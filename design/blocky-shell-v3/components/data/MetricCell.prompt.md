MetricCell — inline metric for horizontal stats bars in card headers.

```jsx
<div style={{display:'flex', background:'var(--surface-2)', borderTop:'1px solid var(--border-0)'}}>
  <MetricCell label="TOOLS OUT" value="47" />
  <MetricCell label="TRUCKS" value="1" suffix="/ 2" warn />
  <MetricCell label="VALUE" value="$12.4k" style={{borderRight:'none'}} />
</div>
```