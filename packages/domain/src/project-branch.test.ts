import { describe, it, expect } from "vitest";
import { branchEmployeeIds, removalBranch } from "./project-branch";
describe("project reporting branches", () => {
  const rows = [
    { projectId: "nex", employeeId: "super", reportsToEmployeeId: "pm" },
    { projectId: "nex", employeeId: "foreman", reportsToEmployeeId: "super" },
    { projectId: "nex", employeeId: "other-super", reportsToEmployeeId: "other-pm" },
    { projectId: "elsewhere", employeeId: "other-foreman", reportsToEmployeeId: "super" },
  ];
  it("includes descendants even before the manager has a roster row", () => {
    expect([...branchEmployeeIds(rows, "nex", "pm")]).toEqual(["pm", "super", "foreman"]);
  });
  it("excludes peers' crews and a different project's reports", () => {
    expect([...branchEmployeeIds(rows, "nex", "super")]).toEqual(["super", "foreman"]);
  });
  it("terminates on historical circular data", () => {
    expect(branchEmployeeIds([...rows, { projectId: "nex", employeeId: "pm", reportsToEmployeeId: "foreman" }], "nex", "pm").size).toBe(3);
  });
});

describe("branch removal dependencies", () => {
  it("preserves an independent assignment and its descendants", () => {
    const row = (id: string, employeeId: string, reportsToEmployeeId: string | null, projectId = "nex") => ({ id, employeeId, reportsToEmployeeId, projectId });
    const result = removalBranch([row("1", "pm", null), row("2", "super", "pm"), row("3", "super", "other-pm"), row("4", "foreman", "super"), row("5", "elsewhere", "pm", "other")], "nex", "pm");
    expect(result.members.map(r => r.id)).toEqual(["1", "2"]);
    expect(result.employeeIds).toEqual(["pm"]);
  });
  it("removes a complete dependent branch without touching a peer", () => {
    const rows = [{ id:"1",projectId:"nex",employeeId:"pm",reportsToEmployeeId:null },{ id:"2",projectId:"nex",employeeId:"super",reportsToEmployeeId:"pm" },{ id:"3",projectId:"nex",employeeId:"foreman",reportsToEmployeeId:"super" },{ id:"4",projectId:"nex",employeeId:"peer",reportsToEmployeeId:null }];
    expect(removalBranch(rows,"nex","pm").employeeIds).toEqual(["pm","super","foreman"]);
  });
});
