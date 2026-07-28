import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/*
  Encrypting a secret that has to live in the database.

  A vendor API key is not a password: the system needs the original back to use
  it, so hashing is not an option. Storing it in the clear would mean a database
  dump — a backup file, a `pg_dump` in someone's downloads — hands over a
  billable third-party credential. AES-256-GCM gives confidentiality and
  tamper-detection, which is what is actually needed here.

  The key is derived from SESSION_SECRET rather than being a second secret to
  manage. That is a deliberate trade: one fewer thing to lose, at the cost of
  rotating SESSION_SECRET making stored ciphertexts unreadable. `decryptSecret`
  returns null rather than throwing in that case, so the failure surfaces as
  "the key needs re-entering" instead of a crash on an unrelated page.

  Not a substitute for a real KMS. If this ever holds something worth more than
  an inference key, move it.
*/

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the size GCM is defined for
const SALT = "stinventory:secret:v1";

function keyFrom(sessionSecret: string): Buffer {
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters to derive an encryption key");
  }
  /* scrypt rather than a bare hash: SESSION_SECRET is high-entropy, but the
     cost is paid once per call and removes any argument about it. */
  return scryptSync(sessionSecret, SALT, 32);
}

/** `v1.<iv>.<tag>.<ciphertext>`, all base64url. The prefix is a version marker
    so the format can change later without guessing at what a stored value is. */
export function encryptSecret(plain: string, sessionSecret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, keyFrom(sessionSecret), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    enc.toString("base64url"),
  ].join(".");
}

/** Null when the value is absent, malformed, or was encrypted under a
    different SESSION_SECRET. Callers treat that as "not configured". */
export function decryptSecret(stored: string | null | undefined, sessionSecret: string): string | null {
  if (!stored) return null;
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const decipher = createDecipheriv(
      ALGO,
      keyFrom(sessionSecret),
      Buffer.from(parts[1]!, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(parts[2]!, "base64url"));
    const out = Buffer.concat([
      decipher.update(Buffer.from(parts[3]!, "base64url")),
      decipher.final(),
    ]);
    return out.toString("utf8");
  } catch {
    /* Wrong key, or the ciphertext was altered. Both mean the same thing to a
       caller: this secret is no longer usable. */
    return null;
  }
}

/*
  What the UI shows instead of the key.

  Enough to answer "is the right key in there?" without being enough to use.
  Short values are masked entirely rather than mostly revealed.
*/
export function secretHint(plain: string): string {
  const trimmed = plain.trim();
  if (trimmed.length <= 8) return "••••";
  return `••••${trimmed.slice(-4)}`;
}
