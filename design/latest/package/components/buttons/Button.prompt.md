Button — the primary interactive element. Use for actions, confirms, form submits.

```jsx
<Button variant="primary" onClick={handleSave}>Save</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="ghost" size="sm">More</Button>
<Button variant="danger">Delete</Button>
<Button variant="warn">⚠ Needs vehicle</Button>
<Button disabled>Disabled</Button>
```

Variants: primary (accent fill), secondary (surface-4 + border), ghost (no bg), danger (crit tones), warn (amber tones).
Sizes: sm (28px), md (34px), lg (40px).