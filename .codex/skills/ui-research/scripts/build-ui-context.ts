#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { UiObservation } from "./save-ui-observation.ts";

interface UiState {
  stateId: string;
  planItemIds: string[];
  sources: string[];
  ui: Record<string, unknown>;
}

type CoverageStatus = "observed" | "partial" | "blocked" | "not_researched";
type ResearchStatus = "complete" | "partial" | "blocked";
interface CoverageItem {
  planItemId: string;
  status: CoverageStatus;
  reason: string;
  evidenceSequences: number[];
}

interface CoverageDocument {
  schemaVersion: 1;
  status: ResearchStatus;
  planItems: CoverageItem[];
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function validateObservation(value: unknown): UiObservation {
  const item = object(value, "Observation");
  if (item.schemaVersion !== 1 || !Number.isInteger(item.sequence) || typeof item.slug !== "string") throw new Error("Invalid observation metadata");
  if (!Array.isArray(item.planItemIds) || !item.planItemIds.every((id) => typeof id === "string" && /^UI-PLAN-\d{3}$/.test(id))) throw new Error("Invalid observation planItemIds");
  if (typeof item.source !== "string") throw new Error("Invalid observation source");
  const structure = object(item.structure, "Observation structure");
  if (typeof structure.url !== "string" || typeof structure.title !== "string") throw new Error("Observation structure must contain url and title");
  for (const field of ["headings", "controls", "fields", "tabs", "navigation", "choices", "dialogs", "messages", "tableHeaders", "tables", "grids"]) {
    if (!Array.isArray(structure[field])) throw new Error(`Observation structure field '${field}' must be an array`);
  }
  return value as UiObservation;
}

function stripRuntimeIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripRuntimeIds);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "elementId")
      .map(([key, child]) => [key, stripRuntimeIds(child)]),
  );
}

function semanticAction(action: Record<string, unknown>, previousStructure: Record<string, unknown>): Record<string, unknown> {
  const labels = new Map<string, string>();
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (!value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    if (typeof item.elementId === "string") {
      const label = typeof item.name === "string" && item.name.trim()
        ? item.name.trim()
        : typeof item.placeholder === "string" && item.placeholder.trim() ? item.placeholder.trim() : undefined;
      if (label) labels.set(item.elementId, label);
    }
    Object.values(item).forEach(collect);
  };
  collect(previousStructure);

  const replace = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value.replace(/\bui-\d+\b/g, (elementId) => {
        const label = labels.get(elementId);
        if (!label) throw new Error(`Cannot resolve runtime elementId '${elementId}' to a semantic name`);
        return label;
      });
    }
    if (Array.isArray(value)) return value.map(replace);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, replace(child)]));
  };
  return replace(action) as Record<string, unknown>;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Base URL must use HTTPS");
  url.search = "";
  url.hash = "";
  return url.href;
}

function parsePlan(value: string): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const line of value.split(/\r?\n/)) {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (!/^UI-PLAN-\d{3}$/.test(cells[0] || "")) continue;
    if (cells.length !== 7 || cells.some((cell) => !cell) || !["Research", "Do not research"].includes(cells[6]!)) throw new Error(`Invalid UI plan row: ${cells[0]}`);
    if (result.has(cells[0]!)) throw new Error(`Duplicate UI plan item: ${cells[0]}`);
    result.set(cells[0]!, cells.at(-1) === "Research");
  }
  if (!result.size) throw new Error("No UI-PLAN items found in ui-test-plan.md");
  if (result.get("UI-PLAN-001") !== true) throw new Error("Initial UI-PLAN-001 must have Research status");
  return result;
}

function validateCoverage(value: unknown, plan: Map<string, boolean>, observations: UiObservation[]): CoverageDocument {
  const document = object(value, "UI research coverage");
  const researchStatus = document.status as ResearchStatus;
  if (document.schemaVersion !== 1 || !Array.isArray(document.planItems) || !(["complete", "partial", "blocked"] as string[]).includes(researchStatus)) {
    throw new Error("Invalid UI research coverage schema");
  }
  const observationBySequence = new Map(observations.map((item) => [item.sequence, item]));
  const seen = new Set<string>();
  const items = document.planItems.map((raw, index) => {
    const item = object(raw, `Coverage item ${index + 1}`);
    const planItemId = String(item.planItemId || "");
    const status = item.status as CoverageStatus;
    const reason = typeof item.reason === "string" ? item.reason.trim() : "";
    const evidenceSequences = Array.isArray(item.evidenceSequences) ? item.evidenceSequences : [];
    if (!plan.has(planItemId) || seen.has(planItemId)) throw new Error(`Unknown or duplicate coverage item: ${planItemId}`);
    if (!(["observed", "partial", "blocked", "not_researched"] as string[]).includes(status)) throw new Error(`Invalid coverage status: ${planItemId}`);
    if (!evidenceSequences.every((sequence) => Number.isInteger(sequence) && observationBySequence.has(sequence))) throw new Error(`Invalid coverage evidence: ${planItemId}`);
    if (plan.get(planItemId) && !["observed", "partial", "blocked"].includes(status)) throw new Error(`Researchable item has no result: ${planItemId}`);
    if (!plan.get(planItemId) && status !== "not_researched") throw new Error(`Non-research item must be not_researched: ${planItemId}`);
    if (status !== "observed" && !reason) throw new Error(`Coverage reason is required: ${planItemId}`);
    if (status === "not_researched" && evidenceSequences.length > 0) throw new Error(`Non-research item must not include evidence: ${planItemId}`);
    if (!evidenceSequences.every((sequence) => observationBySequence.get(sequence)!.planItemIds.includes(planItemId))) {
      throw new Error(`Evidence belongs to another plan item: ${planItemId}`);
    }
    if (["observed", "partial"].includes(status) && evidenceSequences.length === 0) throw new Error(`Coverage result requires evidence: ${planItemId}`);
    seen.add(planItemId);
    return { planItemId, status, reason, evidenceSequences };
  });
  for (const planItemId of plan.keys()) if (!seen.has(planItemId)) throw new Error(`Coverage item is missing: ${planItemId}`);
  const initialItem = items.find((item) => item.planItemId === "UI-PLAN-001");
  if (researchStatus !== "blocked" && initialItem?.status !== "observed") throw new Error("Initial UI-PLAN-001 must be observed");
  const hasIncompleteResearch = items.some((item) => plan.get(item.planItemId) && ["partial", "blocked"].includes(item.status));
  if (researchStatus === "complete" && hasIncompleteResearch) throw new Error("Complete coverage contains incomplete research");
  if (researchStatus === "partial" && !hasIncompleteResearch) throw new Error("Partial coverage has no incomplete research");
  if (researchStatus === "blocked") throw new Error("Blocked UI research cannot create ui-context.json");
  return { schemaVersion: 1, status: researchStatus, planItems: items };
}

export async function buildUiContext(inputDirectory: string, outputPath: string, baseUrlValue: string, planPath: string, coveragePath: string): Promise<void> {
  const baseUrl = normalizeBaseUrl(baseUrlValue);
  const filenames = (await readdir(inputDirectory)).filter((name) => /^\d{3}-[a-z0-9-]+\.json$/.test(name)).sort();
  if (!filenames.length) throw new Error("No UI observations found");
  const observations = await Promise.all(filenames.map(async (name) =>
    validateObservation(JSON.parse(await readFile(resolve(inputDirectory, name), "utf8")) as unknown),
  ));
  const plan = parsePlan(await readFile(planPath, "utf8"));
  const coverage = validateCoverage(JSON.parse(await readFile(coveragePath, "utf8")) as unknown, plan, observations);
  observations.sort((left, right) => left.sequence - right.sequence);
  if (observations[0]?.sequence !== 1 || observations[0].source !== "browser_snapshot" || observations[0].action !== null || !observations[0].planItemIds.includes("UI-PLAN-001")) {
    throw new Error("Observation sequence must start with the initial page snapshot");
  }
  const sequences = new Set<number>();
  for (const observation of observations) {
    if (!observation.planItemIds.length || observation.planItemIds.some((id) => plan.get(id) !== true)) throw new Error("Observation must reference researchable items of the current plan");
    if (sequences.has(observation.sequence)) throw new Error(`Duplicate observation sequence: ${observation.sequence}`);
    sequences.add(observation.sequence);
    if (new URL(String(observation.structure.url)).origin !== new URL(baseUrl).origin) throw new Error("Observation origin differs from base URL origin");
  }

  const pages: Array<{ pageId: string; url: string; title: string; pageType?: unknown; states: UiState[] }> = [];
  const pageByUrl = new Map<string, typeof pages[number]>();
  const stateByFingerprint = new Map<string, UiState>();
  const stateBySequence = new Map<number, string>();
  let stateSequence = 0;

  for (const observation of observations) {
    const structure = stripRuntimeIds(observation.structure) as Record<string, unknown>;
    const url = String(structure.url);
    let page = pageByUrl.get(url);
    if (!page) {
      page = { pageId: `PAGE-${String(pages.length + 1).padStart(3, "0")}`, url, title: String(structure.title), pageType: structure.pageType, states: [] };
      pages.push(page);
      pageByUrl.set(url, page);
    }
    const { url: _url, title: _title, pageType: _pageType, authenticated: _authenticated, ...ui } = structure;
    const fingerprint = `${url}\n${JSON.stringify(ui)}`;
    let state = stateByFingerprint.get(fingerprint);
    if (!state) {
      stateSequence += 1;
      state = { stateId: `STATE-${String(stateSequence).padStart(3, "0")}`, planItemIds: [], sources: [], ui };
      page.states.push(state);
      stateByFingerprint.set(fingerprint, state);
    }
    state.planItemIds = [...new Set([...state.planItemIds, ...observation.planItemIds])];
    state.sources = [...new Set([...state.sources, observation.source])];
    stateBySequence.set(observation.sequence, state.stateId);
  }

  const transitions = observations.flatMap((item, index) => {
    if (index === 0 || item.action === null) return [];
    return [{
      fromStateId: stateBySequence.get(observations[index - 1]!.sequence),
      action: semanticAction(item.action, observations[index - 1]!.structure),
      toStateId: stateBySequence.get(item.sequence),
      planItemIds: item.planItemIds,
    }];
  });

  const context = { schemaVersion: 1, baseUrl, observationCount: observations.length, researchStatus: coverage.status, coverage: coverage.planItems, pages, transitions };
  const serialized = `${JSON.stringify(context, null, 2)}\n`;
  if (/"elementId"\s*:|\bui-\d+\b/.test(serialized)) throw new Error("Runtime elementId leaked into ui_context.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, { encoding: "utf8", flag: "wx" });
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
    if (!values["input-dir"] || !values.output || !values["base-url"] || !values["test-plan"] || !values.coverage) throw new Error("Usage: build-ui-context.ts --input-dir <dir> --output <ui_context.json> --base-url <url> --test-plan <ui-test-plan.md> --coverage <ui-research-coverage.json>");
    await buildUiContext(resolve(values["input-dir"]), resolve(values.output), values["base-url"], resolve(values["test-plan"]), resolve(values.coverage));
    process.stdout.write(`${resolve(values.output)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "UI context build failed"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
