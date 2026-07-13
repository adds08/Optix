// STInventory prototype — sample Urban Infraconstruction data.
// Single source of truth for the prototype. Everything the UI shows is derived from this.
// In production these become Postgres tables (see ../DATA_MODEL.md); here they are arrays.

window.STI = (function () {
  const warehouses = [
    { id: "wh-dal", name: "Main Warehouse — Dallas", region: "TX-North" },
    { id: "wh-hou", name: "Regional Warehouse — Houston", region: "TX-Gulf" },
  ];

  const projects = [
    { id: "p-legacy", extId: "URB-2401", name: "Legacy West Phase 3", status: "active", costCenter: "CC-4100", start: "2026-01-06", end: "2026-11-30" },
    { id: "p-trinity", extId: "URB-2402", name: "Trinity Bridge Rehab", status: "active", costCenter: "CC-4210", start: "2026-03-02", end: "2027-02-15" },
    { id: "p-gpk", extId: "URB-2403", name: "Grand Parkway Segment H", status: "active", costCenter: "CC-4315", start: "2026-02-10", end: "2026-12-20" },
    { id: "p-uptown", extId: "URB-2398", name: "Uptown Utility Relocate", status: "closing", costCenter: "CC-3980", start: "2025-08-01", end: "2026-07-31" },
    { id: "p-warehouse", extId: "URB-YARD", name: "Equipment Yard (unassigned)", status: "active", costCenter: "CC-0000", start: "2025-01-01", end: "2030-01-01" },
  ];

  const employees = [
    { id: "e-miguel", name: "Miguel Torres", role: "foreman", primaryProject: "p-legacy", status: "active" },
    { id: "e-dwayne", name: "Dwayne Ellis", role: "foreman", primaryProject: "p-trinity", status: "active" },
    { id: "e-sofia", name: "Sofia Ramirez", role: "foreman", primaryProject: "p-gpk", status: "active" },
    { id: "e-james", name: "James Whitaker", role: "foreman", primaryProject: "p-uptown", status: "terminated", terminatedAt: "2026-07-05" },
    { id: "e-karen", name: "Karen Osei", role: "equipment_admin", primaryProject: null, status: "active" },
    { id: "e-warehouse", name: "Yard Desk", role: "warehouse", primaryProject: null, status: "active" },
  ];

  const locations = [
    { id: "l-dal", type: "warehouse", name: "Dallas Yard", warehouse: "wh-dal", project: null },
    { id: "l-hou", type: "warehouse", name: "Houston Yard", warehouse: "wh-hou", project: null },
    { id: "l-gbA", type: "gang_box", name: "Gang Box A", warehouse: null, project: "p-legacy" },
    { id: "l-truck12", type: "vehicle", name: "Truck 12", warehouse: null, project: "p-trinity" },
    { id: "l-contH", type: "site_container", name: "Container — GPK H", warehouse: null, project: "p-gpk" },
    { id: "l-contU", type: "site_container", name: "Container — Uptown", warehouse: null, project: "p-uptown" },
  ];

  // Asset catalog shorthand baked into each asset for the prototype.
  // status: available | assigned | in_maintenance | lost | reserved
  const assets = [
    { id: "a-1001", tag: "UIC-1001", model: "Hilti TE 60-ATC Rotary Hammer", category: "Power Tools", serial: "H60-88213", cost: 1650, acquired: "2025-04-11", owningProject: "p-legacy", status: "assigned", custodian: "e-miguel", currentProject: "p-legacy", location: "l-gbA", condition: "good", warranty: "2027-04-11" },
    { id: "a-1002", tag: "UIC-1002", model: "DeWalt DWS779 Miter Saw", category: "Power Tools", serial: "DW-42119", cost: 640, acquired: "2025-06-02", owningProject: "p-legacy", status: "assigned", custodian: "e-miguel", currentProject: "p-legacy", location: "l-gbA", condition: "good", warranty: "2027-06-02" },
    { id: "a-1003", tag: "UIC-1003", model: "Honda EU7000is Generator", category: "Power Equipment", serial: "HG-77341", cost: 4600, acquired: "2024-11-20", owningProject: "p-trinity", status: "assigned", custodian: "e-dwayne", currentProject: "p-trinity", location: "l-truck12", condition: "good", warranty: "2026-11-20" },
    { id: "a-1004", tag: "UIC-1004", model: "Trimble R12i GNSS Receiver", category: "Survey", serial: "TR-10093", cost: 21500, acquired: "2025-01-15", owningProject: "p-gpk", status: "assigned", custodian: "e-sofia", currentProject: "p-gpk", location: "l-contH", condition: "good", warranty: "2028-01-15" },
    { id: "a-1005", tag: "UIC-1005", model: "Milwaukee M18 Impact Kit", category: "Power Tools", serial: "MW-55210", cost: 380, acquired: "2025-09-01", owningProject: "p-gpk", status: "assigned", custodian: "e-sofia", currentProject: "p-gpk", location: "l-contH", condition: "fair", warranty: "2027-09-01" },
    { id: "a-1006", tag: "UIC-1006", model: "Wacker Neuson Plate Compactor", category: "Concrete", serial: "WN-33027", cost: 2100, acquired: "2024-08-19", owningProject: "p-uptown", status: "assigned", custodian: "e-james", currentProject: "p-uptown", location: "l-contU", condition: "fair", warranty: "2026-08-19" },
    { id: "a-1007", tag: "UIC-1007", model: "Hilti PM 40-MG Laser Level", category: "Survey", serial: "HL-19022", cost: 720, acquired: "2025-03-30", owningProject: "p-uptown", status: "assigned", custodian: "e-james", currentProject: "p-uptown", location: "l-contU", condition: "good", warranty: "2027-03-30" },
    { id: "a-1008", tag: "UIC-1008", model: "Stihl TS 500i Cut-Off Saw", category: "Power Tools", serial: "ST-61140", cost: 1150, acquired: "2025-02-14", owningProject: "p-warehouse", status: "in_maintenance", custodian: null, currentProject: "p-warehouse", location: "l-dal", condition: "damaged", warranty: "2027-02-14" },
    { id: "a-1009", tag: "UIC-1009", model: "DeWalt 20V Drill/Driver Kit", category: "Power Tools", serial: "DW-90311", cost: 260, acquired: "2025-10-05", owningProject: "p-warehouse", status: "available", custodian: null, currentProject: "p-warehouse", location: "l-dal", condition: "good", warranty: "2027-10-05" },
    { id: "a-1010", tag: "UIC-1010", model: "Bosch GLL3-330C Laser Level", category: "Survey", serial: "BL-22178", cost: 480, acquired: "2025-05-22", owningProject: "p-warehouse", status: "available", custodian: null, currentProject: "p-warehouse", location: "l-hou", condition: "good", warranty: "2027-05-22" },
    { id: "a-1011", tag: "UIC-1011", model: "Genie AWP-30S Personnel Lift", category: "Access", serial: "GN-40551", cost: 8900, acquired: "2024-07-08", owningProject: "p-warehouse", status: "available", custodian: null, currentProject: "p-warehouse", location: "l-hou", condition: "good", warranty: "2026-07-08" },
    { id: "a-1012", tag: "UIC-1012", model: "Hilti DX 6 Powder Fastener", category: "Power Tools", serial: "HD-70012", cost: 1350, acquired: "2025-07-19", owningProject: "p-trinity", status: "assigned", custodian: "e-dwayne", currentProject: "p-legacy", location: "l-gbA", condition: "good", warranty: "2027-07-19" },
    { id: "a-1013", tag: "UIC-1013", model: "Makita EK7651H Power Cutter", category: "Power Tools", serial: "MK-31900", cost: 890, acquired: "2024-05-30", owningProject: "p-warehouse", status: "lost", custodian: "e-james", currentProject: "p-uptown", location: "l-contU", condition: "poor", warranty: "2026-05-30" },
    { id: "a-1014", tag: "UIC-1014", model: "Topcon GT-1200 Robotic Total Station", category: "Survey", serial: "TP-88820", cost: 33000, acquired: "2025-01-30", owningProject: "p-warehouse", status: "reserved", custodian: null, currentProject: "p-gpk", location: "l-dal", condition: "good", warranty: "2028-01-30" },
  ];

  // Fleet — trucks and trailers, each stationed on a job and tied to its foreman.
  // type: truck | trailer
  const vehicles = [
    { id: "v-t07", type: "truck", unit: "Truck 07", plate: "TX 5521-BR", make: "RAM 2500", project: "p-legacy", foreman: "e-miguel", odometer: 41230, inspDue: "2026-09-30" },
    { id: "v-tr21", type: "trailer", unit: "Trailer 21", plate: "TX TR-2210", make: "PJ 20ft Equipment", project: "p-legacy", foreman: "e-miguel", odometer: null, inspDue: "2026-10-15" },
    { id: "v-t12", type: "truck", unit: "Truck 12", plate: "TX 8842-KL", make: "Ford F-350", project: "p-trinity", foreman: "e-dwayne", odometer: 68540, inspDue: "2026-07-31" },
    { id: "v-tr08", type: "trailer", unit: "Trailer 08", plate: "TX TR-0817", make: "Big Tex 14ft Dump", project: "p-trinity", foreman: "e-dwayne", odometer: null, inspDue: "2026-11-02" },
    { id: "v-t15", type: "truck", unit: "Truck 15", plate: "TX 9930-MN", make: "Chevy Silverado 3500", project: "p-gpk", foreman: "e-sofia", odometer: 22910, inspDue: "2026-08-20" },
    { id: "v-tr33", type: "trailer", unit: "Trailer 33", plate: "TX TR-3390", make: "Load Trail Gooseneck", project: "p-gpk", foreman: "e-sofia", odometer: null, inspDue: "2026-09-05" },
    { id: "v-t04", type: "truck", unit: "Truck 04", plate: "TX 3310-UP", make: "Ford F-250", project: "p-uptown", foreman: "e-james", odometer: 91500, inspDue: "2026-07-15" },
  ];

  // Active assignments (temporary loans carry an expected end date -> overdue check).
  const assignments = [
    { id: "as-1", asset: "a-1012", custodian: "e-dwayne", project: "p-legacy", type: "temporary", start: "2026-06-01", expectedEnd: "2026-06-25", status: "active" },
    { id: "as-2", asset: "a-1005", custodian: "e-sofia", project: "p-gpk", type: "temporary", start: "2026-05-15", expectedEnd: "2026-07-01", status: "active" },
    { id: "as-3", asset: "a-1001", custodian: "e-miguel", project: "p-legacy", type: "permanent", start: "2026-01-10", expectedEnd: null, status: "active" },
  ];

  const purchaseRequests = [
    { id: "pr-1", project: "p-gpk", requestedBy: "e-sofia", status: "submitted", neededBy: "2026-07-25", item: "2x Milwaukee M18 Impact Kit", estCost: 760 },
    { id: "pr-2", project: "p-trinity", requestedBy: "e-dwayne", status: "approved", neededBy: "2026-08-05", item: "1x Honda EU7000is Generator", estCost: 4600 },
    { id: "pr-3", project: "p-legacy", requestedBy: "e-miguel", status: "ordered", neededBy: "2026-07-15", item: "3x DeWalt 20V Drill Kit", estCost: 780 },
  ];

  const maintenance = [
    { id: "m-1", asset: "a-1008", type: "corrective", status: "in_progress", vendor: "Stihl Service DFW", scheduled: "2026-07-06", cost: 240 },
    { id: "m-2", asset: "a-1006", type: "preventive", status: "scheduled", vendor: "In-house", scheduled: "2026-07-20", cost: 0 },
    { id: "m-3", asset: "a-1003", type: "preventive", status: "scheduled", vendor: "In-house", scheduled: "2026-07-14", cost: 0 },
  ];

  // Append-only event log — the system of record. UI reads recent slice for the audit feed.
  const transactions = [
    { id: 1, asset: "a-1001", event: "assign", actor: "e-karen", at: "2026-01-10 08:12", note: "Assigned to Miguel Torres — Legacy West" },
    { id: 2, asset: "a-1012", event: "transfer", actor: "e-karen", at: "2026-06-01 09:40", note: "Temp loan Trinity→Legacy, due 2026-06-25" },
    { id: 3, asset: "a-1008", event: "repair_start", actor: "e-karen", at: "2026-07-06 10:05", note: "Cut-off saw damaged blade housing" },
    { id: 4, asset: "a-1013", event: "lost", actor: "e-karen", at: "2026-07-05 16:20", note: "Not found during Uptown offboarding count" },
    { id: 5, asset: "a-1014", event: "reserve", actor: "e-sofia", at: "2026-07-02 11:30", note: "Reserved for GPK Segment H survey phase" },
    { id: 6, asset: "a-1009", event: "return", actor: "e-warehouse", at: "2026-06-28 14:15", note: "Returned to Dallas Yard — Available" },
  ];

  const lookups = {
    project: (id) => projects.find((p) => p.id === id) || { name: "—" },
    employee: (id) => employees.find((e) => e.id === id) || { name: "—" },
    location: (id) => locations.find((l) => l.id === id) || { name: "—" },
    asset: (id) => assets.find((a) => a.id === id) || { tag: "—", model: "—" },
    vehicle: (id) => vehicles.find((v) => v.id === id) || { unit: "—" },
    foremanOf: (projId) => employees.find((e) => e.role === "foreman" && e.primaryProject === projId) || null,
    vehiclesOf: (projId) => vehicles.filter((v) => v.project === projId),
  };

  return { warehouses, projects, employees, locations, assets, vehicles, assignments, purchaseRequests, maintenance, transactions, lookups };
})();
