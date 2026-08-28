import { boolean, decimal, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./identity";

// Catalog reference tables (tenant-scoped).

export const category = pgTable(
  "tbl_entity_category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentId: uuid("parent_id").references((): any => category.id, { onDelete: "set null" }),
    defaultMaintenanceIntervalDays: integer("default_maintenance_interval_days"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("category_tenant_idx").on(t.tenantId),
  }),
);

export const manufacturer = pgTable(
  "tbl_entity_manufacturer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("manufacturer_tenant_idx").on(t.tenantId),
  }),
);

// Named `asset_model` to avoid the SQL/ORM reserved word `model`.
export const assetModel = pgTable(
  "tbl_entity_asset_model",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id, { onDelete: "cascade" }),
    manufacturerId: uuid("manufacturer_id").references(() => manufacturer.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    categoryId: uuid("category_id").references(() => category.id, { onDelete: "set null" }),
    defaultUnitCost: decimal("default_unit_cost", { precision: 14, scale: 2 }),
    isSerialized: boolean("is_serialized").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("asset_model_tenant_idx").on(t.tenantId),
  }),
);
