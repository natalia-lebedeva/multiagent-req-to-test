import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JiraIssue } from "./jira-client.js";
import { maskIssue } from "./pii-masker.js";

function issue(summary: string, description: unknown = null): JiraIssue {
  return {
    key: "TEST-1",
    fields: { summary, description, labels: [] },
  };
}

describe("maskIssue", () => {
  it("masks the configured regular-expression PII", () => {
    const result = maskIssue(
      issue(
        "Mail user@example.com, phone +7 (999) 123-45-67, " +
          "password=hello, api_key=abcdefghijklmnop, " +
          "Bearer abcdefghijklmnop, GB82WEST12345698765432, " +
          "card 4111 1111 1111 1111",
      ),
    );

    assert.match(result.summary, /\[EMAIL_1]/);
    assert.match(result.summary, /\[PHONE_1]/);
    assert.match(result.summary, /password=\[PASSWORD_1]/i);
    assert.match(result.summary, /api_key=\[API_SECRET_1]/i);
    assert.match(result.summary, /Bearer \[BEARER_TOKEN_1]/);
    assert.match(result.summary, /\[IBAN_1]/);
    assert.match(result.summary, /\[CARD_NUMBER_1]/);
  });

  it("does not mask a card candidate that fails Luhn validation", () => {
    const result = maskIssue(issue("Reference 4111 1111 1111 1112"));
    assert.match(result.summary, /4111 1111 1111 1112/);
  });

  it("masks reporter, assignee, account IDs and ADF mentions", () => {
    const raw: JiraIssue = {
      key: "TEST-2",
      fields: {
        summary: "Ivan Petrov assigned Anna Sidorova",
        reporter: {
          accountId: "jira-account-reporter",
          displayName: "Ivan Petrov",
          emailAddress: "ivan@example.com",
        },
        assignee: {
          accountId: "jira-account-assignee",
          displayName: "Anna Sidorova",
          emailAddress: "anna@example.com",
        },
        description: {
          type: "doc",
          content: [
            {
              type: "mention",
              attrs: { id: "third-account", text: "Maria" },
            },
            {
              type: "text",
              text: "Contact ivan@example.com (jira-account-reporter)",
            },
          ],
        },
        labels: [],
      },
    };

    const result = maskIssue(raw);
    const serialized = JSON.stringify(result);

    assert.equal(result.reporter, "[REPORTER_1]");
    assert.equal(result.assignee, "[ASSIGNEE_1]");
    for (const secret of [
      "Ivan Petrov",
      "Anna Sidorova",
      "ivan@example.com",
      "anna@example.com",
      "jira-account-reporter",
      "jira-account-assignee",
      "third-account",
      "Maria",
    ]) {
      assert.doesNotMatch(serialized, new RegExp(secret, "i"));
    }
    assert.match(serialized, /\[ACCOUNT_ID_/);
    assert.match(serialized, /\[USER_/);
  });

  it("uses stable tokens for repeated values", () => {
    const result = maskIssue(
      issue("user@example.com and again user@example.com"),
    );
    assert.equal(
      result.summary,
      "[EMAIL_1] and again [EMAIL_1]",
    );
    assert.equal(result.piiMasking.maskedEntities.EMAIL, 1);
    assert.equal(result.piiMasking.mode, "best_effort");
    assert.match(result.piiMasking.limitation, /not guaranteed to be anonymized/);
  });

  it("discloses that unknown free-form identifiers can remain", () => {
    const result = maskIssue(issue("Approval requested by Project Falcon Owner"));
    assert.match(result.summary, /Project Falcon Owner/);
    assert.equal(result.piiMasking.mode, "best_effort");
    assert.match(result.piiMasking.limitation, /may miss sensitive data/);
  });

  it("returns the complete ADF description as readable text and ignores localId", () => {
    const result = maskIssue(
      issue("Login", {
        type: "doc",
        version: 1,
        content: [
          {
            type: "heading",
            attrs: { level: 2, localId: "123456789012" },
            content: [{ type: "text", text: "Requirements" }],
          },
          {
            type: "orderedList",
            attrs: { order: 1, localId: "987654321098" },
            content: [
              {
                type: "listItem",
                attrs: { localId: "111222333444" },
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Email is required." }],
                  },
                  {
                    type: "bulletList",
                    content: [
                      {
                        type: "listItem",
                        content: [
                          {
                            type: "paragraph",
                            content: [
                              { type: "text", text: "Trim surrounding spaces." },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Password is required." }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    assert.match(result.description, /Requirements/);
    assert.match(result.description, /1\. Email is required\./);
    assert.match(result.description, /- Trim surrounding spaces\./);
    assert.match(result.description, /2\. Password is required\./);
    assert.equal(result.piiMasking.maskedEntities.PHONE, undefined);
    assert.doesNotMatch(result.description, /123456789012|987654321098/);
  });
});
