#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function validateExternalMap(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["Map must be an object"];
  const map = value as Record<string, unknown>;
  if (map.schemaVersion !== 2) errors.push("schemaVersion must be 2; older maps require reconciliation");
  if (typeof map.publicationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(map.publicationId)) errors.push("publicationId must be a lowercase UUID v4");
  const project = map.project as Record<string, unknown> | undefined;
  if (!project || typeof project.key !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(project.key)) errors.push("project.key is invalid");
  try {
    const url = new URL(String(project?.url ?? ""));
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
  } catch { errors.push("project.url must be a clean HTTPS URL"); }
  if (typeof map.issueType !== "string" || !map.issueType) errors.push("issueType is required");
  const statuses = ["pending", "created", "existing", "failed", "unknown", "conflict"];
  const counts: Record<string, number> = Object.fromEntries(statuses.map((status) => [status, 0]));
  if (!Array.isArray(map.entries) || !map.entries.length) errors.push("entries must be a nonempty array");
  else {
    const ids = new Set<string>();
    const keys = new Set<string>();
    const jiraIds = new Set<string>();
    for (const [index, raw] of map.entries.entries()) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) { errors.push(`Entry ${index + 1} must be an object`); continue; }
      const entry = raw as Record<string, unknown>;
      const id = String(entry.testCaseId ?? "");
      const status = String(entry.status ?? "");
      if (!/^TC-\d{3}$/.test(id) || id === "TC-000" || ids.has(id)) errors.push(`Entry ${index + 1} has invalid or duplicate testCaseId`);
      ids.add(id);
      if ("label" in entry) errors.push(`Entry ${index + 1} must not contain label`);
      const row = typeof entry.sourceRow === "string" ? entry.sourceRow : "";
      const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
      if (!row.startsWith("|") || !row.endsWith("|") || /[\r\n]/.test(row) || cells.length !== 9 || cells[0] !== id || cells.some((cell) => !cell)) errors.push(`Entry ${index + 1} needs matching sourceRow`);
      if (!statuses.includes(status)) errors.push(`Entry ${index + 1} has invalid status`);
      else counts[status] += 1;
      if (["created", "existing"].includes(status)) {
        const key = typeof entry.jiraKey === "string" ? entry.jiraKey : "";
        const jiraId = typeof entry.jiraId === "string" ? entry.jiraId : "";
        if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key) || !key.startsWith(`${project?.key}-`) || !/^\d+$/.test(jiraId)) errors.push(`Entry ${index + 1} needs project-matching jiraKey and numeric jiraId`);
        if (keys.has(key) || jiraIds.has(jiraId)) errors.push(`Entry ${index + 1} duplicates a Jira identity`);
        keys.add(key); jiraIds.add(jiraId);
      } else if (entry.jiraKey !== undefined || entry.jiraId !== undefined) errors.push(`Entry ${index + 1} has unconfirmed Jira identity`);
      if (["failed", "unknown", "conflict"].includes(status) && (typeof entry.reason !== "string" || !entry.reason.trim())) errors.push(`Entry ${index + 1} needs reason`);
    }
  }
  const summary = map.summary as Record<string, unknown> | undefined;
  if (!summary || !["requested", ...statuses].every((key) => Number.isInteger(summary[key]) && Number(summary[key]) >= 0)) errors.push("summary must contain nonnegative integer counts for every status");
  else if (!Array.isArray(map.entries) || summary.requested !== map.entries.length || statuses.some((status) => summary[status] !== counts[status])) errors.push("summary does not match entries");
  return errors;
}

async function main(): Promise<void> {
  try {
    const filePath = process.argv[2];
    if (!filePath) throw new Error("Usage: validate-external-test-cases-map.ts <external-test-cases-map.json>");
    const errors = validateExternalMap(JSON.parse(await readFile(resolve(filePath), "utf8")) as unknown);
    if (errors.length) { process.stderr.write(`${errors.map((error) => `- ${error}`).join("\n")}\n`); process.exitCode = 1; return; }
    process.stdout.write("External test-case map validation passed\n");
  } catch (error: unknown) { process.stderr.write(`${error instanceof Error ? error.message : "Map validation failed"}\n`); process.exitCode = 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

