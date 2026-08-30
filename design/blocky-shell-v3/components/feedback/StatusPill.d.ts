/** Status pill — larger than Badge, used for status callouts in card headers.
 */
export interface StatusPillProps {
  variant?: 'default' | 'accent' | 'ok' | 'warn' | 'crit';
  dot?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
export function StatusPill(props: StatusPillProps): JSX.Element;