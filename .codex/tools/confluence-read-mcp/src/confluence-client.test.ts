import assert from "node:assert/strict";
import test from "node:test";
import { normalizePageId } from "./confluence-client.js";

test("normalizes a numeric page ID", () => {
  assert.equal(normalizePageId(" 12345 "), "12345");
});

test("rejects non-numeric page IDs", () => {
  for (const value of ["", "0", "ABC", "12/34"]) assert.throws(() => normalizePageId(value));
});
