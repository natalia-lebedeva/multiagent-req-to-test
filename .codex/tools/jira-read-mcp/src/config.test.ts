import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeJiraBaseUrl } from "./config.js";

describe("normalizeJiraBaseUrl", () => {
  it("normalizes an HTTPS origin", () => {
    assert.equal(normalizeJiraBaseUrl(" https://example.atlassian.net/ "), "https://example.atlassian.net");
  });

  it("rejects unsafe or ambiguous base URLs", () => {
    assert.throws(() => normalizeJiraBaseUrl("http://example.atlassian.net"));
    assert.throws(() => normalizeJiraBaseUrl("https://user:secret@example.atlassian.net"));
    assert.throws(() => normalizeJiraBaseUrl("https://example.atlassian.net/jira"));
    assert.throws(() => normalizeJiraBaseUrl("https://example.atlassian.net?token=secret"));
    assert.throws(() => normalizeJiraBaseUrl("https://example.atlassian.net#fragment"));
  });
});
