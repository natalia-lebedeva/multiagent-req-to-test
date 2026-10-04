---
name: test-cases-creator
description: "Creates atomic test cases from requirements and UI context, assigning priority and automation suitability."
---

# Create Test Cases

## Purpose

Create detailed, verifiable test cases. This Skill does not retrieve requirements, research the UI, or publish Jira issues.

## Inputs

- Requirements, `requirements-review.md`, `ui-context.json`, and the path for `test-cases.md`.
- UI Test Plan, if supplied, to check coverage.
- Accepted assumptions or permission to continue partially.

If a required input is missing, ask for clarification. Incomplete UI context does not cancel a case: note unknown details under `Clarifications`.

## Procedure

1. Check that inputs concern the same task; review clarifications, `researchStatus`, and UI coverage.
2. Create one `TC-NNN` for every standalone requirement or business rule. Do not combine independent rules, including success, failure, and cancellation. An initial snapshot is not a test case.
3. Use confirmed clarifications, concrete boundaries, and test values. Number steps and expected results as matching sequences.
4. Refer to confirmed UI components semantically, for example: `Click the “Login” button`, `Enter a value in the “Username” field`. Do not add HTML attributes, CSS selectors, or roles unless they are part of the requirement.
5. Group cases by functional area in order and add a prefix to `Name`, for example `[Login] ...`, `[Forgot Password] ...`, `[Sign Up] ...`. Do not add a new column for the area.
6. Assign Priority and Test Automation. Check coverage, duplicates, alignment with requirements, and `Clarifications`.
7. Save a single table and run the validator. One correction cycle is allowed for structural errors.

## Rules

- Requirements define expected behavior; UI context confirms elements and observations. Do not replace a requirement with a current UI defect or invent elements, messages, or rules.
- Use the names and visible labels of confirmed UI components; do not turn a test case into a description of technical locators.
- If `researchStatus` is `partial` and a linked item has `partial` or `blocked` coverage, note the limitation under `Clarifications`. This alone does not mean `Test Automation: No`.
- `Clarifications` contains only limitations, open questions, and UI source `STATE-NNN`; do not include URLs. Avoid repeating the same limitation in every case unless needed. If none apply, use `Not required`.
- `Yes` means an objective, repeatable scenario with regression value; `No` means a subjective, manual, or unjustifiably costly check. Missing UI data alone does not mean `No`.
- Priority: `Highest`, `High`, `Medium`, `Low`, or `Lowest`, based on risk and defect impact.

## Output

`test-cases.md` contains one table:

```markdown
| ID | Requirement | Name | Preconditions | Steps | Expected Result | Test Automation | Priority | Clarifications |
|---|---|---|---|---|---|---|---|---|
| TC-001 | Requirement ID or exact section | [Login] ... | None required | 1. ...<br>2. ... | 1. ...<br>2. ... | Yes | High | Not required |
```

IDs are sequential from `TC-001`; cells must not be empty. Use `<br>` for line breaks and `&#124;` for `|`.

## Completion Criteria

- Every standalone rule has its own case.
- Cases have matching steps and results, with justified Priority and Test Automation values.
- The validator passes, or remaining errors and their impact are clearly reported.
