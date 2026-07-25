"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { Can } from "@/components/can";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Package, Search, Plus, UserPlus, ArrowRightLeft, Flag } from "lucide-react";
import { AssignForm } from "@/components/assign-form";
import { TransferForm } from "@/components/transfer-form";
import { ReportForm } from "@/components/report-form";
import { AssetForm } from "@/components/asset-form";
import { LocationForm } from "@/components/location-form";

const money = (n: string | null | undefined) => "$" + Number(n ?? 0).toLocaleString();

export default function D02AssetsPage() {
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

  const openAssign = (assetId?: string) => { setAssignAssetId(assetId); setShowAssign(true); };
  const closeAssign = () => { setShowAssign(false); setAssignAssetId(undefined); };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Asset Register</h1>
        <p className="text-muted-foreground">Manage and track all equipment and tools.</p>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm">
          <option value="all">All</option>
          <option value="available">Available</option>
          <option value="assigned">Assigned</option>
          <option value="in_maintenance">In Maintenance</option>
          <option value="reserved">Reserved</option>
          <option value="lost">Lost</option>
        </select>
        <Can perm="assignment.create">
          <Button size="sm" variant="outline" onClick={() => openAssign()}><Plus className="h-4 w-4" /> Assign</Button>
        </Can>
        <Can perm="asset.manage">
          <Button size="sm" onClick={() => setShowAssetForm(true)}><Plus className="h-4 w-4" /> Asset</Button>
        </Can>
      </div>

      <Card>
        <CardHeader className="px-6 py-4">
          <CardTitle className="text-base flex items-center gap-2"><Package className="h-4 w-4" /> All Assets</CardTitle>
          <CardDescription>{assets.data?.length ?? 0} assets</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tag</TableHead><TableHead>Model</TableHead><TableHead>Category</TableHead>
                <TableHead>Status</TableHead><TableHead>Custodian</TableHead><TableHead>Project</TableHead>
                <TableHead>Location</TableHead><TableHead>Cond.</TableHead><TableHead className="text-right">Cost</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.data?.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.tag}</TableCell>
                  <TableCell>{a.modelName}</TableCell>
                  <TableCell><Badge variant="outline">{a.categoryName}</Badge></TableCell>
                  <TableCell><Badge variant={a.status === "lost" ? "destructive" : a.status === "assigned" ? "default" : "secondary"}>{a.status.replace("_", " ")}</Badge></TableCell>
                  <TableCell>{a.custodianName ?? "\u2014"}</TableCell>
                  <TableCell>{a.currentProjectName ?? "\u2014"}</TableCell>
                  <TableCell>{a.locationName ?? "\u2014"}</TableCell>
                  <TableCell>{a.condition}</TableCell>
                  <TableCell className="text-right">{money(a.acquisitionCost)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {a.status === "available" && has("assignment.create") && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openAssign(a.id)}><UserPlus className="h-4 w-4" /></Button>
                      )}
                      {a.status === "assigned" && has("transfer.create") && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowTransfer({ id: a.id, tag: a.tag })}><ArrowRightLeft className="h-4 w-4" /></Button>
                      )}
                      {has("asset.manage") && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowReport({ id: a.id, tag: a.tag })}><Flag className="h-4 w-4" /></Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!assets.data?.length && (
                <TableRow><TableCell colSpan={10} className="h-24 text-center text-muted-foreground">No assets found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AssignForm open={showAssign} onClose={closeAssign} preselectedAssetId={assignAssetId} />
      {showTransfer && <TransferForm open={!!showTransfer} onClose={() => setShowTransfer(null)} assetId={showTransfer.id} assetTag={showTransfer.tag} />}
      {showReport && <ReportForm open={!!showReport} onClose={() => setShowReport(null)} assetId={showReport.id} assetTag={showReport.tag} />}
      <AssetForm open={showAssetForm} onClose={() => setShowAssetForm(false)} />
      <LocationForm open={showLocationForm} onClose={() => setShowLocationForm(false)} />
    </div>
  );
}
