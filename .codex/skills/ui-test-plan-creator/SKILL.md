---
name: ui-test-plan-creator
description: "Creates a UI research plan from requirements and their review without using a browser."
---

# Create a UI Research Plan

## Purpose

Create a requirements-linked test plan. The application URL and access are not needed at this stage.

## Inputs

- Requirements, `requirements-review.md`, accepted assumptions, and the output directory for `ui-test-plan.md`.

If material questions are still open, clarify the affected scope or explicitly agree to continue partially.

## Procedure

1. Identify requirements, rules, and limitations.
2. Add an initial snapshot and a check or justified exclusion for each requirement.
3. For each check, state the requirement, goal, safe action, and expected observation.
4. Add positive, negative, and boundary scenarios when supported by the requirements.
5. Check coverage, unique IDs, and exclusions; save the plan.

## Rules

- Do not open a browser, invent UI, or add requirements.
- Do not include an actual URL, credentials, or secrets.
- For unavailable or unapproved checks, use `Do not research` and explain why in `Safe Action`.
- When continuing partially, include the open question and `Not specified: open question` as the expected observation.

## Output

`ui-test-plan.md` contains:

```markdown
# UI Research Plan

Base URL: Will be provided before UI research

| ID | Requirement | Page or URL | Goal | Safe Action | Expected Observation | Status |
|---|---|---|---|---|---|---|
| UI-PLAN-001 | — | Base URL (provided before research) | Initial snapshot | Initial snapshot | Capture the initial page | Research |
```

IDs are sequential from `UI-PLAN-001`; the first item is technical. Other `Requirement` cells contain an ID or exact section from the source requirement. Status: `Research` or `Do not research`.

## Completion Criteria

- Every requirement is covered or has a justified exclusion.
- The plan contains no secrets, actual URLs, or claims about UI that was not observed.
