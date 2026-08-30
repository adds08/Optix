CREATE TABLE IF NOT EXISTS "auth_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"kind" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "smtp_host" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "smtp_port" integer;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "smtp_user" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "smtp_pass_enc" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "smtp_pass_hint" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "smtp_from" text;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "smtp_last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "smtp_last_check_ok" boolean;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "smtp_last_check_error" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_token" ADD CONSTRAINT "auth_token_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_token" ADD CONSTRAINT "auth_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_token_tenant_idx" ON "auth_token" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_token_user_idx" ON "auth_token" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_token_hash_uq" ON "auth_token" USING btree ("token_hash");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Data migration (the invite/reset build, 2026-08-24): the `user.manage`
-- permission itself, and the grant to every EXISTING owner/equipment_admin/
-- office_admin role.
--
-- Same reason 0020 needed one: `permission`, `role` and `role_permission` are
-- populated by the SEED, and the seed refuses to touch a tenant that already
-- exists. `role-perms.ts`'s `owner`/`equipment_admin: [...PERMISSIONS]` spread
-- only reaches a FRESHLY seeded database — on Urban's live one, neither role
-- picks up a permission added to the `PERMISSIONS` list after the fact, any
-- more than `office_admin`'s explicit list does. Skipping this migration would
-- ship `/admin/users` gated on a permission nobody on the live database holds,
-- including the owner account — "Accounts are managed by the equipment desk"
-- for everyone, the same failure shape 0020's header comment describes for
-- the visibility ladder. Idempotent throughout, safe to re-run.
-- ---------------------------------------------------------------------------
INSERT INTO "permission" ("name", "description") VALUES
  ('user.manage', 'Invite and manage login accounts, reset passwords, assign roles')
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "role_permission" ("role_id", "permission_name")
SELECT r."id", 'user.manage'
FROM "role" r
WHERE r."name" IN ('owner', 'equipment_admin', 'office_admin')
ON CONFLICT DO NOTHING;