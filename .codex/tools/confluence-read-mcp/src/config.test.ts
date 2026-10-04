import assert from "node:assert/strict";
import test from "node:test";
import { normalizeConfluenceBaseUrl } from "./config.js";

test("normalizes a Confluence Cloud origin", () => {
  assert.equal(normalizeConfluenceBaseUrl("https://example.atlassian.net/"), "https://example.atlassian.net");
});

test("rejects unsafe or ambiguous base URLs", () => {
  for (const value of ["http://example.test", "https://user:pass@example.test", "https://example.test/wiki", "https://example.test?q=1"]) {
    assert.throws(() => normalizeConfluenceBaseUrl(value));
  }
});
