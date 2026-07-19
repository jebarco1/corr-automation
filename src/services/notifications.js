import axios from "axios";
import { getDb, makeId, nowIso } from "../db/sqlite.js";

function logNotification(vendorId, channel, to, subject, body, status, provider, meta = {}) {
  const id = makeId("ntf");
  getDb().prepare(`
    INSERT INTO notification_log (id, vendor_id, channel, to_addr, subject, body, status, provider, meta_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, vendorId, channel, to, subject || null, body || null, status, provider || "log",
    JSON.stringify(meta), nowIso()
  );
  return { id, channel, to, subject, status, provider };
}

export async function sendEmail({ vendorId, to, subject, body, meta = {} }) {
  if (!to) return { skipped: true, reason: "no recipient" };
  const apiKey = process.env.SENDGRID_API_KEY || process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM_EMAIL || "noreply@ha-corr.local";

  if (process.env.SENDGRID_API_KEY) {
    try {
      await axios.post("https://api.sendgrid.com/v3/mail/send", {
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from },
        subject,
        content: [{ type: "text/plain", value: body }]
      }, {
        headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}` },
        validateStatus: () => true
      });
      return logNotification(vendorId, "email", to, subject, body, "sent", "sendgrid", meta);
    } catch (error) {
      return logNotification(vendorId, "email", to, subject, body, "failed", "sendgrid", {
        ...meta, error: error.message
      });
    }
  }

  if (process.env.RESEND_API_KEY) {
    try {
      await axios.post("https://api.resend.com/emails", {
        from, to: [to], subject, text: body
      }, {
        headers: { Authorization: `Bearer ${apiKey}` },
        validateStatus: () => true
      });
      return logNotification(vendorId, "email", to, subject, body, "sent", "resend", meta);
    } catch (error) {
      return logNotification(vendorId, "email", to, subject, body, "failed", "resend", {
        ...meta, error: error.message
      });
    }
  }

  console.log(`[email:log] to=${to} subject=${subject}`);
  return logNotification(vendorId, "email", to, subject, body, "logged", "console", meta);
}

export async function sendSms({ vendorId, to, body, meta = {} }) {
  if (!to) return { skipped: true, reason: "no recipient" };
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (sid && token && from) {
    try {
      const auth = Buffer.from(`${sid}:${token}`).toString("base64");
      await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        new URLSearchParams({ To: to, From: from, Body: body }).toString(),
        {
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          validateStatus: () => true
        }
      );
      return logNotification(vendorId, "sms", to, null, body, "sent", "twilio", meta);
    } catch (error) {
      return logNotification(vendorId, "sms", to, null, body, "failed", "twilio", {
        ...meta, error: error.message
      });
    }
  }

  console.log(`[sms:log] to=${to} body=${body}`);
  return logNotification(vendorId, "sms", to, null, body, "logged", "console", meta);
}

export function listNotifications(vendorId, limit = 50) {
  return getDb().prepare(`
    SELECT id, channel, to_addr as "to", subject, body, status, provider, created_at as createdAt
    FROM notification_log WHERE vendor_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(vendorId, Math.min(Number(limit) || 50, 200));
}
