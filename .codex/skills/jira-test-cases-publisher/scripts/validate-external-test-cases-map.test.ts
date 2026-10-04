import test from "node:test";
import assert from "node:assert/strict";
import { validateExternalMap } from "./validate-external-test-cases-map.ts";

const publicationId = "12345678-1234-4234-8234-123456789abc";
function fixture(status = "pending") {
  const entry: Record<string, unknown> = {
    testCaseId: "TC-001",
    sourceRow: "| TC-001 | R-1 | Test | None | 1. Act | 1. Result | Yes | High | Not required |", status,
  };
  if (["created", "existing"].includes(status)) Object.assign(entry, { jiraKey: "QA-123", jiraId: "10001" });
  if (["failed", "unknown", "conflict"].includes(status)) entry.reason = "Safe explanation";
  return { schemaVersion: 2, publicationId, project: { key: "QA", url: "https://example.atlassian.net/projects/QA" }, issueType: "Task", entries: [entry],
    summary: Object.fromEntries(["requested", "pending", "created", "existing", "failed", "unknown", "conflict"].map(key => [key, key === "requested" || key === status ? 1 : 0])),
  };
}

test("accepts pre-request map and all publication outcomes", () => {
  for (const status of ["pending", "created", "existing", "failed", "unknown", "conflict"]) assert.deepEqual(validateExternalMap(fixture(status)), []);
});
test("rejects old schema and unexpected label", () => {
  const map = fixture(); map.schemaVersion = 1;
  assert.ok(validateExternalMap(map).length);
  map.schemaVersion = 2; map.entries[0].label = "unexpected-label";
  assert.ok(validateExternalMap(map).some(e => e.includes("label")));
});
test("unknown outcome cannot masquerade as confirmed identity", () => {
  const map = fixture("unknown"); map.entries[0].jiraKey = "QA-123";
  assert.ok(validateExternalMap(map).some(e => e.includes("unconfirmed")));
  delete map.entries[0].jiraKey; delete map.entries[0].reason;
  assert.ok(validateExternalMap(map).some(e => e.includes("reason")));
});
test("rejects reused case ID and Jira identity", () => {
  const map = fixture("created"); map.entries.push({ ...map.entries[0] });
  assert.ok(validateExternalMap(map).some(e => e.includes("duplicate testCaseId")));
  assert.ok(validateExternalMap(map).some(e => e.includes("duplicates a Jira identity")));
});
test("rejects case row renumbering and wrong project key", () => {
  const map = fixture("existing"); map.entries[0].sourceRow = String(map.entries[0].sourceRow).replace("TC-001", "TC-002");
  map.entries[0].jiraKey = "OTHER-123";
  assert.ok(validateExternalMap(map).some(e => e.includes("sourceRow")));
  assert.ok(validateExternalMap(map).some(e => e.includes("project-matching")));
});
test("partial results preserve exact totals", () => {
  const map = fixture("created");
  map.entries.push({ ...fixture("unknown").entries[0], testCaseId: "TC-002", sourceRow: String(map.entries[0].sourceRow).replace("TC-001", "TC-002") });
  map.summary.requested = 2; map.summary.unknown = 1;
  assert.deepEqual(validateExternalMap(map), []);
  map.summary.created = 2;
  assert.ok(validateExternalMap(map).some(e => e.includes("summary")));
});
test("rejects credentials in URL and invalid UUID", () => {
  const map = fixture(); map.project.url = "https://user:password@example.test/"; map.publicationId = "not-a-uuid";
  assert.ok(validateExternalMap(map).some(e => e.includes("HTTPS")));
  assert.ok(validateExternalMap(map).some(e => e.includes("UUID")));
});
test("malformed inputs report errors rather than passing", () => {
  for (const value of [null, [], {}, { ...fixture(), entries: [] }, { ...fixture(), entries: [null] }]) assert.ok(validateExternalMap(value).length);
});

