--
-- Remove three tenant settings that were stored, validated and (for one of
-- them) editable on screen, and that nothing has ever read.
--
--   overdue_escalate_after_days   "Chase an overdue loan after (days)"
--   missing_review_sla_days       never shown on any screen
--   discrepancy_review_sla_days   never shown on any screen
--
-- WHY THEY ARE DEAD, not merely unused. All three date from the borrow/loan
-- model that migration 0012 removed. Nothing falls due in this product: a tool
-- sits with a foreman until it is handed on, and there is no due date for it to
-- pass. `NOTIFICATION_TYPES` lost `overdue` for the same reason, and
-- `nav-config.ts` struck out its "Overdue and requests" item. These three
-- columns are the last of that model still standing.
--
-- The first was worse than unused: the settings screen ASKED for it, took the
-- number, saved it, read it back on reload, and no code path anywhere consulted
-- it. An administrator who set it to 7 had every reason to believe something
-- would chase a tool after a week. Nothing would. A control that lies about
-- what it does is worse than an absent one, because it is acted upon.
--
-- The other two never reached a screen at all, so they cost an operator
-- nothing — but they are the same dead model, and leaving them would mean the
-- next person to read this table finds two thirds of a removed feature and has
-- to re-derive what was already decided here.
--
-- `custody_approver_role` sits in the same block and is NOT dropped: it is read
-- by assignment.ts, transfer.ts and the API's approver lookup.
--
-- Data loss is the point, and it is bounded: a number that changed nothing.

ALTER TABLE "tbl_entity_tenant_settings" DROP COLUMN IF EXISTS "overdue_escalate_after_days";
ALTER TABLE "tbl_entity_tenant_settings" DROP COLUMN IF EXISTS "missing_review_sla_days";
ALTER TABLE "tbl_entity_tenant_settings" DROP COLUMN IF EXISTS "discrepancy_review_sla_days";
