/*
  Suggest a login role, and a job tier, from a BambooHR job title.

  A SUGGESTION, never a decision. It pre-fills a control a human is already
  looking at — the role picker in the invite dialog, the tier picker when
  somebody is added to a job — and every caller must let that human override it.

  WHY THIS IS NOT A MAPPING TABLE

  There was one, and it was retired on 2026-09-09
  (`docs/changelogs/2026-09-09-retire-hr-title-mapping-and-trim-the-people-menu.md`)
  after the client opened a screen listing 131 job titles waiting to be told
  what they meant. The reasoning there still holds and is the reason this file
  is a function rather than a table:

    "A job title does not answer the question the mapping was asking of it...
     `Field Engineer 3` does not say, and `Carpenter` says nothing at all."

  The live register bears that out. Among people who can actually be invited
  there are ~100 distinct titles, 53 of them held by exactly one person
  (`Curb Man`, `Mantis IT`, `Jr. Human Resources Generalist`), and the largest
  single group is `Carpenter` at 111 — a title that implies no particular access
  at all. A stored table would need a row for every one of those, would need
  revisiting whenever HR invents a title, and would hold guesses that something
  later applied unsupervised.

  So this returns `null` freely. An unrecognised title is the normal case, not a
  failure: the picker simply opens with nothing chosen, which is exactly what it
  does today.

  WHY A TITLE CANNOT BE A TIER ON ITS OWN

  A tier is per-project and a title is not. In Urban's real data a
  `Superintendent` reports to six different titles depending on the job — CEO,
  Project Director, General Superintendent, Project Manager, Senior Project
  Manager, Director of Project Controls — and a `Project Manager` reports to
  another `Project Manager`. The same title therefore sits at different heights
  on different jobs, which is why `project_team_member.role` exists per project
  and why this function only ever suggests a STARTING POINT for that choice.
*/

/*
  Normalise a title for matching.

  Lowercased, punctuation flattened to single spaces, and the trade suffix
  dropped: `Foreman - Structures`, `Foreman - Flatworks`, `Foreman - Traffic`
  and `Foreman - Dirt` are all foremen, and the suffix encodes the DEPARTMENT —
  which `employee.department_id` already carries. Those four spellings hold 419
  direct reports between them in Urban's register and the reporting graph treats
  them identically, which is the evidence the suffix is noise for this purpose.

  Seniority words are dropped for the same reason: `Senior Project Manager` and
  `Sr Project Manager` are Project Managers as far as ACCESS is concerned. What
  they are paid and what they may see are different questions.
*/
export function normaliseJobTitle(title: string): string {
  return title
    .toLowerCase()
    /* `Operator- Dozer` really is in the data, without the leading space. */
    .replace(/[-–—/,()]+/g, " ")
    .replace(/\b(sr|senior|jr|junior|asst|assistant|lead|acting|interim)\b/g, " ")
    /* `Carpenter II`, `Field Engineer 3`, `Concrete Finisher II`. */
    .replace(/\b(i{1,3}|iv|v|\d+)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/*
  Ordered longest-phrase-first, because the first match wins and the specific
  phrase has to beat the general one: `general superintendent` must be tested
  before `superintendent`, or every general superintendent reads as a
  superintendent. Same for `project director` before `director`.

  The right-hand side is a CANONICAL KEY, not a role name. Callers resolve it
  against the tenant's own register, so a tenant that renamed a role or invented
  one still gets a sensible suggestion and no name is hardcoded twice.
*/
const TITLE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bgeneral superintendent\b/, "general_superintendent"],
  [/\barea (in charge|incharge|manager|superintendent)\b/, "area_in_charge"],
  [/\bproject director\b/, "director"],
  [/\bproject manager\b/, "project_manager"],
  [/\bproject engineer\b/, "project_engineer"],
  [/\bfield engineer\b/, "field_engineer"],
  [/\bsuperintendent\b/, "superintendent"],
  [/\bforeman\b/, "foreman"],
  [/\bmechanic\b/, "mechanic"],
  [/\bwarehouse|yard\b/, "warehouse"],
  [/\bestimat/, "procurement"],
  [/\bprocurement|purchasing|buyer\b/, "procurement"],
  [/\b(human resources|hr|payroll|recruit)\b/, "hr"],
  [/\b(account|financ|controller|bookkeep)/, "finance"],
  /*
    `director` LAST among the leadership words, and deliberately narrow above
    it: Urban's register carries `Director of Estimating- Water Department` and
    `Director of Project Controls`, which are office roles and must not be
    handed the authority to claim jobs. Only `Project Director` reads as
    operational leadership, and it is matched by its own pattern above.
  */
  [/\bengineer\b/, "engineer"],
];

/*
  The canonical key a title points at, or null when nothing matches.

  Exported for the tier suggester below and for tests; callers normally want
  `suggestRoleId` or `suggestTierName`.
*/
export function canonicalKeyForTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const n = normaliseJobTitle(title);
  if (!n) return null;
  for (const [pattern, key] of TITLE_PATTERNS) if (pattern.test(n)) return key;
  return null;
}

/*
  Resolve a title to one of the tenant's OWN login roles.

  Matched by role `name`, which is the stable machine value — never the label,
  which an administrator may rename at will. Returns null when the title is
  unrecognised OR when the tenant has no role by that name, which are both
  ordinary states: the picker opens unset and a human chooses.
*/
export function suggestRoleId(
  title: string | null | undefined,
  roles: ReadonlyArray<{ id: string; name: string }>,
): string | null {
  const key = canonicalKeyForTitle(title);
  if (!key) return null;
  return roles.find((r) => r.name === key)?.id ?? null;
}

/*
  Resolve a title to one of the tenant's OWN job tiers.

  Separate from `suggestRoleId` because the two registers are different lists
  that happen to share several words — `foreman` is both a login role and a
  tier, and they mean different things. A tenant may carry one and not the
  other, so each resolves independently against its own register.
*/
export function suggestTierName(
  title: string | null | undefined,
  tiers: ReadonlyArray<{ name: string }>,
): string | null {
  const key = canonicalKeyForTitle(title);
  if (!key) return null;
  return tiers.find((t) => t.name === key)?.name ?? null;
}
