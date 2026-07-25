"use client";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { useToast } from "@/components/d02/d02-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardCheck, Check } from "lucide-react";

const INTENT_LABELS: Record<string, string> = {
  assign: "Assign", return: "Return", transfer: "Transfer",
  lost: "Lost", repair: "Repair", report: "Report", task: "Task",
};

const DEPT_BADGES: Record<string, string> = {
  "Equipment Yard": "bg-blue-600", Warehouse: "bg-green-600",
  Maintenance: "bg-yellow-600", "Equipment Admin": "bg-red-600",
  Fleet: "bg-purple-600", Procurement: "bg-cyan-600",
};

export default function D02VerificationPage() {
  const { data, isLoading, error } = trpc.messaging.pendingVerification.useQuery();
  const utils = trpc.useUtils();
  const toast = useToast();
  const { has } = usePermissions();

  const handleConfirm = async (msgId: string) => {
    try {
      await utils.client.messaging.confirmAction.mutate({ messageId: msgId });
      utils.messaging.pendingVerification.invalidate();
      toast("ok", "Confirmed");
    } catch { toast("err", "Failed"); }
  };

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (error) return <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-sm">{error.message}</div>;

  const cards = (data ?? []).map((m) => {
    const a = m.proposedAction as Record<string, unknown> | null;
    return { id: m.id, body: m.body, status: m.processingStatus, intentType: m.intentType, department: (a?.department as string) ?? "Equipment Admin", createdAt: m.createdAt };
  });

  const proposed = cards.filter((c) => c.status === "action_proposed");
  const manual = cards.filter((c) => c.status === "pending_manual");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><ClipboardCheck size={16} /> Verification Queue{proposed.length > 0 && <Badge variant="secondary" className="ml-auto">{proposed.length} pending</Badge>}</CardTitle>
        </CardHeader>
        <CardContent>
          {cards.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground"><ClipboardCheck className="mx-auto mb-2 opacity-40" size={40} /><p className="text-sm">Nothing to verify</p></div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-semibold mb-3 border-t-[3px] border-t-primary pt-2 flex items-center justify-between">Pending Verification<Badge variant="outline">{proposed.length}</Badge></h3>
                <div className="space-y-3">
                  {proposed.length === 0 ? <div className="bg-muted rounded-lg p-8 text-center text-sm text-muted-foreground">None pending</div> : proposed.map((c) => <VerificationCard key={c.id} {...c} onConfirm={() => handleConfirm(c.id)} canConfirm={has("assignment.create")} />)}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-3 border-t-[3px] border-t-destructive pt-2 flex items-center justify-between">Needs Manual Entry<Badge variant="outline">{manual.length}</Badge></h3>
                <div className="space-y-3">
                  {manual.length === 0 ? <div className="bg-muted rounded-lg p-8 text-center text-sm text-muted-foreground">None</div> : manual.map((c) => <VerificationCard key={c.id} {...c} />)}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function VerificationCard({ body, intentType, department, createdAt, canConfirm, onConfirm }: {
  id: string; body: string; intentType: string | null; department: string; createdAt: Date; canConfirm?: boolean; onConfirm?: () => void;
}) {
  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          {intentType && <Badge variant="secondary">{INTENT_LABELS[intentType] ?? intentType}</Badge>}
          <span className={`text-[10px] font-semibold text-white px-2.5 py-0.5 rounded-full ${DEPT_BADGES[department] ?? "bg-gray-500"}`}>{department}</span>
        </div>
        <p className="text-sm">{body}</p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{new Date(createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          {canConfirm && onConfirm && <Button size="sm" variant="secondary" onClick={onConfirm}><Check size={13} /> Confirm</Button>}
        </div>
      </CardContent>
    </Card>
  );
}


