export function Button({ variant = 'primary', size = 'md', disabled = false, children, onClick, style }) {
  const vars = {
    primary: { bg: 'var(--accent)', color: 'var(--surface-0)', border: 'none', hoverBg: 'var(--accent-bright)' },
    secondary: { bg: 'var(--surface-4)', color: 'var(--text-secondary)', border: '1px solid var(--border-2)', hoverBg: 'var(--surface-5)' },
    ghost: { bg: 'transparent', color: 'var(--text-muted)', border: '1px solid transparent', hoverBg: 'var(--surface-5)' },
    danger: { bg: 'var(--crit-bg)', color: 'var(--crit)', border: '1px solid var(--crit-border)', hoverBg: 'var(--crit)' },
    warn: { bg: 'var(--warn-bg)', color: 'var(--warn)', border: '1px solid var(--warn-border)', hoverBg: 'var(--warn)' }
  };
  const sizes = { sm: { h: 28, px: 10, fs: 11.5 }, md: { h: 34, px: 12, fs: 12.5 }, lg: { h: 40, px: 16, fs: 13 } };
  const v = vars[variant] || vars.primary;
  const s = sizes[size] || sizes.md;
  const [hov, setHov] = React.useState(false);
  return React.createElement('div', {
    onClick: disabled ? undefined : onClick,
    onMouseEnter: () => setHov(true), onMouseLeave: () => setHov(false),
    style: {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      height: s.h, padding: '0 ' + s.px + 'px', borderRadius: 'var(--radius-sm)',
      background: disabled ? 'var(--surface-4)' : hov ? v.hoverBg : v.bg,
      color: disabled ? 'var(--text-muted)' : hov && (variant === 'danger' || variant === 'warn') ? 'var(--surface-0)' : v.color,
      border: disabled ? '1px solid var(--border-1)' : v.border,
      fontSize: s.fs, fontWeight: 650, fontFamily: 'var(--font-sans)',
      cursor: disabled ? 'default' : 'pointer', userSelect: 'none',
      transition: 'background .15s, color .15s', ...style
    }
  }, children);
}