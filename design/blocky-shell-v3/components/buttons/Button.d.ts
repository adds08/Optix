/**
 * Primary action button — blocky 3px radius, Inter Tight 650 weight.
 * @startingPoint section="Components" subtitle="Primary, secondary, ghost, danger variants" viewport="700x60"
 */
export interface ButtonProps {
  /** Visual variant */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'warn';
  /** Size preset */
  size?: 'sm' | 'md' | 'lg';
  /** Disabled state */
  disabled?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Override styles */
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
export function Button(props: ButtonProps): JSX.Element;