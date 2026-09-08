import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/*
  The BambooHR integration reads and NEVER writes, and this is what makes that
  checkable rather than merely intended.

  The client's instruction, restated on 2026-09-09 and first given 2026-09-06:
  under no circumstances may this integration POST, PATCH, PUT or DELETE
  against BambooHR. It points at their PRODUCTION HR system — the record of
  their real staff — and there is no undo on the other side.

  The reason the restraint has to live here rather than in their BambooHR
  account: **a BambooHR API key is not itself read-only.** The same credential
  that fetches the employee directory would happily accept a POST. Nothing on
  their side stops us; only our own code does.

  `bamboo-sync.ts`'s header comment has claimed since it was written that "a
  future change that adds a verb fails a test rather than shipping", and named
  this file as that test. **This file did not exist.** The protection was real
  but unguarded — one added parameter away from silently becoming a writer,
  with a comment promising otherwise. Found 2026-09-09 while auditing the
  read-only claim rather than trusting it.

  It is a SOURCE SCAN, deliberately, following `tenant-predicate.test.ts`:
  - It needs no database and no credentials, so it always runs. A test that
    skips without `DATABASE_URL` is not protection against a rule this sharp.
  - Driving the real sync would need a live HR system to be honest about, which
    is the exact thing being protected.

  The assertions read `method:` assignments rather than searching for the verb
  strings loose in the text. That matters: `bamboo-sync.ts` DISCUSSES POST in
  its own header comment, so a naive "the word POST appears nowhere" check
  would fail on the documentation of the very rule it enforces.
*/

const API_SRC = new URL("./", import.meta.url).pathname;
const SYNC_FILE = join(API_SRC, "bamboo-sync.ts");

const source = readFileSync(SYNC_FILE, "utf8");

/** Every `method: "VERB"` in the file, whatever the quoting or spacing. */
function httpMethodsIn(text: string): string[] {
  return [...text.matchAll(/method\s*:\s*["'`]([A-Za-z]+)["'`]/g)].map((m) => m[1]!.toUpperCase());
}

/** The parameter list of a named function, as written. */
function paramsOf(text: string, fnName: string): string {
  const at = text.indexOf(`function ${fnName}(`);
  if (at === -1) return "";
  const open = text.indexOf("(", at);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return "";
}

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("BambooHR is read-only, and it is enforced in our code", () => {
  it("makes exactly one network call in the whole sync", () => {
    const calls = [...source.matchAll(/\bfetch\s*\(/g)].length;
    expect(
      calls,
      "bamboo-sync.ts must funnel every request through the single `bambooGet`. " +
        "A second call site is a second place the verb can be wrong.",
    ).toBe(1);
  });

  it("sends GET and nothing else", () => {
    const methods = httpMethodsIn(source);
    expect(methods.length, "expected at least one explicit `method:` — has the fetch moved?").toBeGreaterThan(0);
    expect(
      methods,
      `bamboo-sync.ts requests ${methods.join(", ")}. Only GET may ever reach the client's ` +
        "production HR system. A write there cannot be undone from our side.",
    ).toStrictEqual(methods.map(() => "GET"));
  });

  it("gives no caller a way to choose the verb", () => {
    const params = paramsOf(source, "bambooGet");
    expect(params, "bambooGet not found — if it was renamed, rename it here too").not.toBe("");
    expect(
      /\b(method|verb|httpMethod)\b/i.test(params),
      `bambooGet takes (${params.trim().replace(/\s+/g, " ")}). It must take no method or verb ` +
        "parameter: hardcoding GET is only a guarantee while there is no argument that overrides it.",
    ).toBe(false);
  });

  it("is the only file in apps/api that talks to BambooHR at all", () => {
    const offenders = tsFilesUnder(API_SRC)
      .filter((f) => !f.endsWith("bamboo-sync.ts") && !f.endsWith("bamboo-sync.test.ts"))
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        return /bamboohr\.com/i.test(text) && /\bfetch\s*\(/.test(text);
      })
      .map((f) => f.slice(API_SRC.length));

    expect(
      offenders,
      `these files reach bamboohr.com outside the audited sync: ${offenders.join(", ")}. ` +
        "Route every request through `bambooGet` so one place owns the verb.",
    ).toStrictEqual([]);
  });
});
