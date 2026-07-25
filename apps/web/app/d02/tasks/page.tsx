"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { useToast } from "@/components/d02/d02-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListChecks, Clock, CheckCircle2, Circle, AlertCircle } from "lucide-react";

const STATUS: Record<string, { label: string; icon: React.ReactNode; variant: "secondary" | "default" | "destructive" | "outline" }> = {
  pending: { label: "Pending", icon: <Clock size={13} />, variant: "secondary" },
  in_progress: { label: "In Progress", icon: <AlertCircle size={13} />, variant: "default" },
  completed: { label: "Completed", icon: <CheckCircle2 size={13} />, variant: "outline" },
  cancelled: { label: "Cancelled", icon: <Circle size={13} />, variant: "outline" },
};

const PRIORITY: Record<string, string> = { urgent: "text-destructive font-bold", high: "text-yellow-600 font-semibold", medium: "text-blue-600", low: "text-muted-foreground" };

export default function D02TasksPage() {
  const { data, isLoading } = trpc.task.list.useQuery({ limit: 100 });
  const utils = trpc.useUtils();
  const toast = useToast();
  const { has } = usePermissions();
  const [filter, setFilter] = useState("all");

  const handleStatus = async (id: string, status: string) => {
    try { await utils.client.task.update.mutate({ id, status: status as "pending" | "in_progress" | "completed" | "cancelled" }); utils.task.list.invalidate(); toast("ok", `Marked ${status.replace("_", " ")}`); } catch { toast("err", "Failed"); }
  };

  if (isLoading) return <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Card key={i}><CardContent className="p-4"><div className="h-6 bg-muted rounded animate-pulse" /></CardContent></Card>)}</div>;

  const rows = data?.items ?? [];
  const filtered = filter === "all" ? rows : rows.filter((t) => t.status === filter);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2"><ListChecks size={16} /> Tasks</CardTitle>
      </CardHeader>
      <div className="flex items-center gap-3 px-6 py-3 border-b flex-wrap">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="text-sm border rounded-md px-3 py-1.5 bg-background">
          <option value="all">All</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <Badge variant="secondary" className="ml-auto">{rows.filter((t) => t.status === "pending").length} pending</Badge>
      </div>
      {filtered.length === 0 ? (
        <CardContent className="py-12 text-center text-muted-foreground"><ListChecks className="mx-auto mb-2 opacity-40" size={40} /><p className="text-sm">No tasks</p></CardContent>
      ) : (
        <Table>
          <TableHeader><TableRow><TableHead>Status</TableHead><TableHead>Title</TableHead><TableHead>Priority</TableHead><TableHead>Created</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {filtered.map((t) => {
              const s = STATUS[t.status] ?? STATUS.pending!;
              return (
                <TableRow key={t.id}>
                  <TableCell><Badge variant={s.variant} className="gap-1">{s.icon}{s.label}</Badge></TableCell>
                  <TableCell><span className="font-medium">{t.title}</span>{t.description && t.description !== t.title && <span className="text-xs text-muted-foreground block mt-0.5 truncate max-w-xs">{t.description}</span>}</TableCell>
                  <TableCell><span className={`text-xs uppercase ${PRIORITY[t.priority] ?? "text-muted-foreground"}`}>{t.priority}</span></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</TableCell>
                  <TableCell>{has("assignment.create") && t.status !== "completed" && t.status !== "cancelled" && (
                    <select value={t.status} onChange={(e) => handleStatus(t.id, e.target.value)} className="text-xs border rounded-md px-2 py-1 bg-background">
                      <option value="pending">Pending</option><option value="in_progress">In Progress</option><option value="completed">Complete</option><option value="cancelled">Cancel</option>
                    </select>
                  )}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
