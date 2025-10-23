// app/routes/apps.powerbuy.requests.jsx
import { json } from "@remix-run/node";
import { prisma } from "../db.server";
import { sendEmail } from "../email.server";
import crypto from "node:crypto";

async function verifyRecaptcha(token) {
  const params = new URLSearchParams({ secret: process.env.RECAPTCHA_SECRET || "", response: token });
  const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = await res.json();
  if (!data.success || (typeof data.score === "number" && data.score < 0.5)) {
    throw new Error("captcha_failed");
  }
}

export async function action({ request }) {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, { status: 405 });
  }

  const ct = request.headers.get("content-type") || "";
  let name, email, product_id, captcha_token;
  if (ct.includes("application/json")) {
    const b = await request.json();
    name = b.name;
    email = b.email;
    product_id = b.product_id;
    captcha_token = b.captcha_token;
  } else {
    const fd = await request.formData();
    name = fd.get("name");
    email = fd.get("email");
    product_id = fd.get("product_id");
    captcha_token = fd.get("captcha_token");
  }

  if (!name || !email || !product_id || !captcha_token) {
    return json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    await verifyRecaptcha(captcha_token);
  } catch {
    return json({ error: "captcha_failed" }, { status: 400 });
  }

  const now = new Date();
  const config = await prisma.tbl_powerbuy_config.findFirst({
    where: { powerbuy_product_id: product_id, start_time: { lte: now }, end_time: { gte: now } },
  });
  if (!config) {
    return json({ error: "no_active_offer_for_product" }, { status: 404 });
  }

  const existing = await prisma.tbl_powerbuy_requests.findFirst({
    where: { email, powerbuy_id: config.id, confirmed_at: null },
  });
  if (existing) {
    return json({ error: "pending_confirmation_exists" }, { status: 409 });
  }

  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24);

  await prisma.tbl_powerbuy_requests.create({
    data: {
      name,
      email,
      product_id,
      powerbuy_id: config.id,
      token,
      token_expires: expires,
      request_ip: (request.headers.get("x-forwarded-for") || "").split(",")[0] || null,
    },
  });

  const origin = new URL(request.url).origin;
  const confirmUrl = `${origin}/apps/powerbuy/confirm?token=${encodeURIComponent(token)}`;

  const subject = config.title ? `Confirm your Powerbuy: ${config.title}` : "Confirm your Powerbuy";
  const html = `
    <p>Hi ${name},</p>
    <p>Please confirm your Powerbuy request by clicking the link below:</p>
    <p><a href="${confirmUrl}">Confirm Powerbuy</a></p>
    <hr/>
    <div>${config.confirmation_email_content ?? ""}</div>
  `;

  await sendEmail({ to: email, subject, html });

  return json({ status: "ok" });
}

export function loader() {
  return json({ error: "method_not_allowed" }, { status: 405 });
}

export default function Empty() { return null; }
