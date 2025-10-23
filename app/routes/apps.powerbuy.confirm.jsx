// app/routes/apps.powerbuy.confirm.jsx
import { prisma } from "../db.server";
import { runAdminQuery } from "../shopify-admin.server";
import { sendEmail } from "../email.server";

function html(body) {
  return new Response(`<!doctype html><html><body>${body}</body></html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function loader({ request }) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const shop = url.searchParams.get("shop") || process.env.SHOP_CUSTOM_DOMAIN || process.env.SHOPIFY_STORE_DOMAIN;

  if (!token) return html("<h1>Missing token</h1>");
  if (!shop) return html("<h1>Missing shop</h1>");

  const pending = await prisma.tbl_powerbuy_requests.findUnique({ where: { token } });
  if (!pending) return html("<h1>Invalid token</h1>");
  if (pending.confirmed_at) return html("<h1>Already confirmed</h1>");
  if (pending.token_expires < new Date()) return html("<h1>Token expired</h1>");

  const config = await prisma.tbl_powerbuy_config.findUnique({ where: { id: pending.powerbuy_id } });
  if (!config) return html("<h1>Offer configuration not found</h1>");

  // Build discount code + payload
  const code = (() => {
    const prefix = (config.discount_prefix || "RSLPB").replace(/[^A-Z0-9]/gi, "");
    const base = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${prefix}-${base}`;
  })();

  const startsAt = config.start_time ? new Date(config.start_time).toISOString() : null;
  const endsAt = config.end_time ? new Date(config.end_time).toISOString() : null;
  const usageLimit = config.number_of_uses ?? 12;
  const productGid = config.powerbuy_product_id;

  const discountType = config.discount_type ?? "percentage";
  const discountValue = Number(config.discount_value ?? 10);
  const currencyCode = process.env.SHOP_CURRENCY || "USD";

  const discount =
    discountType === "fixed"
      ? { amount: { amount: String(discountValue), currencyCode } }
      : { percentage: { value: discountValue } };

  const mutation = `#graphql
    mutation discountCodeBasicCreate($basic: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicDiscount: $basic) {
        userErrors { field message }
        codeDiscountNode { id }
      }
    }
  `;

  const variables = {
    basic: {
      title: `Powerbuy ${code}`,
      startsAt,
      endsAt,
      usageLimit,
      customerSelection: { all: true },
      appliesOncePerCustomer: false,
      items: { products: [productGid] },
      codes: [code],
      discount,
    },
  };

  let gid;
  try {
    const resp = await runAdminQuery(shop, mutation, variables);
    const body = resp?.body;
    const node = body?.data?.discountCodeBasicCreate?.codeDiscountNode;
    const err = body?.data?.discountCodeBasicCreate?.userErrors?.[0]?.message;
    if (!node || err) {
      throw new Error(err || "Failed to create discount code");
    }
    gid = node.id;
  } catch (e) {
    return html(`<h1>Failed to create discount</h1><pre>${(e && e.message) || e}</pre>`);
  }

  await prisma.tbl_powerbuy_codes.create({
    data: {
      powerbuy_id: config.id,
      discount_code: code,
      discount_code_gid: gid,
      short_description: config.short_description ?? null,
      long_description: config.long_description ?? "",
      confirmation_email_content: config.confirmation_email_content ?? null,
      acceptance_email_content: config.acceptance_email_content ?? null,
      rsl_contact_email_address: config.rsl_contact_email_address ?? null,
      start_time: config.start_time ?? null,
      end_time: config.end_time ?? null,
      number_of_uses: usageLimit,
      powerbuy_product_id: productGid ?? null,
    },
  });

  await prisma.tbl_powerbuy_requests.update({
    where: { id: pending.id },
    data: { confirmed_at: new Date() },
  });

  const subject = config.title ? `Your Powerbuy code for ${config.title}` : "Your Powerbuy code";
  const htmlBody = `
    <p>Hi ${pending.name},</p>
    <p>Your Powerbuy code is: <strong>${code}</strong></p>
    <p>Valid ${startsAt ? `from ${new Date(startsAt).toLocaleDateString()}` : "now"}${endsAt ? ` until ${new Date(endsAt).toLocaleDateString()}` : ""}.</p>
    <p>This code can be used up to ${usageLimit} times by anyone who has it.</p>
    <p>Product: ${productGid}</p>
    <hr />
    <div>${config.acceptance_email_content ?? ""}</div>
    ${config.rsl_contact_email_address ? `<p>Questions? Contact: ${config.rsl_contact_email_address}</p>` : ""}
  `;
  try {
    await sendEmail({ to: pending.email, subject, html: htmlBody });
  } catch (e) {
    // do not block confirmation page on email failure
  }

  return html(`<h1>Thanks! You're confirmed.</h1><p>We just sent your Powerbuy code to <strong>${pending.email}</strong>.</p>`);
}

export const action = () => new Response("Method Not Allowed", { status: 405 });

export default function Empty() { return null; }
