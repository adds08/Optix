import { describe, expect, it } from "vitest";
import { esc, inviteEmail, passwordResetEmail, passwordChangedEmail } from "./templates.js";

describe("esc", () => {
  it("escapes every HTML-significant character", () => {
    expect(esc(`<script>&"'</script>`)).toBe("&lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;");
  });
});

describe("inviteEmail", () => {
  it("escapes a tenant name that looks like markup, in the HTML only", () => {
    const out = inviteEmail({
      tenantName: `<b>Urban</b>`,
      recipientFirstName: "Dave",
      inviterLabel: "Karen Osei",
      roleName: "Foreman",
      inviteUrl: "https://app.example/invite/abc123",
      expiresHuman: "7 days",
    });
    expect(out.html).not.toContain("<b>Urban</b>");
    expect(out.html).toContain("&lt;b&gt;Urban&lt;/b&gt;");
    /* Plain text is not HTML, so the raw tenant name is exactly right there —
       escaping it would show the reader literal &lt;b&gt; in a text client. */
    expect(out.text).toContain("<b>Urban</b>");
    expect(out.html).toContain("https://app.example/invite/abc123");
    expect(out.text).toContain("https://app.example/invite/abc123");
  });

  it("carries the invite link in both the button and the fallback text", () => {
    const out = inviteEmail({
      tenantName: "Urban Infraconstruction",
      recipientFirstName: "Dave",
      inviterLabel: "Karen Osei",
      roleName: null,
      inviteUrl: "https://app.example/invite/xyz",
      expiresHuman: "7 days",
    });
    expect(out.subject).toContain("Urban Infraconstruction");
    expect(out.html.match(/https:\/\/app\.example\/invite\/xyz/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("passwordResetEmail", () => {
  it("names the expiry so a stale link is explained rather than mysterious", () => {
    const out = passwordResetEmail({
      tenantName: "Urban Infraconstruction",
      recipientFirstName: "Dave",
      resetUrl: "https://app.example/reset/tok",
      expiresHuman: "1 hour",
    });
    expect(out.html).toContain("1 hour");
    expect(out.text).toContain("1 hour");
    expect(out.text).toContain("https://app.example/reset/tok");
  });
});

describe("passwordChangedEmail", () => {
  it("carries no action link — it is a notice, not a flow", () => {
    const out = passwordChangedEmail({ tenantName: "Urban Infraconstruction", recipientFirstName: "Dave" });
    expect(out.html).not.toContain("href=");
    expect(out.text).not.toMatch(/https?:\/\//);
  });
});

/*
  THE RENAME HAS A TEST BECAUSE IT REGRESSED ONCE ALREADY.

  Every subject line, the header, the footer and most body copy said
  "STInventory" — the repo name — in mail sent to customers. Grepping the
  templates catches that today; this catches it in six months when somebody
  adds a fifth template by copying a fourth.
*/
describe("the product is Optix, everywhere a customer can see", () => {
  const rendered = [
    inviteEmail({
      tenantName: "Urban Infraconstruction",
      recipientFirstName: "Dave",
      inviterLabel: "Karen Osei",
      roleName: "Foreman",
      inviteUrl: "https://app.example/invite/abc",
      expiresHuman: "7 days",
    }),
    inviteEmail({
      tenantName: "Urban Infraconstruction",
      recipientFirstName: "Dave",
      inviterLabel: "Karen Osei",
      roleName: null,
      inviteUrl: "https://app.example/invite/abc",
      expiresHuman: "7 days",
      resend: true,
    }),
    passwordResetEmail({
      tenantName: "Urban Infraconstruction",
      recipientFirstName: "Dave",
      resetUrl: "https://app.example/reset/tok",
      expiresHuman: "1 hour",
    }),
    passwordChangedEmail({ tenantName: "Urban Infraconstruction", recipientFirstName: "Dave" }),
  ];

  it("never says STInventory in a subject, body or plain-text part", () => {
    for (const email of rendered) {
      expect(email.subject).not.toMatch(/STInventory/i);
      expect(email.html).not.toMatch(/STInventory/i);
      expect(email.text).not.toMatch(/STInventory/i);
    }
  });

  it("names Optix in every subject and signs off as Optix Technologies", () => {
    for (const email of rendered) {
      expect(email.subject).toContain("Optix");
      expect(email.html).toContain("Optix Technologies");
      expect(email.text).toContain("Optix Technologies");
    }
  });
});

describe("a resent invite explains itself", () => {
  const args = {
    tenantName: "Urban Infraconstruction",
    recipientFirstName: "Dave",
    inviterLabel: "Karen Osei",
    roleName: null,
    inviteUrl: "https://app.example/invite/fresh",
    expiresHuman: "7 days",
  };

  it("says the earlier link is dead, because sendInvite consumes it", () => {
    /* The resend path issues a new token and consumes the old one. A reader
       holding two invites who opens the older one lands on an expired-token
       page, so the mail has to say which copy is live. */
    const out = inviteEmail({ ...args, resend: true });
    expect(out.subject).toContain("resent");
    expect(out.html).toMatch(/stopped working/i);
    expect(out.text).toMatch(/stopped working/i);
  });

  it("does not say any of that on a first invite", () => {
    const out = inviteEmail(args);
    expect(out.subject).not.toContain("resent");
    expect(out.html).not.toMatch(/stopped working/i);
  });

  it("carries the same link in the button and the fallback either way", () => {
    for (const out of [inviteEmail(args), inviteEmail({ ...args, resend: true })]) {
      expect(out.html.match(/https:\/\/app\.example\/invite\/fresh/g)?.length).toBeGreaterThanOrEqual(2);
      expect(out.text).toContain("https://app.example/invite/fresh");
    }
  });
});

describe("greeting", () => {
  /* Several callers pass "" deliberately — the admin-triggered reset has no
     first name in hand — and "Hi ," is how a real email looks generated. */
  it("drops the comma-dangling name when there is no first name", () => {
    const out = passwordResetEmail({
      tenantName: "Urban Infraconstruction",
      recipientFirstName: "",
      resetUrl: "https://app.example/reset/tok",
      expiresHuman: "1 hour",
    });
    expect(out.html).toContain("Hi,");
    expect(out.html).not.toContain("Hi ,");
    expect(out.text).not.toContain("Hi ,");
  });
});
