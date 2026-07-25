"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Can } from "@/components/can";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, Plus } from "lucide-react";
import { EmployeeForm } from "@/components/employee-form";

const money = (n: string | null | undefined) => "$" + Number(n ?? 0).toLocaleString();

export default function D02ForemenPage() {
  const employees = trpc.employee.list.useQuery();
  const me = trpc.identity.me.useQuery();
  const myEmployeeId = me.data?.employeeId ?? null;
  const isSuper = me.data?.role === "superintendent";
  const foremen = employees.data?.filter((e) => e.role === "foreman") ?? [];
  const assets = trpc.asset.list.useQuery();
  const [showForm, setShowForm] = useState(false);

  const isMyForeman = (f: { reportsToEmployeeId: string | null }) =>
    isSuper && !!myEmployeeId && f.reportsToEmployeeId === myEmployeeId;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Foremen</h1>
          <p className="text-muted-foreground">Custodians and their assigned tools.</p>
        </div>
        <Can perm="employee.manage">
          <Button size="sm" onClick={() => setShowForm(true)}><Plus className="h-4 w-4" /> Employee</Button>
        </Can>
      </div>

      {foremen.map((f) => {
        const held = assets.data?.filter((a) => a.custodianId === f.id && a.status !== "available") ?? [];
        const val = held.reduce((s, x) => s + Number(x.acquisitionCost ?? 0), 0);
        return (
          <Card key={f.id} className={isMyForeman(f) ? "border-l-4 border-l-primary" : ""}>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" /> {f.name}
                {f.employmentStatus === "terminated" && <Badge variant="destructive">terminated</Badge>}
              </CardTitle>
              <CardDescription>
                {f.primaryProjectName ?? "No project"} · {held.length} tools · {money(val.toString())} value
                {f.reportsToName ? ` · Reports to ${f.reportsToName}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {held.length ? (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Tag</TableHead><TableHead>Model</TableHead><TableHead>Project</TableHead><TableHead>Status</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {held.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell className="font-medium">{h.tag}</TableCell>
                        <TableCell>{h.modelName}</TableCell>
                        <TableCell>{h.currentProjectName ?? "\u2014"}</TableCell>
                        <TableCell><Badge variant="secondary">{h.status.replace("_", " ")}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-6 text-center text-muted-foreground text-sm">No tools held.</div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <EmployeeForm open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}
