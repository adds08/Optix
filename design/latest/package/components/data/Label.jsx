export function Label({ children, style }) {
  return React.createElement('span', {
    style: { fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 500,
      letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)', ...style }
  }, children);
}