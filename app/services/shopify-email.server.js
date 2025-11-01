// app/lib/shopify-email.server.js
import { getOfflineSession } from "~/shopify-admin.server";

const FALLBACK_VERSION = "unstable";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";

/**
 * Low-level GraphQL caller that can auto-fallback to the 'unstable' API
 * when Email Campaign types/mutations are not on the current stable version.
 */
async function callEmailGql({ shop, accessToken, query, variables }) {
  async function post(version) {
    const res = await fetch(`https://${shop}/admin/api/${version}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
    return { ok: res.ok, status: res.status, payload };
  }

  // try configured version first
  let out = await post(API_VERSION);
  const schemaError =
    !out.ok ||
    out?.payload?.errors ||
    (out?.payload?.data && Object.values(out.payload.data).some(x => x?.userErrors?.length));

  if (schemaError) {
    // if the error suggests missing types/fields, try 'unstable'
    const looksLikeSchemaMiss =
      JSON.stringify(out?.payload || "").match(/Unknown|Field .* doesn't exist|Invalid field/i);
    if (looksLikeSchemaMiss) out = await post(FALLBACK_VERSION);
  }
  return out;
}

/**
 * Sends a simple one-off email via Shopify Email Campaigns API.
 * Subject + HTML body, to a single recipient.
 *
 * NOTE: This uses mutations commonly surfaced as:
 *   - emailCampaignCreate
 *   - emailCampaignSend
 * If your shop or scopes don’t expose these, you’ll get a clear error.
 */
export async function sendShopifyEmail({
                                         shop,
                                         to,
                                         subject,
                                         html,
                                         fromName,        // optional (Shopify will use shop defaults if omitted)
                                         fromEmail,       // optional
                                       }) {
  if (!shop || !to || !subject || !html) {
    return { ok: false, error: "Missing required email fields." };
  }

  // get offline admin access
  const offline = await getOfflineSession(shop);
  if (!offline?.accessToken) {
    return { ok: false, error: `No offline Admin session for ${shop}. Re-install the app.` };
  }

  // 1) create a campaign
  const createQuery = `
    mutation emailCampaignCreate($input: EmailCampaignCreateInput!) {
      emailCampaignCreate(input: $input) {
        emailCampaign { id status }
        userErrors { field message }
      }
    }
  `;
  const createVars = {
    input: {
      subject,
      bodyHtml: html,
      // fromName / fromEmail are optional; Shopify Email uses the shop's defaults
      ...(fromName ? { fromName } : {}),
      ...(fromEmail ? { fromEmail } : {}),
      recipients: { to: [to] },
    },
  };

  const created = await callEmailGql({
    shop, accessToken: offline.accessToken, query: createQuery, variables: createVars,
  });

  const ce = created?.payload?.data?.emailCampaignCreate;
  const ceErr = created?.payload?.errors || ce?.userErrors;
  const campaignId = ce?.emailCampaign?.id;

  if (!campaignId) {
    return {
      ok: false,
      error: `emailCampaignCreate failed`,
      detail: ceErr || created?.payload || { status: created?.status },
    };
  }

  // 2) send the campaign
  const sendQuery = `
    mutation emailCampaignSend($id: ID!) {
      emailCampaignSend(id: $id) {
        job { id }
        userErrors { field message }
      }
    }
  `;
  const sent = await callEmailGql({
    shop, accessToken: offline.accessToken, query: sendQuery, variables: { id: campaignId },
  });

  const se = sent?.payload?.data?.emailCampaignSend;
  const seErr = sent?.payload?.errors || se?.userErrors;

  if (seErr && seErr.length) {
    return { ok: false, error: "emailCampaignSend failed", detail: seErr };
  }

  return { ok: true, id: campaignId };
}

/* ---------------- Convenience wrappers for PowerBuy ---------------- */

export async function sendPowerBuyRequestEmail({ shop, to, confirmUrl, cfg, customerName }) {
  const short = String(cfg?.short_description || cfg?.title || "PowerBuy");
  const subject = `Confirm your PowerBuy: ${short}`;
  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5">
      <h2 style="margin:0 0 12px">Confirm your email to reserve your PowerBuy</h2>
      <p style="margin:0 0 16px">Hi${customerName ? " " + customerName : ""}, click the button below to confirm your email and get your PowerBuy code.</p>
      <p style="margin:0 0 16px">
        <a href="${confirmUrl}" style="display:inline-block;padding:10px 16px;border-radius:6px;background:#008060;color:#fff;text-decoration:none">
          Confirm my email
        </a>
      </p>
      <p style="font-size:12px;color:#666;margin-top:24px">If the button doesn’t work, paste this into your browser:<br>${confirmUrl}</p>
    </div>
  `;
  return sendShopifyEmail({ shop, to, subject, html });
}

export async function sendPowerBuyConfirmEmail({
                                                 shop, to, discountCode, startsAtUtc, endsAtUtc, cfg,
                                               }) {
  const short = String(cfg?.short_description || cfg?.title || "PowerBuy");
  const subject = `Your PowerBuy code for ${short}`;
  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5">
      <h2 style="margin:0 0 12px">You're in! 🎉</h2>
      <p style="margin:0 0 12px">Here is your PowerBuy code:</p>
      <p style="font-weight:700;font-size:18px;margin:0 0 16px">${discountCode}</p>
      <p style="margin:0 0 16px">
        Active window (UTC):<br>
        <b>${new Date(startsAtUtc).toUTCString()}</b> → <b>${new Date(endsAtUtc).toUTCString()}</b>
      </p>
      <p style="font-size:12px;color:#666;margin-top:24px">Tip: copy and paste the code at checkout.</p>
    </div>
  `;
  return sendShopifyEmail({ shop, to, subject, html });
}
