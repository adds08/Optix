const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4100";

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("sti-session") : null;
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export const api = {
  login: (email: string, password: string) =>
    fetchApi<{ sessionId: string }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => fetchApi<{ firstName: string; lastName: string; role: string; permissions: string[]; employeeId: string }>("/api/auth/me"),
  kpis: () => fetchApi<any>("/api/dashboard/kpis"),
  overdueLoans: () => fetchApi<any[]>("/api/dashboard/overdue-loans"),
  recentActivity: () => fetchApi<any[]>("/api/dashboard/recent-activity"),
  clearanceQueue: () => fetchApi<any[]>("/api/dashboard/clearance-queue"),
  pendingApprovals: () => fetchApi<any[]>("/api/dashboard/pending-approvals"),
  approve: (type: string, id: string) => fetchApi(`/api/${type}/${id}/approve`, { method: "POST" }),
  assets: (search?: string, status?: string) => fetchApi<any[]>(`/api/assets?${new URLSearchParams({ ...(search ? { search } : {}), ...(status && status !== "all" ? { status } : {}) })}`),
  createAsset: (data: any) => fetchApi("/api/assets", { method: "POST", body: JSON.stringify(data) }),
  setAssetStatus: (id: string, status: string) => fetchApi(`/api/assets/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  assignments: () => fetchApi<any[]>("/api/assignments"),
  createAssignment: (data: any) => fetchApi("/api/assignments", { method: "POST", body: JSON.stringify(data) }),
  returnAssignment: (id: string) => fetchApi(`/api/assignments/${id}/return`, { method: "POST" }),
  vehicles: () => fetchApi<any[]>("/api/vehicles"),
  employees: () => fetchApi<any[]>("/api/employees"),
  transactions: (limit = 100) => fetchApi<any[]>(`/api/transactions?limit=${limit}`),
  verifyList: () => fetchApi<any[]>("/api/messaging/pending-verification"),
  confirmAction: (id: string) => fetchApi(`/api/messaging/${id}/confirm`, { method: "POST" }),
  tasks: (limit = 100) => fetchApi<any[]>(`/api/tasks?limit=${limit}`),
  updateTask: (id: string, status: string) => fetchApi(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
};
