#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod/v4";
import { logPiiAudit } from "./audit-logger.js";
import { loadConfig } from "./config.js";
import { JiraClient } from "./jira-client.js";
import { maskIssue } from "./pii-masker.js";
import { publicErrorMessage } from "./public-error.js";

serveStdio(() => {
  const server = new McpServer({
    name: "jira-read-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "get_masked_issue",
    {
      title: "Get PII-masked Jira issue",
      description:
        "Reads an allowlisted set of Jira issue fields and applies best-effort pattern-based PII masking. The result is not guaranteed to be anonymized.",
      inputSchema: z.object({
        issueKey: z.string().describe("Jira issue key, for example TEST-123"),
      }),
    },
    async ({ issueKey }) => {
      try {
        const jira = new JiraClient(loadConfig());
        const masked = maskIssue(await jira.getIssue(issueKey));
        logPiiAudit(masked);
        return {
          content: [{ type: "text", text: JSON.stringify(masked, null, 2) }],
        };
      } catch (error) {
        // Do not serialize unknown errors: they may contain request details.
        return {
          isError: true,
          content: [{ type: "text", text: publicErrorMessage(error) }],
        };
      }
    },
  );

  return server;
});
