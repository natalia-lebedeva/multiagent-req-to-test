import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeIssueKey } from "./jira-client.js";

describe("normalizeIssueKey", () => {
  it("normalizes a valid key", () => {
    assert.equal(normalizeIssueKey(" test-123 "), "TEST-123");
  });

  it("rejects values that could alter the request path", () => {
    assert.throws(() => normalizeIssueKey("TEST-1?fields=*"));
    assert.throws(() => normalizeIssueKey("../TEST-1"));
  });
});
