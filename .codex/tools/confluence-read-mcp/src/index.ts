#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod/v4";
import { logPiiAudit } from "./audit-logger.js";
import { loadConfig } from "./config.js";
import { ConfluenceClient } from "./confluence-client.js";
import { maskPage } from "./confluence-masker.js";
import { publicErrorMessage } from "./public-error.js";

serveStdio(() => {
  const server = new McpServer({ name: "confluence-read-mcp", version: "1.0.0" });
  server.registerTool(
    "get_masked_page",
    {
      title: "Get PII-masked Confluence page",
      description: "Reads a Confluence page and applies best-effort PII masking. The result is not guaranteed to be anonymized.",
      inputSchema: z.object({ pageId: z.string().describe("Numeric Confluence page ID") }),
    },
    async ({ pageId }) => {
      try {
        const confluence = new ConfluenceClient(loadConfig());
        const masked = maskPage(await confluence.getPage(pageId));
        logPiiAudit(masked);
        return { content: [{ type: "text", text: JSON.stringify(masked, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: publicErrorMessage(error) }] };
      }
    },
  );
  return server;
});
