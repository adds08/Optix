"use client";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SearchSelect } from "@/components/ui/search-select";

/*
  Re-file a selection: category and department, in one write (STI-104).

  The sibling of BulkMoveForm, and deliberately NOT the same dialog. Moving
  tools is a custody change — it writes the ledger, it can park for approval,
  and it is the thing this whole product exists to get right. Re-filing is
  book-keeping: which shelf the tool is listed under, and which budget pays
  for it. Putting them behind one button would invite the desk to do the
  dangerous one while meaning the harmless one.

  Only two fields, for the reason the router gives: tag, serial and cost
  identify ONE tool, so writing the same value across a selection is never
  what anybody meant.

  Leaving a field untouched leaves it alone — this is a patch, not a form that
  overwrites everything it renders. That is why both controls start empty and
  why "no change" is a real, selectable state rather than the absence of one.
*/

const NO_CHANGE = "";
/* Distinct from NO_CHANGE: "charge these to a project instead", which is a
   real edit that clears the department. */
const CLEAR_DEPT = "__clear__";

type Props = {
  open: boolean;
  onClose: () => void;
  assetIds: string[];
  onApplied?: () => void;
};

export function BulkEditForm({ open, onClose, assetIds, onApplied }: Props) {
  const utils = trpc.useUtils();
  const categories = trpc.category.list.useQuery(undefined, { enabled: open });
  const departments = trpc.department.list.useQuery(undefined, { enabled: open });

  const [categoryName, setCategoryName] = useState(NO_CHANGE);
  const [departmentId, setDepartmentId] = useState(NO_CHANGE);
  const [error, setError] = useState<string | null>(null);

  /* Reopening must not inherit the last edit — a dialog that remembers a
     department is one stray Apply away from re-coding a different selection. */
  useEffect(() => {
    if (open) {
      setCategoryName(NO_CHANGE);
      setDepartmentId(NO_CHANGE);
      setError(null);
    }
  }, [open]);

  const bulkUpdate = trpc.asset.bulkUpdate.useMutation();

  const nothingPicked = categoryName === NO_CHANGE && departmentId === NO_CHANGE;

  const apply = async () => {
    setError(null);
    try {
      await bulkUpdate.mutateAsync({
        ids: assetIds,
        ...(categoryName !== NO_CHANGE ? { categoryName } : {}),
        ...(departmentId !== NO_CHANGE
          ? { owningDepartmentId: departmentId === CLEAR_DEPT ? null : departmentId }
          : {}),
      });
      utils.asset.list.invalidate();
      utils.category.list.invalidate();
      onApplied?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Those tools could not be updated. Try again.");
    }
  };

  const categoryOptions = (categories.data ?? []).map((c) => ({
    value: c.name,
    label: c.name,
    hint: `${c.assetCount} tool${c.assetCount === 1 ? "" : "s"}`,
  }));

  const departmentOptions = [
    { value: CLEAR_DEPT, label: "No department — charge to the project" },
    ...(departments.data ?? []).map((d) => ({
      value: d.id,
      label: d.name,
      hint: d.code ?? undefined,
    })),
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Re-file {assetIds.length} tool{assetIds.length === 1 ? "" : "s"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Leave a field alone and it stays as it is. This changes how these tools are listed and
            charged — it does not move them or change who is holding them.
          </p>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Category</label>
            <SearchSelect
              value={categoryName}
              onChange={setCategoryName}
              placeholder="Leave unchanged"
              options={categoryOptions}
              widthClass="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Charged to</label>
            <SearchSelect
              value={departmentId}
              onChange={setDepartmentId}
              placeholder="Leave unchanged"
              options={departmentOptions}
              widthClass="w-full"
            />
            {departmentId !== NO_CHANGE && departmentId !== CLEAR_DEPT ? (
              <p className="text-xs text-muted-foreground">
                These tools will be charged to the department, and any owning job is cleared — a
                tool cannot be charged to both.
              </p>
            ) : null}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={bulkUpdate.isPending}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={nothingPicked || bulkUpdate.isPending}>
            {bulkUpdate.isPending ? "Applying…" : `Apply to ${assetIds.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
