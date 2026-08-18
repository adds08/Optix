# Pre-delivery checklist

Run every item. Report the result, not the intention.

## Content

- [ ] Every factual claim has a source in the page: `file:line`, a doc `§`, or "verified live" naming what you ran.
- [ ] Anything you inferred is labelled as inference, not stated as fact.
- [ ] Every `[TBD]` in the source appears as a `TBD` chip in the page. Count them and check the count matches.
- [ ] Mockup-only behaviour is marked as such, separately from specified behaviour.
- [ ] Technology suggestions are labelled proposals, each with its tradeoff and at least one alternative.
- [ ] "Already exists" claims cite a file. Everything else is marked as new work.
- [ ] Every external link is live. Check them:
      `for u in $URLS; do echo "$(curl -s -o /dev/null -w '%{http_code}' -L --max-time 20 "$u")  $u"; done`
      A private GitHub repo returns 404 unauthenticated -- confirm those with
      `gh api repos/<org>/<repo>/contents/<path> --jq .html_url` before calling the link broken.
- [ ] The custody-vs-ownership primer is present and matches the reader's level.
- [ ] Anything the running app contradicts in the docs is called out, not smoothed over.

## Self-containment

```bash
grep -nE '<script[^>]+src=|<link[^>]+href="https?:|@import|https?://[^"]+\.(js|css|woff2?)|fetch\(|XMLHttpRequest' out.html
```

- [ ] No hits, or every hit is inside a code sample being *displayed*, not executed.
- [ ] Only `data:` image URIs -- no `src="http`.
- [ ] Opens with the network disabled and looks identical.

## Rendering

Screenshot both themes and a phone width. Playwright MCP, or
`mad-teams:browser-testing-with-devtools`.

- [ ] Light and dark both legible; no invisible text, no white-on-white chip.
- [ ] Browser console clean -- no errors, no failed requests.
- [ ] 375px wide: no horizontal page scroll. Tables and diagrams scroll inside their own wrapper.
- [ ] Cadence rulers readable at mobile width (they collapse to vertical lists).
- [ ] `Tab` reaches every interactive element with a visible focus ring.
- [ ] Greyscale test: the page still parses without colour.
- [ ] File under ~5 MB.

## Delivery

- [ ] Written to the agreed path (default `scratch/explainers/`), nowhere else.
- [ ] Not committed unless asked. `scratch/` is gitignored -- keep it that way.
- [ ] Tell the user the path and the size, and name what you could *not* verify.
