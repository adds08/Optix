"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, Sparkles, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { IMPORT_SPECS, templateRows, type ImportEntity } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { downloadCsv, parseCsvRows, rowsToObjects } from "@/lib/csv";
import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

/*
  Two ways in, one built and one not.

  CSV/Excel is the whole flow below — template, preview, commit — and stays a
  single click away since it is what every register uses today. AI Import is
  named here, disabled, and badged "Coming soon" rather than left unmentioned:
  the feature-flag work that will eventually turn it on (`import.ai`, an
  `upcoming` tenant feature) needs a real place in the UI to switch on, not a
  button invented after the fact.
*/
/* The feature key AI Import is wired to. Not entity-specific — one tenant
   decision covers the whole capability, whichever register it is offered
   from. See feature.states in packages/api-contracts/src/routers/feature.ts. */
const AI_IMPORT_FEATURE_KEY = "import.ai";

export function ImportButton({ entity }: { entity: ImportEntity }) {
  const [open, setOpen] = useState(false);
  const spec = IMPORT_SPECS[entity];
  const featureStates = trpc.feature.states.useQuery();
  const aiState = featureStates.data?.[AI_IMPORT_FEATURE_KEY] ?? "upcoming";

  if (aiState === "hidden") {
    return (
      <Can perm={spec.permission}>
        {/* default (34px) — matches the search field and toolbar controls beside it. */}
        <Button size="default" variant="outline" onClick={() => setOpen(true)}>
          <Upload className="size-3.5" aria-hidden />
          Import
        </Button>
        {open ? <ImportDialog entity={entity} onClose={() => setOpen(false)} /> : null}
      </Can>
    );
  }

  return (
    <Can perm={spec.permission}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="default" variant="outline">
            <Upload className="size-3.5" aria-hidden />
            Import
            <ChevronDown className="size-3 opacity-60" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpen(true)}>
            <Upload className="size-4 opacity-70" aria-hidden />
            Import from CSV
          </DropdownMenuItem>
          {/* Disabled regardless of state — there is no AI import pipeline
              built yet. The state only changes what the row SAYS, so the
              day one exists, flipping this to "enabled" is real: the badge
              and the disabled attribute below are both driven by it, not
              hard-coded, which is the whole point of wiring it to a tenant
              feature key now rather than later. */}
          <DropdownMenuItem disabled className="flex items-center gap-2 opacity-60">
            <Sparkles className="size-4 opacity-70" aria-hidden />
            <span className="flex-1">AI Import</span>
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {aiState === "beta" ? "Beta" : "Coming soon"}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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

  /*
    The yard keeps its records in Excel, and asking somebody to "save as CSV
    first" is the kind of instruction that quietly kills adoption. `.xlsx` and
    `.xls` are read with SheetJS and fed through the same header-normalising
    path the CSV reader uses, so the spec never learns what format the file was.

    `header: 1` returns positional rows (matching the CSV path exactly);
    `raw: false` makes dates come back as the displayed strings rather than
    Excel serial numbers; `defval: ""` keeps blank cells as empty strings.
  */
  async function onFile(file: File) {
    setParseError("");
    try {
      const isSheet = /\.(xlsx|xls)$/i.test(file.name);
      const matrix = isSheet
        ? await sheetToMatrix(file)
        : parseCsvRows(await file.text());

      /* Header detection needs the spec's headers to recognise a header row
         below a title block — the trailer sheets lead with the trailer number,
         the foreman's name and the project before any column headers. */
      const known = new Set(spec.columns.map((c) => c.header));
      const { headers, rawHeaders, rows } = rowsToObjects(matrix, known);
      if (!rows.length) {
        setParseError("That file has a header but no rows.");
        setParsed(null);
        return;
      }
      /* Matched against the normalised headers, so "SERIAL #" satisfies
         "serial". The message quotes the file's own header line back, because
         the useful question when this fails is "what did it see", and the
         spec names alone left the user comparing a list to a column they
         could plainly see in their spreadsheet. */
      const missing = spec.columns
        .filter((c) => c.required && !headers.includes(c.header))
        .map((c) => c.header);
      if (missing.length) {
        setParseError(
          `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. ` +
            `The file's columns are: ${rawHeaders.join(", ")}.`,
        );
        setParsed(null);
        return;
      }
      setParsed({ rows, filename: file.name });
    } catch {
      setParseError("That file could not be read.");
      setParsed(null);
    }
  }

  const summary = preview.data?.summary;
  const rows = preview.data?.rows ?? [];
  const clean = !!summary && summary.bad === 0 && summary.total > 0;

  /* Rows with neither a tag nor a serial cannot be deduplicated at all —
     re-importing the same sheet will create duplicates of those rows. Say so
     before commit rather than after. */
  const noIdentity =
    entity === "asset" && preview.data
      ? preview.data.rows.filter((r) => !r.values.tag && !r.values.serial)
      : [];

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
              {parsed ? "Choose another file" : "Choose file"}
            </Button>
            {parsed ? (
              <span className="text-sm text-muted-foreground">
                {parsed.filename} · {parsed.rows.length} rows
              </span>
            ) : null}
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv,.xlsx,.xls"
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

          {noIdentity.length ? (
            <div className="rounded-md border border-warn/40 bg-warn-bg px-3 py-2 text-sm text-warn">
              {noIdentity.length} row{noIdentity.length === 1 ? "" : "s"} {noIdentity.length === 1 ? "has" : "have"}{" "}
              neither a tag nor a serial number, so it cannot be recognised on a re-import — running
              this file again would create a duplicate of {noIdentity.length === 1 ? "it" : "each one"}.
            </div>
          ) : null}

          {rows.length ? (
            <div className="sti-table-scroll max-h-80 overflow-auto rounded-md border">
              <table className="sti-grid w-full text-sm">
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

/* The first worksheet of a workbook, as a string[][] matching the CSV path. */
async function sheetToMatrix(file: File): Promise<string[][]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const first = wb.SheetNames[0];
  const sheet = first ? wb.Sheets[first] : undefined;
  if (!sheet) throw new Error("That workbook has no sheets.");
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  return rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "")) : []));
}

/* Shown before a file is chosen: what the template expects, so nobody has to
   open the CSV to find out which columns are mandatory. */
function ColumnGuide({ entity }: { entity: ImportEntity }) {  const spec = IMPORT_SPECS[entity];
  return (
    <div className="rounded-md border">
      <table className="sti-grid w-full text-sm">
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
