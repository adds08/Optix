import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenant, user } from "./identity";
import { project } from "./project";

/*
  Job Groups — how a superintendent or PM is scoped to the jobs that are theirs.

  Operations and the equipment desk group jobs (Legacy West + Trinity + …) into
  named buckets, then assign those buckets to users. A user with group
  assignments only ever sees the jobs in their groups — the sidebar job selector
  is built from this table. A user with none sees the whole tenant, which is how
  the desk keeps full access.

  Three tables, all tenant-scoped like everything else:
    project_group           the named bucket
    project_group_project   which jobs are in it (many-to-many)
    project_group_user      which users can see it (many-to-many)
*/
export const projectGroup = pgTable(
  "project_group",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("project_group_tenant_idx").on(t.tenantId),
  }),
);

export const projectGroupProject = pgTable(
  "project_group_project",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    projectGroupId: uuid("project_group_id")
      .notNull()
      .references(() => projectGroup.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    groupProjectUq: uniqueIndex("project_group_project_uq").on(t.projectGroupId, t.projectId),
    tenantIdx: index("project_group_project_tenant_idx").on(t.tenantId),
  }),
);

export const projectGroupUser = pgTable(
  "project_group_user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    projectGroupId: uuid("project_group_id")
      .notNull()
      .references(() => projectGroup.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    groupUserUq: uniqueIndex("project_group_user_uq").on(t.projectGroupId, t.userId),
    tenantIdx: index("project_group_user_tenant_idx").on(t.tenantId),
  }),
);
