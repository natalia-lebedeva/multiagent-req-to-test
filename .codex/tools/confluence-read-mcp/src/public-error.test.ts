import assert from "node:assert/strict";
import test from "node:test";
import { publicErrorMessage } from "./public-error.js";

test("exposes allowlisted operational errors", () => {
  assert.equal(publicErrorMessage(new Error("Confluence request failed with HTTP 404")), "Confluence request failed with HTTP 404");
});

test("hides unexpected error details", () => {
  assert.equal(publicErrorMessage(new Error("secret response body")), "Confluence request failed");
});
