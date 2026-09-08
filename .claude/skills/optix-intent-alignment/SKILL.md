---
name: optix-intent-alignment
description: Use at the START of any non-trivial coding or multi-file architecture task, before writing code, drawing architecture, or producing an implementation plan. Ask 2-4 targeted questions about edge cases, state boundaries and missing constraints, then stop and wait. Triggers on "implement", "build", "add", "fix", "refactor", "design", "plan this", "can you do", "complete this", or any request that will change more than one file. Also governs tone for the whole task: concise, functional, no filler.
---

# Interactive intent alignment

Set by the user on 2026-09-08, after a session in which they said: *"your
technicality and wordings are so complex everytime! when you ask stuff i dont
even understand"*.

## The rule

When beginning any non-trivial coding or multi-file architecture task:

1. **Do not** generate code stubs, architecture diagrams, or implementation
   plans immediately.
2. **Interrogate the user first.** Ask 2-4 targeted, high-impact questions
   about edge cases, state management boundaries, or missing technical
   constraints.
3. **Wait for the user's explicit response** before scaffolding or altering
   files.
4. Keep all explanations concise, clear, and focused entirely on functional
   logic — no conversational filler, no repetitive validation phrasing.

## Rule 4 binds the questions too

Rule 2 says to ask; `optix-explain-before-deciding` says how to word it. Both
apply at once, and the failures on 2026-09-08 were all in the wording, not the
asking:

- **Name what is on screen, never the thing that stores it.** "The words in the
  Role column", not "the label". `label`, `isSystem`, `onboardingKind` and
  `shouldPrompt` are column names; the user has never seen them. A column name
  is not a definition.
- **Ask fewer, larger questions.** A four-question block was interrupted. Two
  is usually the ceiling, and one is fine.
- **No option tables where a sentence does.** Six sections, four tables and
  three questions in one message is unreadable whatever the vocabulary.
- `file:line` citations stay — those are evidence, and they are wanted. It is
  the *prose* that must be plain.

## Why a skill alone is not enough

`optix-explain-before-deciding` was written on 2026-09-03 for the same
complaint and did not prevent it, for two reasons worth not repeating:

- Its scope is **decision points only**, and it names explaining routine work
  plainly as a non-goal. Most of the jargon was in ordinary explanation.
- A skill only applies when something invokes it. Loading it is not applying
  it — it was loaded on 2026-09-08 and the jargon continued in the same turn.

So this rule also belongs in `CLAUDE.md`, which every session reads
automatically. If it is here and nowhere else, expect it to fail the same way.
