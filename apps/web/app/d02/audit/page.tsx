"use client";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollText } from "lucide-react";

export default function D02AuditPage() {
  const tx = trpc.transaction.list.useQuery({ limit: 100 });
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit Trail</h1>
        <p className="text-muted-foreground">Append-only transaction log — immutable system of record.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><ScrollText className="h-4 w-4" /> Transactions</CardTitle>
          <CardDescription>{tx.data?.length ?? 0} entries</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead><TableHead>Event</TableHead><TableHead>Tag</TableHead>
                <TableHead>Model</TableHead><TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tx.data?.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-sm whitespace-nowrap">{new Date(t.occurredAt).toLocaleString()}</TableCell>
                  <TableCell><Badge variant="secondary">{t.eventType.replace("_", " ")}</Badge></TableCell>
                  <TableCell className="font-medium">{t.tag}</TableCell>
                  <TableCell>{t.modelName}</TableCell>
                  <TableCell className="text-muted-foreground max-w-xs truncate">{t.note}</TableCell>
                </TableRow>
              ))}
              {!tx.data?.length && (
                <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No transactions yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
