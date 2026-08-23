export function Chip({ children, active, count, dot, dotColor, onClick, style }) {
  const [hov, setHov] = React.useState(false);
  return React.createElement('div', {
    onClick, onMouseEnter: () => setHov(true), onMouseLeave: () => setHov(false),
    style: { display: 'inline-flex', alignItems: 'center', gap: 6, height: 27, padding: '0 10px',
      borderRadius: 'var(--radius-md)', cursor: onClick ? 'pointer' : 'default',
      fontSize: 12.5, fontWeight: active ? 600 : 500, fontFamily: 'var(--font-sans)',
      color: active ? 'var(--text-heading)' : 'var(--text-muted)',
      background: active ? 'var(--surface-8)' : hov ? 'var(--surface-5)' : 'transparent',
      border: '1px solid ' + (active ? 'var(--border-2)' : 'transparent'),
      transition: 'background .12s', userSelect: 'none', whiteSpace: 'nowrap', ...style }
  },
    dot && React.createElement('span', { style: { width: 7, height: 7, borderRadius: 2, flex: 'none', background: dotColor || 'var(--accent)' } }),
    children,
    count != null && React.createElement('span', {
      style: { fontFamily: 'var(--font-mono)', fontSize: 10, padding: '1px 5px', borderRadius: 3,
        background: active ? 'rgba(255,255,255,.12)' : 'var(--surface-7)', color: active ? 'var(--text-primary)' : 'var(--text-muted)' }
    }, count)
  );
}