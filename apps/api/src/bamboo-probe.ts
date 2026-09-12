/*
  READ-ONLY BambooHR probe. Temporary — delete after use.

  Goes through `fetchAllBambooEmployees` → `bambooGet`, which hardcodes
  `method: "GET"` and takes no verb parameter, so nothing here can write to
  BambooHR. It also writes NOTHING to our own Postgres: no sync_run row, no
  employee upsert. It counts and prints, and that is all.

  Run: pnpm --filter @stinventory/api exec tsx src/bamboo-probe.ts
*/
import "dotenv/config";
import { bambooCredentialsFrom, fetchAllBambooEmployees } from "./bamboo-sync.js";
import { adaptBambooPage } from "@stinventory/domain";

const creds = bambooCredentialsFrom(process.env as Record<string, string | undefined>);
if (!creds) {
  console.error("BambooHR not configured (BAMBOOHR_COMPANY_DOMAIN / BAMBOOHR_API_KEY).");
  process.exit(1);
}

console.log(`[probe] GET https://${creds.companyDomain}.bamboohr.com/api/v1/employees`);
console.log("[probe] READ-ONLY — nothing is written to BambooHR or to our database.\n");

const { records, reportedTotal, complete } = await fetchAllBambooEmployees(creds);

console.log(`Bamboo reported total ... ${reportedTotal ?? "(not reported)"}`);
console.log(`Records read ............ ${records.length}`);
console.log(`Complete read ........... ${complete}\n`);

const { people, failures } = adaptBambooPage(records);

console.log(`Adapted OK .............. ${people.length}`);
console.log(`Adapt failures .......... ${failures.length}`);
if (failures.length) {
  const why = new Map<string, number>();
  for (const f of failures) why.set(f.reason, (why.get(f.reason) ?? 0) + 1);
  for (const [r, n] of why) console.log(`    ${String(n).padStart(4)}  ${r}`);
}

/* ---- job titles: does the 131-title problem exist in the live roster? ---- */
const titles = new Map<string, number>();
for (const p of people) titles.set(p.writable.jobTitleName ?? "(none)", (titles.get(p.writable.jobTitleName ?? "(none)") ?? 0) + 1);
const sorted = [...titles.entries()].sort((a, b) => b[1] - a[1]);

console.log(`\n=== JOB TITLES ===`);
console.log(`distinct titles ......... ${titles.size}`);
console.log(`held by exactly 1 person  ${sorted.filter(([, n]) => n === 1).length}`);
console.log(`\ntop 25 by headcount:`);
for (const [t, n] of sorted.slice(0, 25)) console.log(`  ${String(n).padStart(4)}  ${t}`);

/* ---- the manager edge + isManager: what automates crew creation ---- */
const withMgr = people.filter((p) => p.reportsToExternalId).length;
const isMgrTrue = people.filter((p) => p.observed.isManager === true).length;
const isMgrFalse = people.filter((p) => p.observed.isManager === false).length;
const isMgrUnsaid = people.filter((p) => p.observed.isManager === undefined).length;

console.log(`\n=== ORG CHART (reportsToId) ===`);
console.log(`with a supervisor ....... ${withMgr} / ${people.length}` +
  (people.length ? `  (${Math.round((withMgr / people.length) * 100)}%)` : ""));
console.log(`\n=== isManager (HR's own assertion) ===`);
console.log(`  true .................. ${isMgrTrue}`);
console.log(`  false ................. ${isMgrFalse}`);
console.log(`  not said .............. ${isMgrUnsaid}`);

/* How many distinct supervisors are actually named — the crew count. */
const supervisors = new Set(people.map((p) => p.reportsToExternalId).filter(Boolean));
console.log(`\ndistinct supervisors named  ${supervisors.size}`);

/* ---- status / termination: who is actually on the roster ---- */
const statuses = new Map<string, number>();
for (const p of people) {
  const s = p.observed.employmentStatus ?? "(null — not derivable)";
  statuses.set(s, (statuses.get(s) ?? 0) + 1);
}
console.log(`\n=== EMPLOYMENT STATUS (normalised) ===`);
for (const [s, n] of [...statuses.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${s}`);
}

const rawStatuses = new Map<string, number>();
for (const p of people) {
  const s = p.observed.rawStatus ?? "(absent from payload)";
  rawStatuses.set(s, (rawStatuses.get(s) ?? 0) + 1);
}
console.log(`\n=== RAW status FIELD ===`);
for (const [s, n] of [...rawStatuses.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${s}`);
}

const statusNames = new Map<string, number>();
for (const p of people) {
  const s = p.observed.rawEmploymentStatusName ?? "(absent)";
  statusNames.set(s, (statusNames.get(s) ?? 0) + 1);
}
console.log(`\n=== employmentStatusName (leave detection) ===`);
for (const [s, n] of [...statusNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(n).padStart(5)}  ${s}`);
}

const withTerm = people.filter((p) => p.observed.terminationDate).length;
console.log(`\n=== terminationDate ===`);
console.log(`  present ............... ${withTerm}`);

const empTypes = new Map<string, number>();
for (const p of people) {
  const s = p.observed.employmentType ?? "(absent)";
  empTypes.set(s, (empTypes.get(s) ?? 0) + 1);
}
console.log(`\n=== employmentType ===`);
for (const [s, n] of [...empTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${String(n).padStart(5)}  ${s}`);
}

const restricted = people.filter((p) => (p.withheld?.length ?? 0) > 0).length;
console.log(`\npeople with restricted fields  ${restricted}`);
console.log("\n[probe] done. Nothing was written.");
