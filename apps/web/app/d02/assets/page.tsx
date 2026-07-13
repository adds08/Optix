"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { Can } from "@/components/can";
import { useToast } from "@/components/d02/d02-toast";
import {
  Package, Search, Plus, UserPlus, ArrowRightLeft, Flag, ClipboardList, FolderOpen
} from "lucide-react";
import { AssignForm } from "@/components/assign-form";
import { TransferForm } from "@/components/transfer-form";
import { ReportForm } from "@/components/report-form";
import { AssetForm } from "@/components/asset-form";
import { LocationForm } from "@/components/location-form";

const money = (n: string | null | undefined) => "$" + Number(n ?? 0).toLocaleString();

function StatusChip({ status }: { status: string }) {
  const colors: Record<string, string> = {
    available: "d02-chip-ok",
    assigned: "d02-chip-assigned",
    in_maintenance: "d02-chip-maintenance",
    reserved: "d02-chip-reserved",
    lost: "d02-chip-lost",
    overdue: "d02-chip-overdue",
    active: "d02-chip-active",
    loan: "d02-chip-loan",
  };
  return <span className={`d02-chip ${colors[status] ?? ""}`}>{status.replace("_", " ")}</span>;
}

export default function D02AssetsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const assets = trpc.asset.list.useQuery({ search, status });
  const { has } = usePermissions();
  const toast = useToast();

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
      <div className="d02-card">
        <h2><ClipboardList size={16} className="d02-card-header-icon" /> Asset Register ({assets.data?.length ?? 0})</h2>
        <div className="d02-toolbar">
          <div style={{ position: "relative", flex: 1, maxWidth: 280 }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--d2-muted)" }} />
            <input type="search" placeholder="Search tag, model, serial…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 30 }} />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="available">Available</option>
            <option value="assigned">Assigned</option>
            <option value="in_maintenance">In Maintenance</option>
            <option value="reserved">Reserved</option>
            <option value="lost">Lost</option>
          </select>
          <div style={{ flex: 1 }} />
          <Can perm="assignment.create">
            <button className="d02-btn d02-sm" onClick={() => openAssign()}><Plus size={14} /> Assign</button>
          </Can>
          <Can perm="asset.manage">
            <button className="d02-btn d02-sm d02-ok" onClick={() => setShowAssetForm(true)}><Plus size={14} /> New Asset</button>
          </Can>
          <Can perm="location.manage">
            <button className="d02-btn d02-sm" onClick={() => setShowLocationForm(true)}><FolderOpen size={14} /> Location</button>
          </Can>
        </div>
        <div className="d02-body d02-scroll">
          <table className="d02-table">
            <thead><tr><th>Tag</th><th>Model</th><th>Category</th><th>Status</th><th>Custodian</th><th>Project</th><th>Location</th><th>Cond.</th><th className="d02-right">Cost</th><th>Actions</th></tr></thead>
            <tbody>
              {assets.data?.map((a) => (
                <tr key={a.id}>
                  <td><b>{a.tag}</b></td>
                  <td>{a.modelName}</td>
                  <td><span className="d02-chip">{a.categoryName}</span></td>
                  <td><StatusChip status={a.status} /></td>
                  <td>{a.custodianName ?? <span className="d02-muted">—</span>}</td>
                  <td>{a.currentProjectName ?? <span className="d02-muted">—</span>}</td>
                  <td>{a.locationName ?? <span className="d02-muted">—</span>}</td>
                  <td>{a.condition}</td>
                  <td className="d02-right">{money(a.acquisitionCost)}</td>
                  <td>
                    <div className="d02-actions">
                      {a.status === "available" && has("assignment.create") && (
                        <button className="d02-btn d02-ghost d02-sm" onClick={() => openAssign(a.id)}><UserPlus size={14} /></button>
                      )}
                      {a.status === "assigned" && has("transfer.create") && (
                        <button className="d02-btn d02-ghost d02-sm" onClick={() => setShowTransfer({ id: a.id, tag: a.tag })}><ArrowRightLeft size={14} /></button>
                      )}
                      {has("asset.manage") && (
                        <button className="d02-btn d02-ghost d02-sm" onClick={() => setShowReport({ id: a.id, tag: a.tag })}><Flag size={14} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!assets.data?.length && (
                <tr><td colSpan={11}><div className="d02-empty"><Package size={36} /><div>No assets match your filters</div></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AssignForm open={showAssign} onClose={closeAssign} preselectedAssetId={assignAssetId} />
      {showTransfer && <TransferForm open={!!showTransfer} onClose={() => setShowTransfer(null)} assetId={showTransfer.id} assetTag={showTransfer.tag} />}
      {showReport && <ReportForm open={!!showReport} onClose={() => setShowReport(null)} assetId={showReport.id} assetTag={showReport.tag} />}
      <AssetForm open={showAssetForm} onClose={() => setShowAssetForm(false)} />
      <LocationForm open={showLocationForm} onClose={() => setShowLocationForm(false)} />
    </>
  );
}
