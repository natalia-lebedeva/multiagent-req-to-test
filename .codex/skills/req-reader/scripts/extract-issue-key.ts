#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,49}-[1-9]\d*$/;

export function extractIssueKey(input: string): string {
  const value = input.trim();
  if (!value) throw new Error("A Jira URL or issue key is required");

  const directKey = value.toUpperCase();
  if (ISSUE_KEY_PATTERN.test(directKey)) return directKey;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Input must be a Jira Cloud browse URL or issue key");
  }

  if (url.protocol !== "https:" || !url.hostname.endsWith(".atlassian.net")) {
    throw new Error("Only HTTPS Jira Cloud URLs under atlassian.net are supported");
  }

  const match = url.pathname.match(/^\/browse\/([^/]+)\/?$/i);
  const issueKey = match ? decodeURIComponent(match[1]).toUpperCase() : "";
  if (!ISSUE_KEY_PATTERN.test(issueKey)) {
    throw new Error("Jira URL must have the form https://<site>.atlassian.net/browse/KEY-123");
  }
  return issueKey;
}

function main(): void {
  try {
    process.stdout.write(`${extractIssueKey(process.argv[2] ?? "")}\n`);
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : "Invalid input"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
