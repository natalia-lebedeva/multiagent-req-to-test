import type { JiraConfig } from "./config.js";

const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,49}-[1-9]\d*$/;
const ALLOWED_FIELDS = [
  "summary",
  "description",
  "reporter",
  "assignee",
  "labels",
] as const;

export interface JiraUser {
  accountId?: string;
  displayName?: string;
  emailAddress?: string;
}

export interface JiraIssue {
  key: string;
  fields: {
    summary?: string | null;
    description?: unknown;
    reporter?: JiraUser | null;
    assignee?: JiraUser | null;
    labels?: string[] | null;
  };
}

export function normalizeIssueKey(value: string): string {
  const issueKey = value.trim().toUpperCase();
  if (!ISSUE_KEY.test(issueKey)) {
    throw new Error("Invalid Jira issue key");
  }
  return issueKey;
}

export class JiraClient {
  public constructor(private readonly config: JiraConfig) {}

  public async getIssue(rawIssueKey: string): Promise<JiraIssue> {
    const issueKey = normalizeIssueKey(rawIssueKey);
    const url = new URL(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
      this.config.baseUrl,
    );
    url.searchParams.set("fields", ALLOWED_FIELDS.join(","));

    const authorization = Buffer.from(
      `${this.config.email}:${this.config.apiToken}`,
    ).toString("base64");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${authorization}`,
      },
    });

    if (!response.ok) {
      // Never include Jira's response body: it can contain raw issue data.
      throw new Error(`Jira request failed with HTTP ${response.status}`);
    }

    return (await response.json()) as JiraIssue;
  }
}
