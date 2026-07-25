// Re-export from db schema types match
export type Asset = {
  id: string; tag: string; modelName: string; categoryName: string;
  status: string; condition: string; custodianName?: string;
  currentProjectName?: string; locationName?: string; acquisitionCost?: string;
  custodianId?: string;
};
export type Assignment = {
  id: string; assetId: string; tag: string; modelName: string;
  custodianName: string; projectName?: string; type: string;
  startDate: string; expectedEnd?: string; status: string; overdue: boolean;
};
export type OverdueLoan = {
  id: string; tag: string; modelName: string; custodianName: string;
  expectedEnd: string; daysOverdue: number;
};
export type ActivityItem = {
  id: string; eventType: string; tag: string; note: string; occurredAt: string;
};
export type PendingApproval = {
  id: string; type: string; assetTag: string; assetModel: string; custodianName: string;
};
export type KpiData = {
  assigned: number; available: number; inMaintenance: number; reserved: number;
  lost: number; fleetValue: string;
};
export type Vehicle = {
  id: string; unit: string; vehicleType: string; plate?: string;
  makeModel?: string; ownershipType: string; foremanName?: string; projectName?: string;
};
export type Employee = {
  id: string; name: string; role: string; employmentStatus: string;
  primaryProjectName?: string; reportsToName?: string;
  reportsToEmployeeId?: number; externalId?: number;
};
export type TransactionItem = {
  id: string; eventType: string; tag: string; modelName: string;
  note?: string; occurredAt: string;
};
export type VerificationMessage = {
  id: string; body: string; intentType: string; department: string; createdAt: string;
};
export type TaskItem = {
  id: string; title: string; description?: string; priority: string; status: string; createdAt: string;
};
export type AuthState = {
  isAuthenticated: boolean; userName?: string; role?: string; permissions: string[];
};
