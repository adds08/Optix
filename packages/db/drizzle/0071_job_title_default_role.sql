--
-- Map a job title to the login role its holders get.
--
-- THE GAP THIS CLOSES. BambooHR sync resolves a person's `jobTitleName` to a
-- `company_role` row and stops there. It never sets `employee.role_id`, so
-- every synced person arrives with NO login role: no permissions, no custody
-- eligibility, nothing the register can reason about. Somebody then sets each
-- one by hand, for a roster that is 190 people at Urban and re-synced nightly.
--
-- The three things are, and remain, different:
--
--   company_role   the HR job title. BambooHR owns it. "Carpenter", "Foreman
--                  II", "Project Manager" — whatever payroll calls the post.
--   role           the LOGIN role. What an account may see and do. Tenant
--                  editable at /settings/roles.
--   team_role      the tier a person holds ON A PROJECT. Per project, not per
--                  person.
--
-- `default_role_id` is the bridge between the first two, and only the first
-- two. It says: "somebody whose payroll title is X should sign in as Y, unless
-- a human has said otherwise about that individual."
--
-- WHY IT IS A DEFAULT AND NOT AN ASSIGNMENT. An administrator's decision about
-- one person must outlive the next sync. The sync therefore fills
-- `employee.role_id` only where it is NULL — it never overwrites a role a human
-- set, even if the title later changes. Getting this backwards would mean a
-- nightly job quietly undoing an administrator's work, which is the failure
-- mode that makes people stop trusting a sync.
--
-- ON DELETE SET NULL, not CASCADE: deleting a login role must never delete the
-- job title. The title is HR's record of a post that exists whether or not the
-- product has a role for it; losing it would mean the next sync re-creating it
-- empty and every person holding it going unmapped in silence.
--
-- NULL means "no opinion" — the sync leaves those people alone rather than
-- guessing. An unmapped title is a visible, answerable question ("what should a
-- Carpenter be able to do?"); a wrong guess is an invisible one.

ALTER TABLE "tbl_entity_company_role"
  ADD COLUMN IF NOT EXISTS "default_role_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_role_default_role_fk'
  ) THEN
    ALTER TABLE "tbl_entity_company_role"
      ADD CONSTRAINT "company_role_default_role_fk"
      FOREIGN KEY ("default_role_id") REFERENCES "tbl_entity_role"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

-- The mapping screen orders titles by headcount, so the most consequential
-- decision is the first one on the page.
CREATE INDEX IF NOT EXISTS "company_role_default_role_idx"
  ON "tbl_entity_company_role" ("default_role_id");
