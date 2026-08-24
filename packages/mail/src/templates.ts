/*
  Email templates: layout in code, not a database table.

  Four emails, that change twice a year, do not earn a tenant-editable
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
*/

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BRAND = "#3A6E9E"; // apps/web/app/globals.css --primary, light theme

export type EmailContent = { subject: string; html: string; text: string };

/*
  Shared chrome around every message. Inline styles throughout — email clients
  do not reliably load a `<style>` block, let alone an external sheet. System
  font stack rather than the product's own (Inter Tight): a web font never
  loads in an email client, and naming one that silently falls back to
  `system-ui` everywhere would be worse than asking for `system-ui` outright.
*/
function layout(opts: { preheader: string; bodyHtml: string; tenantName: string }): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border:1px solid #e2e4e7;border-radius:6px;overflow:hidden;">
        <tr><td style="background:${BRAND};padding:20px 28px;">
          <span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;background:#ffffff;color:${BRAND};font-weight:700;font-size:12px;border-radius:3px;vertical-align:middle;">ST</span>
          <span style="color:#ffffff;font-weight:600;font-size:15px;vertical-align:middle;margin-left:8px;">STInventory</span>
        </td></tr>
        <tr><td style="padding:28px;">
          ${opts.bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #e2e4e7;">
          <p style="margin:0;font-size:12px;color:#8a8f98;">${esc(opts.tenantName)} · sent by STInventory, the small tools and equipment custody platform.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:${BRAND};border-radius:4px;">
    <a href="${url}" style="display:inline-block;padding:11px 22px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">${esc(label)}</a>
  </td></tr></table>`;
}

/* Falls back to plain link text when a client strips buttons — never leave
   the plain-text version relying on markup that will not render there. */
function linkFallback(url: string): string {
  return `<p style="margin:12px 0 0;font-size:12px;color:#8a8f98;word-break:break-all;">Or paste this link into your browser: <a href="${url}" style="color:${BRAND};">${esc(url)}</a></p>`;
}

export function inviteEmail(input: {
  tenantName: string;
  recipientFirstName: string;
  inviterLabel: string;
  roleName: string | null;
  inviteUrl: string;
  expiresHuman: string;
}): EmailContent {
  const { tenantName, recipientFirstName, inviterLabel, roleName, inviteUrl, expiresHuman } = input;
  const roleLine = roleName ? ` as ${esc(roleName)}` : "";
  const subject = `You're invited to ${tenantName} on STInventory`;
  const html = layout({
    tenantName,
    preheader: `${inviterLabel} invited you to ${tenantName} on STInventory.`,
    bodyHtml: `
      <h1 style="margin:0 0 12px;font-size:18px;font-weight:600;">You're invited</h1>
      <p style="margin:0 0 8px;font-size:14px;line-height:1.6;">Hi ${esc(recipientFirstName)},</p>
      <p style="margin:0 0 8px;font-size:14px;line-height:1.6;">
        ${esc(inviterLabel)} has invited you to <strong>${esc(tenantName)}</strong> on STInventory${roleLine}.
        STInventory tracks who is holding which tool and equipment across your projects.
      </p>
      ${button(inviteUrl, "Accept invite")}
      ${linkFallback(inviteUrl)}
      <p style="margin:20px 0 0;font-size:12px;color:#8a8f98;">This invite expires in ${esc(expiresHuman)}. If you were not expecting it, you can ignore this email.</p>
    `,
  });
  const text = [
    `You're invited to ${tenantName} on STInventory`,
    ``,
    `Hi ${recipientFirstName},`,
    ``,
    `${inviterLabel} has invited you to ${tenantName} on STInventory${roleLine}.`,
    ``,
    `Accept your invite: ${inviteUrl}`,
    ``,
    `This invite expires in ${expiresHuman}. If you were not expecting it, you can ignore this email.`,
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
  const subject = `Reset your STInventory password`;
  const html = layout({
    tenantName,
    preheader: `Reset your STInventory password for ${tenantName}.`,
    bodyHtml: `
      <h1 style="margin:0 0 12px;font-size:18px;font-weight:600;">Reset your password</h1>
      <p style="margin:0 0 8px;font-size:14px;line-height:1.6;">Hi ${esc(recipientFirstName)},</p>
      <p style="margin:0 0 8px;font-size:14px;line-height:1.6;">
        We received a request to reset the password on your ${esc(tenantName)} account. Click below to choose a new one.
      </p>
      ${button(resetUrl, "Reset password")}
      ${linkFallback(resetUrl)}
      <p style="margin:20px 0 0;font-size:12px;color:#8a8f98;">This link expires in ${esc(expiresHuman)}. If you did not request this, you can ignore this email — your password will not change.</p>
    `,
  });
  const text = [
    `Reset your STInventory password`,
    ``,
    `Hi ${recipientFirstName},`,
    ``,
    `We received a request to reset the password on your ${tenantName} account.`,
    ``,
    `Reset it here: ${resetUrl}`,
    ``,
    `This link expires in ${expiresHuman}. If you did not request this, you can ignore this email — your password will not change.`,
  ].join("\n");
  return { subject, html, text };
}

/*
  No link and no button, deliberately. This is a notice, not an action — the
  password has already changed by the time it sends, and its only job is to
  let the account owner notice a change they did not make.
*/
export function passwordChangedEmail(input: {
  tenantName: string;
  recipientFirstName: string;
}): EmailContent {
  const { tenantName, recipientFirstName } = input;
  const subject = `Your STInventory password was changed`;
  const html = layout({
    tenantName,
    preheader: `Your password on ${tenantName} was just changed.`,
    bodyHtml: `
      <h1 style="margin:0 0 12px;font-size:18px;font-weight:600;">Password changed</h1>
      <p style="margin:0 0 8px;font-size:14px;line-height:1.6;">Hi ${esc(recipientFirstName)},</p>
      <p style="margin:0 0 8px;font-size:14px;line-height:1.6;">
        The password on your ${esc(tenantName)} account was just changed. If this was you, no action is needed.
      </p>
      <p style="margin:16px 0 0;font-size:14px;line-height:1.6;">
        If you did not do this, contact your administrator right away.
      </p>
    `,
  });
  const text = [
    `Password changed`,
    ``,
    `Hi ${recipientFirstName},`,
    ``,
    `The password on your ${tenantName} account was just changed. If this was you, no action is needed.`,
    ``,
    `If you did not do this, contact your administrator right away.`,
  ].join("\n");
  return { subject, html, text };
}
