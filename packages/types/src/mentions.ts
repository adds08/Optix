/*
  @-mentions in a field message.

  The interface stays a plain sentence — "gave the rotary hammer to Dwayne for
  Trinity" — because that is what a foreman will actually type at the end of a
  shift. There is no command syntax to remember and nothing to get wrong.

  What `@` adds is only lookup. Typing `@10` lists everything in the tenant
  matching "10" — tools, people, jobs, trucks together — and picking one leaves
  the label in the sentence while the id travels alongside it. The sentence is
  unchanged for the person writing it; the difference is that the noun is no
  longer a guess.

  That matters because the resolver is the weakest part of the chat path. "the
  rotary hammer" matches whichever rotary hammer the search happens to rank
  first, and when it matches nothing the message drops into `pending_manual`
  for the desk to sort out by hand. A mentioned tool cannot be misresolved, and
  a fully-mentioned message needs the parser for the verb only.
*/

export const MENTION_KINDS = ["asset", "employee", "project", "location", "vehicle"] as const;
export type MentionKind = (typeof MENTION_KINDS)[number];

export type ChatMention = {
  kind: MentionKind;
  /** The row this resolves to. Authoritative — never re-resolved from `label`. */
  id: string;
  /** What the sentence shows: "UIC-1012", "Dwayne Ellis", "Legacy West Phase 3". */
  label: string;
};

/** The character that opens the lookup. One trigger for every kind. */
export const MENTION_TRIGGER = "@";

/*
  How few characters are worth a round trip. One is not: "@1" matches half the
  yard on a real register and the list is noise. Two is the point where a tag
  fragment or a name start begins to mean something.
*/
export const MENTION_MIN_QUERY = 2;

/*
  How many words a lookup will span before giving up.

  Spaces cannot close the query — half the things worth naming are two or three
  words ("Dwayne Ellis", "Gang Box A", "Legacy West Phase 3"). But something has
  to, or an `@` that matches nothing swallows the rest of the sentence and the
  picker never goes away.
*/
export const MENTION_MAX_WORDS = 4;

/*
  The `@…` fragment under the caret, or null when no lookup should be open.

  `applied` is the labels already picked in this message. It exists because a
  mention has no closing delimiter: after inserting "@Dwayne Ellis " the text
  behind the caret is still one unbroken run from the `@`, so continuing to
  type turned the query into "Dwayne Ellis has my" — which matches nothing and
  left the panel stuck open over the keyboard. Recognising that the fragment
  begins with a label the author already chose is what tells us the mention is
  finished and the rest is ordinary prose.
*/
export function activeMentionQuery(
  text: string,
  caret: number,
  applied: readonly string[] = [],
): { query: string; start: number } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf(MENTION_TRIGGER);
  if (at === -1) return null;

  /* `foo@bar` is an email address, not a mention. The trigger only counts at
     the start of the message or after a space. */
  const before = at > 0 ? upto[at - 1] : " ";
  if (before && !/\s/.test(before)) return null;

  const query = upto.slice(at + 1);
  /* A newline closes the lookup — the foreman moved on. */
  if (query.includes("\n")) return null;

  /* Already chosen, and the author has typed past it. Backspacing back INTO
     the name shortens the fragment below the label and reopens the lookup,
     which is what you want when correcting a wrong pick. */
  if (applied.some((label) => label && query.length > label.length && query.startsWith(label))) {
    return null;
  }

  /* Nothing matched and the sentence has moved on. Give up rather than keep
     consuming it. */
  if (query.trimEnd().split(/\s+/).length > MENTION_MAX_WORDS) return null;

  return { query, start: at };
}

/** Replace the `@…` fragment under the caret with the chosen label. */
export function applyMention(
  text: string,
  start: number,
  caret: number,
  label: string,
): { text: string; caret: number } {
  const inserted = `${MENTION_TRIGGER}${label} `;
  const next = text.slice(0, start) + inserted + text.slice(caret);
  return { text: next, caret: start + inserted.length };
}

/*
  Which slot each kind fills in a custody action.

  A message names things; what the model decides is the verb. Given "gave
  @UIC-1012 to @Dwayne for @Trinity Bridge", the kinds alone say which is the
  tool, who the destination is and which job it is going to — no ordering
  convention for anyone to remember, and no ambiguity for the resolver to get
  wrong.

  Vehicles map to `locationId` because a truck IS a location here: tools ride
  in it, and its location row is what the register points at.
*/
export type MentionSlots = {
  assetIds: string[];
  custodianId?: string;
  projectId?: string;
  /** For vehicles this is the vehicle's `locationId`, resolved server side. */
  locationId?: string;
  vehicleIds: string[];
};

export function slotsFromMentions(mentions: readonly ChatMention[]): MentionSlots {
  const slots: MentionSlots = { assetIds: [], vehicleIds: [] };
  for (const m of mentions) {
    switch (m.kind) {
      case "asset":
        /* Several tools in one sentence is normal — "gave the hammer and the
           laser level to Dwayne" — so these accumulate. */
        if (!slots.assetIds.includes(m.id)) slots.assetIds.push(m.id);
        break;
      case "employee":
        /* First person named wins. The sender is the implicit source, so the
           only person a sentence needs to name is the destination. */
        slots.custodianId ??= m.id;
        break;
      case "project":
        slots.projectId ??= m.id;
        break;
      case "location":
        slots.locationId ??= m.id;
        break;
      case "vehicle":
        if (!slots.vehicleIds.includes(m.id)) slots.vehicleIds.push(m.id);
        break;
    }
  }
  return slots;
}

/** Strips the trigger characters, leaving the sentence a person would read. */
export function plainText(text: string): string {
  return text.replace(/@(?=\S)/g, "");
}
