// app/services/mailer.server.js
// Server-only mailer that reads SMTP + email text from tbl_powerbuy_config.
// Uses dynamic import of "nodemailer" so Vite/SSR don't try to bundle it.

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

/**
 * Send the "request" email with a confirm URL.
 * Replaces {{name}} and {{confirmUrl}} if confirmation_email_content is provided.
 * Honors tbl_powerbuy_config.use_request_email_override + request_email_override.
 */
export async function sendRequestEmail({ powerbuyId, to, name, confirmUrl }) {
  const pb = await getPowerbuy(powerbuyId);
  const transport = await createSmtpTransportFromDb(pb);
  const from = resolveFromHeader(pb);
  const subject = pb.request_email_subject ?? "Confirm your PowerBuy request";

  const recipient = resolveRecipient(pb, to);

  const html =
    pb.confirmation_email_content
      ? pb.confirmation_email_content
        .replace(/\{\{name\}\}/g, escapeHtml(name))
        .replace(/\{\{confirmUrl\}\}/g, confirmUrl)
      : `
<p>Hi ${escapeHtml(name)},</p>
<p>Confirm your PowerBuy request:</p>
<p><a href="${confirmUrl}">${confirmUrl}</a></p>`.trim();

  const text = `Hi ${name ?? ""}

Confirm your PowerBuy request:

${confirmUrl}
`.trim();

  await transport.sendMail({ from, to: recipient, subject, html, text });
}

/**
 * Send the "confirm" email with the discount code.
 * Replaces {{discountCode}}, {{startAt}}, {{expiresAt}} if acceptance_email_content is provided.
 * Now ALSO honors use_request_email_override + request_email_override.
 */
export async function sendConfirmEmail({
                                         powerbuyId,
                                         to,
                                         discountCode,
                                         startAt,   // Date or ISO string (optional)
                                         expiresAt, // Date or ISO string (optional)
                                       }) {
  const pb = await getPowerbuy(powerbuyId);
  const transport = await createSmtpTransportFromDb(pb);
  const from = resolveFromHeader(pb);
  const subject = pb.confirm_email_subject ?? "Your PowerBuy code";

  const recipient = resolveRecipient(pb, to);

  const startStr = startAt ? new Date(startAt).toLocaleString() : "";
  const expStr = expiresAt ? new Date(expiresAt).toLocaleString() : "";

  const html =
    pb.acceptance_email_content
      ? pb.acceptance_email_content
        .replace(/\{\{discountCode\}\}/g, escapeHtml(discountCode))
        .replace(/\{\{startAt\}\}/g, escapeHtml(startStr))
        .replace(/\{\{expiresAt\}\}/g, escapeHtml(expStr))
      : `
<p>Your PowerBuy code:</p>
<p><strong>${escapeHtml(discountCode)}</strong></p>
${expStr ? `<p>Expires: ${escapeHtml(expStr)}</p>` : ""}`.trim();

  const text = `Your PowerBuy code: ${discountCode}${
    expStr ? `\nExpires: ${expStr}` : ""
  }`.trim();

  await transport.sendMail({ from, to: recipient, subject, html, text });
}

/** Optional: verify SMTP creds for a given PowerBuy row */
export async function verifyMailer(powerbuyId) {
  const pb = await getPowerbuy(powerbuyId);
  const transport = await createSmtpTransportFromDb(pb);
  return transport.verify(); // resolves true or throws
}
