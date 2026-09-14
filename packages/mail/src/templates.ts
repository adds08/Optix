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

/* Where the full logo is served from, relative to the web app's origin. The
   caller supplies the origin — an email cannot know its own host, and every
   message already carries an absolute link to that same origin. */
const LOGO_PATH = "/assets/optix-logo.png";

export const PRODUCT = "Optix";
export const COMPANY = "Optix Technologies";

export type EmailContent = { subject: string; html: string; text: string };

/*
  THE MARK, BUILT OUT OF A BORDER RATHER THAN AN IMAGE.

  The short mark is the wordmark's "O" — a ring beside the word — for the case
  where the caller cannot name an origin to fetch the full logo from. Every
  obvious way to put the real artwork in an email is worse without a host:

  - An <svg> is stripped by Gmail, Outlook and Yahoo outright.
  - A remote <img> needs an origin we do not have here.
  - A data: URI <img> is blocked by Outlook and stripped by Gmail.

  A div with equal width, height, border-radius and a thick border is none of
  those: it is a ring, drawn by the layout engine, that renders everywhere with
  images off. The proportions follow the artwork — the stroke is 8% of the
  height there, and 2px on a 26px ring here is 7.7%, which is as close as whole
  pixels allow.

  NAVY, not the artwork's yellow: this sits on the white page every client
  renders by default, and yellow on white is a mark nobody can read.
  Outlook's Word engine ignores border-radius and will square the ring. That is
  an accepted, deliberate degradation.
*/
function optixMark(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 auto;"><tr>
    <td style="width:26px;height:26px;">
      <div style="width:22px;height:22px;border:2px solid ${NAVY};border-radius:11px;font-size:0;line-height:0;">&nbsp;</div>
    </td>
    <td style="padding-left:8px;color:${INK};font-size:15px;font-weight:700;letter-spacing:0.2px;white-space:nowrap;">${PRODUCT}</td>
  </tr></table>`;
}

/*
  THE FULL LOGO — the supplied navy stadium plate with the yellow wordmark.

  This is the artwork itself, served as a PNG by the web app, rather than the
  drawn-from-a-border short mark above. It is the header whenever the caller
  can name an origin to fetch it from.

  Remote images are blocked by default in many clients, so the header is built
  to survive them: the alt text is the single word "Optix" beside the layout,
  and the width/height attributes reserve the plate's own box so nothing jumps
  when the image is allowed. `optixMark()` remains the fallback for a caller
  with no origin, so no message is ever headerless.

  Sized by attribute as well as style: Outlook honours `width`/`height` on an
  <img> and is unreliable about CSS-only sizing. 100×37 is the artwork's own
  261×96 ratio, kept small on purpose — the header is a signature, not a
  poster, and every pixel of it is a pixel of the message the reader scrolls.
*/
function optixLogo(webOrigin: string): string {
  const src = `${webOrigin.replace(/\/+$/, "")}${LOGO_PATH}`;
  return `<img src="${esc(src)}" width="100" height="37" alt="Optix" style="display:block;margin:0 auto;width:100px;height:37px;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;">`;
}

/*
  Shared chrome around every message.

  FLAT AND MINIMAL, on purpose. No card, no border, no radius, no colour block:
  a white page, one 480px column, the centred logo, a hairline, the message, a
  hairline, one small line. It is the same design language as the sign-in
  screen, so a reset link does not land somebody on a screen that looks like a
  different product. A transactional email is read once and mostly on a phone,
  so every 10px of chrome above the fold is 10px the reader scrolls past — and
  a framed card spends ~80px of height saying nothing.

  Inline styles throughout — email clients do not reliably load a `<style>`
  block, let alone an external sheet. System font stack rather than the
  product's own (Inter Tight): a web font never loads in an email client.

  The tenant's name carries the "whose account is this" job in the footer and
  in the body copy. It is deliberately NOT a tenant logo: this package has no
  way to know where a tenant's artwork lives, and a broken <img> in the header
  of a password-reset email is worse than a name set in type.

  `webOrigin` is optional so a caller with no origin (and every test) still
  renders a complete, branded message using the short mark instead.
*/
function layout(opts: { preheader: string; bodyHtml: string; tenantName: string; webOrigin?: string }): string {
  const origin = (opts.webOrigin ?? "").trim();
  const header = origin ? optixLogo(origin) : optixMark();

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
</head>
<body style="margin:0;padding:0;background:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;padding:22px 16px 28px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;">
        <tr><td align="center" style="padding:0 0 12px;border-bottom:1px solid ${RULE};">${header}</td></tr>
        <tr><td style="padding:18px 0;">
          ${opts.bodyHtml}
        </td></tr>
        <tr><td style="padding:12px 0 0;border-top:1px solid ${RULE};">
          <p style="margin:0;font-size:11.5px;line-height:1.6;color:${MUTED};">
            Sent to you for <strong style="color:${INK};font-weight:600;">${esc(opts.tenantName)}</strong>. <strong style="color:${INK};font-weight:600;">${PRODUCT}</strong> by ${COMPANY} — small tools and equipment custody. This message is transactional; a reply will not be read.
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
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px;"><tr>
    <td bgcolor="${NAVY}" style="background:${NAVY};border-radius:6px;">
      <a href="${url}" style="display:inline-block;padding:11px 22px;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;">${esc(label)}</a>
    </td>
  </tr></table>`;
}

/* Falls back to plain link text when a client strips buttons — never leave
   the plain-text version relying on markup that will not render there. */
function linkFallback(url: string): string {
  return `<p style="margin:12px 0 0;font-size:11.5px;line-height:1.6;color:${MUTED};word-break:break-all;">Or paste this link into your browser:<br><a href="${url}" style="color:${NAVY};">${esc(url)}</a></p>`;
}

/* The small print under an expiring link. One helper so the four templates
   that carry a token cannot word the same caveat four different ways. */
function expiryNote(expiresHuman: string, unexpected: string): string {
  return `<p style="margin:18px 0 0;padding-top:12px;border-top:1px solid ${RULE};font-size:11.5px;line-height:1.6;color:${MUTED};">This link expires in ${esc(expiresHuman)}. ${esc(unexpected)}</p>`;
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 12px;font-size:19px;font-weight:600;line-height:1.35;color:${INK};">${esc(text)}</h1>`;
}

function para(html: string): string {
  return `<p style="margin:0 0 10px;font-size:14px;line-height:1.62;color:${INK};">${html}</p>`;
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
  /* The web app's origin, so the header can fetch the full logo. Optional:
     without it the short mark is used and the message is still complete. */
  webOrigin?: string;
  /* A resend is the same invite with the same link — only the framing changes,
     so the reader understands why a second copy has arrived rather than
     wondering whether they were invited twice. */
  resend?: boolean;
}): EmailContent {
  const { tenantName, recipientFirstName, inviterLabel, roleName, inviteUrl, expiresHuman, resend, webOrigin } = input;
  const roleLine = roleName ? ` as ${esc(roleName)}` : "";
  const roleLineText = roleName ? ` as ${roleName}` : "";
  const subject = resend
    ? `Your invite to ${tenantName} on ${PRODUCT} (resent)`
    : `You're invited to ${tenantName} on ${PRODUCT}`;

  const html = layout({
    tenantName,
    webOrigin,
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
  webOrigin?: string;
}): EmailContent {
  const { tenantName, recipientFirstName, resetUrl, expiresHuman, webOrigin } = input;
  const subject = `Reset your ${PRODUCT} password`;

  const html = layout({
    tenantName,
    webOrigin,
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
  webOrigin?: string;
}): EmailContent {
  const { tenantName, recipientFirstName, webOrigin } = input;
  const subject = `Your ${PRODUCT} password was changed`;

  const html = layout({
    tenantName,
    webOrigin,
    preheader: `The password on your ${tenantName} account was just changed.`,
    bodyHtml: `
      ${heading("Password changed")}
      ${para(greeting(recipientFirstName))}
      ${para(`The password on your <strong>${esc(tenantName)}</strong> account was just changed. If this was you, there is nothing to do.`)}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0 0;"><tr>
        <td style="padding:12px 14px;background:#FFF8E1;border-left:3px solid ${YELLOW};border-radius:4px;">
          <p style="margin:0;font-size:13px;line-height:1.6;color:${INK};">If you did not do this, contact your administrator right away — someone else may have access to the account.</p>
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
