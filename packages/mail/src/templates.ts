/*
  Email templates: layout in code, not a database table.

  A handful of emails that change twice a year do not earn a tenant-editable
  template store — that is a second surface (a table, a preview screen, an
  HTML-injection review) for content nobody has asked to customise. If a
  tenant ever wants their own wording, that is a real feature to scope, not a
  default to build here.

  HTML and plain text are written together for every template. Plain text is
  not a lesser fallback: some inboxes show it first, and it is what a screen
  reader gets when the HTML is malformed.

  Every piece of tenant- or user-supplied text (names, the tenant name) is run
  through `esc` before it reaches the HTML — these are the only templates in
  the codebase that interpolate untrusted strings into markup an email client
  will render.

  THE PRODUCT IS OPTIX. These templates said "STInventory" in the header, the
  footer, every subject line and most body copy until 2026-09-11. STInventory
  is the repository and the package scope; it is not a name a customer should
  ever be shown. Nothing here may reintroduce it.
*/

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/*
  The brand palette, literal.

  These are the artwork's own colours (apps/web/components/optix-mark.tsx and
  globals.css), repeated here rather than imported because this package must
  not depend on the web app — and because an email cannot read a CSS variable
  anyway. If the brand changes, both move together.
*/
const NAVY = "#082F49";
const YELLOW = "#FFCA00";
const INK = "#1A1A1A";
const MUTED = "#6B7280";
const RULE = "#E4E7EB";
const PAPER = "#F4F5F6";

export const PRODUCT = "Optix";
export const COMPANY = "Optix Technologies";

export type EmailContent = { subject: string; html: string; text: string };

/*
  THE MARK, BUILT OUT OF A BORDER RATHER THAN AN IMAGE.

  The short mark is the wordmark's "O" — a yellow ring on the navy plate. Every
  obvious way to put that in an email is worse than this one:

  - An <svg> is stripped by Gmail, Outlook and Yahoo outright.
  - A remote <img> is blocked by default in most clients, so the header would
    be an empty box until the reader clicks "show images" — for a transactional
    mail that is the first impression.
  - A data: URI <img> is blocked by Outlook and stripped by Gmail.

  A div with equal width, height, border-radius and a thick border is none of
  those: it is a ring, drawn by the layout engine, that renders everywhere with
  images off. The proportions follow the artwork — the stroke is 8% of the
  height there, and 3px on a 34px ring here is 8.8%, which is as close as whole
  pixels allow.

  Outlook's Word engine ignores border-radius and will square the ring. That is
  an accepted, deliberate degradation: a navy plate with a yellow square is
  still legibly the brand, and the alternative is VML nobody can maintain.
*/
function optixMark(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>
    <td style="width:34px;height:34px;">
      <div style="width:28px;height:28px;border:3px solid ${YELLOW};border-radius:17px;font-size:0;line-height:0;">&nbsp;</div>
    </td>
    <td style="padding-left:10px;color:#FFFFFF;font-size:17px;font-weight:600;letter-spacing:0.2px;white-space:nowrap;">${PRODUCT}</td>
  </tr></table>`;
}

/*
  Shared chrome around every message. Inline styles throughout — email clients
  do not reliably load a `<style>` block, let alone an external sheet. System
  font stack rather than the product's own (Inter Tight): a web font never
  loads in an email client, and naming one that silently falls back to
  `system-ui` everywhere would be worse than asking for `system-ui` outright.

  The tenant's name carries the "whose account is this" job in the footer and
  in the body copy. It is deliberately NOT a tenant logo: this package has no
  way to know where a tenant's artwork lives, and a broken <img> in the header
  of a password-reset email is worse than a name set in type.
*/
function layout(opts: { preheader: string; bodyHtml: string; tenantName: string }): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background:#FFFFFF;border:1px solid ${RULE};border-radius:8px;overflow:hidden;">
        <tr><td style="background:${NAVY};padding:22px 28px;">
          ${optixMark()}
        </td></tr>
        <tr><td style="padding:30px 28px;">
          ${opts.bodyHtml}
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid ${RULE};background:#FAFBFC;">
          <p style="margin:0 0 4px;font-size:12px;line-height:1.5;color:${MUTED};">
            Sent to you for <strong style="color:${INK};font-weight:600;">${esc(opts.tenantName)}</strong>.
          </p>
          <p style="margin:0;font-size:12px;line-height:1.5;color:${MUTED};">
            ${PRODUCT} by ${COMPANY} — small tools and equipment custody.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/*
  The action button.

  `bgcolor` on the <td> as well as the inline background: Outlook honours the
  attribute and is unreliable about the style, and a button whose background
  drops out is navy text on white — invisible as a call to action.
*/
function button(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;"><tr>
    <td bgcolor="${NAVY}" style="background:${NAVY};border-radius:6px;">
      <a href="${url}" style="display:inline-block;padding:13px 26px;color:#FFFFFF;font-size:15px;font-weight:600;text-decoration:none;">${esc(label)}</a>
    </td>
  </tr></table>`;
}

/* Falls back to plain link text when a client strips buttons — never leave
   the plain-text version relying on markup that will not render there. */
function linkFallback(url: string): string {
  return `<p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:${MUTED};word-break:break-all;">Or paste this link into your browser:<br><a href="${url}" style="color:${NAVY};">${esc(url)}</a></p>`;
}

/* The small print under an expiring link. One helper so the four templates
   that carry a token cannot word the same caveat four different ways. */
function expiryNote(expiresHuman: string, unexpected: string): string {
  return `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${RULE};font-size:12px;line-height:1.6;color:${MUTED};">This link expires in ${esc(expiresHuman)}. ${esc(unexpected)}</p>`;
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 14px;font-size:20px;font-weight:600;line-height:1.3;color:${INK};">${esc(text)}</h1>`;
}

function para(html: string): string {
  return `<p style="margin:0 0 10px;font-size:15px;line-height:1.65;color:${INK};">${html}</p>`;
}

/* "Hi Dave," — or just "Hi," when we were never given a first name. Several
   callers pass "" on purpose (the reset-by-admin path has no name in hand),
   and "Hi ," is the kind of detail that makes a real email look generated. */
function greeting(firstName: string): string {
  const name = firstName.trim();
  return name ? `Hi ${esc(name)},` : "Hi,";
}

function greetingText(firstName: string): string {
  const name = firstName.trim();
  return name ? `Hi ${name},` : "Hi,";
}

export function inviteEmail(input: {
  tenantName: string;
  recipientFirstName: string;
  inviterLabel: string;
  roleName: string | null;
  inviteUrl: string;
  expiresHuman: string;
  /* A resend is the same invite with the same link — only the framing changes,
     so the reader understands why a second copy has arrived rather than
     wondering whether they were invited twice. */
  resend?: boolean;
}): EmailContent {
  const { tenantName, recipientFirstName, inviterLabel, roleName, inviteUrl, expiresHuman, resend } = input;
  const roleLine = roleName ? ` as ${esc(roleName)}` : "";
  const roleLineText = roleName ? ` as ${roleName}` : "";
  const subject = resend
    ? `Your invite to ${tenantName} on ${PRODUCT} (resent)`
    : `You're invited to ${tenantName} on ${PRODUCT}`;

  const html = layout({
    tenantName,
    preheader: resend
      ? `Here is your ${tenantName} invite again — the earlier link no longer works.`
      : `${inviterLabel} invited you to ${tenantName} on ${PRODUCT}.`,
    bodyHtml: `
      ${heading(resend ? "Here is your invite again" : "You're invited")}
      ${para(greeting(recipientFirstName))}
      ${
        resend
          ? para(
              `A fresh invite to <strong>${esc(tenantName)}</strong> on ${PRODUCT}${roleLine}. Use the button below — <strong>any earlier invite link has stopped working</strong>, so this is the one to open.`,
            )
          : para(
              `${esc(inviterLabel)} has invited you to <strong>${esc(tenantName)}</strong> on ${PRODUCT}${roleLine}.`,
            )
      }
      ${para(`${PRODUCT} keeps track of who is holding which tool across your jobs, so nobody has to remember where a grinder went.`)}
      ${button(inviteUrl, resend ? "Accept your invite" : "Accept invite")}
      ${linkFallback(inviteUrl)}
      ${expiryNote(expiresHuman, "If you were not expecting it, you can ignore this email.")}
    `,
  });

  const text = [
    subject,
    ``,
    greetingText(recipientFirstName),
    ``,
    resend
      ? `A fresh invite to ${tenantName} on ${PRODUCT}${roleLineText}. Any earlier invite link has stopped working, so use this one.`
      : `${inviterLabel} has invited you to ${tenantName} on ${PRODUCT}${roleLineText}.`,
    ``,
    `${PRODUCT} keeps track of who is holding which tool across your jobs.`,
    ``,
    `Accept your invite: ${inviteUrl}`,
    ``,
    `This link expires in ${expiresHuman}. If you were not expecting it, you can ignore this email.`,
    ``,
    `${PRODUCT} by ${COMPANY}`,
  ].join("\n");

  return { subject, html, text };
}

export function passwordResetEmail(input: {
  tenantName: string;
  recipientFirstName: string;
  resetUrl: string;
  expiresHuman: string;
}): EmailContent {
  const { tenantName, recipientFirstName, resetUrl, expiresHuman } = input;
  const subject = `Reset your ${PRODUCT} password`;

  const html = layout({
    tenantName,
    preheader: `Reset your ${PRODUCT} password for ${tenantName}.`,
    bodyHtml: `
      ${heading("Reset your password")}
      ${para(greeting(recipientFirstName))}
      ${para(`We received a request to reset the password on your <strong>${esc(tenantName)}</strong> account. Choose a new one below.`)}
      ${button(resetUrl, "Reset password")}
      ${linkFallback(resetUrl)}
      ${expiryNote(expiresHuman, "If you did not request this, you can ignore this email — your password will not change.")}
    `,
  });

  const text = [
    subject,
    ``,
    greetingText(recipientFirstName),
    ``,
    `We received a request to reset the password on your ${tenantName} account.`,
    ``,
    `Reset it here: ${resetUrl}`,
    ``,
    `This link expires in ${expiresHuman}. If you did not request this, you can ignore this email — your password will not change.`,
    ``,
    `${PRODUCT} by ${COMPANY}`,
  ].join("\n");

  return { subject, html, text };
}

/*
  No link and no button, deliberately. This is a notice, not an action — the
  password has already changed by the time it sends, and its only job is to
  let the account owner notice a change they did not make. A reset link here
  would be a phishing shape: an unexpected security email with a button.
*/
export function passwordChangedEmail(input: {
  tenantName: string;
  recipientFirstName: string;
}): EmailContent {
  const { tenantName, recipientFirstName } = input;
  const subject = `Your ${PRODUCT} password was changed`;

  const html = layout({
    tenantName,
    preheader: `The password on your ${tenantName} account was just changed.`,
    bodyHtml: `
      ${heading("Password changed")}
      ${para(greeting(recipientFirstName))}
      ${para(`The password on your <strong>${esc(tenantName)}</strong> account was just changed. If this was you, there is nothing to do.`)}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:22px 0 0;"><tr>
        <td style="padding:14px 16px;background:#FFF8E1;border-left:3px solid ${YELLOW};border-radius:4px;">
          <p style="margin:0;font-size:14px;line-height:1.6;color:${INK};">If you did not do this, contact your administrator right away — someone else may have access to the account.</p>
        </td>
      </tr></table>
    `,
  });

  const text = [
    subject,
    ``,
    greetingText(recipientFirstName),
    ``,
    `The password on your ${tenantName} account was just changed. If this was you, there is nothing to do.`,
    ``,
    `If you did not do this, contact your administrator right away — someone else may have access to the account.`,
    ``,
    `${PRODUCT} by ${COMPANY}`,
  ].join("\n");

  return { subject, html, text };
}
