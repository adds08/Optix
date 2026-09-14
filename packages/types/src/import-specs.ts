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

export type ImportEntity = "asset" | "employee" | "project" | "location" | "vehicle";

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
    /*
      UNIQUE BUT NULLABLE, both of them. `validateRows` skips a blank value
      before the duplicate check (`!val` -> continue), so the 407 tools with no
      serial all pass and only a REPEATED serial is refused.

      I briefly removed `serialNumber` from this list when a real import showed
      28 rows failing on it. That was wrong — the check is right and the DATA is
      not. Two distinguishable problems in Urban's sheet:

        15 rows have `N` or `n` in the serial column, which is somebody writing
        "no serial" in a text field. Those should be BLANK.
        13 values genuinely repeat (10 numeric ×2-3, plus `1161205PR3` ×3),
        which is transcription error or reuse.

      Weakening the constraint would have imported 28 tools that cannot be told
      apart by the one identifier a police report needs. Fix the CSV instead.
    */
    unique: ["code", "serialNumber"],
    description:
      "The tool register. One row per serialized tool; use quantity for bulk lines that are not tracked individually.",
    columns: [
      /* The tool's CODE — renamed from `tag` on 2026-09-07 so it matches every
         other entity (`employee.code`, `project.code`). The CSV header stays
         `tag`: that is a contract with spreadsheets people already have, and
         the column behind it is what needed to be honest. `serial_number`
         below is the MANUFACTURER's and is a separate field, not a fallback
         for this one. */
      /* Header is `code`, not `tag`: the column was renamed on 2026-09-07 and
         this spec was the last place still asking for the old word. Blank is
         normal and expected — `asset.create` generates `TOOL-00001` when none
         is given, and the importer leaves it null for a row to be coded later. */
      { key: "code", header: "code", type: "text", example: "TOOL-00001",
        hint: "Your own code for the tool, if it has one. Leave blank to have one generated." },
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
      { key: "locationId", header: "location", type: "ref", ref: "location", example: "Dallas Yard",
        hint: "Name of an existing location." },
      { key: "owningProjectId", header: "owning_project", type: "ref", ref: "project", example: "Legacy West Phase 3",
        hint: "The project whose capital bought it. Does not change when the tool moves." },
      /*
        DELIBERATELY NOT IMPORTABLE: `condition` and `other_ref`.

        They were here because Urban's tools spreadsheet had the columns —
        literally headed `other` and `column_8`, the second being the sheet's
        unlabelled ninth column. Measured against the real 753-row file, both
        are 0% POPULATED. Asking a CSV for a field nobody fills makes the
        template wider and the import easier to get wrong, for nothing.

        THE COLUMNS STILL EXIST on `tbl_entity_small_tool` and are editable in
        the app, so no data and no capability is lost. If a real source for
        either appears, adding a line back here is a one-line change with no
        migration — which is the general rule: the spec is what a CSV may
        carry, not what the entity can hold.

        `cost` is 0% too and STAYS, because it is load-bearing: the high-value
        approval gate reads `acquisitionCost`, so it has to be fillable at
        import even while every row is blank.
      */
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
      /* The header stays `employee_id` and the key stays `externalId` on
         purpose: both are a contract with spreadsheets people already have.
         The COLUMN behind them was renamed to `employee.code` on 2026-09-06
         — see `insertOne`, which remaps it. This is the company's own badge
         number, NOT a foreign system's key; a BambooHR employee id is a
         different fact and belongs in `employee_external_ref`. */
      { key: "externalId", header: "employee_id", type: "text", example: "4471",
        hint: "Your own payroll / badge number. Unique if given." },
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
    description: "The projects tools get charged to. Import these first — people and tools both reference them by name.",
    columns: [
      { key: "name", header: "name", type: "text", required: true, example: "Legacy West Phase 3" },
      { key: "externalId", header: "project_code", type: "text", example: "LW-P3",
        hint: "How FoundationSoft knows this job, and the code shown on the register. Unique if given." },
      { key: "description", header: "description", type: "text", example: "Phase 3 road widening" },
      { key: "status", header: "status", type: "enum", values: PROJECT_STATUSES, example: "in_progress" },
      { key: "siteAddress", header: "site_address", type: "text", example: "7501 Windrose Ave, Plano TX",
        hint: "Where the job physically is — what a driver types into a phone." },
      { key: "startDate", header: "start_date", type: "date", required: true, example: "2026-01-06" },
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
        example: "warehouse",
      },
      { key: "projectId", header: "project", type: "ref", ref: "project", example: "Trinity Bridge Rehab" },
      { key: "warehouseId", header: "warehouse", type: "ref", ref: "warehouse", example: "Dallas Yard" },
      { key: "custodianEmployeeId", header: "held_by", type: "ref", ref: "employee", example: "Dwayne Miller",
        hint: "Who carries this container. Leave blank for a yard or a site — nobody carries those." },
    ],
  },

  /* Trucks and trailers. They are also LOCATIONS — each one creates the
     location row tools ride in, which is how "in trailer TE-011" is recorded
     at all. (A rented-equipment spec sat here until 2026-09-13, describing a
     United Rentals import that was built and then removed with the rental
     model; it had been left above this entry, describing nothing.) */
  vehicle: {
    entity: "vehicle",
    label: "Vehicles",
    permission: "vehicle.manage",
    /* `code`, not `unit` — that column was dropped in migration 0077. Naming
       a field that no longer exists meant equipment code duplicates were not
       checked AT ALL: the set was built under a key nothing looked up. */
    unique: ["code"],
    description:
      "Trucks and trailers, which are locations that move. Each one also creates the location tools ride in.",
    columns: [
      /* ONE code. This spec asked for `unit` AND `code` as separate columns
         until migration 0077, with a hint insisting they were different
         things — they were not: all 88 vehicles in Urban's real fleet had them
         equal. */
      { key: "code", header: "code", type: "text", required: true, example: "TRK-012",
        hint: "The unit number painted on it — TRK-012, TE-006. Must be unique." },
      { key: "vehicleType", header: "type", type: "enum", required: true, values: VEHICLE_TYPES, example: "truck" },
      /* Added 2026-09-14 at the client's direction: "yes VIN matter but should
         be isNull". The column has always existed and been nullable; this spec
         had no way to fill it, so every import dropped the VINs on the floor —
         88 of them are recoverable from `git show bd98798:…seed-data.urban.ts`. */
      { key: "vin", header: "vin", type: "text", example: "1FTEW1KP6RKD12345",
        hint: "The manufacturer's chassis number. Optional, and never validated — a real fleet has a 16-character one." },
      { key: "description", header: "description", type: "text", example: "2023 F-250, GPK crew" },
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
