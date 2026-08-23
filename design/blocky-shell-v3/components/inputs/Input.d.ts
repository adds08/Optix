/** Text input — dark surface-4 bg, border-2 outline, clearable.
 * @startingPoint section="Components" subtitle="Search and text inputs with clear button" viewport="700x50"
 */
export interface InputProps {
  value?: string;
  onChange?: (e: { target: { value: string } }) => void;
  placeholder?: string;
  icon?: React.ReactNode;
  clearable?: boolean;
  size?: 'sm' | 'md' | 'lg';
  style?: React.CSSProperties;
}
export function Input(props: InputProps): JSX.Element;