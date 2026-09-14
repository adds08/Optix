import { describe, expect, it } from "vitest";
import { formatToolCode, highestToolNumber, TOOL_CODE_PREFIX } from "./tool-code.js";

/*
  Generating a tool's code.

  Urban's sheets carry no tool-ID column — all 753 rows in the real import file
  have an empty code — so tool codes have to be minted where equipment codes
  are imported. Small tools need two identifiers for the client's stated reason:
  hundreds of them, a serial is the natural key, but only 345 of 753 have one
  and 13 of those are duplicated. So a code guarantees every tool has something
  a person can read out.

  These cover the pure half. `nextToolCode`'s transaction behaviour — which is
  the part that matters for correctness — is exercised end to end through
  `asset.create`.
*/
describe("formatToolCode", () => {
  it("pads a generated code to five digits", () => {
    expect(formatToolCode(1)).toBe("TOOL-00001");
    expect(formatToolCode(753)).toBe("TOOL-00753");
    expect(formatToolCode(99999)).toBe("TOOL-99999");
  });

  it("WIDENS past 99,999 rather than wrapping", () => {
    /* The client's rule: "even if it goes beyond 100,000 we can just add one
       digit, does not matter total length." Wrapping would reissue a code that
       is already on a tool, which is the one outcome worse than a long code. */
    expect(formatToolCode(100000)).toBe("TOOL-100000");
    expect(formatToolCode(1234567)).toBe("TOOL-1234567");
  });
});

describe("highestToolNumber", () => {
  it("is zero on an empty register, so the first code is TOOL-00001", () => {
    expect(highestToolNumber([])).toBe(0);
    expect(formatToolCode(highestToolNumber([]) + 1)).toBe("TOOL-00001");
  });

  it("takes the highest, not the count — deleted rows must not reissue a code", () => {
    /* If tools 1 and 2 are deleted, the next code is still 4. Counting rows
       would hand out TOOL-00002 again, and a code that was on a tool last
       month must never come back on a different one. */
    expect(highestToolNumber(["TOOL-00003"])).toBe(3);
    expect(highestToolNumber(["TOOL-00001", "TOOL-00009", "TOOL-00004"])).toBe(9);
  });

  it("ignores codes that are not the generated shape", () => {
    /* A tenant that types its own codes must not move the counter. Without
       this, one hand-typed TOOL-99999 would push every future generated code
       to six digits — and a `DRILL-7` would be read as 7. */
    expect(highestToolNumber(["DRILL-7", "TOOL-A", "TOOL", "12345", null])).toBe(0);
    expect(highestToolNumber(["DRILL-999", "TOOL-00002"])).toBe(2);
  });

  it("reads a padded and an unpadded code as the same number", () => {
    /* `TOOL-7` and `TOOL-00007` are DIFFERENT codes and both stay exactly as
       stored — but for "what is next", both mean seven. Otherwise a register
       holding TOOL-7 would generate TOOL-00001 and then collide at seven. */
    expect(highestToolNumber(["TOOL-7"])).toBe(7);
    expect(highestToolNumber(["TOOL-00007"])).toBe(7);
    expect(highestToolNumber(["TOOL-7", "TOOL-00009"])).toBe(9);
  });

  it("is case-insensitive about the prefix", () => {
    /* A code's case is not its identity — the unique index is on lower(code) —
       so a lowercase generated code still has to move the counter. */
    expect(highestToolNumber(["tool-00012"])).toBe(12);
  });

  it("survives a number too large to be meaningful", () => {
    /* Not a real case, but the counter must not return NaN and produce
       `TOOL-NaN` as somebody's permanent tool code. */
    expect(highestToolNumber([`${TOOL_CODE_PREFIX}-999999999999999999999999`])).toBeGreaterThan(0);
    expect(Number.isFinite(highestToolNumber(["TOOL-1"]))).toBe(true);
  });
});
