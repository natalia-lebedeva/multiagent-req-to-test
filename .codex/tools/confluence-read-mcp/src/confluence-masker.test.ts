import assert from "node:assert/strict";
import test from "node:test";
import { maskPage } from "./confluence-masker.js";

test("masks common PII and Confluence account IDs", () => {
  const result = maskPage({
    id: "123",
    title: "Contact alice@example.com",
    body: { storage: { value: '<p>alice@example.com</p><ri:user ri:account-id="abc-123" />' } },
    version: { number: 7 },
  });
  assert.equal(result.pageId, "123");
  assert.match(result.title, /\[EMAIL_1\]/);
  assert.match(result.body, /\[EMAIL_1\]/);
  assert.match(result.body, /ri:account-id="\[ACCOUNT_ID_1\]"/);
  assert.equal(result.version, 7);
  assert.deepEqual(result.piiMasking.maskedEntities, { EMAIL: 1, ACCOUNT_ID: 1 });
});

test("returns only the normalized allowlisted shape", () => {
  const result = maskPage({ id: "9", title: "Page", body: { storage: { value: "Text" } } });
  assert.deepEqual(Object.keys(result), ["pageId", "title", "body", "version", "piiMasking"]);
});
