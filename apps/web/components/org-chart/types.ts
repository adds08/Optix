import type { OrgMemberInput } from "@stinventory/domain/org-chart";

/*
  A roster row as the chart page uses it: the edge fields `buildOrgForest` needs
  (via OrgMemberInput) plus the display fields the cards draw. Kept in one place
  so the page, the tree and the tabs cannot drift on the shape.
*/
export type ChartMember = OrgMemberInput & {
  name: string;
  externalId: string | null;
  employeeRole: string | null;
  employeeStatus: string | null;
  projectName: string;
  projectExternalId: string | null;
  projectStatus: string | null;
  startedOn: string;
  note: string | null;
};
