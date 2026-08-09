import { Hono, type Context } from "hono";
import { eq, desc, and, sql, ne, ilike, inArray, or } from "drizzle-orm";
import { resolveSession } from "@stinventory/auth";
import * as s from "@stinventory/db/schema";
import type { Database } from "@stinventory/db";
import type { ResolvedSession } from "@stinventory/auth";
import { formatAssetModel } from "@stinventory/types";

type AppContext = { Variables: { session: ResolvedSession } };

export function mountRestRoutes(app: Hono, db: Database) {
  const rest = new Hono<AppContext>();

  rest.use("*", async (c, next) => {
    const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    const session = await resolveSession(db, token);
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    c.set("session", session);
    await next();
  });

  const tid = (c: Context<AppContext>) => c.get("session").tenantId;

  rest.get("/api/auth/me", (c) => {
    const session = c.get("session");
    const parts = session.actorLabel?.split(" ") ?? [];
    return c.json({
      firstName: parts[0] ?? "",
      lastName: parts.slice(1).join(" "),
      role: session.roleName,
      permissions: [...session.permissions],
      employeeId: session.employeeId,
    });
  });

  // Dashboard KPIs
  rest.get("/api/dashboard/kpis", async (c) => {
    const tenantId = tid(c);
    const assets = await db.select({
      status: s.asset.currentStatus,
      cost: s.asset.acquisitionCost,
    }).from(s.asset).where(eq(s.asset.tenantId, tenantId));

    const assigned = assets.filter(a => a.status === "assigned").length;
    const available = assets.filter(a => a.status === "available").length;
    const inMaint = assets.filter(a => a.status === "in_maintenance").length;
    const reserved = assets.filter(a => a.status === "reserved").length;
    const lost = assets.filter(a => a.status === "lost").length;
    const fleetValue = assets.reduce((sum, a) => sum + Number(a.cost ?? 0), 0);
    return c.json({ assigned, available, inMaintenance: inMaint, reserved, lost, fleetValue: `${fleetValue}` });
  });

  // Recent activity
  rest.get("/api/dashboard/recent-activity", async (c) => {
    const rows = await db.select({
      id: s.transaction.id,
      eventType: s.transaction.eventType,
      tag: s.asset.tag,
      make: s.asset.make,
      modelNumber: s.asset.modelNumber,
      description: s.asset.description,
      note: s.transaction.note,
      occurredAt: s.transaction.occurredAt,
    }).from(s.transaction)
      .leftJoin(s.asset, eq(s.transaction.assetId, s.asset.id))
      .where(eq(s.transaction.tenantId, tid(c)))
      .orderBy(desc(s.transaction.occurredAt))
      .limit(20);
    return c.json(rows.map((r) => ({ ...r, modelName: formatAssetModel(r) })));
  });

  // HR Clearance queue
  rest.get("/api/dashboard/clearance-queue", async (c) => {
    const rows = await db.select({
      assetId: s.asset.id,
      tag: s.asset.tag,
      make: s.asset.make,
      modelNumber: s.asset.modelNumber,
      description: s.asset.description,
    }).from(s.asset)
      .innerJoin(s.employee, eq(s.asset.currentCustodianId, s.employee.id))
      .where(and(
        eq(s.asset.tenantId, tid(c)),
        eq(s.employee.employmentStatus, "terminated"),
        ne(s.asset.currentStatus, "available"),
      ));
    return c.json(rows.map((r) => ({ ...r, modelName: formatAssetModel(r) })));
  });

  // Pending approvals
  rest.get("/api/dashboard/pending-approvals", async (c) => {
    const tenantId = tid(c);
    const assignments = await db.select({
      id: s.assignment.id,
      type: sql<string>`'assignment'`.as("type"),
      assetTag: s.asset.tag,
      make: s.asset.make,
      modelNumber: s.asset.modelNumber,
      description: s.asset.description,
      custodianName: s.employee.name,
      status: s.assignment.status,
    }).from(s.assignment)
      .innerJoin(s.asset, eq(s.assignment.assetId, s.asset.id))
      .innerJoin(s.employee, eq(s.assignment.custodianId, s.employee.id))
      .where(and(eq(s.assignment.tenantId, tenantId), eq(s.assignment.status, "pending_approval")));
    const transfers = await db.select({
      id: s.transfer.id,
      type: sql<string>`'transfer'`.as("type"),
      assetTag: s.asset.tag,
      make: s.asset.make,
      modelNumber: s.asset.modelNumber,
      description: s.asset.description,
      custodianName: s.employee.name,
      status: s.transfer.status,
    }).from(s.transfer)
      .innerJoin(s.asset, eq(s.transfer.assetId, s.asset.id))
      .innerJoin(s.employee, eq(s.transfer.toCustodianId, s.employee.id))
      /* Borrows belong in the desk's queue too — they are the larger half of it
         now, since a foreman's hand-off no longer settles itself. */
      .where(and(eq(s.transfer.tenantId, tenantId), inArray(s.transfer.status, ["pending_approval", "pending_verification"])));
    const withModel = (r: { make: string | null; modelNumber: string | null; description: string | null }) => ({
      ...r,
      assetModel: formatAssetModel(r),
    });
    return c.json([...assignments.map(withModel), ...transfers.map(withModel)]);
  });

  // Approvals
  rest.post("/api/assignment/:id/approve", async (c) => {
    await db.update(s.assignment).set({ status: "active" })
      .where(and(eq(s.assignment.id, c.req.param("id")!), eq(s.assignment.tenantId, tid(c))));
    return c.json({ ok: true });
  });

  rest.post("/api/transfer/:id/approve", async (c) => {
    await db.update(s.transfer).set({ status: "approved" })
      .where(and(eq(s.transfer.id, c.req.param("id")!), eq(s.transfer.tenantId, tid(c))));
    return c.json({ ok: true });
  });

  // Assets
  rest.get("/api/assets", async (c) => {
    const search = c.req.query("search");
    const status = c.req.query("status");
    const conditions: ReturnType<typeof eq>[] = [eq(s.asset.tenantId, tid(c))];
    if (search) {
      conditions.push(or(
        ilike(s.asset.tag, `%${search}%`),
        ilike(s.asset.make, `%${search}%`),
        ilike(s.asset.modelNumber, `%${search}%`),
        ilike(s.asset.description, `%${search}%`),
        ilike(s.asset.serialNumber, `%${search}%`),
      )!);
    }
    if (status && status !== "all") {
      conditions.push(eq(s.asset.currentStatus, status));
    }
    const rows = await db.select({
      id: s.asset.id, tag: s.asset.tag,
      make: s.asset.make, modelNumber: s.asset.modelNumber, description: s.asset.description,
      categoryName: s.asset.categoryName, status: s.asset.currentStatus,
      condition: s.asset.condition, acquisitionCost: s.asset.acquisitionCost,
      custodianId: s.asset.currentCustodianId,
      custodianName: s.employee.name,
      currentProjectName: s.project.name,
      locationName: s.location.name,
    }).from(s.asset)
      .leftJoin(s.employee, eq(s.asset.currentCustodianId, s.employee.id))
      .leftJoin(s.project, eq(s.asset.currentProjectId, s.project.id))
      .leftJoin(s.location, eq(s.asset.currentLocationId, s.location.id))
      .where(and(...conditions))
      .orderBy(s.asset.tag);
    return c.json(rows.map((r) => ({ ...r, modelName: formatAssetModel(r) })));
  });

  rest.post("/api/assets", async (c) => {
    const body = await c.req.json();
    const [row] = await db.insert(s.asset).values({ ...body, tenantId: tid(c), currentStatus: body.currentStatus ?? "available" }).returning();
    return c.json(row);
  });

  rest.patch("/api/assets/:id/status", async (c) => {
    const body = await c.req.json();
    await db.update(s.asset).set({ currentStatus: body.status })
      .where(and(eq(s.asset.id, c.req.param("id")!), eq(s.asset.tenantId, tid(c))));
    return c.json({ ok: true });
  });

  // Assignments
  rest.get("/api/assignments", async (c) => {
    const rows = await db.select({
      id: s.assignment.id, assetId: s.assignment.assetId,
      tag: s.asset.tag,
      make: s.asset.make, modelNumber: s.asset.modelNumber, description: s.asset.description,
      custodianName: s.employee.name,
      projectName: s.project.name,
      startDate: s.assignment.startDate, status: s.assignment.status,
    }).from(s.assignment)
      .innerJoin(s.asset, eq(s.assignment.assetId, s.asset.id))
      .innerJoin(s.employee, eq(s.assignment.custodianId, s.employee.id))
      .leftJoin(s.project, eq(s.assignment.projectId, s.project.id))
      .where(eq(s.assignment.tenantId, tid(c)))
      .orderBy(desc(s.assignment.startDate));
    return c.json(rows.map((r) => ({ ...r, modelName: formatAssetModel(r) })));
  });

  rest.post("/api/assignments", async (c) => {
    const body = await c.req.json();
    const [row] = await db.insert(s.assignment).values({ ...body, tenantId: tid(c), status: "active" }).returning();
    return c.json(row);
  });

  rest.post("/api/assignments/:id/return", async (c) => {
    await db.update(s.assignment).set({ status: "completed" })
      .where(and(eq(s.assignment.id, c.req.param("id")!), eq(s.assignment.tenantId, tid(c))));
    return c.json({ ok: true });
  });

  // Vehicles
  rest.get("/api/vehicles", async (c) => {
    const rows = await db.select({
      id: s.vehicle.id, unit: s.vehicle.unit,
      vehicleType: s.vehicle.vehicleType,
      plate: s.vehicle.plate, makeModel: s.vehicle.makeModel,
      ownershipType: s.vehicle.ownershipType,
      foremanName: s.employee.name,
      projectName: s.project.name,
    }).from(s.vehicle)
      .leftJoin(s.employee, eq(s.vehicle.foremanEmployeeId, s.employee.id))
      .leftJoin(s.project, eq(s.vehicle.projectId, s.project.id))
      .where(eq(s.vehicle.tenantId, tid(c)));
    return c.json(rows);
  });

  rest.post("/api/vehicles", async (c) => {
    const body = await c.req.json();
    const [row] = await db.insert(s.vehicle).values({ ...body, tenantId: tid(c) }).returning();
    return c.json(row);
  });

  // Employees
  rest.get("/api/employees", async (c) => {
    const rows = await db.select({
      id: s.employee.id, name: s.employee.name, role: s.employee.role,
      employmentStatus: s.employee.employmentStatus,
      primaryProjectName: s.project.name,
      reportsToName: sql<string>`e2.name`.as("reportsToName"),
      reportsToEmployeeId: s.employee.reportsToEmployeeId,
      externalId: s.employee.externalId,
    }).from(s.employee)
      .leftJoin(s.project, eq(s.employee.primaryProjectId, s.project.id))
      .leftJoin(sql`${s.employee} e2`, eq(s.employee.reportsToEmployeeId, sql`e2.id`))
      .where(eq(s.employee.tenantId, tid(c)))
      .orderBy(s.employee.name);
    return c.json(rows);
  });

  rest.post("/api/employees", async (c) => {
    const body = await c.req.json();
    const [row] = await db.insert(s.employee).values({ ...body, tenantId: tid(c) }).returning();
    return c.json(row);
  });

  // Transactions
  rest.get("/api/transactions", async (c) => {
    const limit = parseInt(c.req.query("limit") ?? "100");
    const rows = await db.select({
      id: s.transaction.id, eventType: s.transaction.eventType,
      tag: s.asset.tag,
      make: s.asset.make, modelNumber: s.asset.modelNumber, description: s.asset.description,
      note: s.transaction.note, occurredAt: s.transaction.occurredAt,
    }).from(s.transaction)
      .leftJoin(s.asset, eq(s.transaction.assetId, s.asset.id))
      .where(eq(s.transaction.tenantId, tid(c)))
      .orderBy(desc(s.transaction.occurredAt))
      .limit(limit);
    return c.json(rows.map((r) => ({ ...r, modelName: formatAssetModel(r) })));
  });

  // Verification
  rest.get("/api/messaging/pending-verification", async (c) => {
    const rows = await db.select({
      id: s.message.id, body: s.message.body,
      intentType: s.message.intentType,
      department: s.message.intentPayload,
      createdAt: s.message.createdAt,
    }).from(s.message)
      .where(and(
        eq(s.message.tenantId, tid(c)),
        eq(s.message.processingStatus, "pending_verification"),
      ))
      .orderBy(desc(s.message.createdAt));
    return c.json(rows.map(r => ({ ...r, department: extractDept(r.department) })));
  });

  rest.post("/api/messaging/:id/confirm", async (c) => {
    await db.update(s.message).set({ processingStatus: "confirmed" })
      .where(and(eq(s.message.id, c.req.param("id")!), eq(s.message.tenantId, tid(c))));
    return c.json({ ok: true });
  });

  // Tasks
  rest.get("/api/tasks", async (c) => {
    const limit = parseInt(c.req.query("limit") ?? "100");
    const rows = await db.select({
      id: s.task.id, title: s.task.title, description: s.task.description,
      priority: s.task.priority, status: s.task.status, createdAt: s.task.createdAt,
    }).from(s.task)
      .where(eq(s.task.tenantId, tid(c)))
      .orderBy(desc(s.task.createdAt))
      .limit(limit);
    return c.json(rows);
  });

  rest.patch("/api/tasks/:id", async (c) => {
    const body = await c.req.json();
    await db.update(s.task).set({ status: body.status })
      .where(and(eq(s.task.id, c.req.param("id")!), eq(s.task.tenantId, tid(c))));
    return c.json({ ok: true });
  });

  // Transfers
  rest.post("/api/transfers", async (c) => {
    const body = await c.req.json();
    const [row] = await db.insert(s.transfer).values({ ...body, tenantId: tid(c), status: "pending" }).returning();
    return c.json(row);
  });

  // Projects & Locations
  rest.get("/api/projects", async (c) => {
    const rows = await db.select({ id: s.project.id, name: s.project.name })
      .from(s.project).where(eq(s.project.tenantId, tid(c)));
    return c.json(rows);
  });

  rest.get("/api/locations", async (c) => {
    const rows = await db.select({ id: s.location.id, name: s.location.name, type: s.location.type })
      .from(s.location).where(eq(s.location.tenantId, tid(c)));
    return c.json(rows);
  });

  app.route("/", rest);
}

function extractDept(payload: unknown): string {
  if (payload && typeof payload === "object" && "department" in payload) {
    return String((payload as Record<string, unknown>).department ?? "Equipment Yard");
  }
  return "Equipment Yard";
}
