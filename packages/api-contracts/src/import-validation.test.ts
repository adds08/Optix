import { describe, expect, it } from "vitest";
import type { ImportColumn, ImportSpec } from "@stinventory/types";
import { checkCell, validateRows, type RefIndex } from "./routers/import.js";

/*
  STI-405 — the spreadsheet importer's validation.

  `SYSTEM_PLAN.md` §5 rates this subsystem "genuinely good: typed validation,
  dedup, preview, transactional commit" and, in the same row, "**No tests**".
  It was the only FUNCTIONAL area with none, which is a bad combination: an
  importer is the one surface where a user hands the system a few hundred rows
  of somebody else's data and trusts the preview to tell them what is wrong
  with it. A validator that silently accepts a bad cell does not produce an
  error — it produces a wrong register.

  Both functions under test are pure: no database, no session. What they need
  is a `RefIndex` (name -> id, for the columns that point at a project,
  location, employee or warehouse) and, for `validateRows`, the set of values
  already in the database.
*/

const refs = (): RefIndex => ({
  project: new Map([["lone star", "p-1"]]),
  location: new Map([["dallas yard", "l-1"]]),
  employee: new Map([["alejandro capuchino", "e-1"]]),
  warehouse: new Map([["main", "w-1"]]),
});

const col = (over: Partial<ImportColumn>): ImportColumn =>
  ({ key: "k", header: "H", type: "text", ...over }) as ImportColumn;

describe("checkCell — one cell at a time (STI-405)", () => {
  it("treats whitespace as empty, and empty as an error only when required", () => {
    /* The distinction the whole preview rests on: a blank optional cell is
       normal data (imported rows routinely omit most columns), a blank
       required one is the file being wrong. Untrimmed, "  " would sail
       through a required check as a value. */
    expect(checkCell(col({ required: true }), "   ", refs())).toEqual({ error: "required" });
    expect(checkCell(col({ required: false }), "   ", refs())).toEqual({ value: undefined });
  });

  describe("integer", () => {
    it("accepts a whole number of 1 or more", () => {
      expect(checkCell(col({ type: "integer" }), "3", refs())).toEqual({ value: 3 });
    });
    it("refuses 0, negatives, fractions and words — a quantity of half a tool is not a quantity", () => {
      for (const bad of ["0", "-2", "1.5", "two", ""]) {
        expect(checkCell(col({ type: "integer", required: true }), bad, refs()).error, bad).toBeTruthy();
      }
    });

    it("accepts scientific notation, which is a real thing spreadsheets emit", () => {
      /* Written expecting a refusal; the code accepts it, and on reflection the
         code is right. Excel exports large numbers as `1E+15`, and `Number()`
         reads `1e3` as exactly 1000 — refusing it would reject a file that is
         not wrong, over a formatting choice the clerk did not make.

         Recorded as behaviour rather than left implicit: it means a quantity
         column will silently accept an implausibly large value from a
         mis-formatted cell. That is a real if minor sharp edge, and this is
         where somebody will find it if it ever bites. */
      expect(checkCell(col({ type: "integer" }), "1e3", refs())).toEqual({ value: 1000 });
    });
  });

  describe("decimal", () => {
    it("accepts at most two decimal places", () => {
      expect(checkCell(col({ type: "decimal" }), "489.00", refs())).toEqual({ value: "489.00" });
      expect(checkCell(col({ type: "decimal" }), "489", refs())).toEqual({ value: "489" });
    });
    it("keeps the STRING, never a float", () => {
      /* Money. `acquisitionCost` is a numeric column and the high-value gate
         compares against a threshold; parsing to a float here would introduce
         a rounding error before the value ever reaches Postgres. */
      const out = checkCell(col({ type: "decimal" }), "5000.00", refs());
      expect(typeof out.value).toBe("string");
    });
    it("refuses three decimals, currency symbols and thousands separators", () => {
      for (const bad of ["489.000", "$489.00", "1,489.00", "489."]) {
        expect(checkCell(col({ type: "decimal" }), bad, refs()).error, bad).toBeTruthy();
      }
    });
  });

  describe("usdate — the vendor-portal format", () => {
    it("normalises MM/DD/YYYY to ISO", () => {
      expect(checkCell(col({ type: "usdate" }), "12/04/2026", refs())).toEqual({ value: "2026-12-04" });
    });
    it("pads single-digit months and days", () => {
      /* Portals export both `1/4/2026` and `01/04/2026`. Unpadded, the ISO
         string is malformed and Postgres rejects the whole import. */
      expect(checkCell(col({ type: "usdate" }), "1/4/2026", refs())).toEqual({ value: "2026-01-04" });
    });
    it("refuses a date that parses as a string but is not a real day", () => {
      expect(checkCell(col({ type: "usdate" }), "13/45/2026", refs()).error).toBeTruthy();
    });
    it("refuses ISO in a usdate column rather than guessing", () => {
      /* Ambiguity is the danger, not strictness: 03/04 is two different days
         depending on which side of the Atlantic wrote it, so a column declares
         its format and the file matches or fails. */
      expect(checkCell(col({ type: "usdate" }), "2026-12-04", refs()).error).toBeTruthy();
    });
  });

  describe("enum", () => {
    const condition = col({
      type: "enum",
      values: ["new", "good", "fair", "poor", "damaged"],
      valueAliases: { used: "good", refurb: "fair" },
    });

    it("matches case-insensitively", () => {
      expect(checkCell(condition, "GOOD", refs())).toEqual({ value: "good" });
    });

    it("folds the yard's vocabulary onto ours through valueAliases", () => {
      /* A trailer sheet says USED where the register means `good`. Widening
         ASSET_CONDITIONS to carry "used" would create a condition nothing
         downstream knows the meaning of — the alias keeps the vocabulary
         translation at the edge. */
      expect(checkCell(condition, "USED", refs())).toEqual({ value: "good" });
      expect(checkCell(condition, "Refurb", refs())).toEqual({ value: "fair" });
    });

    it("returns the CANONICAL value, not what the file said", () => {
      const out = checkCell(condition, "used", refs());
      expect(out.value).toBe("good");
      expect(out.value).not.toBe("used");
    });

    it("names the permitted values when it refuses, so the fix is obvious", () => {
      const out = checkCell(condition, "knackered", refs());
      expect(out.error).toContain("new");
      expect(out.error).toContain("damaged");
    });
  });

  describe("ref", () => {
    it("resolves a name to an id, case-insensitively", () => {
      expect(checkCell(col({ type: "ref", ref: "project" }), "LONE STAR", refs())).toEqual({ value: "p-1" });
    });
    it("refuses an unknown name and quotes it back", () => {
      /* The clerk's next move is to go and look at the spelling, so the
         message has to carry what they typed. */
      const out = checkCell(col({ type: "ref", ref: "project" }), "Loan Star", refs());
      expect(out.error).toContain("Loan Star");
      expect(out.error).toContain("project");
    });
  });
});

describe("validateRows — the whole file at once (STI-405)", () => {
  const spec: ImportSpec = {
    label: "Tools",
    permission: "asset.manage",
    unique: ["tag"],
    columns: [
      { key: "tag", header: "Tag", type: "text", required: true },
      { key: "cost", header: "Cost", type: "decimal" },
    ],
  } as ImportSpec;

  const run = (rows: Record<string, string>[], existing: Record<string, Set<string>> = { tag: new Set() }) =>
    validateRows(spec, rows, refs(), existing);

  it("resolves the good rows and leaves them error-free", () => {
    const [row] = run([{ Tag: "UIC-2001", Cost: "489.00" }]);
    expect(row!.errors).toEqual([]);
    expect(row!.resolved).toEqual({ tag: "UIC-2001", cost: "489.00" });
  });

  it("catches a duplicate against the DATABASE", () => {
    const [row] = run([{ Tag: "UIC-2001", Cost: "" }], { tag: new Set(["uic-2001"]) });
    expect(row!.errors.map((e) => e.message).join()).toContain("already exists");
  });

  it("catches a duplicate WITHIN the file — two rows claiming one tag is a bad sheet either way", () => {
    const rows = run([{ Tag: "UIC-2001" }, { Tag: "UIC-2001" }]);
    expect(rows[0]!.errors).toEqual([]);
    expect(rows[1]!.errors.map((e) => e.message).join()).toContain("same as row");
  });

  it("reports the row number the USER sees, not the array index", () => {
    /* index is 0-based and the file's first line is the header, so the first
       data row is row 2 in the spreadsheet. Off by one here and the clerk goes
       and edits the wrong line. */
    const rows = run([{ Tag: "A" }, { Tag: "B" }, { Tag: "A" }]);
    expect(rows[2]!.errors[0]!.message).toBe("same as row 2");
  });

  it("matches duplicates case-insensitively", () => {
    /* `uic-2001` and `UIC-2001` are the same physical label. */
    const rows = run([{ Tag: "UIC-2001" }, { Tag: "uic-2001" }]);
    expect(rows[1]!.errors.length).toBeGreaterThan(0);
  });

  it("does not treat two blank optional cells as duplicates of each other", () => {
    /* The bug this shape invites: an unset unique column normalises to "" for
       every row, so a naive dedup rejects every row after the first. Most
       imported rows legitimately have no tag. */
    const rows = validateRows(
      { ...spec, columns: [{ key: "tag", header: "Tag", type: "text" }] } as ImportSpec,
      [{ Tag: "" }, { Tag: "" }],
      refs(),
      { tag: new Set() },
    );
    expect(rows[0]!.errors).toEqual([]);
    expect(rows[1]!.errors).toEqual([]);
  });

  it("reports every bad cell in a row, not just the first", () => {
    /* A preview exists so one pass fixes the file. Stopping at the first error
       per row turns a single correction into as many round-trips as there are
       bad columns. */
    const [row] = validateRows(
      {
        ...spec,
        columns: [
          { key: "tag", header: "Tag", type: "text", required: true },
          { key: "cost", header: "Cost", type: "decimal" },
          { key: "qty", header: "Qty", type: "integer" },
        ],
      } as ImportSpec,
      [{ Tag: "", Cost: "nope", Qty: "0" }],
      refs(),
      { tag: new Set() },
    );
    expect(row!.errors.length).toBe(3);
  });

  it("keeps the original values alongside the resolved ones", () => {
    /* The preview screen shows the user what they typed next to what it became
       — "USED → good" is the reassurance that an alias did what they meant. */
    const [row] = run([{ Tag: "UIC-2001", Cost: "489.00" }]);
    expect(row!.values).toEqual({ Tag: "UIC-2001", Cost: "489.00" });
  });
});
