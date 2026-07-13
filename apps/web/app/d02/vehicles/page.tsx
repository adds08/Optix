"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Can } from "@/components/can";
import { Truck, Plus, MapPin, Wrench, User, Building2, DollarSign } from "lucide-react";
import { VehicleForm } from "@/components/vehicle-form";

export default function D02VehiclesPage() {
  const vehicles = trpc.vehicle.list.useQuery();
  const [showForm, setShowForm] = useState(false);

  return (
    <>
      <div className="d02-card">
        <h2><Truck size={16} className="d02-card-header-icon" /> Vehicles (Trucks & Trailers)</h2>
        <div className="d02-toolbar">
          <Can perm="vehicle.manage">
            <button className="d02-btn d02-sm" onClick={() => setShowForm(true)}><Plus size={14} /> New Vehicle</button>
          </Can>
          <div style={{ flex: 1 }} />
          <span className="d02-chip">{vehicles.data?.length ?? 0} vehicles</span>
        </div>
        <div className="d02-body d02-scroll">
          <table className="d02-table"><thead><tr><th>Unit</th><th>Type</th><th>Make/Model</th><th>Plate</th><th>Ownership</th><th>Foreman</th><th>Project</th><th>GPS</th><th>Allowance</th></tr></thead>
            <tbody>
              {vehicles.data?.map((v) => (
                <tr key={v.id}>
                  <td><b style={{ display: "flex", alignItems: "center", gap: 6 }}><Truck size={14} />{v.unit}</b></td>
                  <td><span className="d02-chip">{v.vehicleType}</span></td>
                  <td>{v.makeModel ?? <span className="d02-muted">—</span>}</td>
                  <td>{v.plate ?? <span className="d02-muted">—</span>}</td>
                  <td><span className={`d02-chip ${v.ownershipType === "personal_allowance" ? "d02-chip-lost" : "d02-chip-ok"}`}>{v.ownershipType.replace("_", " ")}</span></td>
                  <td>{v.foremanName ?? <span className="d02-muted">—</span>}</td>
                  <td>{v.projectName ?? <span className="d02-muted">—</span>}</td>
                  <td>{v.gpsLat ? <span style={{ display: "flex", alignItems: "center", gap: 4 }}><MapPin size={12} />{v.gpsLat},{v.gpsLng}</span> : <span className="d02-muted">—</span>}</td>
                  <td>{v.ownershipType === "personal_allowance" ? `${v.allowanceRate ?? ""}/${v.allowanceFrequency ?? ""}` : <span className="d02-muted">—</span>}</td>
                </tr>
              ))}
              {!vehicles.data?.length && <tr><td colSpan={9}><div className="d02-empty"><Truck size={36} /><div>No vehicles yet</div></div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <VehicleForm open={showForm} onClose={() => setShowForm(false)} />
    </>
  );
}
