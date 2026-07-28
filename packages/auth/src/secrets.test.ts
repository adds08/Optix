import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, secretHint } from "./secrets.js";

/*
  A vendor API key has to come back out again, so this is encryption rather
  than hashing — which means the failure modes are different and worth pinning.
*/
const SECRET = "a".repeat(32) + "-session-secret-material";

describe("encryptSecret / decryptSecret", () => {
  it("round-trips", () => {
    const key = "dop_v1_9f8e7d6c5b4a3210";
    expect(decryptSecret(encryptSecret(key, SECRET), SECRET)).toBe(key);
  });

  it("produces different ciphertext each time", () => {
    /* A fresh IV per call. Identical ciphertexts would leak that two tenants
       configured the same key. */
    const a = encryptSecret("same-key", SECRET);
    const b = encryptSecret("same-key", SECRET);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, SECRET)).toBe(decryptSecret(b, SECRET));
  });

  it("returns null under a different SESSION_SECRET rather than throwing", () => {
    /* Rotating SESSION_SECRET must surface as "re-enter the key", not as a
       crash on whatever page happens to read settings. */
    const enc = encryptSecret("k", SECRET);
    expect(decryptSecret(enc, "b".repeat(40))).toBeNull();
  });

  it("returns null on tampered ciphertext", () => {
    const enc = encryptSecret("k", SECRET);
    const parts = enc.split(".");
    parts[3] = Buffer.from("evil").toString("base64url");
    expect(decryptSecret(parts.join("."), SECRET)).toBeNull();
  });

  it("returns null for absent or malformed values", () => {
    for (const v of [null, undefined, "", "not-a-ciphertext", "v2.a.b.c"]) {
      expect(decryptSecret(v as string, SECRET)).toBeNull();
    }
  });

  it("refuses to derive a key from a weak session secret", () => {
    expect(() => encryptSecret("k", "short")).toThrow(/at least 32/);
  });
});

describe("secretHint", () => {
  it("shows only the last four", () => {
    expect(secretHint("dop_v1_abcdefgh1234")).toBe("••••1234");
  });

  it("masks a short value entirely", () => {
    /* Four of eight characters is most of a short key. */
    expect(secretHint("abc123")).toBe("••••");
  });
});
