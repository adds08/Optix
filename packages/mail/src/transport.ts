import nodemailer from "nodemailer";

export type MailConfig = {
  host: string;
  port: number;
  user: string | null;
  pass: string | null;
  from: string;
};

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendResult = { ok: true } | { ok: false; error: string };

/*
  Delivery, with the console fallback that lets the rest of the auth flow work
  before anyone has entered SMTP credentials — the same shape as
  `llmConfigFor` in `routers/settings.ts`: one config resolver whose absence
  means "print, don't send" rather than a startup error.

  `config: null` is the unconfigured case, not a malformed one. A fresh stack
  and a tenant that has never visited Settings both hit it, and invites,
  resets and the notification queue all need to keep working right up to the
  point something actually needs the mail to arrive on a real inbox.
*/
export async function sendMail(config: MailConfig | null, message: MailMessage): Promise<SendResult> {
  if (!config) {
    console.log(`[mail:console] to=${message.to} subject="${message.subject}"\n${message.text}`);
    return { ok: true };
  }

  try {
    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      /* 465 is SMTPS (implicit TLS); everything else — 587 included — starts
         plain and upgrades with STARTTLS, which nodemailer negotiates on its
         own when `secure` is false. */
      secure: config.port === 465,
      auth: config.user ? { user: config.user, pass: config.pass ?? "" } : undefined,
    });
    await transport.sendMail({
      from: config.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    return { ok: true };
  } catch (e) {
    /* The provider's own words are the useful part — same reasoning as
       `testLlm`'s error handling: "wrong port" and "auth failed" need
       different fixes, and both look identical from the caller's side until
       something actually tries to send. */
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
