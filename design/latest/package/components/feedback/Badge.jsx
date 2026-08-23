export function Badge({ children, variant = 'default', style }) {
  const vars = {
    default: { bg: 'var(--surface-7)', color: 'var(--text-muted)', border: 'var(--border-3)' },
    accent: { bg: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'var(--accent)' },
    ok: { bg: 'var(--ok-bg)', color: 'var(--ok)', border: 'var(--ok-border)' },
    warn: { bg: 'var(--warn-bg)', color: 'var(--warn)', border: 'var(--warn-border)' },
    crit: { bg: 'var(--crit-bg)', color: 'var(--crit)', border: 'var(--crit-border)' }
  };
  const v = vars[variant] || vars.default;
  return React.createElement('span', {
    style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)',
      fontSize: 10.5, fontWeight: 600, borderRadius: 'var(--radius-sm)', padding: '2px 7px',
      color: v.color, background: v.bg, border: '1px solid ' + v.border, whiteSpace: 'nowrap', ...style }
  }, children);
}