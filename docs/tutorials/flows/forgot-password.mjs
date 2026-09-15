/*
  Forgot password — the whole loop, end to end, against the real app.

    sign in  ->  Forgot password?  ->  enter address  ->  Send reset link
             ->  the email in the inbox  ->  follow the link
             ->  choose a new password  ->  Reset password  ->  you're in

  Every step runs on the running stack and the link is read out of the real
  inbox (Mailpit), so this cannot drift into a scripted fiction: if the email
  stops arriving or the link stops working, the recording fails.

  Address used: tutorial@optixtec.com — a throwaway account created for these
  recordings, so a reset never touches a real login.
*/
export default {
  name: "forgot-password",
  title: "Reset a forgotten password",
  intro:
    "A password reset that starts and ends on somebody's own phone or laptop, with no call to the office. " +
    "Recorded against the running app; the reset link is read from the real inbox.",

  async run(t) {
    /* ---- 1. the way in ---- */
    await t.step({
      selector: 'a[href="/forgot-password"]',
      arrow: "left",
      text: "Signing in starts here. If the password is gone, choose Forgot password?",
      hold: 1800,
    });
    await t.click('a[href="/forgot-password"]');
    await t.waitFor("#email");

    /* ---- 2. who is asking ---- */
    await t.step({
      selector: "#email",
      arrow: "left",
      text: "Enter the address you sign in with — the email already on your record.",
      hold: 1500,
    });
    await t.type("#email", "tutorial@optixtec.com");

    /* ---- 3. send ---- */
    await t.step({
      selector: 'button[type="submit"]',
      arrow: "left",
      text: "Choose Send reset link.",
      hold: 1200,
    });
    await t.click('button[type="submit"]');
    await t.pause(900);

    /* Caption only: the confirmation is a sentence, not a control, and the same
       sentence appears whether or not the address exists. That is deliberate —
       see the STI-305 enumeration note on the API route. */
    await t.step({
      text: "It answers the same way for everyone — nobody can use this page to find out who works here.",
      hold: 2400,
    });

    /* ---- 4. the real inbox ---- */
    const mail = await t.mail();
    if (!mail?.resetUrl) throw new Error("no reset email arrived — check Mailpit on " + t.mailpit);
    await t.goto(mail.viewUrl);
    await t.step({
      text: "The email lands in a minute: one single-use link that expires in an hour.",
      hold: 2600,
    });

    /* ---- 5. the link ---- */
    await t.goto(mail.resetUrl);
    await t.waitFor("#password");
    await t.step({
      selector: "#password",
      arrow: "left",
      text: "The link opens a page to choose a new password — ten characters or more.",
      hold: 1400,
    });
    await t.type("#password", process.env.TUTORIAL_NEW_PASSWORD ?? "TutorialDemo2026");

    await t.step({
      selector: "#confirm",
      arrow: "left",
      text: "Type it a second time so a mistyped password cannot lock the account.",
      hold: 1100,
    });
    await t.type("#confirm", process.env.TUTORIAL_NEW_PASSWORD ?? "TutorialDemo2026");

    /* ---- 6. reset ---- */
    await t.step({
      selector: 'button[type="submit"]',
      arrow: "left",
      text: "Choose Reset password.",
      hold: 1200,
    });
    await t.click('button[type="submit"]');

    /* ---- 7. in ---- */
    /* Signed in when the SPA's path says so — see the note in create-small-tool:
       `waitForURL` waits on `load`, which a client-side navigation never fires. */
    await t.page.waitForFunction(() => location.pathname === "/home", null, { timeout: 25000 });
    await t.page.waitForTimeout(1400);
    await t.step({
      text: "Done — the reset signs you straight in. No second sign-in, and the old password is already dead.",
      hold: 2200,
    });
  },
};
