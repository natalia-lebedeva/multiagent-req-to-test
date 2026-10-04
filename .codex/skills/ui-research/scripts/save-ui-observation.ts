#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const SOURCES = new Set([
  "browser_snapshot", "browser_navigate", "browser_navigate_back", "browser_click", "browser_type",
  "browser_fill_form", "browser_select_option", "browser_press_key", "browser_hover", "browser_drag",
  "browser_tabs", "browser_evaluate", "browser_run_code", "browser_take_screenshot",
  "browser_verify_element_visible", "browser_verify_text_visible", "browser_verify_list_visible",
  "browser_verify_value", "browser_generate_locator",
]);

export interface UiObservation {
  schemaVersion: 1;
  sequence: number;
  slug: string;
  planItemIds: string[];
  source: string;
  action: Record<string, unknown> | null;
  structure: Record<string, unknown>;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function validateStructure(value: unknown): Record<string, unknown> {
  const structure = object(value, "UI structure");
  if (typeof structure.url !== "string" || !structure.url) throw new Error("UI structure must contain url");
  const url = new URL(structure.url);
  if (url.protocol !== "https:") throw new Error("UI structure url must use HTTPS");
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  structure.url = url.href;
  if (typeof structure.title !== "string") throw new Error("UI structure must contain title");
  for (const field of ["headings", "controls", "fields", "tabs", "navigation", "choices", "dialogs", "messages", "tableHeaders", "tables", "grids"]) {
    if (!Array.isArray(structure[field])) throw new Error(`UI structure field '${field}' must be an array`);
  }
  return structure;
}

export function createObservation(
  responseValue: unknown,
  metadata: { sequence: number; slug: string; planItemIds: string[]; source: string },
): UiObservation {
  if (!Number.isInteger(metadata.sequence) || metadata.sequence < 1 || metadata.sequence > 999) throw new Error("Sequence must be an integer from 1 to 999");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.slug)) throw new Error("Slug must use lowercase letters, digits and hyphens");
  if (!metadata.planItemIds.length || metadata.planItemIds.some((id) => !/^UI-PLAN-\d{3}$/.test(id))) throw new Error("At least one valid UI-PLAN-NNN ID is required");
  if (!SOURCES.has(metadata.source)) throw new Error("Unsupported Playwright MCP source tool");

  const response = object(responseValue, "MCP response");
  const structure = validateStructure(response.structure);
  const action = response.action === null ? null : object(response.action, "Action");
  if (metadata.sequence === 1 && (metadata.source !== "browser_snapshot" || action !== null)) {
    throw new Error("The first observation must be an initial browser_snapshot");
  }

  return {
    schemaVersion: 1,
    sequence: metadata.sequence,
    slug: metadata.slug,
    planItemIds: metadata.planItemIds,
    source: metadata.source,
    action,
    structure,
  };
}

export async function saveObservation(inputPath: string, outputDirectory: string, metadata: Parameters<typeof createObservation>[1]): Promise<string> {
  const response = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
  const observation = createObservation(response, metadata);
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, `${String(metadata.sequence).padStart(3, "0")}-${metadata.slug}.json`);
  await writeFile(outputPath, `${JSON.stringify(observation, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return outputPath;
}

export function parseCliArgs(values: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]; const value = values[index + 1];
    if (key?.startsWith("--") && value) result[key.slice(2)] = value;
  }
  return result;
}

async function main(): Promise<void> {
  try {
    const values = parseCliArgs(process.argv.slice(2));
    if (!values.input || !values["output-dir"] || !values.sequence || !values.slug || !values["plan-items"] || !values.source) {
      throw new Error("Usage: save-ui-observation.ts --input <response.json> --output-dir <dir> --sequence <n> --slug <slug> --plan-items <IDs> --source <tool>");
    }
    const output = await saveObservation(resolve(values.input), resolve(values["output-dir"]), {
      sequence: Number(values.sequence), slug: values.slug,
      planItemIds: values["plan-items"].split(",").map((id) => id.trim()).filter(Boolean), source: values.source,
    });
    process.stdout.write(`${output}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Observation save failed"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
