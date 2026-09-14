--
-- Drop `asset_number`. It was a second identifier with no remaining job.
--
-- The client's rule, 2026-09-14: "no reference_no field on small tools" and
-- "it should just be `code` for like all tables of entity."
--
-- WHAT IT WAS: a database-stamped counter (`generatedAlwaysAsIdentity`)
-- rendered as `A-000001` in a "Ref #" column on /tools and on the tool detail
-- page. So a tool displayed TWO numbers — that one and its `code` — and a
-- person reading a row had to know which one the next person meant.
--
-- WHY IT EXISTED, and why that reason is gone. Urban's sheets carry no tool-ID
-- column: all 753 rows in the real import file have an empty code. So nothing
-- was guaranteed to be present, and this column was, in the schema's own
-- words, "what a report or a screen can always point to". That was true.
--
-- The code generator (`packages/api-contracts/src/tool-code.ts`, 2026-09-14)
-- removed the premise: every tool created through `asset.create` now gets a
-- code, generated when none is typed. The fallback goes with the reason for it.
--
-- ORDER: this migration must come AFTER the generator, never before. Dropping
-- the fallback first would leave a codeless tool with nothing to display at
-- all, which is worse than showing two numbers.
--
-- THE BACKFILL IS NOT OPTIONAL. Rows created before the generator may have no
-- code — the local test database had 11, from fixtures. Left alone they would
-- be untraceable the moment the counter they relied on is gone. Each gets a
-- generated code, numbered from the current maximum so nothing collides with a
-- code already in use.
--
-- `code` is deliberately left NULLABLE. Every path that creates a tool fills
-- it, and the partial unique index (0078) does not require it — but an import
-- written before the generator existed could still produce a null, and failing
-- a boot migration over that is a worse outcome than a row somebody can fix.

-- One statement per tenant-ordered row: number from that tenant's own maximum,
-- pad to five, and widen naturally past 99,999 exactly as the generator does.
WITH numbered AS (
  SELECT
    t.id,
    t.tenant_id,
    (
      SELECT COALESCE(MAX((regexp_match(m.code, '^TOOL-([0-9]+)$'))[1]::bigint), 0)
      FROM "tbl_entity_small_tool" m
      WHERE m.tenant_id = t.tenant_id AND m.code ~ '^TOOL-[0-9]+$'
    ) + ROW_NUMBER() OVER (PARTITION BY t.tenant_id ORDER BY t.asset_number) AS n
  FROM "tbl_entity_small_tool" t
  WHERE t.code IS NULL
)
UPDATE "tbl_entity_small_tool" s
   SET "code" = 'TOOL-' || LPAD(numbered.n::text, 5, '0')
  FROM numbered
 WHERE s.id = numbered.id;

ALTER TABLE "tbl_entity_small_tool" DROP COLUMN "asset_number";
