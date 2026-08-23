export function Input({ value, onChange, placeholder, icon, clearable, size = 'md', style }) {
  const sizes = { sm: { h: 28, fs: 11.5 }, md: { h: 34, fs: 12.5 }, lg: { h: 38, fs: 13 } };
  const s = sizes[size] || sizes.md;
  return React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', gap: 8, height: s.h, padding: '0 11px',
      borderRadius: 'var(--radius-md)', border: '1px solid var(--border-2)', background: 'var(--surface-4)',
      fontFamily: 'var(--font-sans)', ...style }
  },
    icon && React.createElement('span', { style: { color: 'var(--text-muted)', flex: 'none', display: 'flex' } }, icon),
    React.createElement('input', {
      value, onChange, placeholder,
      style: { flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
        color: 'var(--text-primary)', fontSize: s.fs, fontFamily: 'inherit' }
    }),
    clearable && value && React.createElement('span', {
      onClick: () => onChange && onChange({ target: { value: '' } }),
      style: { cursor: 'pointer', color: 'var(--text-muted)', fontSize: 15, lineHeight: 1 }
    }, '×')
  );
}