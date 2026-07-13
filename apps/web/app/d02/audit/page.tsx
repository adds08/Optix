"use client";
import { trpc } from "@/lib/trpc";
import { ScrollText, FileText } from "lucide-react";

export default function D02AuditPage() {
  const tx = trpc.transaction.list.useQuery({ limit: 100 });
  return (
    <div className="d02-card">
      <h2><ScrollText size={16} className="d02-card-header-icon" /> Transaction Log — append-only system of record</h2>
      <div className="d02-body d02-scroll">
        <table className="d02-table"><thead><tr><th>When</th><th>Event</th><th>Tag</th><th>Model</th><th>Note</th></tr></thead>
          <tbody>
            {tx.data?.map((t) => (
              <tr key={t.id}>
                <td style={{ whiteSpace: "nowrap" }}>{new Date(t.occurredAt).toLocaleString()}</td>
                <td><span className="d02-chip">{t.eventType.replace("_", " ")}</span></td>
                <td><b>{t.tag}</b></td>
                <td>{t.modelName}</td>
                <td className="d02-muted" style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }}>{t.note}</td>
              </tr>
            ))}
            {!tx.data?.length && <tr><td colSpan={5}><div className="d02-empty"><FileText size={36} /><div>No transactions recorded yet</div></div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
