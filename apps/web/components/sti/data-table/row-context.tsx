"use client";

import { createContext, useContext } from "react";

/*
  What a row knows about the table it is sitting in.

  `RowActions` is built by each page — it is the page that knows what "delete"
  means for a person versus a project — but freezing a row is a property of the
  TABLE, not of the thing in it. Rather than thread a row id and a pin callback
  through every register that renders a `RowActions`, `DataTable` publishes it
  here and `RowActions` picks it up.

  Absent by default, and that is the interface: the hand-rolled tables
  (`jobsite-tool-table`) render `RowActions` too, have no pinning of their own,
  and simply get no Table group in the menu rather than a dead control.
*/
export type RowTableOptions = {
  pinned: boolean;
  togglePinned: () => void;
};

const RowTableContext = createContext<RowTableOptions | null>(null);

export const RowTableProvider = RowTableContext.Provider;

export function useRowTableOptions() {
  return useContext(RowTableContext);
}
