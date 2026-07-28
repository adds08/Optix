"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { IMPORT_SPECS, templateRows, type ImportEntity } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { downloadCsv, parseCsv } from "@/lib/csv";
import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/*
  Bulk import for one entity: template → file → preview → commit.

  The preview is the point. Somebody is moving a register they have kept in a
  spreadsheet for years, and the useful answer to a bad file is "row 12 has a
  duplicate tag", not "import failed". Import stays disabled until every row is
  clean, because a half-applied register cannot be told apart from a yard that
  has genuinely lost things.
*/

type Parsed = { rows: Record<string, string>[]; filename: string };

export function ImportButton({ entity }: { entity: ImportEntity }) {
  const [open, setOpen] = useState(false);
  const spec = IMPORT_SPECS[entity];

  return (
    <Can perm={spec.permission}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Upload className="size-4" aria-hidden />
        Import
      </Button>
      {open ? <ImportDialog entity={entity} onClose={() => setOpen(false)} /> : null}
    </Can>
  );
}

function ImportDialog({ entity, onClose }: { entity: ImportEntity; onClose: () => void }) {
  const spec = IMPORT_SPECS[entity];
  const utils = trpc.useUtils();
  const fileInput = useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [parseError, setParseError] = useState("");

  /* A mutation, not a query — see the note on the procedure. A real file is
     far too large to travel in a URL, which is what a tRPC query does. */
  const preview = trpc.import.preview.useMutation();

  /* Preview as soon as a file parses. The effect rather than an onFile call so
     it also re-runs if the entity changes underneath. */
  /* `preview` is intentionally not a dependency: including the mutation object
     would re-fire this on every state change it makes, which is an infinite
     loop. The file and the entity are the only real inputs. */
  useEffect(() => {
    if (parsed?.rows.length) preview.mutate({ entity, rows: parsed.rows });
  }, [parsed, entity]);

  const commit = trpc.import.commit.useMutation({
    onSuccess: () => {
      utils.invalidate();
      onClose();
    },
  });

  function onFile(file: File) {
    setParseError("");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { headers, rows } = parseCsv(String(reader.result ?? ""));
        if (!rows.length) {
          setParseError("That file has a header but no rows.");
          setParsed(null);
          return;
        }
        const missing = spec.columns
          .filter((c) => c.required && !headers.includes(c.header))
          .map((c) => c.header);
        if (missing.length) {
          setParseError(`Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
          setParsed(null);
          return;
        }
        setParsed({ rows, filename: file.name });
      } catch {
        setParseError("That file could not be read as CSV.");
        setParsed(null);
      }
    };
    reader.readAsText(file);
  }

  const summary = preview.data?.summary;
  const rows = preview.data?.rows ?? [];
  const clean = !!summary && summary.bad === 0 && summary.total > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import {spec.label.toLowerCase()}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{spec.description}</p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadCsv(`stinventory-${entity}-template`, templateRows(entity))}
            >
              <Download className="size-4" aria-hidden />
              Download template
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
              <Upload className="size-4" aria-hidden />
              {parsed ? "Choose another file" : "Choose CSV"}
            </Button>
            {parsed ? (
              <span className="text-sm text-muted-foreground">
                {parsed.filename} · {parsed.rows.length} rows
              </span>
            ) : null}
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
                e.target.value = "";
              }}
            />
          </div>

          {!parsed ? <ColumnGuide entity={entity} /> : null}

          {parseError ? <p className="text-sm text-destructive">{parseError}</p> : null}

          {preview.isError ? (
            <p className="text-sm text-destructive">{preview.error.message}</p>
          ) : null}

          {parsed && preview.isPending ? (
            <p className="text-sm text-muted-foreground">Checking rows…</p>
          ) : null}

          {summary ? (
            <div
              className={cn(
                "rounded-md border px-3 py-2 text-sm",
                summary.bad ? "border-destructive/40 text-destructive" : "border-ok/40 text-ok",
              )}
            >
              {summary.bad
                ? `${summary.bad} of ${summary.total} rows need fixing. Nothing will be imported until they are clean.`
                : `All ${summary.total} rows look good.`}
            </div>
          ) : null}

          {rows.length ? (
            <div className="max-h-80 overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left">
                    <th className="px-3 py-2 font-medium">Row</th>
                    {spec.columns.map((c) => (
                      <th key={c.header} className="px-3 py-2 font-medium whitespace-nowrap">
                        {c.header}
                      </th>
                    ))}
                    <th className="px-3 py-2 font-medium">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.index}
                      className={cn("border-b last:border-0", r.errors.length && "bg-destructive/5")}
                    >
                      <td className="px-3 py-2 text-muted-foreground">{r.index + 2}</td>
                      {spec.columns.map((c) => {
                        const bad = r.errors.some((e) => e.column === c.header);
                        return (
                          <td
                            key={c.header}
                            className={cn("px-3 py-2 whitespace-nowrap", bad && "text-destructive")}
                          >
                            {r.values[c.header] || <span className="text-muted-foreground">—</span>}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-destructive">
                        {r.errors.map((e) => `${e.column}: ${e.message}`).join("; ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {commit.isError ? (
            <p className="text-sm text-destructive">{commit.error.message}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!clean || commit.isPending}
            onClick={() => parsed && commit.mutate({ entity, rows: parsed.rows })}
          >
            {commit.isPending ? "Importing…" : `Import ${summary?.total ?? 0} rows`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* Shown before a file is chosen: what the template expects, so nobody has to
   open the CSV to find out which columns are mandatory. */
function ColumnGuide({ entity }: { entity: ImportEntity }) {
  const spec = IMPORT_SPECS[entity];
  return (
    <div className="rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="px-3 py-2 font-medium">Column</th>
            <th className="px-3 py-2 font-medium">Needs</th>
            <th className="px-3 py-2 font-medium">Example</th>
          </tr>
        </thead>
        <tbody>
          {spec.columns.map((c) => (
            <tr key={c.header} className="border-b last:border-0">
              <td className="px-3 py-2 font-mono text-xs">
                {c.header}
                {c.required ? <span className="text-destructive"> *</span> : null}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {c.hint ?? (c.values ? c.values.join(" / ") : c.type)}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{c.example}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
