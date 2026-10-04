# UI Research Flow

```text
Approved ui-test-plan.md + URL
        ↓
Check Playwright MCP, Chromium, and working directory
        ↓
Launch a visible browser
        ↓
Capture the initial browser_snapshot
        ↓
Research only items with Status = Research
        ↓
Playwright MCP responses
        ↓
Temporary response JSON
        ↓
scripts/save-ui-observation.ts
        ↓
ui-observations/001-*.json
ui-observations/002-*.json
...
        ↓
Delete temporary response JSON
        ↓
Create ui-research-coverage.json
        ↓
scripts/build-ui-context.ts
        ↓
ui-context.json
        ↓
User reviews the results
        ↓
After approval — browser_close
        ↓
test-cases-creator uses ui-context.json
```

## Main Artifacts

- `ui-test-plan.md` — what to research;
- `ui-observations/` — actual browser observations;
- `ui-research-coverage.json` — status of each plan item;
- `ui-context.json` — final structured UI context for test-case creation.

## Coverage Statuses

- `observed` — the item was fully observed;
- `partial` — only some of the data was obtained;
- `blocked` — research was stopped by an external limitation;
- `not_researched` — the plan excluded the item from research.

## Overall Research Status

- `complete` — all items marked `Research` were observed;
- `partial` — the initial snapshot and some context were obtained, but some items are `partial` or `blocked`;
- `blocked` — the initial snapshot was not obtained; no `ui-context.json` is created.
