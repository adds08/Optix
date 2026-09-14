import { sql } from "drizzle-orm";
import * as schema from "@optix/db/schema";
import type { Database, Transaction } from "@optix/db";

/*
  Generating a small tool's code.

  WHY TOOLS AND NOT EQUIPMENT. Urban's sheets carry no tool-ID column at all —
  all 753 rows in the real import file have an empty code — while every one of
  the 88 vehicles already has `TRK-034`, `TE-006`. So equipment codes are
  imported and tool codes have to be minted.

  Small tools also need TWO identifiers, which is the client's reasoning and
  worth restating because it is what makes this function necessary: there are
  hundreds of them, a serial number is the natural key, but only 345 of 753
  have one and 13 of those serials are duplicated. Some tools never had a
  serial and on others it has worn off. So a code is generated to guarantee
  every tool has something a person can read out.
*/

/** The tenant-wide prefix. One value for the whole table — tools have no
    sub-kinds to distinguish, unlike equipment where TRK/TE/SUV are three
    different things and the prefix has to be chosen per row. */
export const TOOL_CODE_PREFIX = "TOOL";

/** Zero-padding for a GENERATED code. Not a rule about codes: a code somebody
    types is stored exactly as typed, so `TOOL-7` and `TOOL-00007` are
    different codes. Five digits is ~90x the current register (753 rows), and
    past 99,999 the number simply gets longer — `TOOL-100000` — because the
    client's rule is "even if it goes beyond 100,000 we can just add one digit,
    does not matter total length." */
export const TOOL_CODE_PAD = 5;

/** Build a code from a number. Exported for testing, and because the padding
    rule should live in exactly one place. */
export function formatToolCode(n: number, prefix = TOOL_CODE_PREFIX): string {
  return `${prefix}-${String(n).padStart(TOOL_CODE_PAD, "0")}`;
}

/**
 * The highest number already used by a generated code, from a list of codes.
 *
 * Pure, so the interesting half is testable without a database. Only codes
 * matching the generated SHAPE count — `TOOL-00042` does, `DRILL-7` and
 * `TOOL-A` do not. A tenant that has typed its own codes by hand does not move
 * the counter, which is what stops a hand-typed `TOOL-99999` from pushing
 * every future generated code to six digits.
 */
export function highestToolNumber(codes: readonly (string | null)[], prefix = TOOL_CODE_PREFIX): number {
  const shape = new RegExp(`^${prefix}-(\\d+)$`, "i");
  let max = 0;
  for (const code of codes) {
    const m = code?.match(shape);
    if (!m) continue;
    const n = Number(m[1]);
    /* `Number("007")` is 7 — leading zeros do not change the value, so
       TOOL-00007 and TOOL-7 both count as 7 for the purpose of "what is next".
       They remain DIFFERENT codes; this is only the counter. */
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/**
 * The next free code for this tenant.
 *
 * MUST be called inside the same transaction as the insert that uses it.
 * `max + 1` read outside one lets two concurrent creates take the same number;
 * inside one they serialise and the second sees the first's row.
 *
 * `max + 1` rather than a database sequence, deliberately: a sequence is
 * per-database where codes are per-tenant, cannot be reset, and leaves gaps
 * that look like missing tools to whoever reads the register.
 */
export async function nextToolCode(
  db: Database | Transaction,
  tenantId: string,
  prefix = TOOL_CODE_PREFIX,
): Promise<string> {
  /* Only rows whose code looks generated, so the scan stays small on a
     register where most codes were typed by hand. */
  const rows = await db
    .select({ code: schema.smallTool.code })
    .from(schema.smallTool)
    .where(
      sql`${schema.smallTool.tenantId} = ${tenantId} and ${schema.smallTool.code} ~* ${`^${prefix}-[0-9]+$`}`,
    );

  return formatToolCode(highestToolNumber(rows.map((r) => r.code), prefix) + 1, prefix);
}
