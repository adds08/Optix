import { ArrowRight } from "lucide-react";

/*
  The briefing bar — one paragraph of "here is what happened while you were
  away", with the hazard edge marking it as something that wants reading.

  Deliberately not a card grid: the value is that it reads as prose, in the
  operator's own words, above the numbers. Keep it to one or two sentences —
  if it needs three, the dashboard below is failing to say it.
*/

export function AiBriefing({
  text,
  onOpenChat,
}: {
  text: string;
  onOpenChat?: () => void;
}) {
  return (
    <section
      aria-labelledby="briefing-kicker"
      className="sti-hazard-edge rounded-md border bg-card px-3.5 py-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="briefing-kicker" className="label-xs text-muted-foreground">
          AI Briefing · today
        </h2>
        {onOpenChat ? (
          <button
            type="button"
            onClick={onOpenChat}
            className="inline-flex shrink-0 items-center gap-1 text-xs text-primary transition-colors hover:underline"
          >
            Open chat
            <ArrowRight className="size-3" aria-hidden />
          </button>
        ) : null}
      </div>
      <p className="mt-1.5 text-pretty text-xs leading-relaxed text-muted-foreground">
        {text}
      </p>
    </section>
  );
}
