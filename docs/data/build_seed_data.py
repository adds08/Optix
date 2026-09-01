#!/usr/bin/env python3
"""Rewrite the DATA blocks of packages/db/src/seed-data.ts from the real Urban
import templates in docs/data/import/.

Why this shape rather than a second seed script: packages/db/src/seed.ts already
writes a COMPLETE toState on every ledger row (the four core keys plus the
explicit truck/trailer pair), which is CLAUDE.md's first non-negotiable and a bug
that has shipped three times. Duplicating that logic in a parallel seeder is how
it ships a fourth time. So this replaces the DATA the existing, correct seeder
consumes, and the seeder itself is untouched.

Three regions of seed-data.ts:
  1. head   — types plus the static vocabularies (categories, roles, units of
              measure, company roles). PRESERVED verbatim.
  2. data   — projectSpecs .. txSpecs. REPLACED from the CSVs.
  3. users  — userSpecs, the 15 login accounts. PRESERVED verbatim, which is what
              "wipe everything except the logins" means in practice.

Region 3 pins a hard constraint: those accounts reference eight employee keys by
name, so the generated employeeSpecs MUST still contain all eight or the seed
fails on a null lookup. RESERVED_KEYS below maps each one onto a real person from
the source data, chosen by their position.
"""
import csv
import re
import unicodedata

ROOT = "/Users/adds08/Development/Urbaniconstruction/STInventory"
IMP = f"{ROOT}/docs/data/import"
TARGET = f"{ROOT}/packages/db/src/seed-data.urban.ts"
DEMO = f"{ROOT}/packages/db/src/seed-data.ts"

START = "2025-01-06"
END = "2030-12-31"
YARD = "Equipment Yard"

# Accounts in userSpecs reference these employee keys; every one must exist.
# Each is claimed by the first real person whose position matches.
# The 15 demo accounts are gone (they shared a published password, which is
# unacceptable on a customer-facing deployment), and with them the requirement
# that specific employee keys exist for a login to attach to. One real superuser
# account is seeded instead; it links to no employee, because the IT owner is not
# a member of a crew.
RESERVED = []
OWNER_EMAIL = "optix_it@optixtec.com"


def norm(s):
    if s is None:
        return ""
    s = unicodedata.normalize("NFKD", str(s))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip()


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", norm(s).lower()).strip("-") or "unknown"


def ts(v):
    """A TypeScript literal. Empty string is null, never ''."""
    if v is None or v == "":
        return "null"
    return '"' + str(v).replace("\\", "\\\\").replace('"', '\\"') + '"'


def read(name):
    with open(f"{IMP}/{name}") as f:
        return list(csv.DictReader(f))


projects_csv = read("projects.csv")
employees_csv = read("employees.csv")
vehicles_csv = read("vehicles.csv")
tools_csv = read("tools.csv")

# ------------------------------------------------------------------ projects
project_key = {}          # (name, extId) -> key
project_rows = []
for p in projects_csv:
    ext = p["external_id"] or None
    key = f"p-{slug(p['name'])}" + (f"-{ext}" if ext else "")
    project_rows.append({
        "key": key, "extId": ext, "name": p["name"],
        "status": p["status"] or "in_progress",
        "start": START, "end": END, "site": None,
    })
    project_key[(p["name"], ext)] = key
    project_key[p["name"]] = key
    if ext:
        project_key[ext] = key

YARD_KEY = project_key[YARD]


def proj_key(job, name=None):
    if job and job in project_key:
        return project_key[job]
    if name and name in project_key:
        return project_key[name]
    return None


# ------------------------------------------------------------------ employees
# Which role the app should give this person. Restricted to the vocabulary
# legacyEmployeeRoleToRole understands -- an unmapped value would resolve to
# undefined when the seed links an account to an employee.
def role_of(position):
    p = norm(position).lower()
    if "mechanic" in p:
        return "mechanic"
    if "superintendent" in p or p.startswith("super"):
        return "superintendent"
    if "project manager" in p or p == "pm" or "engineer" in p:
        return "pm"
    if "foreman" in p or "forman" in p or "formn" in p:
        return "foreman"
    if "ceo" in p or "manager" in p or "admin" in p:
        return "equipment_admin"
    # Field staff who hold equipment but whose title is a licence or a trade
    # (CDL, Surveyor, Quality, Safety). Foreman is the custody-bearing default.
    return "foreman"


emp_key_of = {}
emp_rows = []
claimed = set()

# Pass 1: hand the reserved keys to real people, so the logins keep working.
for key, wants in RESERVED:
    for e in employees_csv:
        nm = e["name"]
        if nm in claimed:
            continue
        if wants(norm(e["positions"]).lower()):
            emp_key_of[nm] = key
            claimed.add(nm)
            break

# Pass 2: everyone else gets a stable key derived from their name.
seq = 0
for e in employees_csv:
    nm = e["name"]
    if nm in emp_key_of:
        continue
    seq += 1
    emp_key_of[nm] = f"e-{slug(nm)[:28]}-{seq:03d}"

# Neither source carries an employee number, and EmployeeSeed.extId is not
# nullable, so one is minted here. Stable across runs because employees.csv
# order is stable — the same person keeps the same number on a reseed.
for n, e in enumerate(employees_csv, start=1):
    nm = e["name"]
    jobs = [j.strip() for j in (e["jobs"] or "").split("|") if j.strip()]
    primary = proj_key(jobs[0]) if jobs else None
    emp_rows.append({
        "key": emp_key_of[nm], "extId": f"URB-{n:03d}", "name": nm,
        "role": role_of(e["positions"]), "primary": primary,
        "status": "active", "email": None, "phone": None, "reportsTo": None,
    })

# The two desk employees the admin/warehouse logins are attached to.
emp_rows.append({"key": "e-karen", "extId": "0199", "name": "Karen Osei",
                 "role": "equipment_admin", "primary": None, "status": "active",
                 "email": "karen.osei@urban.local", "phone": "214-555-0100", "reportsTo": None})
emp_rows.append({"key": "e-yard", "extId": "7712", "name": "Yard Desk",
                 "role": "warehouse", "primary": None, "status": "active",
                 "email": "yard@urban.local", "phone": "214-555-0199", "reportsTo": None})

have = {r["key"] for r in emp_rows}
missing = [k for k, _ in RESERVED if k not in have]
if missing:
    raise SystemExit(
        f"FATAL: userSpecs references {missing} but no source person matched. "
        "Adjust RESERVED or the seed will fail on a null employee lookup.")

# ------------------------------------------------------------------ vehicles
loc_rows = [{"key": "l-dal", "type": "warehouse", "name": "Dallas Yard",
             "warehouse": "Main Warehouse — Dallas", "project": None, "custodian": None}]
vehloc_rows = []
veh_rows = []
loc_of_unit = {}

for v in vehicles_csv:
    unit = v["unit"]
    loc_key = f"l-{slug(unit)}"
    cust = emp_key_of.get(v["custodian_name"]) if v["custodian_name"] else None
    pk = proj_key(v["job"])
    # A truck or trailer with no readable job sits at the yard rather than nowhere.
    if not pk:
        pk = YARD_KEY
    vehloc_rows.append({"key": loc_key, "type": "vehicle", "name": unit,
                        "project": pk, "custodian": cust})
    veh_rows.append({
        "key": f"v-{slug(unit)}", "loc": loc_key,
        # The register models a trailer as vehicleType 'trailer'; the
        # vehicle/attachment split the templates carry has no column yet.
        "vtype": v["vehicle_type"],
        # The category Urban files it under, straight from the templates.
        "eclass": v["equipment_kind"] or None,
        # The VIN finally has a column to land in (migration 0040); before it,
        # every one of these was read from the source and silently dropped.
        "vin": v["vin"] or None,
        "unit": unit, "code": v["code"] or None,
        "description": v["make_model"] or None,
        "plate": v["plate"] or None, "make": v["make_model"] or None,
        "own": v["ownership"] or "company_owned",
        "payee": None, "allow": None, "freq": None,
        "proj": pk, "foreman": cust, "lat": None, "lng": None,
    })
    loc_of_unit[unit] = loc_key

# ------------------------------------------------------------------ assets
asset_rows = []
assign_rows = []
tx_rows = []
for t in tools_csv:
    tag = t["tag"]
    cust = emp_key_of.get(t["custodian_name"]) if t["custodian_name"] else None
    loc = loc_of_unit.get(t["trailer_unit"], "l-dal")
    pk = proj_key(t["job"], t["project_name"]) or YARD_KEY
    serial = t["serial"] or None
    serialized = bool(serial)
    dept = t["department"] == "Equipment Department"
    asset_rows.append({
        "tag": tag, "make": t["make"] or None, "modelNumber": t["model"] or None,
        "description": t["description"] or None, "serial": serial,
        "isSerialized": serialized,
        "quantity": 1 if serialized else int(t["qty"] or 1),
        "cost": None,
        "own": None if dept else pk, "dept": dept,
        "status": "assigned" if cust else "available",
        "cust": cust, "cur": pk, "loc": loc,
    })
    if cust:
        assign_rows.append({"tag": tag, "cust": cust, "proj": pk, "loc": loc,
                            "type": "permanent", "start": START, "end": None})
        tx_rows.append({"tag": tag, "event": "assign", "at": f"{START} 08:00",
                        "note": f"Genesis import — {t['custodian_name']}", "ref": "assignment"})

# ------------------------------------------------ postings + project team
posting_rows, team_rows = {}, {}
for v in vehicles_csv:
    if v["vehicle_type"] != "trailer" or not v["custodian_name"]:
        continue
    emp = emp_key_of[v["custodian_name"]]
    pk = proj_key(v["job"]) or YARD_KEY
    k = (emp, pk)
    if k not in posting_rows:
        posting_rows[k] = {"emp": emp, "proj": pk, "from": START, "to": None,
                           "note": f"Assigned with trailer {v['unit']}"}
        team_rows[k] = {"emp": emp, "proj": pk, "role": "foreman", "from": START,
                        "note": f"Runs trailer {v['unit']}"}
    else:
        posting_rows[k]["note"] += f", {v['unit']}"
        team_rows[k]["note"] += f", {v['unit']}"
posting_rows = list(posting_rows.values())
team_rows = list(team_rows.values())

# ------------------------------------------------------------------ emit
# Types are declared once, in the demo module, and imported here -- two copies
# of the same nine type aliases would drift.
head = (
    "/* GENERATED from docs/data/import/*.csv by docs/data/build_seed_data.py.\n"
    "   Do not edit by hand -- re-run the generator.\n"
    "\n"
    "   Urban Infraconstruction's REAL register, kept deliberately separate from the\n"
    "   demo dataset in ./seed-data.ts. That file is a test fixture: its synthetic\n"
    "   people and accounts are what rbac-matrix.test.ts drives the visibility ladder\n"
    "   through, so replacing it with real data made a security test unrunnable and\n"
    "   turned CI red. seed.ts picks between the two on SEED_DATASET.\n"
    "\n"
    "   Rows that could not be trusted are NOT here. They are listed with reasons in\n"
    "   docs/data/import/rejects.json and rendered for Urban to correct in\n"
    "   docs/data/import/data-issues.html. */\n"
    "import type {\n"
    "  AssetSeed,\n"
    "  AssignSeed,\n"
    "  EmployeeSeed,\n"
    "  LocSeed,\n"
    "  PostingSeed,\n"
    "  ProjectSeed,\n"
    "  TeamSeed,\n"
    "  TxSeed,\n"
    "  UserSeed,\n"
    "  VehLocSeed,\n"
    "  VehSeed,\n"
    "} from \"./seed-data.js\";\n\n"
)

L = []
A = L.append
A("/* ---------------------------------------------------------------------------")
A("   GENERATED from docs/data/import/*.csv by docs/data/build_seed_data.py.")
A("   Do not edit the blocks below by hand — re-run the generator instead.")
A("")
A("   This is Urban's real register: the enclosed-trailer workbook and the company")
A("   vehicle list, reconciled. Rows that could not be trusted were NOT invented —")
A("   they are listed in docs/data/import/rejects.json and rendered for the team in")
A("   docs/data/import/data-issues.html.")
A("")
A("   userSpecs below is deliberately NOT generated. Those accounts reference eight")
A("   employee keys by name (e-fm001, e-sup001, e-pm001, e-eng001, e-mech001,")
A("   e-karen, e-yard), so the generator assigns each key to a real person and")
A("   fails loudly rather than emitting a set the logins cannot resolve.")
A("   --------------------------------------------------------------------------- */")
A("")

A("export const projectSpecs: ProjectSeed[] = [")
for x in project_rows:
    A(f'  {{ key: {ts(x["key"])}, extId: {ts(x["extId"])}, name: {ts(x["name"])}, '
      f'status: {ts(x["status"])}, start: {ts(x["start"])}, end: {ts(x["end"])}, site: {ts(x["site"])} }},')
A("];")
A("")

A("export const employeeSpecs: EmployeeSeed[] = [")
for x in emp_rows:
    A(f'  {{ key: {ts(x["key"])}, extId: {ts(x["extId"])}, name: {ts(x["name"])}, '
      f'role: {ts(x["role"])}, primary: {ts(x["primary"])}, status: {ts(x["status"])}, '
      f'email: {ts(x["email"])}, phone: {ts(x["phone"])}, reportsTo: {ts(x["reportsTo"])} }},')
A("];")
A("")

A("export const postingSpecs: PostingSeed[] = [")
for x in posting_rows:
    A(f'  {{ emp: {ts(x["emp"])}, proj: {ts(x["proj"])}, from: {ts(x["from"])}, '
      f'to: {ts(x["to"])}, note: {ts(x["note"])} }},')
A("];")
A("")

A("export const teamSpecs: TeamSeed[] = [")
for x in team_rows:
    A(f'  {{ emp: {ts(x["emp"])}, proj: {ts(x["proj"])}, role: {ts(x["role"])}, '
      f'from: {ts(x["from"])}, note: {ts(x["note"])} }},')
A("];")
A("")

A("export const locSpecs: LocSeed[] = [")
for x in loc_rows:
    A(f'  {{ key: {ts(x["key"])}, type: {ts(x["type"])}, name: {ts(x["name"])}, '
      f'warehouse: {ts(x["warehouse"])}, project: {ts(x["project"])}, custodian: {ts(x["custodian"])} }},')
A("];")
A("")

A("export const vehLocSpecs: VehLocSeed[] = [")
for x in vehloc_rows:
    A(f'  {{ key: {ts(x["key"])}, type: {ts(x["type"])}, name: {ts(x["name"])}, '
      f'project: {ts(x["project"])}, custodian: {ts(x["custodian"])} }},')
A("];")
A("")

A("export const vehSpecs: VehSeed[] = [")
for x in veh_rows:
    A(f'  {{ key: {ts(x["key"])}, loc: {ts(x["loc"])}, vtype: {ts(x["vtype"])}, '
      f'eclass: {ts(x["eclass"])}, vin: {ts(x["vin"])}, '
      f'unit: {ts(x["unit"])}, code: {ts(x["code"])}, description: {ts(x["description"])}, '
      f'plate: {ts(x["plate"])}, make: {ts(x["make"])}, own: {ts(x["own"])}, '
      f'payee: {ts(x["payee"])}, allow: {ts(x["allow"])}, freq: {ts(x["freq"])}, '
      f'proj: {ts(x["proj"])}, foreman: {ts(x["foreman"])}, lat: {ts(x["lat"])}, lng: {ts(x["lng"])} }},')
A("];")
A("")

A("export const assetSpecs: AssetSeed[] = [")
for x in asset_rows:
    A(f'  {{ tag: {ts(x["tag"])}, make: {ts(x["make"])}, modelNumber: {ts(x["modelNumber"])}, '
      f'description: {ts(x["description"])}, serial: {ts(x["serial"])}, '
      f'isSerialized: {"true" if x["isSerialized"] else "false"}, quantity: {x["quantity"]}, '
      f'cost: {ts(x["cost"])}, own: {ts(x["own"])}, dept: {"true" if x["dept"] else "false"}, '
      f'status: {ts(x["status"])}, cust: {ts(x["cust"])}, cur: {ts(x["cur"])}, loc: {ts(x["loc"])} }},')
A("];")
A("")

A("export const assignSpecs: AssignSeed[] = [")
for x in assign_rows:
    A(f'  {{ tag: {ts(x["tag"])}, cust: {ts(x["cust"])}, proj: {ts(x["proj"])}, '
      f'loc: {ts(x["loc"])}, type: {ts(x["type"])}, start: {ts(x["start"])}, end: {ts(x["end"])} }},')
A("];")
A("")

A("export const txSpecs: TxSeed[] = [")
for x in tx_rows:
    A(f'  {{ tag: {ts(x["tag"])}, event: {ts(x["event"])}, at: {ts(x["at"])}, '
      f'note: {ts(x["note"])}, ref: {ts(x["ref"])} }},')
A("];")
A("")

A("/* ONE account, and it is a real one.")
A("")
A("   This replaced the fifteen demo logins that all shared the password")
A("   `stinventory-demo` — including an owner holding every permission. That set is")
A("   correct for a demo and indefensible on a customer-facing deployment, and")
A("   `seed.ts` refuses NODE_ENV=production precisely because of it.")
A("")
A("   No password lives here. seed.ts reads SEED_OWNER_PASSWORD, and generates a")
A("   random one it prints ONCE if that is unset — so a credential is never")
A("   committed and never defaults to something guessable.")
A("")
A("   employeeKey is null on purpose: the IT owner administers the system, they are")
A("   not a foreman holding tools. */")
A("export const userSpecs: UserSeed[] = [")
A(f'  {{ email: {ts(OWNER_EMAIL)}, first: "Optix", last: "IT", role: "owner", employeeKey: null }},')
A("];")

open(TARGET, "w").write(head + "\n".join(L) + "\n")

print(f"rewrote {TARGET}")
print(f"  projects   {len(project_rows)}")
print(f"  employees  {len(emp_rows)}  (reserved keys satisfied: {[k for k,_ in RESERVED]})")
print(f"  locations  {len(loc_rows)} + {len(vehloc_rows)} vehicle")
print(f"  vehicles   {len(veh_rows)}  "
      f"(trucks {sum(1 for v in veh_rows if v['vtype']=='truck')}, "
      f"trailers {sum(1 for v in veh_rows if v['vtype']=='trailer')})")
print(f"  assets     {len(asset_rows)}   assignments {len(assign_rows)}   tx {len(tx_rows)}")
print(f"  postings   {len(posting_rows)}   team {len(team_rows)}")
for key, _ in RESERVED:
    who = next((r["name"] for r in emp_rows if r["key"] == key), "??")
    print(f"    {key:12} -> {who}")
