/** Metric cell — label/value pair for inline metrics bars.
 */
export interface MetricCellProps {
  label: string;
  value: string;
  suffix?: string;
  warn?: boolean;
  style?: React.CSSProperties;
}
export function MetricCell(props: MetricCellProps): JSX.Element;