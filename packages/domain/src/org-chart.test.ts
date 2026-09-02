import { describe, expect, it } from "vitest";
import { buildOrgForest, findCycle, visibleEmployeeIds, SYNTHETIC_PREFIX } from "./org-chart.js";
import type { OrgMemberInput } from "./org-chart.js";

/* Shorthand: a roster row. `p` is the project, `e` the person, `to` the boss. */
const row = (id: string, p: string, e: string, role: string, to: string | null = null): OrgMemberInput => ({
  id,
  projectId: p,
  employeeId: e,
  role,
  reportsToEmployeeId: to,
});

describe("buildOrgForest", () => {
  it("hangs a foreman off the superintendent of the SAME job", () => {
    /* Marcus supers two jobs. The Lone Star foreman must land under the Lone
       Star row, not the DART one — otherwise the chart reads like a crew that
       does not exist. */
    const members = [
      row("m1", "lone-star", "marcus", "superintendent"),
      row("m2", "dart", "marcus", "superintendent"),
      row("m3", "lone-star", "alejandro", "foreman", "marcus"),
    ];
    const roots = buildOrgForest(members);
    const lodestar = roots.find((r) => r.key === "m1")!;
    const dart = roots.find((r) => r.key === "m2")!;
    expect(lodestar.children.map((c) => c.key)).toEqual(["m3"]);
    expect(dart.children).toEqual([]);
  });

  it("gives a director pointed at from many jobs ONE node, without rows of their own", () => {
    /* The case that killed the rank/area design: a director over every job must
       not need a roster row on every job. */
    const members = [
      row("m1", "lone-star", "dana", "pm", "alice-director"),
      row("m2", "dart", "priya", "pm", "alice-director"),
      row("m3", "nex", "saul", "pm", "alice-director"),
    ];
    const roots = buildOrgForest(members);
    const synthetic = roots.filter((r) => r.member === null);
    expect(synthetic).toHaveLength(1);
    const root = synthetic[0]!;
    expect(root.key).toBe(`${SYNTHETIC_PREFIX}alice-director`);
    expect(root.children.map((c) => c.key).sort()).toEqual(["m1", "m2", "m3"]);
    expect(root.children.every((c) => c.depth === 1)).toBe(true);
  });

  it("treats a row reporting to nobody as a root", () => {
    const roots = buildOrgForest([row("m1", "lone-star", "solo", "foreman", null)]);
    expect(roots.map((r) => r.key)).toEqual(["m1"]);
    expect(roots[0]!.depth).toBe(0);
  });

  it("surfaces rows stranded in a cycle instead of dropping or hanging", () => {
    /* A page that silently omits somebody is worse than one that shows them at
       top level, and an infinite recursion is worse than both. */
    const members = [
      row("m1", "job", "a", "pm", "b"),
      row("m2", "job", "b", "superintendent", "a"),
    ];
    const roots = buildOrgForest(members);
    /* Both rows still reachable, and the walk TERMINATES — the assertion that
       matters, since the bug this pins produced a.children=[b], b.children=[a]
       and hung the first recursive render. */
    const keys = new Set<string>();
    const walk = (n: { key: string; children: { key: string }[] }, depth: number) => {
      expect(depth).toBeLessThan(10);
      keys.add(n.key);
      for (const c of n.children) walk(c as never, depth + 1);
    };
    for (const r of roots) walk(r, 0);
    expect(keys.has("m1")).toBe(true);
    expect(keys.has("m2")).toBe(true);
  });
});

describe("visibleEmployeeIds", () => {
  /* Two supers on one job, each with their own foreman. The rule the user
     asked for: a super sees the PM above and their own crew below — NOT the
     other super, and NOT the other super's foreman. */
  const members = [
    row("m0", "job", "dana", "pm", "alice"),
    row("m1", "job", "marcus", "superintendent", "dana"),
    row("m2", "job", "brian", "superintendent", "dana"),
    row("m3", "job", "alejandro", "foreman", "marcus"),
    row("m4", "job", "zelvin", "foreman", "brian"),
  ];

  it("gives a superintendent their chain up and their own crew down", () => {
    const seen = visibleEmployeeIds(members, "marcus");
    expect([...seen].sort()).toEqual(["alejandro", "alice", "dana", "marcus"]);
  });

  it("hides a sibling superintendent and their crew", () => {
    const seen = visibleEmployeeIds(members, "marcus");
    expect(seen.has("brian")).toBe(false);
    expect(seen.has("zelvin")).toBe(false);
  });

  it("gives a foreman their chain up and nothing below", () => {
    const seen = visibleEmployeeIds(members, "zelvin");
    expect([...seen].sort()).toEqual(["alice", "brian", "dana", "zelvin"]);
  });

  it("terminates on a cycle rather than looping", () => {
    const cyclic = [row("m1", "job", "a", "pm", "b"), row("m2", "job", "b", "pm", "a")];
    expect([...visibleEmployeeIds(cyclic, "a")].sort()).toEqual(["a", "b"]);
  });
});

describe("findCycle", () => {
  const members = [
    row("m1", "job", "b", "superintendent", "a"),
    row("m2", "job", "c", "foreman", "b"),
  ];

  it("refuses somebody reporting to themselves", () => {
    expect(findCycle(members, "a", "a")).toEqual(["a", "a"]);
  });

  it("catches the depth-3 loop that the existing self-check misses", () => {
    /* a -> b -> c already exists; making `a` report to `c` closes it. This is
       the case entered one innocent row at a time by three different people,
       which routers/project.ts's self-reference check cannot see. */
    expect(findCycle(members, "a", "c")).toEqual(["c", "b", "a"]);
  });

  it("allows a legitimate new edge", () => {
    expect(findCycle(members, "d", "c")).toBeNull();
  });

  it("allows clearing the boss", () => {
    expect(findCycle(members, "c", null)).toBeNull();
  });
});
