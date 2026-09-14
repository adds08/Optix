import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/*
  Provisioning must write EVERY field a role spec carries.

  F-01, found by QA on 2026-09-14 against a freshly provisioned tenant.
  `provision.ts` inserted three of the eight fields on `RoleSeed` and silently
  dropped five. Drizzle discards an unknown key without erroring, and `tsc`
  cannot see an ABSENT one, so nothing failed — the roles were created, three
  columns were right, and five took their database defaults.

  Two of those defaults broke the tenant outright:

    claim_tier_names -> []          `onboarding.claimProject` gates on
                                    `role.claimTierNames.includes(tier)`, so
                                    every claim was refused for everybody. A
                                    director cannot be PLACED into their tier
                                    (`setBy: []`), so claiming is the only way
                                    onto a job — no job could be staffed at all.
    onboarding_kind  -> 'equipment' HR got the equipment wizard; foremen got a
                                    wizard they are meant to skip.

  It never showed up in development because this database was repaired by hand
  afterwards through /settings/roles, which DOES write these fields. Same shape
  as the seed-vs-live gap `.claude/rules/database.md` warns about, in the
  opposite direction: the fix reached the running database and not the code.

  WHY THIS TEST IS A SOURCE SCAN and not a database round-trip. The failure was
  an ABSENT key, which is invisible to the type system and produces a perfectly
  valid row. A round-trip test would need a fresh tenant per run and would only
  catch the two fields whose defaults happen to be wrong — `category` and
  `is_system` default to null/false and a round-trip would pass while still
  dropping them. Asserting the insert NAMES every field catches all five, and
  catches the ninth field somebody adds next year.
*/

const SRC = new URL("../../db/src/provision.ts", import.meta.url).pathname;
const TYPES = new URL("../../db/src/tenant-config.ts", import.meta.url).pathname;

/* The fields on `RoleSeed`, read from the type rather than hardcoded — so
   adding one to the type makes this test demand it in the insert. */
function roleSeedFields(): string[] {
  const src = readFileSync(TYPES, "utf8");
  const start = src.indexOf("export type RoleSeed = {");
  expect(start, "RoleSeed type not found in tenant-config.ts").toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf("\n};", start));
  /* Field declarations only: `name: string;` / `category?: string;`. Skips
     comment lines, which in this file are long and contain colons. */
  return [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]!);
}

describe("provisioning writes every role field (F-01)", () => {
  it("names every RoleSeed field in the role insert", () => {
    const src = readFileSync(SRC, "utf8");
    const at = src.indexOf(".insert(schema.role)");
    expect(at, "the role insert moved — update this test with it").toBeGreaterThan(-1);
    /* The `.values({...})` that follows it. */
    const values = src.slice(at, src.indexOf("})", src.indexOf(".values({", at)));

    const missing = roleSeedFields().filter((f) => !new RegExp(`\\b${f}:`).test(values));

    expect(
      missing,
      `provision.ts's role insert does not write: ${missing.join(", ")}.\n` +
        "Drizzle drops an absent key silently and tsc cannot see it, so the " +
        "row is created with database defaults instead. That is F-01: " +
        "claim_tier_names defaulted to [] and no job could be staffed on a " +
        "fresh tenant. Add the field to the insert.",
    ).toEqual([]);
  });

  it("still has roles that may claim, or the bootstrap is gone", () => {
    /* The thing F-01 actually broke. An empty tenant has nobody on any job, so
       no tier-on-a-project exists for the authority check to read, so nobody
       can be placed by anybody. At least one role able to place ITSELF is what
       breaks that circle.

       Read from source, not imported: `tenant-config` is not an exported
       subpath of @optix/db, and widening a package's public API for a test is
       the wrong trade. This whole file is a source scan anyway. */
    const specs = readFileSync(TYPES, "utf8");
    const claimers = [...specs.matchAll(/claimTierNames:\s*\[[^\]]+\]/g)];
    expect(
      claimers.length,
      "No role in tenant-config carries claimTierNames, so a freshly " +
        "provisioned tenant has no way onto a job at all.",
    ).toBeGreaterThan(0);
  });
});
