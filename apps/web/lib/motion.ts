/*
  The house motion scale.

  One file so a curve is a decision made once rather than a magic array typed
  into whichever component needed it. The palette comment in globals.css sets
  the brief — "this is a yard tool, not a consumer app" — and motion follows
  it: nothing overshoots, nothing bounces, and no transition outlasts the time
  it takes to look from one side of the shell to the other.

  Durations are SECONDS, because that is what `motion` takes. CSS-side values
  live in globals.css as `--dur-*` / `--ease-*` and must agree with these.
*/

/* Cubic-bezier control points, in `motion`'s tuple form. */
export const EASE = {
  /*
    Decelerate. For anything ARRIVING — a panel sliding in, a splash lifting.
    Quintic out: it commits immediately, then settles for a long time, which is
    what makes an entrance read as confident rather than slow.
  */
  out: [0.22, 1, 0.36, 1],
  /*
    Accelerate. For anything LEAVING. Deliberately shorter than `out` wherever
    it is used: a dismissal that lingers reads as the app not having heard you.
  */
  in: [0.55, 0, 1, 0.45],
  /* Symmetric, for something that moves across the screen and stays there. */
  inOut: [0.65, 0, 0.35, 1],
} as const;

export const DUR = {
  /* Hover, press, colour. Below ~0.12s a transition stops being perceived as
     motion and starts being perceived as a repaint. */
  fast: 0.16,
  /* The default for a small element appearing in place. */
  base: 0.22,
  /* A route's content fading up under the top bar. Short on purpose — this one
     is in front of every single navigation, so it is the transition most able
     to make the whole product feel sluggish. */
  route: 0.2,
  /* The assistant panel: 400px of travel needs longer than an in-place fade or
     it looks teleported. */
  panel: 0.34,
  /* The boot splash lifting off the shell. */
  splash: 0.4,
} as const;

/*
  The assistant panel's transition.

  A spring rather than a duration because the panel is DRAGGABLE-feeling
  furniture the eye tracks across 400px, and a spring's velocity curve is what
  makes that travel read as weight. Damped hard (no visible overshoot): the
  panel butts against the shell's edge, and a bounce there would look like it
  had missed.
*/
export const PANEL_SPRING = {
  type: "spring",
  stiffness: 340,
  damping: 38,
  mass: 0.9,
} as const;
