import { createHash, randomBytes } from "node:crypto";

/*
  Invite and password-reset tokens.

  The plaintext is what goes in the email link; `auth_token.token_hash` never
  stores it (see the schema comment in packages/db/src/schema/identity.ts).
  32 random bytes, base64url so it survives being pasted into a URL with no
  percent-encoding surprises.
*/
const TOKEN_BYTES = 32;

export function generateAuthToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/*
  SHA-256, not bcrypt.

  A password needs a slow hash because it is low-entropy, human-chosen, and
  attackable by dictionary. This token is 256 bits of `randomBytes` with
  nothing to guess — there is no dictionary, and a fast digest is exactly
  right for a value that will be looked up by an equality index on every
  invite-accept and reset-consume request. Hashing it with bcrypt would make
  every one of those requests as slow as a login, for a threat model
  (brute-forcing 256 bits) that a fast hash is already immune to.
*/
export function hashAuthToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
