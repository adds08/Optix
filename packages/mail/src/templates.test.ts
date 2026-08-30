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
