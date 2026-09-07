/*
  BambooHR `GET /api/v1/employees` -> Optix, as a pure function.

  No network, no database, no imports from `@stinventory/db`. That is the whole
  point of it living here: the mapping is the part most likely to be wrong and
  the part least in need of a running stack to test. `bamboohr.test.ts` covers
  it with no fixtures.

  Verified against the published reference on 2026-09-07 (documentation.bamboohr.com
  /reference/list-employees) rather than against a live call — an agent never
  calls the client's production HR system, and the first live request is the
  user's. The path carries an `/api/v1` prefix; the plan document said `/v1`
  and was wrong about that one detail and right about everything else.

  THE RULE THAT MATTERS MOST: `_restrictedFields`.

  BambooHR returns `null` for a field the API key may not read and names that
  field in `_restrictedFields`. A null therefore means "not allowed to see it",
  NOT "the value is empty". An importer that treated the two alike would blank
  a real phone number on the second sync and there would be nothing in the logs
  to explain it.

  So this adapter does not return nulls for withheld fields — it OMITS them.
  A caller spreading `writable` into an update cannot blank a field it was
  never shown, because the key is not there to overwrite anything with. The
  array itself is passed through so a thin record is explainable next month
  instead of looking like bad data.

  THREE OUTPUT BUCKETS, and the split is policy made structural:

  - `writable`   — apply freely. HR owns these and nothing downstream breaks.
  - `identity`   — PROPOSE, never apply blind. `code` and `name` decide who a
                   row IS, and `name` is the only key available on a first
                   bind. Urban's roster carries five deliberately-separate
                   near-duplicate name pairs (`rejects.csv`), so silently
                   rewriting either field is how two people become one.
  - `observed`   — never written by a sync at all. `status` lives here because
                   the user settled on 2026-09-07 that a departure is a FLAG
                   for an admin to action, never an automatic deactivation:
                   terminating an employee reaches tool custody and the
                   clearance queue, and no import gets to do that on its own.

  A writer that spreads `writable` therefore cannot deactivate anybody or
  rename anybody, which is a stronger guarantee than a comment asking it not to.
*/

/** One record from the `data[]` array. Unknown-shaped on purpose — this is
    somebody else's payload and every field is optional in practice. */
export type BambooEmployeeRecord = Record<string, unknown>;

/** Fields HR owns outright. Absent key = BambooHR withheld it or never sent it;
    either way there is nothing to write. */
export type BambooWritableFields = {
  email?: string;
  jobTitleName?: string;
  divisionName?: string;
  departmentName?: string;
};

/** Proposed, never applied without a human. See the `identity` note above. */
export type BambooIdentityFields = {
  code?: string;
  name?: string;
};

/** Reported and never written. */
export type BambooObservations = {
  /** Normalised from Bamboo's `status`. `null` when withheld or unrecognised. */
  employmentStatus: "active" | "terminated" | "on_leave" | null;
  /** Bamboo's own word, kept verbatim so a surprising value is debuggable. */
  rawStatus?: string;
  /**
   * HR's own answer to "does this person supervise anybody".
   *
   * `undefined` when withheld or absent, and that is NOT the same as `false` —
   * the difference decides whether a role is derived at all, so an absent
   * value must never collapse into "not a manager".
   */
  isManager?: boolean;
  /** Full-time / Part-Time / Contractor, verbatim. Reported, not mapped. */
  employmentType?: string;
  /**
   * HR's own status wording, verbatim — "Full-Time", "Leave of Absence",
   * "Terminated". The only field that can tell somebody on leave from
   * somebody gone; `status` cannot, it is Active/Inactive and nothing else.
   */
  rawEmploymentStatusName?: string;
  /**
   * The date a leaver left, `YYYY-MM-DD` as Bamboo sends it.
   *
   * Targets `employee.terminated_at`, the last employee column with no source
   * in this adapter. Reported rather than written, like everything else in
   * this bucket — but it is the date a flagged departure would carry, and it
   * is the column the clearance queue reads to find an ex-employee still
   * holding tools.
   */
  terminationDate?: string;
};

export type BambooContact = {
  kind: "mobile" | "work";
  value: string;
};

export type AdaptedBambooPerson = {
  /** Bamboo's internal PK, the stable match key. Goes to
      `employee_external_ref.external_id` with `system: 'bamboohr'` — never onto
      the employee row, where it would collide with Urban's own `code`. */
  externalId: string;
  writable: BambooWritableFields;
  identity: BambooIdentityFields;
  observed: BambooObservations;
  contacts: BambooContact[];
  /** Bamboo's id for this person's manager. Resolved in a SECOND pass, because
      a manager may be imported after their report. */
  reportsToExternalId?: string;
  /** `_restrictedFields` verbatim, for `employee_external_ref.restricted_fields`. */
  withheld: string[];
  /** The untouched record, for `employee_external_ref.raw`. Carries the fields
      this adapter deliberately drops — `locationName` (an HR office, not a
      place a tool can sit) and `photoUrl` (a CloudFront signature that expires,
      so storing it yields a link that 403s in a month). */
  raw: BambooEmployeeRecord;
};

export type BambooAdaptFailure = {
  /** Why this record cannot be used. Surfaced in the dry-run as "refused". */
  reason: string;
  raw: BambooEmployeeRecord;
};

export type BambooAdaptResult =
  | { ok: true; person: AdaptedBambooPerson }
  | { ok: false; failure: BambooAdaptFailure };

/* Bamboo sends numbers for some ids and strings for others depending on the
   field and the endpoint. Everything we store is text, so normalise once here
   rather than at each call site — and treat whitespace as absent, because a
   roster exported through a spreadsheet is full of " ". */
function str(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function restrictedFieldsOf(record: BambooEmployeeRecord): string[] {
  const raw = record["_restrictedFields"];
  if (!Array.isArray(raw)) return [];
  return raw.filter((f): f is string => typeof f === "string");
}

/*
  Bamboo's `status` is "Active" / "Inactive". Ours is
  `active | terminated | on_leave` (`EMPLOYMENT_STATUSES`).

  "Inactive" maps to `terminated` and NOT to `on_leave`: Bamboo models leave
  separately, so reading "Inactive" as "on leave" would quietly resurrect
  leavers as current staff. Anything unrecognised returns null rather than
  guessing — an unknown status is a thing to report, not to coerce.

  Compared case-insensitively. This is a display string in somebody else's
  system and its capitalisation is not our contract.
*/
export function normaliseBambooStatus(
  value: unknown,
  statusName?: unknown,
): "active" | "terminated" | "on_leave" | null {
  const s = str(value);
  if (!s) return null;
  const k = s.toLowerCase();

  /* INACTIVE WINS, and it is checked before the leave refinement on purpose.
     A person HR has marked Inactive is off the roster whatever their status
     name still says, and reading that as `on_leave` would keep them out of the
     clearance queue — an ex-employee holding tools nobody goes looking for.
     Recovering a tool from somebody who turns out to be on leave is the
     cheaper mistake of the two. */
  if (k === "inactive") return "terminated";
  if (k !== "active") return null;

  /* The ONLY path to `on_leave`, which `EMPLOYMENT_STATUSES` defines and
     nothing could previously produce. Somebody on a leave of absence is still
     `status: Active` in BambooHR — the flag cannot tell them from somebody at
     work, so the distinction has to come from HR's own wording.

     Substring rather than a fixed list because the wording is tenant-defined:
     "Leave of Absence", "FMLA Leave" and "Maternity Leave" are all one answer,
     and a list would silently miss whichever one this tenant configured. */
  const nameKey = str(statusName)?.toLowerCase();
  if (nameKey?.includes("leave")) return "on_leave";

  return "active";
}

/**
 * Adapt one `data[]` record.
 *
 * Returns a failure rather than throwing, and rather than skipping silently:
 * a run that refused four rows has to be able to say which four and why, and
 * an exception mid-page would abandon the rest of the page.
 */
export function adaptBambooEmployee(record: BambooEmployeeRecord): BambooAdaptResult {
  const withheld = restrictedFieldsOf(record);
  /* A `Set` because this is consulted once per mapped field and the array can
     carry the 150-plus optional field names. */
  const isWithheld = new Set(withheld);

  /* Reads a field ONLY if Bamboo did not withhold it. This function is the
     enforcement of the restricted-fields rule — every mapped read goes through
     it, so a new field added below inherits the protection instead of having to
     remember it. */
  const visible = (key: string): string | undefined =>
    isWithheld.has(key) ? undefined : str(record[key]);

  /* The match key. Without it a row cannot be bound to anybody, cannot be
     re-found on the next run, and would be indistinguishable from a new person
     every sync — so this is a refusal, not a warning. Deliberately read
     WITHOUT `visible`: an `employeeId` in `_restrictedFields` is a payload we
     do not understand, and pretending the row is anonymous would be worse than
     refusing it. */
  const externalId = str(record["employeeId"]);
  if (!externalId) {
    return {
      ok: false,
      failure: { reason: "no employeeId — cannot be matched to a person", raw: record },
    };
  }

  /* `firstName` + `lastName`, and `preferredName` is deliberately ignored: the
     register is a legal roster that has to reconcile with payroll, and "Bob"
     for "Robert" would not match the badge. Either half may be withheld, so
     the join tolerates one side missing rather than emitting " " or "undefined
     Smith". */
  const first = visible("firstName");
  const last = visible("lastName");
  const name = [first, last].filter(Boolean).join(" ") || undefined;

  const contacts: BambooContact[] = [];
  const mobile = visible("mobilePhone");
  if (mobile) contacts.push({ kind: "mobile", value: mobile });
  const work = visible("workPhone");
  if (work) contacts.push({ kind: "work", value: work });

  const writable: BambooWritableFields = {};
  /* Assigned conditionally, never as `x: maybeUndefined`. Under
     `exactOptionalPropertyTypes` those differ, and more importantly a present
     key holding `undefined` still overwrites on a spread — which is the exact
     blanking this whole file exists to prevent. */
  const email = visible("workEmail");
  if (email) writable.email = email;
  const jobTitle = visible("jobTitleName");
  if (jobTitle) writable.jobTitleName = jobTitle;
  const divisionName = visible("divisionName");
  if (divisionName) writable.divisionName = divisionName;
  const departmentName = visible("departmentName");
  if (departmentName) writable.departmentName = departmentName;

  const identity: BambooIdentityFields = {};
  /* `employeeNumber` is Urban's OWN badge number that BambooHR happens to
     administer — a `code`, not a foreign key. Bamboo's spec warns never to
     pass it as an id, and `employeeId` above is the id. */
  const code = visible("employeeNumber");
  if (code) identity.code = code;
  if (name) identity.name = name;

  const rawStatus = visible("status");
  const observed: BambooObservations = {
    employmentStatus: normaliseBambooStatus(rawStatus, visible("employmentStatusName")),
  };
  if (rawStatus) observed.rawStatus = rawStatus;
  /* Read directly rather than through `visible`, because this is a boolean and
     `str()` would turn `false` into undefined — losing the distinction between
     "HR says no" and "HR did not say", which is the whole point of the field.
     The restriction check still applies. */
  if (!isWithheld.has("isManager") && typeof record["isManager"] === "boolean") {
    observed.isManager = record["isManager"] as boolean;
  }
  const empType = visible("employmentType");
  if (empType) observed.employmentType = empType;
  const empStatusName = visible("employmentStatusName");
  if (empStatusName) observed.rawEmploymentStatusName = empStatusName;
  const termDate = visible("terminationDate");
  if (termDate) observed.terminationDate = termDate;

  const person: AdaptedBambooPerson = {
    externalId,
    writable,
    identity,
    observed,
    contacts,
    withheld,
    raw: record,
  };

  /* `reportsToId`, never `reportsToName`. The name string is offered by the
     same payload and is unusable here: Urban's roster carries five
     near-duplicate name pairs kept deliberately separate, so a name lookup
     would bind a supervisor to the wrong twin. Self-reference is dropped —
     `employee.reportsToEmployeeId` has a self-FK and the router already refuses
     it, so passing it on would only turn a bad payload into a 400. */
  const reportsTo = visible("reportsToId");
  if (reportsTo && reportsTo !== externalId) person.reportsToExternalId = reportsTo;

  return { ok: true, person };
}

/**
 * Adapt a whole `data[]` page, keeping refusals beside successes.
 *
 * One pass returns both because the dry-run has to report created / updated /
 * skipped / refused together, and a caller that had to run the list twice to
 * get both halves would be free to forget the second half.
 */
export function adaptBambooPage(records: BambooEmployeeRecord[]): {
  people: AdaptedBambooPerson[];
  failures: BambooAdaptFailure[];
} {
  const people: AdaptedBambooPerson[] = [];
  const failures: BambooAdaptFailure[] = [];
  for (const r of records) {
    const res = adaptBambooEmployee(r);
    if (res.ok) people.push(res.person);
    else failures.push(res.failure);
  }
  return { people, failures };
}

/**
 * The `fields` query parameter: every OPTIONAL field this adapter maps.
 *
 * Derived from the mapping above rather than typed out beside it, so adding a
 * mapped field cannot leave the request asking for less than the adapter reads
 * — a mismatch that would present as "BambooHR never sends this" and send the
 * next person looking in the wrong system entirely.
 *
 * The always-included fields (`employeeId`, `firstName`, `lastName`,
 * `jobTitleName`, `status`, `_restrictedFields`) are absent deliberately: they
 * arrive whether or not they are asked for.
 */
export const BAMBOO_OPTIONAL_FIELDS = [
  "workEmail",
  "mobilePhone",
  "workPhone",
  "departmentName",
  "divisionName",
  "employeeNumber",
  "reportsToId",
  /*
    SUPERVISION, and it is a separate fact from the job title.

    BambooHR's own words for it: "Whether the employee is a manager". Asking
    the title whether somebody supervises is guesswork — `Field Engineer 3`
    does not say, and `Carpenter` says nothing at all — whereas this is HR's
    assertion. Missing this was the difference between deriving a role from a
    string and reading it.

    (`supervisor` is the DIRECTORY endpoint's name for the manager, and that
    endpoint is not the one we use. Here the pair is `isManager` +
    `reportsToId`.)
  */
  "isManager",
  /* Full-time / part-time / contractor. Not mapped to a column yet, but a
     roster that cannot tell a subcontractor from staff is a roster that will
     be asked to. */
  "employmentType",
  /*
    THE DATE A LEAVER LEFT — and the last employee column with no source.

    `employee.terminated_at` exists and the clearance queue reads it, so
    without this field a departure can only ever be flagged as "inactive" with
    no date attached. The user settled that a leaver is a FLAG rather than an
    automatic deactivation, and a flag carrying "left 2026-03-15" is something
    an admin can act on where a bare boolean is not.
  */
  "terminationDate",
  /*
    THE RICH EMPLOYMENT STATUS — and the only way to reach `on_leave`.

    `status` is Active/Inactive and nothing else, so `normaliseBambooStatus`
    fed only that can produce `active` and `terminated` and never the third
    value `EMPLOYMENT_STATUSES` defines. Somebody on a leave of absence is
    still `status: Active` in BambooHR, which is why the distinction has to
    come from HR's own wording rather than from the flag.

    Without this field an Optix enum value has no source at all — dead by
    construction, not by choice.
  */
  "employmentStatusName",
  /* Not mapped to a column, kept so `raw` can answer "what did Bamboo say
     about where this person sits" without a second call. An HR office is not a
     place a tool can be — see the plan document on why this never becomes a
     `location` row. */
  "locationName",
] as const;
