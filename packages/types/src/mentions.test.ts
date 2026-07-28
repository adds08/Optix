import { describe, expect, it } from "vitest";
import {
  MENTION_TRIGGER,
  activeMentionQuery,
  applyMention,
  plainText,
  slotsFromMentions,
  type ChatMention,
} from "./mentions.js";

/*
  The @ parser.

  This runs on every keystroke in the chat box on both clients, and the mention
  it produces outranks the language model when the message is resolved. A false
  positive here puts a lookup in a foreman's face mid-sentence; a wrong id ends
  up naming the wrong tool in a custody action.
*/

describe("activeMentionQuery", () => {
  it("finds the fragment under the caret", () => {
    const text = "gave @UIC";
    expect(activeMentionQuery(text, text.length)).toEqual({ query: "UIC", start: 5 });
  });

  it("opens at the very start of a message", () => {
    expect(activeMentionQuery("@dwa", 4)).toEqual({ query: "dwa", start: 0 });
  });

  it("ignores an @ that is part of a word", () => {
    /* An email address is the case that actually turns up — "email
       dwayne@urban.local" must not open a picker. */
    expect(activeMentionQuery("mail dwayne@urban.local", 23)).toBeNull();
  });

  it("keeps searching across a space, so two-word names work", () => {
    const text = "gave it to @Dwayne El";
    expect(activeMentionQuery(text, text.length)).toEqual({ query: "Dwayne El", start: 11 });
  });

  it("closes at a newline", () => {
    expect(activeMentionQuery("@UIC-1012\nand another thing", 26)).toBeNull();
  });

  it("returns nothing when there is no trigger before the caret", () => {
    expect(activeMentionQuery("nothing to see here", 19)).toBeNull();
  });

  it("looks only behind the caret, not at the whole message", () => {
    /* Editing mid-sentence must not pick up an @ that comes later. */
    const text = "gave it to @Dwayne";
    expect(activeMentionQuery(text, 4)).toBeNull();
  });

  it("uses the trigger closest to the caret", () => {
    const text = "@UIC-1012 to @Dwa";
    expect(activeMentionQuery(text, text.length)?.start).toBe(13);
  });
});

describe("activeMentionQuery — closing the lookup", () => {
  /*
    The bug from the field app: after picking "Dwayne Ellis" and carrying on
    typing, the query became "Dwayne Ellis has my", matched nothing, and left
    the panel parked over the keyboard.
  */
  const applied = ["Dwayne Ellis"];

  it("closes as soon as a picked label is inserted", () => {
    /* applyMention leaves a trailing space, so the fragment is already longer
       than the label the instant it lands. */
    const text = "@Dwayne Ellis ";
    expect(activeMentionQuery(text, text.length, applied)).toBeNull();
  });

  it("stays closed while the sentence continues", () => {
    const text = "@Dwayne Ellis has my";
    expect(activeMentionQuery(text, text.length, applied)).toBeNull();
  });

  it("reopens if the author backspaces into the name to correct it", () => {
    const text = "@Dwayne Elli";
    expect(activeMentionQuery(text, text.length, applied)).toEqual({
      query: "Dwayne Elli",
      start: 0,
    });
  });

  it("still opens for a NEW mention later in the same sentence", () => {
    const text = "@Dwayne Ellis has @UIC";
    expect(activeMentionQuery(text, text.length, applied)).toEqual({
      query: "UIC",
      start: 18,
    });
  });

  it("gives up rather than swallowing a sentence that matches nothing", () => {
    /* No mention was ever picked here, so the label check cannot help — the
       word cap is what stops it. */
    const text = "@nothing here matches any row at all";
    expect(activeMentionQuery(text, text.length)).toBeNull();
  });

  it("still allows a genuine multi-word name inside the cap", () => {
    const text = "@Legacy West Phase";
    expect(activeMentionQuery(text, text.length)).toEqual({
      query: "Legacy West Phase",
      start: 0,
    });
  });

  it("is unaffected when no labels have been picked", () => {
    const text = "@Dwa";
    expect(activeMentionQuery(text, text.length, [])).toEqual({ query: "Dwa", start: 0 });
  });
});

describe("applyMention", () => {
  it("replaces the fragment with the label and a trailing space", () => {
    const text = "gave @UIC";
    const next = applyMention(text, 5, text.length, "UIC-1012");
    expect(next.text).toBe("gave @UIC-1012 ");
    expect(next.caret).toBe(next.text.length);
  });

  it("keeps whatever followed the caret", () => {
    const text = "gave @UIC to Dwayne";
    const next = applyMention(text, 5, 9, "UIC-1012");
    expect(next.text).toBe("gave @UIC-1012  to Dwayne");
  });

  it("leaves the caret ready for the next word", () => {
    const next = applyMention("@dwa", 0, 4, "Dwayne Ellis");
    expect(next.text).toBe("@Dwayne Ellis ");
    /* Not inside the name just inserted — the next keystroke should start a
       new word, not reopen the picker on the one just chosen. */
    expect(next.caret).toBe(14);
  });
});

describe("slotsFromMentions", () => {
  const m = (kind: ChatMention["kind"], id: string, label = id): ChatMention => ({ kind, id, label });

  it("maps each kind to the slot it fills", () => {
    const slots = slotsFromMentions([
      m("asset", "a1"),
      m("employee", "e1"),
      m("project", "p1"),
      m("location", "l1"),
    ]);
    expect(slots).toEqual({
      assetIds: ["a1"],
      custodianId: "e1",
      projectId: "p1",
      locationId: "l1",
      vehicleIds: [],
    });
  });

  it("accumulates tools, because one sentence can name several", () => {
    const slots = slotsFromMentions([m("asset", "a1"), m("asset", "a2")]);
    expect(slots.assetIds).toEqual(["a1", "a2"]);
  });

  it("takes the first person named as the destination", () => {
    /* The sender is the implicit source, so the only person a sentence needs
       to name is who it is going to. */
    const slots = slotsFromMentions([m("employee", "e1"), m("employee", "e2")]);
    expect(slots.custodianId).toBe("e1");
  });

  it("does not double-count a tool mentioned twice", () => {
    const slots = slotsFromMentions([m("asset", "a1"), m("asset", "a1")]);
    expect(slots.assetIds).toEqual(["a1"]);
  });

  it("keeps vehicles apart, since they resolve to a location server side", () => {
    const slots = slotsFromMentions([m("vehicle", "v1")]);
    expect(slots.vehicleIds).toEqual(["v1"]);
    expect(slots.locationId).toBeUndefined();
  });

  it("returns empty slots for a message with no mentions", () => {
    expect(slotsFromMentions([])).toEqual({ assetIds: [], vehicleIds: [] });
  });
});

describe("plainText", () => {
  it("strips the trigger but keeps the words", () => {
    expect(plainText("gave @UIC-1012 to @Dwayne Ellis")).toBe("gave UIC-1012 to Dwayne Ellis");
  });

  it("leaves a bare @ alone", () => {
    expect(plainText("me @ the yard")).toBe("me @ the yard");
  });
});

describe("MENTION_TRIGGER", () => {
  it("is the one character both clients key off", () => {
    expect(MENTION_TRIGGER).toBe("@");
  });
});
