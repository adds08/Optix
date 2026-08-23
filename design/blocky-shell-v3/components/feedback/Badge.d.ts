/** Inline badge / tag — mono font, compact. Use for job codes, counts, status labels.
 * @startingPoint section="Components" subtitle="Default, accent, ok, warn, crit variants" viewport="700x50"
 */
export interface BadgeProps {
  variant?: 'default' | 'accent' | 'ok' | 'warn' | 'crit';
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
export function Badge(props: BadgeProps): JSX.Element;