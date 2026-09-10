"use client";

import { useCallback, useRef, useState } from "react";

/*
  The house pattern for a destructive action with no dialog: the button reads
  its normal label, one click swaps it to "Really <do it>?", and only a SECOND
  click on that armed state actually fires. `RowActions`
  (`components/sti/row-actions.tsx`) has done this in place for the register's
  menu since it was built; this hook is the same two-click shape pulled out so
  every OTHER destructive button — a group delete, a role delete, a saved
  filter, an icon-only remove — gets it too, rather than firing on the first
  click the way six of them did.

  Auto-disarms after a few seconds so a button armed and then ignored does not
  sit primed for a stray click days later, and disarms immediately on blur so
  tabbing away cannot leave it waiting either.
*/
export function useArmedConfirm(onConfirm: () => void, timeoutMs = 4000) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const disarm = useCallback(() => {
    clear();
    setArmed(false);
  }, [clear]);

  const handleClick = useCallback(() => {
    if (armed) {
      disarm();
      onConfirm();
      return;
    }
    setArmed(true);
    clear();
    timer.current = setTimeout(disarm, timeoutMs);
  }, [armed, disarm, clear, onConfirm, timeoutMs]);

  return { armed, handleClick, disarm };
}
