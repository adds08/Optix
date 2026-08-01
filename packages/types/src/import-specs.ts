/* Type-only, so it is erased at runtime and cannot reintroduce a cycle. */
import type { Permission } from "./index";
import {
  ASSET_CONDITIONS,
  EMPLOYEE_ROLES,
  EMPLOYMENT_STATUSES,
  LOCATION_TYPES,
  PROJECT_STATUSES,
  VEHICLE_OWNERSHIP,
  VEHICLE_TYPES,
} from "./enums";

/*
  Column specs for bulk CSV import.

  One declaration drives three things that must never disagree: the template a
  user downloads, the client-side parse, and the server-side validation. When
  they live apart, a template quietly grows a column the importer rejects and
  the first thing a new customer meets is a spreadsheet that will not load.

  `ref` columns hold a human name in the file — "Legacy West Phase 3", not a
  UUID — because the spreadsheet a yard keeps has names in it. The server
  resolves them and reports the ones it cannot match.
*/

export type ImportColumnType =
  | "text"
  | "integer"
  | "decimal"
  | "date"
  /* US-format dates (MM/DD/YYYY), because that is what vendor portals emit.
     Normalised to ISO on the way in. */
  | "usdate"
  | "enum"
  | "ref";

export type ImportRefTarget = "project" | "location" | "employee" | "warehouse";

export type ImportColumn = {
  /** Field name on the created row. */
  key: string;
  /** Header as it appears in the CSV. */
  header: string;
  type: ImportColumnType;
  required?: boolean;
  values?: readonly string[];
  ref?: ImportRefTarget;
  /** Sample value written into the template's example row. */
  example: string;
  hint?: string;
  /** Vendor and yard vocabulary folded onto ours. Keys are lowercase. */
  valueAliases?: Record<string, string>;
};

export type ImportEntity = "asset" | "employee" | "project" | "location" | "vehicle" | "rental";

export type ImportSpec = {
  entity: ImportEntity;
  label: string;
  /** What the equivalent create procedure charges. */
  permission: Permission;
  /** Columns that must be unique both within the file and against the tenant. */
  unique: string[];
  description: string;
  columns: ImportColumn[];
};

export const IMPORT_SPECS: Record<ImportEntity, ImportSpec> = {
  asset: {
    entity: "asset",
    label: "Tools",
    permission: "asset.manage",
    unique: ["tag", "serialNumber"],
    description:
      "The tool register. One row per serialized tool; use quantity for bulk lines that are not tracked individually.",
    columns: [
      { key: "tag", header: "tag", type: "text", example: "UIC-2001",
        hint: "Your asset tag, if the tool has one. Leave blank if it is not labelled yet." },
      /* In the order the trailer sheets use them: description first, then make
         and model number. The sheets have no tag column and the brand can be
         buried in the description, so description is the one required field. */
      { key: "description", header: "description", type: "text", required: true,
        example: "Rotary Hammer",
        hint: "What the tool is, in your own words." },
      { key: "make", header: "make", type: "text",
        example: "DeWalt", hint: "Brand only." },
      { key: "modelNumber", header: "model", type: "text",
        example: "DCH273", hint: "The manufacturer's number. Blank is fine." },
      { key: "categoryName", header: "category", type: "text", example: "Power Tools" },
      { key: "serialNumber", header: "serial", type: "text", example: "4471X99",
        hint: "Manufacturer serial. Unique if given — this is what a police report needs." },
      { key: "quantity", header: "quantity", type: "integer", example: "1",
        hint: "Leave at 1 for serialized tools." },
      { key: "acquisitionCost", header: "cost", type: "decimal", example: "489.00" },
      { key: "acquisitionDate", header: "purchased_on", type: "date", example: "2026-03-14",
        hint: "YYYY-MM-DD." },
      { key: "warrantyExpiresOn", header: "warranty_expires", type: "date", example: "2028-03-14" },
      { key: "condition", header: "other", type: "enum", values: ASSET_CONDITIONS,
        valueAliases: { used: "good" },
        example: "new",
        hint: "NEW or USED on the trailer sheets. USED is recorded as good." },
      { key: "otherRef", header: "column_8", type: "text",
        example: "PC-08",
        hint: "The unlabelled ninth sheet column: a secondary equipment number or a note." },
      { key: "locationId", header: "location", type: "ref", ref: "location", example: "Dallas Yard",
        hint: "Name of an existing location." },
      { key: "owningProjectId", header: "owning_project", type: "ref", ref: "project", example: "Legacy West Phase 3",
        hint: "The project whose capital bought it. Does not change when the tool moves." },
    ],
  },

  employee: {
    entity: "employee",
    label: "People",
    permission: "employee.manage",
    unique: ["externalId"],
    description: "Anyone who can hold custody of a tool. Import these before tools, so assignments can find them.",
    columns: [
      { key: "name", header: "name", type: "text", required: true, example: "Dwayne Miller" },
      { key: "role", header: "role", type: "enum", values: EMPLOYEE_ROLES, example: "foreman" },
      { key: "externalId", header: "employee_id", type: "text", example: "4471",
        hint: "Your payroll / BambooHR id. Unique if given." },
      { key: "email", header: "email", type: "text", example: "dwayne.miller@example.com" },
      { key: "phone", header: "phone", type: "text", example: "214-555-0142" },
      {
        key: "employmentStatus", header: "status", type: "enum",
        values: EMPLOYMENT_STATUSES, example: "active",
      },
      { key: "primaryProjectId", header: "primary_project", type: "ref", ref: "project",
        example: "Legacy West Phase 3" },
    ],
  },

  project: {
    entity: "project",
    label: "Projects",
    permission: "project.manage",
    unique: ["externalId"],
    description: "Job sites tools get charged to. Import these first — people and tools both reference them by name.",
    columns: [
      { key: "name", header: "name", type: "text", required: true, example: "Legacy West Phase 3" },
      { key: "externalId", header: "cost_code", type: "text", example: "LW-P3",
        hint: "How FoundationSoft knows this job. Unique if given." },
      { key: "status", header: "status", type: "enum", values: PROJECT_STATUSES, example: "active" },
      { key: "costCenter", header: "cost_center", type: "text", example: "TX-DAL-01" },
      { key: "siteAddress", header: "site_address", type: "text", example: "7501 Windrose Ave, Plano TX",
        hint: "Where the job physically is — what a driver types into a phone." },
      { key: "startDate", header: "start_date", type: "date", example: "2026-01-06" },
      { key: "endDate", header: "end_date", type: "date", example: "2026-11-30" },
    ],
  },

  location: {
    entity: "location",
    label: "Locations",
    permission: "location.manage",
    unique: [],
    description:
      "Places a tool can sit — yards, containers, gang boxes. Trucks and trailers go in the vehicle import instead; they create their own location.",
    columns: [
      { key: "name", header: "name", type: "text", required: true, example: "Gang Box A" },
      {
        key: "type", header: "type", type: "enum", required: true,
        /* `vehicle` is deliberately absent: a vehicle location is created by the
           vehicle importer so the two rows cannot drift apart. */
        values: LOCATION_TYPES.filter((t) => t !== "vehicle"),
        example: "gang_box",
      },
      { key: "projectId", header: "project", type: "ref", ref: "project", example: "Trinity Bridge Rehab" },
      { key: "warehouseId", header: "warehouse", type: "ref", ref: "warehouse", example: "Dallas Yard" },
      { key: "custodianEmployeeId", header: "held_by", type: "ref", ref: "employee", example: "Dwayne Miller",
        hint: "Who carries this container. Leave blank for a yard or a site — nobody carries those." },
    ],
  },

  /*
    Rented equipment, shaped to match what a vendor actually exports.

    The headers are United Rentals' own, verbatim, because the file Urban can
    download has these columns and asking a yard clerk to rename them before
    importing is how an import feature goes unused. One row is one line item,
    with the contract fields repeated on every row — the importer groups them
    back into orders by contract number.

    `jobsite` is plain text, not a project ref. The vendor's name for a job
    ("TXDOT PUMP STATION IMPROVEMENT") will not match Urban's, and a ref column
    would reject every row of a real file. Linking happens afterwards, once,
    per jobsite.
  */
  rental: {
    entity: "rental",
    label: "Rented equipment",
    permission: "rental.manage",
    /* Nothing is unique per row: a contract legitimately appears on as many
       rows as it has lines. */
    unique: [],
    description:
      "Quotes and contracts from a rental vendor. Export from the vendor's portal and load it as-is — one row per line item.",
    columns: [
      { key: "orderType", header: "Order Type", type: "enum", required: true,
        values: ["Quote", "Open Contract", "Closed Contract"], example: "Open Contract",
        hint: "The vendor's own wording." },
      { key: "externalNumber", header: "Contract/Quote #", type: "text", required: true, example: "260816452",
        hint: "Groups rows into one order." },
      { key: "startDate", header: "Start Date", type: "usdate", example: "12/04/2026" },
      { key: "endDate", header: "End Date", type: "usdate", example: "01/01/2027",
        hint: "When it must go back. Past this and still on rent is what the alerts chase." },
      { key: "jobsiteLabel", header: "Jobsite", type: "text", example: "TXDOT PUMP STATION IMPROVEMENT",
        hint: "The vendor's name for the job. Match it to one of yours after importing." },
      { key: "orderedByLabel", header: "Ordered By", type: "text", example: "Martha Gonazalez-Munoz" },
      { key: "itemName", header: "Item Name", type: "text", required: true,
        example: "Vacuum Assisted Pump, 12 in. by 8 in., Diesel Powered" },
      { key: "catClass", header: "Cat Class", type: "text", example: "520-6005",
        hint: "The vendor's catalogue code. Worth keeping — it is what makes two lines comparable." },
      { key: "quantity", header: "Qty", type: "integer", example: "5" },
      { key: "notes", header: "Notes", type: "text", example: "" },
    ],
  },

  vehicle: {
    entity: "vehicle",
    label: "Vehicles",
    permission: "vehicle.manage",
    unique: ["unit"],
    description:
      "Trucks and trailers, which are locations that move. Each one also creates the location tools ride in.",
    columns: [
      { key: "unit", header: "unit", type: "text", required: true, example: "TRU-012",
        hint: "Unit number. Must be unique." },
      { key: "vehicleType", header: "type", type: "enum", required: true, values: VEHICLE_TYPES, example: "truck" },
      { key: "plate", header: "plate", type: "text", example: "TX 8823NM" },
      { key: "makeModel", header: "make_model", type: "text", example: "2023 Ford F-250" },
      {
        key: "ownershipType", header: "ownership", type: "enum",
        values: VEHICLE_OWNERSHIP, example: "company_owned",
      },
      { key: "projectId", header: "project", type: "ref", ref: "project", example: "Grand Parkway Segment H" },
      { key: "foremanEmployeeId", header: "foreman", type: "ref", ref: "employee", example: "Dwayne Miller" },
    ],
  },
};

export const IMPORT_ENTITIES = Object.keys(IMPORT_SPECS) as ImportEntity[];

/** Header row plus one example row — the file a user downloads to start from. */
export function templateRows(entity: ImportEntity): string[][] {
  const spec = IMPORT_SPECS[entity];
  return [spec.columns.map((c) => c.header), spec.columns.map((c) => c.example)];
}
