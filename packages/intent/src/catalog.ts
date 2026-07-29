import type { Permission } from "@stinventory/types";

/*
  Every intent the chat parser can produce, declared once.

  This file exists because adding one used to mean editing six places in three
  packages — the prompt in engine-client.ts, the whitelist in the Python
  engine, the `EngineIntent` union, the permission map, the department map and
  the request-title map — and forgetting any one of them failed quietly. A
  missing prompt entry meant the model never emitted the intent; a missing
  permission entry meant every foreman's message became a request nobody could
  approve.

  Now the declarative half of an intent lives here and the rest is derived:
  the system prompt is generated from `summary` and `examples`, and
  apply-action.ts builds its maps from `apply`, `department` and
  `requestTitle`. Adding an intent is this file plus, if it changes the
  register, one `case` in applyChatAction. See docs/08-custom-intents.md.
*/

export type IntentSpec = {
  /** Wire value. Stored on `message.intent_type`, so renaming one orphans history. */
  name: string;

  /** One line, written for the model. This is the definition it classifies against. */
  summary: string;

  /** Real sentences a foreman would send. The strongest signal in the prompt. */
  examples: string[];

  /*
    What applying it costs, or null if it never touches the register directly.

    `{ permission: null }` and `null` are different: the first means any
    authenticated member may apply it (a note), the second means there is no
    apply path at all and every role's version becomes a request. Asking for a
    tool to be bought is the second kind — there is nothing in the register to
    change.
  */
  apply: { permission: Permission | null } | null;

  /*
    Always park for a human, whatever the model's confidence.

    Confidence is an input to the workflow, not an authority over it
    (docs/06-decisions.md ADR-4). Anything that moves a tool between people or
    writes off its status is in here.
  */
  alwaysConfirm: boolean;

  /** Safe to execute unattended: annotates or files work, moves nothing. */
  autoSafe: boolean;

  /*
    The subject is not in the register yet, so "no matching asset" is the
    expected case rather than a parse failure. Without this the worker sends
    every one of them to pending_manual.
  */
  aboutNewTool: boolean;

  /** Which desk owns the follow-up when this becomes a request. */
  department: string;

  /** Heading on the approval card. Omitted for intents that never become one. */
  requestTitle?: string;
};

export const INTENTS: readonly IntentSpec[] = [
  {
    name: "assign",
    summary: "giving a tool to a person for the first time, or checking one out of the yard",
    examples: [
      "gave the rotary hammer UIC-1012 to Dave for the bridge job",
      "Ray is taking the generator out to the north site",
    ],
    apply: { permission: "assignment.create" },
    alwaysConfirm: true,
    autoSafe: false,
    aboutNewTool: false,
    department: "Equipment Yard",
    requestTitle: "Assignment requested",
  },
  {
    name: "transfer",
    summary: "moving a tool between people or between job sites — somebody already has it",
    examples: [
      "passing UIC-1004 over to Tony",
      "the miter saw is going from the uptown job to the parkway job",
    ],
    apply: { permission: "transfer.create" },
    alwaysConfirm: true,
    autoSafe: false,
    aboutNewTool: false,
    department: "Equipment Yard",
    requestTitle: "Transfer requested",
  },
  {
    name: "return",
    summary: "bringing a tool back to the yard or warehouse — nobody holds it afterwards",
    examples: ["returning UIC-1002 to the yard", "dropped the compactor back at the Dallas yard"],
    apply: { permission: "assignment.create" },
    alwaysConfirm: true,
    autoSafe: false,
    aboutNewTool: false,
    department: "Warehouse",
    requestTitle: "Return requested",
  },
  {
    name: "repair",
    summary: "a tool is broken, damaged or not working and needs maintenance",
    examples: ["UIC-1008 is broken, needs repair", "the generator won't start"],
    apply: { permission: "asset.manage" },
    alwaysConfirm: true,
    autoSafe: false,
    aboutNewTool: false,
    department: "Maintenance",
    requestTitle: "Repair requested",
  },
  {
    name: "lost",
    summary: "a tool is missing and cannot be found",
    examples: ["can't find UIC-1015 anywhere", "the small grinder went missing off the site"],
    apply: { permission: "asset.manage" },
    alwaysConfirm: true,
    autoSafe: false,
    aboutNewTool: false,
    department: "Equipment Admin",
    requestTitle: "Reported missing",
  },
  {
    name: "intake",
    summary:
      "registering a tool the company already has into the system for the first time — the tool is physically present",
    examples: [
      "register a DeWalt DCH273 rotary hammer, tag UIC-1099, serial 4471X",
      "just took delivery of two new impact drivers, put them in the system",
    ],
    /* An equipment-department action, not a field one. A foreman describing a
       new tool is useful; the row that enters the register is the desk's call,
       so everyone else's version becomes an intake request. */
    apply: { permission: "asset.manage" },
    alwaysConfirm: true,
    autoSafe: false,
    aboutNewTool: true,
    department: "Equipment Admin",
    requestTitle: "New tool to register",
  },
  {
    name: "request_purchase",
    summary:
      "asking for a tool to be bought that the company does not have — distinct from intake, nothing is in hand yet",
    examples: ["we need another 4in grinder out here", "can we order a second GNSS rover"],
    apply: null,
    alwaysConfirm: true,
    autoSafe: false,
    aboutNewTool: true,
    department: "Procurement",
    requestTitle: "Purchase requested",
  },
  {
    name: "report",
    summary: "a general note or observation about a tool that changes nothing about where it is",
    examples: ["UIC-1003 is running rough but still usable", "the saw blade is nearly worn out"],
    apply: { permission: null },
    alwaysConfirm: false,
    autoSafe: true,
    aboutNewTool: false,
    department: "Equipment Admin",
  },
  {
    name: "task",
    summary:
      "a work item or to-do about small tools that does not fit the other intents — something for a person to do later",
    examples: ["check the generator on Friday", "we need the miter saw serviced before Monday"],
    apply: null,
    alwaysConfirm: false,
    autoSafe: true,
    aboutNewTool: false,
    department: "Equipment Admin",
  },
  {
    name: "none",
    summary: "a greeting, a question about process, or anything too unclear to act on",
    examples: ["morning all", "how do I book time off?"],
    apply: null,
    alwaysConfirm: false,
    autoSafe: false,
    aboutNewTool: false,
    department: "Equipment Admin",
  },
] as const;

const BY_NAME = new Map(INTENTS.map((i) => [i.name, i]));

export function intentSpec(name: string): IntentSpec | null {
  return BY_NAME.get(name) ?? null;
}

/** The whitelist. Anything outside it is coerced to `none` rather than trusted. */
export const INTENT_NAMES: readonly string[] = INTENTS.map((i) => i.name);

export function isKnownIntent(name: unknown): boolean {
  return typeof name === "string" && BY_NAME.has(name);
}

const namesWhere = (pred: (i: IntentSpec) => boolean) =>
  new Set(INTENTS.filter(pred).map((i) => i.name));

export const CUSTODY_INTENTS: ReadonlySet<string> = namesWhere((i) => i.alwaysConfirm && !i.aboutNewTool);
export const AUTO_SAFE_INTENTS: ReadonlySet<string> = namesWhere((i) => i.autoSafe);
export const NEW_TOOL_INTENTS: ReadonlySet<string> = namesWhere((i) => i.aboutNewTool);

/** Present key = has an apply path. Absent = always a request. */
export const ACTION_PERMISSIONS: Readonly<Record<string, Permission | null>> = Object.fromEntries(
  INTENTS.filter((i) => i.apply).map((i) => [i.name, i.apply!.permission]),
);

export const ACTION_DEPARTMENTS: Readonly<Record<string, string>> = Object.fromEntries(
  INTENTS.map((i) => [i.name, i.department]),
);

export const REQUEST_TITLES: Readonly<Record<string, string>> = Object.fromEntries(
  INTENTS.filter((i) => i.requestTitle).map((i) => [i.name, i.requestTitle!]),
);
