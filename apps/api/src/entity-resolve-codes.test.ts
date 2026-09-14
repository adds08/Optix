import { describe, expect, it } from "vitest";
import { extractTag } from "./entity-resolve.js";

/*
  Pulling a code out of a foreman's sentence.

  This was hardcoded to `UIC-`: a bare number became `UIC-1012`, and vehicles
  matched only `TRA-`/`TRU-`. Both were wrong about Urban's real data.

  `UIC` appeared in NO row anywhere — it was a placeholder (a guess at "Urban
  InfraConstruction") that had leaked from a form hint into working code. And
  the real fleet is `TRK-` ×47, `TE-` ×39, `SUV-` ×2, so "where is TRK-034"
  resolved to nothing while "where is TRA-034" resolved to a truck that does
  not exist. Silently, both ways: the resolver returned null and the chat said
  it could not find the tool.

  The rule now: take the code AS WRITTEN whatever its prefix, and return a bare
  number bare. That is what lets a prefix added later — `SKT-` for skytrack —
  work without a deploy, which is the whole point of prefixes being data.
*/
describe("extractTag", () => {
  it("takes a written code as-is, whatever the prefix", () => {
    /* The three real ones, plus one that does not exist yet. None of these
       worked before: TRK and TE are the actual fleet. */
    expect(extractTag("where is TRK-034")).toBe("TRK-034");
    expect(extractTag("TE-006 needs a service")).toBe("TE-006");
    expect(extractTag("SUV-001 is at the yard")).toBe("SUV-001");
    expect(extractTag("book SKT-12 to Trinity")).toBe("SKT-12");
  });

  it("takes a tool code with the new prefix and its padding", () => {
    expect(extractTag("gave TOOL-00012 to Dwayne")).toBe("TOOL-00012");
    /* Unpadded is a different code and must survive as typed — the client's
       rule: TOOL-0001 does not equal TOOL-1. */
    expect(extractTag("TOOL-1 is broken")).toBe("TOOL-1");
  });

  it("is case-insensitive and normalises a space to a dash", () => {
    /* People type lowercase, and "TRK 034" is the same rig as "TRK-034". A
       code's case is not its identity — the unique index is on lower(code). */
    expect(extractTag("where is trk-034")).toBe("TRK-034");
    expect(extractTag("where is TRK 034")).toBe("TRK-034");
  });

  it("returns a bare number BARE, inventing no prefix", () => {
    /* The actual defect. This used to return "UIC-1012" — a code that exists
       in no register — so the lookup could only ever fail. Bare digits let the
       caller match the END of a code and find TOOL-01012. */
    expect(extractTag("where is 1012")).toBe("1012");
    expect(extractTag("1012")).toBe("1012");
  });

  it("finds nothing in a sentence with no code", () => {
    expect(extractTag("give the rotary hammer to Dwayne")).toBeNull();
    /* One or two digits is a quantity or a day, not a code. */
    expect(extractTag("need 2 grinders")).toBeNull();
  });

  it("does not mistake an ordinary hyphenated word for a code", () => {
    /* Two letters minimum is what stops "a-1" and "x-2" qualifying. */
    expect(extractTag("the follow-up is tomorrow")).toBeNull();
  });
});
