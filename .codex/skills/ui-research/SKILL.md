---
name: ui-research
description: "Researches the UI against an approved plan using the official Playwright MCP and creates UI context."
---

# UI Research

## Purpose

Run the approved UI Test Plan in the test environment and save confirmed UI context.

## Inputs

- Approved `ui-test-plan.md`, a clean HTTPS URL, Playwright MCP, and working directory.
- Explicit permission to create and delete synthetic data, if the plan requires those actions.

## Procedure

1. Check the MCP, URL, and Chromium. Keep the browser and profile inside the working directory.
2. Launch a visible browser and save the initial snapshot. If authentication is needed, keep the window open and wait for the user to sign in.
3. Run only items marked `Research`; call `save-ui-observation.ts` for each actual Playwright MCP response.
4. After research, create `ui-research-coverage.json` for every plan item and call `build-ui-context.ts`. The script validates coverage and creates `ui-context.json`; it does not assign statuses for the agent.
5. For approved data-changing actions, use the `qa-agent-<run-id>` prefix, delete created entities, and report any that could not be removed.
6. Show the results and wait for the user's explicit approval. Only then mark UI research complete and call Playwright MCP `browser_close`; keep the browser open until approval.

## Coverage

```json
{
  "schemaVersion": 1,
  "status": "complete | partial | blocked",
  "planItems": [{ "planItemId": "UI-PLAN-001", "status": "observed | partial | blocked | not_researched", "reason": "...", "evidenceSequences": [1] }]
}
```

- `observed` — the item was fully researched; include evidence. The absence of an expected element can also be an observation if confirmed by a snapshot.
- `partial` — only some of the needed information was obtained; include a reason and evidence.
- `blocked` — research was stopped by an external condition; include a reason. Evidence is optional.
- `not_researched` — only for a `Do not research` item; include a reason and no evidence.

`complete` means all `Research` items are `observed`. `partial` means the initial snapshot and some context were obtained, but at least one item is `partial` or `blocked`. `blocked` means the initial snapshot was not obtained, so `ui-context.json` is not created.

## Coverage Summary

After research, estimate UI coverage as: requirements linked to at least one `observed` UI item / requirements included in the research × 100. Show the numerator and denominator and report `partial` and `blocked` separately. Exclude `Do not research` items from the denominator. If coverage is incomplete, suggest allowing synthetic data, providing authentication or permissions, or repeating selected plan items.

## Script Calls

After each Playwright MCP response, temporarily save its JSON and call:

```text
node --experimental-strip-types scripts/save-ui-observation.ts \
  --input <temporary-response.json> \
  --output-dir <run-dir>/ui-observations \
  --sequence <n> --slug <short-name> \
  --plan-items <UI-PLAN-NNN[,UI-PLAN-NNN]> --source <browser_*>
```

The script reads the MCP response, checks metadata, and creates `<run-dir>/ui-observations/<NNN>-<slug>.json`. The first call must use `sequence = 1`, `source = browser_snapshot`, and the initial snapshot. The temporary response JSON is not a workflow artifact and must be deleted after the observation is saved. Do not create separate Markdown snapshot files (`ui-*-snapshot.md`) or leave `response-*.json` files in the output directory.

After creating coverage, call:

```text
node --experimental-strip-types scripts/build-ui-context.ts \
  --input-dir <run-dir>/ui-observations \
  --output <run-dir>/ui-context.json \
  --base-url <URL> --test-plan <run-dir>/ui-test-plan.md \
  --coverage <run-dir>/ui-research-coverage.json
```

The script reads observations, plan, and coverage; checks `UI-PLAN-NNN` and `evidenceSequences` links; and creates `ui-context.json` only for `complete` or `partial` runs.

## Rules

- The user enters passwords and MFA codes. Do not read or save secrets, cookies, or storage state.
- Without permission, perform safe observations only. MCP `approval_mode` does not replace this permission.
- `observed` means “observed,” not “working correctly.”
- Write text artifacts in English; do not translate UI labels, URLs, or identifiers.
- Request manual authentication only before researching an item that checks successful sign-in or functionality available after sign-in. Keep the browser open until the user signs in. If no such item exists, do not request authentication and report `Not required`.

## Output

`ui-observations/`, `ui-research-coverage.json`, and, for `complete` or `partial`, `ui-context.json`, plus status and limitations.

## Completion Criteria

- The initial snapshot is saved first for `complete` and `partial` runs; every plan item is classified.
- The browser and profile are inside the working directory.
- `browser_close` is called only after the user approves the results.
- On error, confirmed results are preserved and the reason is reported.
- No raw snapshots or temporary response files remain in the output directory.
