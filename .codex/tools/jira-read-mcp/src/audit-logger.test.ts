import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JiraIssue } from "./jira-client.js";
import { maskIssue } from "./pii-masker.js";
import { formatPiiAuditLog, logPiiAudit } from "./audit-logger.js";

describe("formatPiiAuditLog", () => {
  it("reports only counts and replacement tokens", () => {
    const message = formatPiiAuditLog("TEST-1", {
      EMAIL: 2,
      PHONE: 1,
    });

    assert.equal(
      message,
      "PII masking audit for TEST-1: 3 configured pattern or known-user matches replaced with " +
        "[EMAIL_1], [EMAIL_2], [PHONE_1]",
    );
    assert.doesNotMatch(message, /user@example\.com|\+7/);
  });

  it("reports when no configured pattern or known user field matches", () => {
    assert.equal(
      formatPiiAuditLog("TEST-2", {}),
      "PII masking audit for TEST-2: no configured patterns or known user fields matched",
    );
  });

  it("logs every supported PII category from a Jira description without raw values", () => {
    const rawValues = [
      "reporter-account-id",
      "Ivan Petrov",
      "reporter@example.com",
      "assignee-account-id",
      "Anna Sidorova",
      "assignee@example.com",
      "mentioned-account-id",
      "Maria Smirnova",
      "external@example.com",
      "+7 (999) 123-45-67",
      "super-secret-password",
      "abcdefghijklmnop",
      "qrstuvwxyzABCDEF",
      "GB82WEST12345698765432",
      "4111 1111 1111 1111",
    ];

    const issue: JiraIssue = {
      key: "TEST-99",
      fields: {
        summary: "Issue created by Ivan Petrov for Anna Sidorova",
        reporter: {
          accountId: rawValues[0],
          displayName: rawValues[1],
          emailAddress: rawValues[2],
        },
        assignee: {
          accountId: rawValues[3],
          displayName: rawValues[4],
          emailAddress: rawValues[5],
        },
        description: {
          type: "doc",
          content: [
            {
              type: "mention",
              attrs: { id: rawValues[6], text: rawValues[7] },
            },
            {
              type: "text",
              text:
                "email external@example.com; phone +7 (999) 123-45-67; " +
                "password=super-secret-password; api_key=abcdefghijklmnop; " +
                "Bearer qrstuvwxyzABCDEF; IBAN GB82WEST12345698765432; " +
                "card 4111 1111 1111 1111",
            },
          ],
        },
        labels: [],
      },
    };

    const masked = maskIssue(issue);
    let stderrMessage = "";
    const originalConsoleError = console.error;
    console.error = (message?: unknown) => {
      stderrMessage += String(message);
    };

    try {
      logPiiAudit(masked);
    } finally {
      console.error = originalConsoleError;
    }

    for (const category of [
      "EMAIL",
      "PHONE",
      "PASSWORD",
      "API_SECRET",
      "BEARER_TOKEN",
      "IBAN",
      "CARD_NUMBER",
      "REPORTER",
      "ASSIGNEE",
      "USER",
      "ACCOUNT_ID",
    ]) {
      assert.match(stderrMessage, new RegExp(`\\[${category}_\\d+\\]`));
    }

    for (const rawValue of rawValues) {
      assert.equal(
        stderrMessage.includes(rawValue),
        false,
        `audit log leaked raw value: ${rawValue}`,
      );
    }

    assert.match(stderrMessage, /PII masking audit for TEST-99:/);
    assert.match(stderrMessage, /configured pattern or known-user matches replaced with/);
  });
});
