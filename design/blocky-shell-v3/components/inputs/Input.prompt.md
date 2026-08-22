Input — text field for search, filters, and form data entry.

```jsx
<Input placeholder="Search job, crew, tool…" icon={<SearchIcon />} clearable value={q} onChange={e => setQ(e.target.value)} />
<Input placeholder="Qty" size="sm" style={{width: 70}} />
```

Always dark background (surface-4), muted placeholder. Use `clearable` for search fields.