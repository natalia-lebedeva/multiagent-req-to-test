import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publicErrorMessage } from "./public-error.js";

describe("publicErrorMessage", () => {
  it("preserves known safe operational errors", () => {
    assert.equal(publicErrorMessage(new Error("Invalid Jira issue key")), "Invalid Jira issue key");
    assert.equal(publicErrorMessage(new Error("Jira request failed with HTTP 404")), "Jira request failed with HTTP 404");
  });

  it("does not expose unknown error details", () => {
    assert.equal(publicErrorMessage(new Error("fetch failed for https://example.test/?token=secret")), "Jira request failed");
    assert.equal(publicErrorMessage("unexpected"), "Jira request failed");
  });
});
