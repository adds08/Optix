/** Card with 3px colored left edge — the signature Blocky card pattern.
 * @startingPoint section="Components" subtitle="Card with colored edge accent bar" viewport="700x80"
 */
export interface EdgeCardProps {
  edge?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
export function EdgeCard(props: EdgeCardProps): JSX.Element;