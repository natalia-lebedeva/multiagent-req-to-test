#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const COLUMNS = ["ID", "Requirement", "Name", "Preconditions", "Steps", "Expected Result", "Test Automation", "Priority", "Clarifications"];

function cells(line: string): string[] {
  return line.startsWith("|") && line.endsWith("|")
    ? line.slice(1, -1).split("|").map((cell) => cell.trim()) : [];
}

export function validateTestCases(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (cells(lines[0] ?? "").join("\0") !== COLUMNS.join("\0")) return ["Expected one test-case table with columns: " + COLUMNS.join(" | ")];
  const separator = cells(lines[1] ?? "");
  if (separator.length !== COLUMNS.length || !separator.every(cell => /^:?-{3,}:?$/.test(cell))) return ["Invalid Markdown table separator"];
  const errors: string[] = [];
  if (lines.length < 3) errors.push("At least one test case is required");
  const seen = new Set<string>();
  lines.slice(2).forEach((line, index) => {
    const row = cells(line);
    const label = `Test-case row ${index + 1}`;
    if (row.length !== COLUMNS.length) { errors.push(`${label}: expected ${COLUMNS.length} columns; only a single table is allowed`); return; }
    if (row.some(cell => !cell)) errors.push(`${label}: all cells must be non-empty`);
    const [id, requirement, , , steps, expected, automation, priority] = row;
    const expectedId = `TC-${String(index + 1).padStart(3, "0")}`;
    if (!/^TC-\d{3}$/.test(id) || id !== expectedId) errors.push(`${label}: expected sequential ID ${expectedId} in TC-NNN format`);
    if (seen.has(id)) errors.push(`${label}: duplicate ID ${id}`);
    seen.add(id);
    if (["—", "-", "..."].includes(requirement)) errors.push(`${label}: Requirement must identify a source fragment`);
    if (!["Yes", "No"].includes(automation)) errors.push(`${label}: Test Automation must be Yes or No`);
    if (!["Highest", "High", "Medium", "Low", "Lowest"].includes(priority)) errors.push(`${label}: Priority must be Highest, High, Medium, Low or Lowest`);
    const stepItems = steps.split(/<br\s*\/?>/i).map(item => item.trim());
    const resultItems = expected.split(/<br\s*\/?>/i).map(item => item.trim());
    if (stepItems.length !== resultItems.length) errors.push(`${label}: steps and expected results must have equal counts`);
    for (const [items, field] of [[stepItems, "steps"], [resultItems, "expected results"]] as const) {
      if (items.some((item, i) => !new RegExp(`^${i + 1}\\.\\s+\\S`).test(item))) errors.push(`${label}: ${field} must be consecutively numbered with non-empty text`);
    }
  });
  return errors;
}

async function main(): Promise<void> {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: validate-test-cases.ts <test-cases.md>");
    const errors = validateTestCases(await readFile(resolve(process.argv[2]!), "utf8"));
    if (errors.length) { process.stderr.write(`${errors.join("\n")}\n`); process.exitCode = 1; return; }
    process.stdout.write("Test-case structure validation passed; requirements coverage and UI evidence require content review\n");
  } catch { process.stderr.write("Cannot validate test cases: expected one readable Markdown file\n"); process.exitCode = 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
