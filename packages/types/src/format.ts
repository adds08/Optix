/* One place that decides how the four columns read as a single line, so a
   register row, a chat card, a report and an overdue email cannot disagree
   about what a tool is called. */
export function formatAssetModel(a: {
  make?: string | null;
  modelNumber?: string | null;
  description?: string | null;
}): string {
  return [a.make, a.modelNumber, a.description].filter(Boolean).join(" ");
}
