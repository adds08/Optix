"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { Can } from "@/components/can";
import { AssignForm } from "@/components/assign-form";
import { TransferForm } from "@/components/transfer-form";
import { ReportForm } from "@/components/report-form";
import { AssetForm } from "@/components/asset-form";
import { LocationForm } from "@/components/location-form";

function statusChip(s: string) {
  return <span className={`chip ${s}`}>{s.replace("_", " ")}</span>;
}
const money = (n: string | null | undefined) => "$" + Number(n ?? 0).toLocaleString();

export default function AssetsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const assets = trpc.asset.list.useQuery({ search, status });
  const { has } = usePermissions();

  const [showAssign, setShowAssign] = useState(false);
  const [assignAssetId, setAssignAssetId] = useState<string | undefined>(undefined);
  const [showTransfer, setShowTransfer] = useState<{ id: string; tag: string } | null>(null);
  const [showReport, setShowReport] = useState<{ id: string; tag: string } | null>(null);
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [showLocationForm, setShowLocationForm] = useState(false);

  const openAssign = (assetId?: string) => {
    setAssignAssetId(assetId);
    setShowAssign(true);
  };
  const closeAssign = () => {
    setShowAssign(false);
    setAssignAssetId(undefined);
  };

  return (
    <>
      <div className="card">
        <h2>Asset Register ({assets.data?.length ?? 0})</h2>
        <div className="toolbar">
          <input type="search" placeholder="Search tag, model, serial…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="available">Available</option>
            <option value="assigned">Assigned</option>
            <option value="in_maintenance">In Maintenance</option>
            <option value="reserved">Reserved</option>
            <option value="lost">Lost</option>
          </select>
          <Can perm="assignment.create">
            <button className="btn btn-sm" onClick={() => openAssign()}>+ Assign</button>
          </Can>
          <Can perm="asset.manage">
            <button className="btn btn-sm btn-ok" onClick={() => setShowAssetForm(true)}>+ New Asset</button>
          </Can>
          <Can perm="location.manage">
            <button className="btn btn-sm" onClick={() => setShowLocationForm(true)}>+ Location</button>
          </Can>
        </div>
        <div className="body scroll"><table>
          <thead><tr><th>Tag</th><th>Model</th><th>Category</th><th>Status</th><th>Custodian</th><th>Current Project</th><th>Location</th><th>Cond.</th><th className="right">Cost</th><th>Actions</th></tr></thead>
          <tbody>
            {assets.data?.map((a) => (
              <tr key={a.id}>
                <td><b>{a.tag}</b></td><td>{a.modelName}</td><td>{a.categoryName}</td><td>{statusChip(a.status)}</td>
                <td>{a.custodianName ?? <span className="muted">—</span>}</td>
                <td>{a.currentProjectName ?? <span className="muted">—</span>}</td>
                <td>{a.locationName ?? <span className="muted">—</span>}</td>
                <td>{a.condition}</td><td className="right">{money(a.acquisitionCost)}</td>
                <td>
                  {a.status === "available" && has("assignment.create") && (
                    <button className="btn btn-sm ghost" onClick={() => openAssign(a.id)} style={{ marginRight: 4 }}>Assign</button>
                  )}
                  {a.status === "assigned" && has("transfer.create") && (
                    <button className="btn btn-sm ghost" onClick={() => setShowTransfer({ id: a.id, tag: a.tag })} style={{ marginRight: 4 }}>Transfer</button>
                  )}
                  {has("asset.manage") && (
                    <button className="btn btn-sm ghost" onClick={() => setShowReport({ id: a.id, tag: a.tag })}>Report</button>
                  )}
                </td>
              </tr>
            ))}
            {!assets.data?.length && <tr><td colSpan={11} className="muted" style={{ padding: 14 }}>No matches</td></tr>}
          </tbody>
        </table></div>
      </div>

      <AssignForm open={showAssign} onClose={closeAssign} preselectedAssetId={assignAssetId} />
      {showTransfer && <TransferForm open={!!showTransfer} onClose={() => setShowTransfer(null)} assetId={showTransfer.id} assetTag={showTransfer.tag} />}
      {showReport && <ReportForm open={!!showReport} onClose={() => setShowReport(null)} assetId={showReport.id} assetTag={showReport.tag} />}
      <AssetForm open={showAssetForm} onClose={() => setShowAssetForm(false)} />
      <LocationForm open={showLocationForm} onClose={() => setShowLocationForm(false)} />
    </>
  );
}
