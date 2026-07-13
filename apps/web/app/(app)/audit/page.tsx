"use client";
import { trpc } from "@/lib/trpc";
export default function AuditPage() {
  const tx = trpc.transaction.list.useQuery({ limit: 100 });
  return (
      <div className="card"><h2>Transaction Log — append-only system of record</h2><div className="body scroll">
        <table><thead><tr><th>When</th><th>Event</th><th>Tag</th><th>Model</th><th>Note</th></tr></thead>
          <tbody>
            {tx.data?.map((t) => (
              <tr key={t.id}>
                <td>{new Date(t.occurredAt).toLocaleString()}</td>
                <td><span className="chip">{t.eventType.replace("_", " ")}</span></td>
                <td>{t.tag}</td><td>{t.modelName}</td><td className="muted">{t.note}</td>
              </tr>
            ))}
            {!tx.data?.length && <tr><td colSpan={5} className="muted" style={{ padding: 14 }}>No transactions</td></tr>}
          </tbody>
        </table>
      </div></div>
  );
}
