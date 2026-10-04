import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MaskingSession } from "./index.js";

describe("MaskingSession", () => {
  it("masks shared sensitive-data patterns", () => {
    const session = new MaskingSession();
    const result = session.maskText(
      "Mail user@example.com, phone +7 (999) 123-45-67, password=secret",
    );

    assert.match(result, /\[EMAIL_1\]/);
    assert.match(result, /\[PHONE_1\]/);
    assert.match(result, /password=\[PASSWORD_1\]/);
    assert.deepEqual(session.summary(), { EMAIL: 1, PASSWORD: 1, PHONE: 1 });
  });

  it("reuses a token for the same value", () => {
    const session = new MaskingSession();
    assert.equal(
      session.maskText("user@example.com and USER@example.com"),
      "[EMAIL_1] and [EMAIL_1]",
    );
    assert.equal(session.summary().EMAIL, 1);
  });

  it("does not mask an invalid card candidate", () => {
    const session = new MaskingSession();
    assert.equal(
      session.maskText("Reference 4111 1111 1111 1112"),
      "Reference 4111 1111 1111 1112",
    );
  });

  it("returns the common best-effort metadata contract", () => {
    const session = new MaskingSession();
    session.maskText("user@example.com");
    const metadata = session.metadata();

    assert.equal(metadata.mode, "best_effort");
    assert.equal(metadata.maskedEntities.EMAIL, 1);
    assert.match(metadata.limitation, /not guaranteed to be anonymized/);
  });
});
