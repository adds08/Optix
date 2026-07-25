"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { Can } from "@/components/can";
import { useToast } from "@/components/d02/d02-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClipboardList, Plus, RotateCcw, ArrowRightLeft, AlertOctagon } from "lucide-react";
import { AssignForm } from "@/components/assign-form";
import { TransferForm } from "@/components/transfer-form";

export default function D02AssignmentsPage() {
  const a = trpc.assignment.list.useQuery();
  const utils = trpc.useUtils();
  const { has } = usePermissions();
  const toast = useToast();
  const assignments = a.data ?? [];

  const overdue = assignments.filter((x) => x.overdue);

  const [showAssign, setShowAssign] = useState(false);
  const [showTransfer, setShowTransfer] = useState<{ id: string; tag: string } | null>(null);
  const [returning, setReturning] = useState<string | null>(null);

  const doReturn = async (assignmentId: string) => {
    setReturning(assignmentId);
    try {
      await utils.client.assignment.return.mutate({ id: assignmentId });
      toast("ok", "Tool returned successfully");
      utils.assignment.list.invalidate(); utils.asset.list.invalidate();
      utils.dashboard.kpis.invalidate(); utils.dashboard.recentActivity.invalidate();
    } catch { toast("err", "Return failed"); }
    setReturning(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Assignments</h1>
          <p className="text-muted-foreground">Track custody and tool assignments.</p>
        </div>
        <Can perm="assignment.create">
          <Button size="sm" onClick={() => setShowAssign(true)}><Plus className="h-4 w-4" /> Assign</Button>
        </Can>
      </div>

      {overdue.length > 0 && (
        <Alert variant="destructive">
          <AlertOctagon className="h-4 w-4" />
          <AlertTitle>{overdue.length} overdue loan{overdue.length > 1 ? "s" : ""} — tools that should have been returned</AlertTitle>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><ClipboardList className="h-4 w-4" /> All Assignments</CardTitle>
          <CardDescription>{assignments.length} total</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead><TableHead>Custodian</TableHead><TableHead>Project</TableHead>
                <TableHead>Type</TableHead><TableHead>Since</TableHead><TableHead>Due</TableHead>
                <TableHead>Status</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((x) => (
                <TableRow key={x.id}>
                  <TableCell><span className="font-medium">{x.tag}</span><span className="text-xs text-muted-foreground block">{x.modelName}</span></TableCell>
                  <TableCell>{x.custodianName}</TableCell>
                  <TableCell>{x.projectName ?? "\u2014"}</TableCell>
                  <TableCell><Badge variant={x.type === "temporary" ? "secondary" : "outline"}>{x.type === "temporary" ? "loan" : "permanent"}</Badge></TableCell>
                  <TableCell className="text-sm">{x.startDate}</TableCell>
                  <TableCell className="text-sm">{x.expectedEnd ?? "\u2014"}</TableCell>
                  <TableCell>{x.overdue ? <Badge variant="destructive">overdue</Badge> : <Badge variant="default">{x.status.replace("_", " ")}</Badge>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {x.status === "active" && has("assignment.create") && (
                        <>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => doReturn(x.id)} disabled={returning === x.id}><RotateCcw className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowTransfer({ id: x.assetId, tag: x.tag })}><ArrowRightLeft className="h-4 w-4" /></Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!assignments.length && (
                <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">No assignments yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {showTransfer && <TransferForm open={!!showTransfer} onClose={() => setShowTransfer(null)} assetId={showTransfer.id} assetTag={showTransfer.tag} />}
      <AssignForm open={showAssign} onClose={() => setShowAssign(false)} />
    </div>
  );
}
