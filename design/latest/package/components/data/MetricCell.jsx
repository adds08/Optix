export function MetricCell({ label, value, suffix, warn, style }) {
  return React.createElement('div', {
    style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      padding: '9px 20px', borderRight: '1px solid var(--border-0)', ...style }
  },
    React.createElement('span', {
      style: { fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)' }
    }, label),
    React.createElement('span', { style: { display: 'flex', alignItems: 'baseline', gap: 3 } },
      React.createElement('span', {
        style: { fontSize: 15, fontWeight: 600, color: warn ? 'var(--warn)' : 'var(--text-heading)', letterSpacing: '-0.01em' }
      }, value),
      suffix && React.createElement('span', {
        style: { fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-muted)' }
      }, suffix)
    )
  );
}