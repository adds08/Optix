/*
  One rule, applied to the last two columns that broke it: a `code` is the
  COMPANY's own identifier; an `external_id` is a foreign system's primary key.

  HAND-EDITED, and it matters. `drizzle-kit generate` emitted ADD COLUMN "code"
  followed by DROP COLUMN "tag" for the asset table — it prompts for
  create-vs-rename only on the first ambiguous column it meets (project), then
  guesses for the rest. Applied as generated, that pair would have silently
  destroyed the code of all 753 tools. Both statements below are RENAMEs, which
  preserve the data.
*/
ALTER TABLE "tbl_entity_project" RENAME COLUMN "external_id" TO "code";--> statement-breakpoint

/* The tool's code. Was `tag` — a name inherited from the spreadsheet column it
   arrived in, not a different fact. `serial_number` (the manufacturer's) and
   `asset_number` (the database's own sequence) are separate columns and are
   untouched: extra identifiers stay as their own fields. */
ALTER TABLE "tbl_entity_asset" RENAME COLUMN "tag" TO "code";--> statement-breakpoint
ALTER INDEX "asset_tag_idx" RENAME TO "asset_code_idx";
