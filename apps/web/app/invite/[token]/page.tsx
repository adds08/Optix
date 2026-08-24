"use client";

import { use } from "react";
import { AuthTokenForm } from "@/components/auth-token-form";

/*
  Where an invite link lands. Unauthenticated by construction — there is no
  signup in this product, so this page IS how an account first becomes usable.
  See `apps/api`'s `/auth/tokens/:token` and `/consume` for the mechanics, and
  `AuthTokenForm` for what the two token pages share.
*/
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return (
    <AuthTokenForm
      token={token}
      expectedKind="invite"
      copy={{
        heading: (info) => `Welcome, ${info.firstName}`,
        subheading: (info) => `Choose a password to join ${info.tenantName} on STInventory.`,
        submitLabel: "Create account",
        submittingLabel: "Creating account…",
        successLabel: "Account created. Taking you in…",
        wrongKindMessage: "This link is a password reset, not an invite.",
        invalidHeading: "This invite is no longer valid",
        invalidHint:
          "It may have already been used, or a newer invite was sent to replace it. Ask whoever invited you to send a fresh one.",
      }}
    />
  );
}
