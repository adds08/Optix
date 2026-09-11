-- Foremen receive their existing custody directly; invitation/password setup
-- still applies, but the project onboarding wizard is not required.
UPDATE "tbl_entity_role" SET "onboarding_kind" = 'none'
WHERE "name" = 'foreman';
