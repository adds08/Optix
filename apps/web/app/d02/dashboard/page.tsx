"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { Can } from "@/components/can";
import { useToast } from "@/components/d02/d02-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Wrench, CheckCircle2, AlertTriangle, Bookmark, SearchX, DollarSign,
  AlertOctagon, Clock, Activity, ThumbsUp, Plus, Check, ArrowUpRight,
} from "lucide-react";
import { ProjectForm } from "@/components/project-form";

const money = (n: string | null | undefined) => "$" + Number(n ?? 0).toLocaleString();

export default function D02DashboardPage() {
  const k = trpc.dashboard.kpis.useQuery();
  const overdue = trpc.dashboard.overdueLoans.useQuery();
  const activity = trpc.dashboard.recentActivity.useQuery();
  const clearance = trpc.dashboard.clearanceQueue.useQuery();
  const pending = trpc.dashboard.pendingApprovals.useQuery();
  const utils = trpc.useUtils();
  const { has } = usePermissions();
  const toast = useToast();
  const [showProjectForm, setShowProjectForm] = useState(false);

  if (!k.data) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}><CardContent className="p-5 space-y-3"><Skeleton className="h-8 w-8 rounded-lg" /><Skeleton className="h-6 w-16" /><Skeleton className="h-4 w-12" /></CardContent></Card>
        ))}
      </div>
    );
  }

  const doApprove = async (type: string, id: string) => {
    try {
      if (type === "assignment") await utils.client.assignment.approve.mutate({ id });
      else await utils.client.transfer.approve.mutate({ id });
      pending.refetch();
      utils.assignment.list.invalidate(); utils.transfer.list.invalidate();
      utils.asset.list.invalidate(); utils.dashboard.kpis.invalidate();
      utils.dashboard.recentActivity.invalidate();
      toast("ok", "Approved");
    } catch { toast("err", "Approval failed"); }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">Equipment and tool management overview.</p>
        </div>
        <Can perm="project.manage">
          <Button onClick={() => setShowProjectForm(true)} size="sm"><Plus className="h-4 w-4" /> New Project</Button>
        </Can>
      </div>

      {((overdue.data?.length ?? 0) > 0 || (clearance.data?.length ?? 0) > 0 || k.data.lost > 0) && (
        <div className="flex flex-col gap-2">
          {overdue.data?.length ? (
            <Alert variant="destructive">
              <AlertOctagon className="h-4 w-4" />
              <AlertTitle>{overdue.data.length} overdue loan{overdue.data.length > 1 ? "s" : ""}</AlertTitle>
              <AlertDescription>
                <a href="/d02/assignments" className="font-semibold inline-flex items-center gap-1 hover:underline">Review <ArrowUpRight className="h-3 w-3" /></a>
              </AlertDescription>
            </Alert>
          ) : null}
          {clearance.data?.length ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{clearance.data.length} asset{clearance.data.length > 1 ? "s" : ""} pending HR clearance</AlertTitle>
            </Alert>
          ) : null}
          {k.data.lost > 0 ? (
            <Alert variant="destructive">
              <SearchX className="h-4 w-4" />
              <AlertTitle>{k.data.lost} lost asset{k.data.lost > 1 ? "s" : ""}</AlertTitle>
              <AlertDescription>
                <a href="/d02/assets" className="font-semibold inline-flex items-center gap-1 hover:underline">Audit <ArrowUpRight className="h-3 w-3" /></a>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Use</CardTitle>
            <Wrench className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tabular-nums">{k.data.assigned}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Available</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tabular-nums">{k.data.available}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Repair</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tabular-nums">{k.data.inMaintenance}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Reserved</CardTitle>
            <Bookmark className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tabular-nums">{k.data.reserved}</div>
          </CardContent>
        </Card>
        {k.data.lost > 0 ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Lost</CardTitle>
              <SearchX className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono tabular-nums">{k.data.lost}</div>
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Fleet Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tabular-nums">{money(k.data.fleetValue)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {pending.data?.length && has("assignment.approve") ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><ThumbsUp className="h-4 w-4" /> Pending Approvals</CardTitle>
              <CardDescription>Review and approve assignments and transfers.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Tool</TableHead><TableHead>Custodian</TableHead><TableHead>Type</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {pending.data.map((p) => (
                    <TableRow key={`${p.type}-${p.id}`}>
                      <TableCell><span className="font-medium">{p.assetTag}</span><span className="text-xs text-muted-foreground block">{p.assetModel}</span></TableCell>
                      <TableCell>{p.custodianName}</TableCell>
                      <TableCell><Badge variant="outline">{p.type}</Badge></TableCell>
                      <TableCell><Button size="sm" variant="outline" onClick={() => doApprove(p.type, p.id)}><Check className="h-4 w-4" /> Approve</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" /> Overdue Loans</CardTitle>
            <CardDescription>Temporary loans past their expected return date.</CardDescription>
          </CardHeader>
          <CardContent>
            {overdue.data?.length ? (
              <Table>
                <TableHeader><TableRow><TableHead>Tool</TableHead><TableHead>Custodian</TableHead><TableHead>Due</TableHead><TableHead>Overdue</TableHead></TableRow></TableHeader>
                <TableBody>
                  {overdue.data.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell><span className="font-medium">{o.tag}</span><span className="text-xs text-muted-foreground block">{o.modelName}</span></TableCell>
                      <TableCell>{o.custodianName}</TableCell>
                      <TableCell className="text-sm">{o.expectedEnd}</TableCell>
                      <TableCell><Badge variant="destructive">{o.daysOverdue}d</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="py-8 text-center text-muted-foreground text-sm">
                <CheckCircle2 className="mx-auto mb-2 h-8 w-8 opacity-40" />
                <p>All clear — no overdue loans</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" /> Recent Activity</CardTitle>
            <CardDescription>Latest transactions and asset movements.</CardDescription>
          </CardHeader>
          <CardContent>
            {activity.data?.length ? (
              <div className="space-y-0 divide-y">
                {activity.data.map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="capitalize text-xs">{t.eventType.replace("_", " ")}</Badge>
                        <span className="font-medium text-sm">{t.assetTag}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{t.note}</p>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(t.occurredAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground text-sm">
                <Activity className="mx-auto mb-2 h-8 w-8 opacity-40" />
                <p>No recent activity</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ProjectForm open={showProjectForm} onClose={() => setShowProjectForm(false)} />
    </div>
  );
}
