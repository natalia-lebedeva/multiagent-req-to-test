---
name: jira-test-cases-publisher
description: "Publishes approved test cases to Jira Cloud and prevents duplicate creation using TC-NNN and Summary."
---

# Publish Test Cases to Jira

## Purpose

Create one Jira issue for each approved test case.

## Inputs

- Approved `test-cases.md`.
- Jira project, issue type `Task`, and required project fields. If `Task` is unavailable, ask the user to choose another type.
- Output directory for `jira-task-preview.md` and `external-test-cases-map.json`; for continuation, the existing map.
- Approval for the preview, and `jira_get`/`jira_post` tools.

## Procedure

1. Check the project, permissions, issue type, and test cases. Create a map with status `pending`; when continuing, use the existing map. If the project, type, or cases have changed, stop and ask for confirmation.
2. Before any `jira_post`, create `jira-task-preview.md` and show its contents to the user. Use one table with one row per `TC-NNN` and these columns: `TC-NNN`, `Summary`, `Type`, `Project`, `Parent issue`, `Priority`, `Test Automation`, `Label`, `Description`, `Duplicate`. After showing it, wait for one explicit approval of the entire file; do not write before approval.
3. Fetch the existing project issues once and compare them to the cases by Summary `[TC-NNN] <Name>`:
   - exact match — `existing`;
   - same `TC-NNN` with a different Summary, or a clearly similar Summary — possible duplicate: show it to the user and stop that case;
   - otherwise, create the issue.
4. Before each POST, save `unknown` in the map. A response with a key/ID means `created`; a confirmed failure means `failed`; an unclear response means `unknown`. Save the map after each change.
5. After `failed`, check for duplicates and retry the POST no more than twice. After `unknown`, search specifically for `TC-NNN` and Summary; an empty result does not permit another POST—request a manual check.
6. Validate the map with the existing validator and report keys, statuses, and limitations.

## Rules

- Summary: `[TC-NNN] <Name>`.
- Before POST, match Priority by its exact name to an available Jira priority and pass its ID in `fields.priority`. Allowed names: `Highest`, `High`, `Medium`, `Low`, `Lowest`. If a name cannot be found, stop.
- Before POST, pass one label in `fields.labels`: `automation-yes` for `Test Automation = Yes`, or `automation-no` for `Test Automation = No`.
- Send Description as Atlassian Document Format (ADF), not plain Markdown or flattened text. Format section titles in bold; send `Steps` and `Expected Result` as separate numbered lists, with one `listItem` per point.
- For each `TC-NNN`, copy the exact `Requirement`, `Preconditions`, `Steps`, `Expected Result`, and `Clarifications` values from its `test-cases.md` row into ADF. Do not shorten the content or replace it with generic instructions. Do not include `Test Automation` or `Priority` in Description.
- Placeholder phrases such as `Use the approved ... from test-cases.md`, `Execute the approved ...`, or `Observe the approved ...` are forbidden. If actual steps or results were not copied, stop publication and fix the preview.

  ```text
  **Preconditions**
  ...

  **Steps**
  1. ...
  2. ...

  **Expected Result**
  1. ...
  2. ...

  **Clarifications**
  ...
  ```

  Minimal Jira ADF example:

  ```json
  {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [
          { "type": "text", "text": "Requirements", "marks": [{ "type": "strong" }] }
        ]
      },
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Requirement title" }]
      },
      {
        "type": "paragraph",
        "content": [
          { "type": "text", "text": "Preconditions", "marks": [{ "type": "strong" }] }
        ]
      },
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "The Login page is open" }]
      },
      {
        "type": "paragraph",
        "content": [
          { "type": "text", "text": "Steps", "marks": [{ "type": "strong" }] }
        ]
      },
      {
        "type": "orderedList",
        "content": [
          { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Find the page heading." }] }] },
          { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Check its text." }] }] }
        ]
      },
      {
        "type": "paragraph",
        "content": [
          { "type": "text", "text": "Expected Result", "marks": [{ "type": "strong" }] }
        ]
      },
      {
        "type": "orderedList",
        "content": [
          { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "The heading is displayed." }] }] }
        ]
      }
    ]
  }
  ```

- Do not include `Test Automation` or `Priority` in Description. `Test Automation` is sent as a label, and `Priority` as Jira's system field; both remain required in the preview and Jira issue.
- GET may be retried up to three times after a temporary error. Do not run update/delete operations or include secrets in Jira.

## Output

Create and show `jira-task-preview.md` before the first write. After one approval of the full file, save `external-test-cases-map.json` with `publicationId`, project, type, `testCaseId`, `sourceRow`, status, and confirmed Jira key/ID or a safe reason for failure. `sourceRow` is used only to check that a case has not changed before continuation.

## Completion Criteria

- `jira-task-preview.md` was created, shown, and approved once before POST.
- Each case has status `created`, `existing`, `failed`, or `unknown` with a clear reason.
- The map passed validation; an unknown POST was not retried automatically.
