#!/usr/bin/env python3
"""Emit packages/db/src/seed-data.ts from docs/data/seed_from_tools_list.json.

Maps the Excel extraction onto the app's seed spec shapes:
  foremen    -> employee   (role foreman, primaryProjectId from their trailer)
  projects   -> project    (externalId = job number when present)
  trailers   -> vehicle    (vehicleType trailer, unit = TE-xxx, truck stays null
                            because the source has no trucks) + vehicle location
  small_tools-> asset      (isSerialized when a serial exists; serial -> Equipment
                            Department, no serial -> Purchased Department)
Also emits postings, team rows, one active assignment + one assign transaction
per tool, and the minimal desk logins (owner / admin / warehouse).
"""
import json
import re

SRC = "/Users/adds08/Development/Urbaniconstruction/STInventory/docs/data/seed_from_tools_list.json"
OUT = "/Users/adds08/Development/Urbaniconstruction/STInventory/packages/db/src/seed-data.ts"

d = json.load(open(SRC))
foremen = d["foremen"]
projects = d["projects"]
trailers = d["trailers"]
tools = d["small_tools"]

def ts(s):
    if s is None:
        return "null"
    return json.dumps(str(s), ensure_ascii=False)

def slug(name):
    s = re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")
    return s or "unknown"

# ---- departments ----
depts = [
    {"key": "RM", "name": "Repair & Maintenance", "code": "RM"},
    {"key": "EQ", "name": "Equipment Department", "code": "EQ"},
    {"key": "PUR", "name": "Purchased Department", "code": "PUR"},
]

# ---- projects ----
project_rows = []
for i, p in enumerate(projects):
    job = p["job"] or None
    key = f"p-{slug(p['name'])}" + (f"-{job}" if job else "")
    if any(r["key"] == key for r in project_rows):
        key += f"-{i}"  # never collide
    project_rows.append({
        "key": key, "extId": job, "name": p["name"], "status": "active",
        "costCenter": None, "start": "2025-01-06", "end": "2030-12-31", "site": None,
    })

proj_key_of = {}
# project id in trailers references proj-<slug>[-job] — rebuild the mapping
def find_project_key(pname):
    if not pname:
        return None
    name = pname["name"] if isinstance(pname, dict) else pname
    job = pname["job"] if isinstance(pname, dict) else None
    key = f"p-{slug(name)}" + (f"-{job}" if job else "")
    return key if any(r["key"] == key for r in project_rows) else None

for p in project_rows:
    proj_key_of[(p["name"], p["extId"])] = p["key"]

# ---- foremen (employees) ----
emp_rows = []
emp_key_of = {}
for f in foremen:
    key = f"e-fm{f['id']:03d}"
    emp_rows.append({
        "key": key, "extId": f["external_id"], "name": f["name"],
        "role": "foreman", "primary": None, "status": "active",
        "email": None, "phone": None, "reportsTo": None,
    })
    emp_key_of[f["id"]] = key

# operational staff (desk) kept so the logins work
emp_rows.append({"key": "e-karen", "extId": "0199", "name": "Karen Osei", "role": "equipment_admin", "primary": None, "status": "active", "email": "karen.osei@urban.local", "phone": "214-555-0100", "reportsTo": None})
emp_rows.append({"key": "e-yard", "extId": "7712", "name": "Yard Desk", "role": "warehouse", "primary": None, "status": "active", "email": "yard@urban.local", "phone": "214-555-0199", "reportsTo": None})
emp_key_of["karen"] = "e-karen"
emp_key_of["yard"] = "e-yard"

# foreman primary project from their first trailer
trailer_foreman_id = {t["foreman_id"]: t for t in trailers if t["foreman_id"]}
for f in foremen:
    t = trailer_foreman_id.get(f["id"])
    pname = t["project_name"] if t else None
    pjob = t["job"] if t else None
    if pname or pjob:
        key = f"p-{slug(pname or 'unknown')}" + (f"-{pjob}" if pjob else "")
        if any(r["key"] == key for r in project_rows):
            for e in emp_rows:
                if e["key"] == f"e-fm{f['id']:03d}":
                    e["primary"] = key

# ---- vehicle locations + vehicles (trailers only; truck always null) ----
vehloc_rows = []
veh_rows = []
loc_of_trailer = {}
for t in trailers:
    if not t["foreman_id"]:
        continue
    loc_key = f"l-{t['id']}"
    veh_key = f"v-{t['id']}"
    emp = emp_key_of[t["foreman_id"]]
    pkey = None
    if t["project_name"] or t["job"]:
        pkey = f"p-{slug(t['project_name'] or 'unknown')}" + (f"-{t['job']}" if t["job"] else "")
        if not any(r["key"] == pkey for r in project_rows):
            pkey = None
    vehloc_rows.append({"key": loc_key, "type": "vehicle", "name": t["id"], "project": pkey, "custodian": emp})
    veh_rows.append({
        "key": veh_key, "loc": loc_key, "vtype": "trailer", "unit": t["id"],
        "plate": None, "make": "Enclosed trailer (source)", "own": "company_owned",
        "payee": None, "allow": None, "freq": None, "proj": pkey, "foreman": emp,
        "lat": "32.7766", "lng": "-96.7970",
    })
    loc_of_trailer[t["id"]] = loc_key

# ---- non-vehicle locations: warehouses ----
loc_rows = [
    {"key": "l-dal", "type": "warehouse", "name": "Dallas Yard", "warehouse": "Main Warehouse — Dallas", "project": None, "custodian": None},
]

# ---- assets ----
asset_rows = []
assign_rows = []
tx_rows = []
for t in tools:
    emp = emp_key_of.get(t["foreman_id"]) if t["foreman_id"] else None
    loc = loc_of_trailer.get(t["trailer_id"]) if t["trailer_id"] else "l-dal"
    pkey = None
    if t["project_name"] or t["job"]:
        pkey = f"p-{slug(t['project_name'] or 'unknown')}" + (f"-{t['job']}" if t["job"] else "")
        if not any(r["key"] == pkey for r in project_rows):
            pkey = None
    serialized = bool(t["serial"])
    dept = t["department"] == "equipment"  # equipment -> department cost target
    asset_rows.append({
        "tag": t["id"], "make": t["make"], "modelNumber": t["model"],
        "description": t["description"], "serial": t["serial"],
        "isSerialized": serialized, "quantity": t["qty"] if not serialized else 1,
        "cost": None, "own": None if dept else pkey, "dept": dept,
        "status": "assigned" if emp else "available",
        "cust": emp, "cur": pkey, "loc": loc,
    })
    if emp:
        assign_rows.append({
            "tag": t["id"], "cust": emp, "proj": pkey, "loc": loc,
            "type": "permanent", "start": "2025-01-06", "end": None,
        })
        emp_name = next((f["name"] for f in foremen if f["id"] == t["foreman_id"]), emp)
        proj_name = t["project_name"] or "the project"
        tx_rows.append({
            "tag": t["id"], "event": "assign", "at": "2025-01-06 08:00",
            "note": f"Assigned to {emp_name} — {proj_name}", "ref": "assignment",
        })

# ---- postings + team (one per foreman+project; a foreman may run several
# trailers on the same project, but only one posting/team row per project) ----
posting_rows = {}
team_rows = {}
for t in trailers:
    if not t["foreman_id"]:
        continue
    emp = emp_key_of[t["foreman_id"]]
    pkey = None
    if t["project_name"] or t["job"]:
        pkey = f"p-{slug(t['project_name'] or 'unknown')}" + (f"-{t['job']}" if t["job"] else "")
        if not any(r["key"] == pkey for r in project_rows):
            pkey = None
    if not pkey:
        continue
    key = (emp, pkey)
    if key not in posting_rows:
        posting_rows[key] = {"emp": emp, "proj": pkey, "from": "2025-01-06", "to": None, "note": f"Assigned with trailer {t['id']}"}
        team_rows[key] = {"emp": emp, "proj": pkey, "role": "foreman", "from": "2025-01-06", "note": f"Working with trailer {t['id']}"}
    else:
        posting_rows[key]["note"] += f", {t['id']}"
        team_rows[key]["note"] += f", {t['id']}"
posting_rows = list(posting_rows.values())
team_rows = list(team_rows.values())

# ---- users ----
user_rows = [
    {"email": "owner@stinventory.local", "first": "Demo", "last": "Owner", "role": "owner", "employeeKey": None},
    {"email": "admin@stinventory.local", "first": "Karen", "last": "Osei", "role": "equipment_admin", "employeeKey": "e-karen"},
    {"email": "warehouse@stinventory.local", "first": "Yard", "last": "Desk", "role": "warehouse", "employeeKey": "e-yard"},
]

# ---------------- emit ---------------- 
lines = []
A = lines.append
A("/* GENERATED by docs/data/generate_app_seed.py from")
A("   docs/data/seed_from_tools_list.json — do not edit by hand. */")
A("")
A("export type ProjectSeed = { key: string; extId: string | null; name: string; status: string; costCenter: string | null; start: string; end: string; site: string | null };")
A("export type EmployeeSeed = { key: string; extId: string; name: string; role: string; primary: string | null; status: string; email: string | null; phone: string | null; reportsTo: string | null };")
A("export type PostingSeed = { emp: string; proj: string; from: string; to: string | null; note: string };")
A("export type TeamSeed = { emp: string; proj: string; role: string; from: string; note: string };")
A("export type LocSeed = { key: string; type: string; name: string; warehouse: string | null; project: string | null; custodian: string | null };")
A("export type VehLocSeed = { key: string; type: string; name: string; project: string | null; custodian: string | null };")
A("export type VehSeed = { key: string; loc: string; vtype: 'truck' | 'trailer'; unit: string; plate: string | null; make: string | null; own: string; payee: string | null; allow: string | null; freq: string | null; proj: string | null; foreman: string | null; lat: string; lng: string };")
A("export type AssetSeed = { tag: string; make: string | null; modelNumber: string | null; description: string | null; serial: string | null; isSerialized: boolean; quantity: number; cost: string | null; own: string | null; dept: boolean; status: string; cust: string | null; cur: string | null; loc: string };")
A("export type AssignSeed = { tag: string; cust: string; proj: string | null; loc: string; type: string; start: string; end: string | null };")
A("export type TxSeed = { tag: string; event: string; at: string; note: string; ref: string };")
A("export type DeptSeed = { name: string; code: string };")
A("export type UserSeed = { email: string; first: string; last: string; role: string; employeeKey: string | null };")
A("")

A("export const departmentSpecs: DeptSeed[] = [")
for x in depts:
    A(f"  {{ name: {ts(x['name'])}, code: {ts(x['code'])} }},")
A("];")
A("")

A("export const projectSpecs: ProjectSeed[] = [")
for x in project_rows:
    A(f"  {{ key: {ts(x['key'])}, extId: {ts(x['extId'])}, name: {ts(x['name'])}, status: {ts(x['status'])}, costCenter: {ts(x['costCenter'])}, start: {ts(x['start'])}, end: {ts(x['end'])}, site: {ts(x['site'])} }},")
A("];")
A("")

A("export const employeeSpecs: EmployeeSeed[] = [")
for x in emp_rows:
    A(f"  {{ key: {ts(x['key'])}, extId: {ts(x['extId'])}, name: {ts(x['name'])}, role: {ts(x['role'])}, primary: {ts(x['primary'])}, status: {ts(x['status'])}, email: {ts(x['email'])}, phone: {ts(x['phone'])}, reportsTo: {ts(x['reportsTo'])} }},")
A("];")
A("")

A("export const postingSpecs: PostingSeed[] = [")
for x in posting_rows:
    A(f"  {{ emp: {ts(x['emp'])}, proj: {ts(x['proj'])}, from: {ts(x['from'])}, to: {ts(x['to'])}, note: {ts(x['note'])} }},")
A("];")
A("")

A("export const teamSpecs: TeamSeed[] = [")
for x in team_rows:
    A(f"  {{ emp: {ts(x['emp'])}, proj: {ts(x['proj'])}, role: {ts(x['role'])}, from: {ts(x['from'])}, note: {ts(x['note'])} }},")
A("];")
A("")

A("export const locSpecs: LocSeed[] = [")
for x in loc_rows:
    A(f"  {{ key: {ts(x['key'])}, type: {ts(x['type'])}, name: {ts(x['name'])}, warehouse: {ts(x['warehouse'])}, project: {ts(x['project'])}, custodian: {ts(x['custodian'])} }},")
A("];")
A("")

A("export const vehLocSpecs: VehLocSeed[] = [")
for x in vehloc_rows:
    A(f"  {{ key: {ts(x['key'])}, type: {ts(x['type'])}, name: {ts(x['name'])}, project: {ts(x['project'])}, custodian: {ts(x['custodian'])} }},")
A("];")
A("")

A("export const vehSpecs: VehSeed[] = [")
for x in veh_rows:
    A(f"  {{ key: {ts(x['key'])}, loc: {ts(x['loc'])}, vtype: {ts(x['vtype'])}, unit: {ts(x['unit'])}, plate: {ts(x['plate'])}, make: {ts(x['make'])}, own: {ts(x['own'])}, payee: {ts(x['payee'])}, allow: {ts(x['allow'])}, freq: {ts(x['freq'])}, proj: {ts(x['proj'])}, foreman: {ts(x['foreman'])}, lat: {ts(x['lat'])}, lng: {ts(x['lng'])} }},")
A("];")
A("")

A("export const assetSpecs: AssetSeed[] = [")
for x in asset_rows:
    A(f"  {{ tag: {ts(x['tag'])}, make: {ts(x['make'])}, modelNumber: {ts(x['modelNumber'])}, description: {ts(x['description'])}, serial: {ts(x['serial'])}, isSerialized: {str(x['isSerialized']).lower()}, quantity: {x['quantity']}, cost: {ts(x['cost'])}, own: {ts(x['own'])}, dept: {str(x['dept']).lower()}, status: {ts(x['status'])}, cust: {ts(x['cust'])}, cur: {ts(x['cur'])}, loc: {ts(x['loc'])} }},")
A("];")
A("")

A("export const assignSpecs: AssignSeed[] = [")
for x in assign_rows:
    A(f"  {{ tag: {ts(x['tag'])}, cust: {ts(x['cust'])}, proj: {ts(x['proj'])}, loc: {ts(x['loc'])}, type: {ts(x['type'])}, start: {ts(x['start'])}, end: {ts(x['end'])} }},")
A("];")
A("")

A("export const txSpecs: TxSeed[] = [")
for x in tx_rows:
    A(f"  {{ tag: {ts(x['tag'])}, event: {ts(x['event'])}, at: {ts(x['at'])}, note: {ts(x['note'])}, ref: {ts(x['ref'])} }},")
A("];")
A("")

A("export const userSpecs: UserSeed[] = [")
for x in user_rows:
    A(f"  {{ email: {ts(x['email'])}, first: {ts(x['first'])}, last: {ts(x['last'])}, role: {ts(x['role'])}, employeeKey: {ts(x['employeeKey'])} }},")
A("];")

with open(OUT, "w") as f:
    f.write("\n".join(lines) + "\n")

print(f"wrote {OUT}")
print(f"  projects: {len(project_rows)}  employees: {len(emp_rows)}  postings: {len(posting_rows)}  team: {len(team_rows)}")
print(f"  locations: {len(loc_rows) + len(vehloc_rows)}  vehicles(trailers): {len(veh_rows)}")
print(f"  assets: {len(asset_rows)}  assignments: {len(assign_rows)}  transactions: {len(tx_rows)}")
print(f"  users: {len(user_rows)}")
