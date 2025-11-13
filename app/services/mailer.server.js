// app/services/mailer.server.js
// Server-only mailer that reads SMTP + email text from tbl_powerbuy_config.
// Supports URL-based templates, preserves line breaks for plain text,
// and converts newlines to <br> for HTML templates (DB or URL).

import { prisma } from "~/db.server";

let _nm;
/** Lazy-load nodemailer to keep it external from the SSR bundle */
async function getNodemailer() {
  if (!_nm) {
    const mod = await import("nodemailer");
    _nm = mod.default ?? mod;
  }
  return _nm;
}

/** Fetch the PowerBuy config row */
async function getPowerbuy(powerbuyId) {
  const id = Number(powerbuyId);
  const pb = await prisma.tbl_powerbuy_config.findFirst({ where: { id } });
  if (!pb) throw new Error(`PowerBuy config ${id} not found`);
  return pb;
}

/** Build the SMTP transport from DB columns */
async function createSmtpTransportFromDb(pb) {
  const host = pb.mailer_smtp_host;
  const port = Number(pb.mailer_smtp_port ?? 587);
  const secure =
    String(pb.mailer_smtp_secure ?? "")
      .toLowerCase()
      .trim() === "true" || port === 465;

  const user = pb.mailer_smtp_user;
  const pass = pb.mailer_smtp_pass;

  if (!host || !user || !pass) {
    throw new Error(
      "Missing SMTP settings in tbl_powerbuy_config (mailer_* columns)."
    );
  }

  const nodemailer = await getNodemailer();
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

function resolveFromHeader(pb) {
  // Prefer explicit header; fall back to contact email; then a safe default
  return (
    pb.mailer_from_header ??
    pb.rsl_contact_email_address ??
    "RSL Speakers <no-reply@rslspeakers.com>"
  );
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Very simple HTML→text conversion for the plaintext email body */
function htmlToText(html) {
  let s = String(html ?? "");
  // Breaks for common block elements
  s = s.replace(/<\s*br\s*\/?>/gi, "\n");
  s = s.replace(/<\/\s*(p|div|li|h[1-6]|tr|section|article)\s*>/gi, "\n");
  // Remove tags
  s = s.replace(/<[^>]+>/g, "");
  // Decode a few common entities
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // Collapse excessive blank lines
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function coerceTruthy(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string")
    return ["true", "1", "yes", "y", "on"].includes(v.trim().toLowerCase());
  return false;
}

/** Decide who actually receives the email (shared for request + confirm) */
function resolveRecipient(pb, fallbackTo) {
  const useOverride = coerceTruthy(pb.use_request_email_override);
  const overrideTo = (pb.request_email_override || "").trim();
  return useOverride && overrideTo ? overrideTo : fallbackTo;
}

/* ---------------------------
   Template utilities
----------------------------*/

/** Validate http(s) URL */
function isValidHttpUrl(u) {
  try {
    const url = new URL(String(u || "").trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Fetch text from a URL with a timeout; uses global fetch or node-fetch fallback */
async function fetchText(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const _fetch =
      typeof fetch === "function" ? fetch : (await import("node-fetch")).default;
    const res = await _fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.text())?.trim() ?? "";
  } finally {
    clearTimeout(timer);
  }
}

/** Replace {{token}} with provided values (global, literal match) for HTML templates */
function replaceTokens(str, tokens) {
  let out = String(str ?? "");
  for (const [key, value] of Object.entries(tokens || {})) {
    const re = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    out = out.replace(re, value ?? "");
  }
  return out;
}

/** Replace {{token}} in plain text (no escaping) */
function replaceTokensPlain(str, tokens) {
  return replaceTokens(str, tokens);
}

/** Treat strings with HTML tags as HTML; otherwise plain text (loose) */
function looksLikeHtml(s) {
  return /<\/?[a-z][\s\S]*>/i.test(String(s || ""));
}

/** Build HTML from a *plain text* template with tokens and preserved line breaks */
function htmlFromPlainTextTemplate(template, tokens, unescapedKeys = []) {
  let src = String(template ?? "");
  // Sentinel-mark tokens so we can escape the rest safely, then restore
  const markers = {};
  for (const k of Object.keys(tokens || {})) {
    const marker = `\uFFF0${k}\uFFF1`;
    markers[k] = marker;
    src = src.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), marker);
  }
  // Escape entire template, then restore each token with the right escaping
  let html = escapeHtml(src);
  for (const [k, marker] of Object.entries(markers)) {
    const reMarker = new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    const val = String(tokens[k] ?? "");
    const replacement = unescapedKeys.includes(k) ? val : escapeHtml(val);
    html = html.replace(reMarker, replacement);
  }
  // Finally, honor line breaks
  return html.replace(/\r?\n/g, "<br>");
}

/** Try to read a template string from a pb.*_email_template_url field */
async function getTemplateStringFromUrl(url) {
  if (!isValidHttpUrl(url)) return null;
  try {
    const txt = await fetchText(url);
    return txt || null;
  } catch {
    return null; // swallow fetch errors and let callers fall back
  }
}

/* ---------------------------
   Mailers
----------------------------*/

/**
 * Send the "request" email with a confirm URL.
 * DB plain text is preserved with line breaks.
 * Tokens:
 *  - HTML:    {{name}} (escaped), {{confirmUrl}} (NOT escaped)
 *  - PLAIN:   {{name}}, {{confirmUrl}} (both inserted literally into text)
 */
export async function sendRequestEmail({ powerbuyId, to, name, confirmUrl }) {
  const pb = await getPowerbuy(powerbuyId);
  const transport = await createSmtpTransportFromDb(pb);
  const from = resolveFromHeader(pb);
  const subject = pb.request_email_subject ?? "Confirm your PowerBuy request";
  const recipient = resolveRecipient(pb, to);

  let html = null;
  let text = null;

  // Pull template from URL (optional) or DB content
  let tpl = null;
  const requestUrlTpl = (pb.request_email_template_url || "").trim() || null;
  if (requestUrlTpl) {
    tpl = await getTemplateStringFromUrl(requestUrlTpl);
  }
  if (!tpl && pb.request_email_content) {
    tpl = pb.request_email_content;
  }

  if (tpl) {
    const tokens = { name: name ?? "", confirmUrl: confirmUrl ?? "" };

    if (looksLikeHtml(tpl)) {
      // HTML template (URL or DB): replace tokens then force \n → <br>
      const replaced = replaceTokens(tpl, {
        name: escapeHtml(tokens.name),
        confirmUrl: confirmUrl, // unescaped by design
      });
      html = replaced.replace(/\r?\n/g, "<br>\n");
      // Plaintext mirrors tokens in the original HTML, then strip tags
      const textRaw = replaceTokensPlain(tpl, tokens);
      text = htmlToText(textRaw);
    } else {
      // PLAIN TEXT template (URL or DB): preserve line breaks in HTML and text
      const textBody = replaceTokensPlain(tpl, tokens);
      text = textBody;
      html = htmlFromPlainTextTemplate(
        tpl,
        tokens,
        /* unescaped keys in HTML: */ ["confirmUrl"]
      );
    }
  } else {
    // Last resort default
    html = `
<p>Hi ${escapeHtml(name)},</p>
<p>Confirm your PowerBuy request:</p>
<p><a href="${confirmUrl}">${confirmUrl}</a></p>`.trim();
    text = `Hi ${name ?? ""}

Confirm your PowerBuy request:

${confirmUrl}`.trim();
  }

  await transport.sendMail({ from, to: recipient, subject, html, text });
}

/**
 * Send the "confirm" email with the discount code.
 * DB plain text is preserved with line breaks (parity with request email).
 * Accepts startAt or startsAt for compatibility with callers.
 */
export async function sendConfirmEmail({
                                         powerbuyId,
                                         to,
                                         discountCode,
                                         startAt,
                                         startsAt,
                                         expiresAt,
                                       }) {
  const pb = await getPowerbuy(powerbuyId);
  const transport = await createSmtpTransportFromDb(pb);
  const from = resolveFromHeader(pb);
  const subject = pb.confirm_email_subject ?? "Your PowerBuy code";
  const recipient = resolveRecipient(pb, to);

  const start = startAt ?? startsAt;
  const startStr = start ? new Date(start).toLocaleString() : "";
  const expStr = expiresAt ? new Date(expiresAt).toLocaleString() : "";

  let html = null;
  let text = null;

  // Pull template from URL (optional) or DB content
  let tpl = null;
  const confirmUrlTpl = (pb.confirm_email_template_url || "").trim() || null;
  if (confirmUrlTpl) {
    tpl = await getTemplateStringFromUrl(confirmUrlTpl);
  }
  if (!tpl && pb.confirm_email_content) {
    tpl = pb.confirm_email_content;
  }

  if (tpl) {
    const tokens = {
      discountCode: String(discountCode ?? ""),
      startAt: String(startStr ?? ""),
      startsAt: String(startStr ?? ""),
      expiresAt: String(expStr ?? ""),
    };

    if (looksLikeHtml(tpl)) {
      // HTML template (URL or DB): replace tokens then force \n → <br>
      const replaced = replaceTokens(tpl, {
        discountCode: escapeHtml(tokens.discountCode),
        startAt: escapeHtml(tokens.startAt),
        startsAt: escapeHtml(tokens.startsAt),
        expiresAt: escapeHtml(tokens.expiresAt),
      });
      html = replaced.replace(/\r?\n/g, "<br>\n");
      const textRaw = replaceTokensPlain(tpl, tokens);
      text = htmlToText(textRaw);
    } else {
      // PLAIN TEXT template (URL or DB)
      const textBody = replaceTokensPlain(tpl, tokens);
      text = textBody;
      html = htmlFromPlainTextTemplate(tpl, tokens);
    }
  } else {
    html = `
<p>Your PowerBuy code:</p>
<p><strong>${escapeHtml(discountCode)}</strong></p>
${expStr ? `<p>Expires: ${escapeHtml(expStr)}</p>` : ""}`.trim();
    text = `Your PowerBuy code: ${discountCode}${
      expStr ? `\nExpires: ${expStr}` : ""
    }`.trim();
  }

  await transport.sendMail({ from, to: recipient, subject, html, text });
}

/** Optional: verify SMTP creds for a given PowerBuy row */
export async function verifyMailer(powerbuyId) {
  const pb = await getPowerbuy(powerbuyId);
  const transport = await createSmtpTransportFromDb(pb);
  return transport.verify(); // resolves true or throws
}
