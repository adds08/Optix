"use client";

import { use } from "react";
import { AuthTokenForm } from "@/components/auth-token-form";

/*
  Where a self-service "forgot password" link lands. See
  `apps/api`'s `/auth/tokens/:token` and `/consume`, and `AuthTokenForm` for
  what this shares with `/invite/[token]`.
*/
export default function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return (
    <AuthTokenForm
      token={token}
      expectedKind="reset"
      copy={{
        heading: () => "Choose a new password",
        subheading: (info) => `For your ${info.tenantName} account (${info.email}).`,
        submitLabel: "Reset password",
        submittingLabel: "Resetting…",
        successLabel: "Password changed. Taking you in…",
        wrongKindMessage: "This link is an account invite, not a password reset.",
        invalidHeading: "This reset link is no longer valid",
        invalidHint: "It may have expired or already been used. Request a new one from the sign-in page.",
      }}
    />
  );
}
