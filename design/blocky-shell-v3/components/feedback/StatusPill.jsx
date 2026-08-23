export function StatusPill({ children, variant = 'default', dot, style }) {
  const vars = {
    default: { color: 'var(--text-secondary)', bg: 'var(--surface-5)', border: 'var(--border-2)' },
    accent: { color: 'var(--accent)', bg: 'var(--accent-bg)', border: 'var(--accent)' },
    ok: { color: 'var(--ok)', bg: 'var(--ok-bg)', border: 'var(--ok-border)' },
    warn: { color: 'var(--warn)', bg: 'var(--warn-bg)', border: 'var(--warn-border)' },
    crit: { color: 'var(--crit)', bg: 'var(--crit-bg)', border: 'var(--crit-border)' }
  };
  const v = vars[variant] || vars.default;
  return React.createElement('span', {
    style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px',
      borderRadius: 'var(--radius-md)', fontSize: 11, fontWeight: 650, fontFamily: 'var(--font-sans)',
      color: v.color, background: v.bg, border: '1px solid ' + v.border, whiteSpace: 'nowrap', ...style }
  },
    dot && React.createElement('span', { style: { width: 7, height: 7, borderRadius: 2, flex: 'none', background: v.color } }),
    children
  );
}