import {
  Bolt,
  Cable,
  Cog,
  Construction,
  Drill,
  Forklift,
  Hammer,
  HardHat,
  Paintbrush,
  Ruler,
  Wrench,
} from "lucide-react";

/*
  One icon per tool category, so a jobsite full of rotary hammers reads at a
  glance instead of as a wall of text. Keywords are matched against the
  category name with the first hit winning; anything unrecognised falls back
  to a wrench, which is never wrong for a tool.
*/

const CATEGORY_ICONS: [RegExp, React.ComponentType<{ className?: string }>][] = [
  [/drill|rotary|impact/, Drill],
  [/saw|cut|blade|grind/, Cog],
  [/hammer|demo|breaker|nail|stapler/, Hammer],
  [/wrench|plumb|pipe|thread|fitting|socket/, Wrench],
  [/ladder|staging|scaffold|platform/, Construction],
  [/level|laser|measur|survey|ruler|tape/, Ruler],
  [/paint|brush|roller|taping/, Paintbrush],
  [/electri|light|generator|power|battery|charg/, Bolt],
  [/cable|hose|cord|compressor|air/, Cable],
  [/lift|fork|jack|hoist|crane/, Forklift],
  [/safety|harness|shield|ppe/, HardHat],
];

export function toolCategoryIcon(category: string | null | undefined) {
  const text = (category ?? "").toLowerCase();
  for (const [re, Icon] of CATEGORY_ICONS) {
    if (re.test(text)) return Icon;
  }
  return Wrench;
}

export function ToolIcon({
  category,
  className,
}: {
  category?: string | null;
  className?: string;
}) {
  const Icon = toolCategoryIcon(category);
  return <Icon className={className} aria-hidden />;
}
