// app/email.server.js
import sg from "@sendgrid/mail";

if (process.env.SENDGRID_API_KEY) {
  sg.setApiKey(process.env.SENDGRID_API_KEY);
}

export async function sendEmail({ to, subject, html }) {
  if (!process.env.SENDGRID_API_KEY) {
    console.warn("SENDGRID_API_KEY not set; skipping email send to", to);
    return;
  }
  const from = process.env.FROM_EMAIL || "no-reply@rslspeakers.com";
  await sg.send({ to, from, subject, html });
}
