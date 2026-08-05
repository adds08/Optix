"use client";

/*
  The unified action bar pinned to the bottom of the screen.

  Page titles are gone from the content area — the sidebar already says where
  you are — and every primary action (Export, Import, New, Edit) lives here
  instead, so the data gets the full height of the window. The bar is fixed,
  transparent-backed and blurred, so it never pushes content or blocks a row.

  Pages that use it should render it last inside their root element. The app
  shell adds bottom padding to <main> so nothing hides behind it.
*/

export function BottomToolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1400px] items-center gap-2 px-4 py-2 lg:px-8">
        <div className="ml-auto flex items-center gap-2">{children}</div>
      </div>
    </div>
  );
}
