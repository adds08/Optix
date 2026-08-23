/** Filter chip / tab — toggleable, with optional dot and count badge.
 * @startingPoint section="Components" subtitle="Filter chips with dot indicator and count" viewport="700x50"
 */
export interface ChipProps {
  active?: boolean;
  count?: string | number;
  dot?: boolean;
  dotColor?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
export function Chip(props: ChipProps): JSX.Element;