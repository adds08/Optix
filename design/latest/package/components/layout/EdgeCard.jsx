export function EdgeCard({ edge = 'var(--accent)', children, style }) {
  return React.createElement('div', {
    style: { display: 'flex', background: 'var(--surface-3)', border: '1px solid var(--border-1)',
      borderRadius: 'var(--radius-md)', overflow: 'hidden', ...style }
  },
    React.createElement('div', { style: { width: 3, flex: 'none', background: edge } }),
    React.createElement('div', { style: { flex: 1, minWidth: 0 } }, children)
  );
}