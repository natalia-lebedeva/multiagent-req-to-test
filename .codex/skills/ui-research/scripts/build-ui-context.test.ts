import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildUiContext } from "./build-ui-context.ts";

async function fixture(run: (f: any) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "ui-contract-"));
  const input = join(dir, "observations");
  await mkdir(input);
  const structure = {
    url: "https://example.test/", title: "Test",
    headings: [], controls: [], fields: [], tabs: [], navigation: [], choices: [],
    dialogs: [], messages: ["Observed message"], tableHeaders: [], tables: [], grids: [],
  };
  const f = {
    observation: { schemaVersion: 1, sequence: 1, slug: "initial-page", planItemIds: ["UI-PLAN-001", "UI-PLAN-002"], source: "browser_snapshot", action: null, structure },
    plan: "| ID | Requirement | Page or URL | Goal | Safe Action | Expected Observation | Status |\n|---|---|---|---|---|---|---|\n| UI-PLAN-001 | — | Base URL | Initial | Snapshot | Page | Research |\n| UI-PLAN-002 | R-1 | Page | Message | Observe | Expected message | Research |\n| UI-PLAN-003 | R-2 | Page | Integration | No permission | Result | Do not research |\n",
    coverage: { schemaVersion: 1, status: "complete", planItems: [
      { planItemId: "UI-PLAN-001", status: "observed", reason: "", evidenceSequences: [1] },
      { planItemId: "UI-PLAN-002", status: "observed", reason: "Expected: Expected message; observed: Observed message", evidenceSequences: [1] },
      { planItemId: "UI-PLAN-003", status: "not_researched", reason: "No permission", evidenceSequences: [] },
    ] },
    build: async () => {
      await writeFile(join(input, "001-initial-page.json"), JSON.stringify(f.observation));
      await writeFile(join(dir, "plan.md"), f.plan);
      await writeFile(join(dir, "coverage.json"), JSON.stringify(f.coverage));
      await buildUiContext(input, join(dir, "context.json"), "https://example.test/", join(dir, "plan.md"), join(dir, "coverage.json"));
      return JSON.parse(await readFile(join(dir, "context.json"), "utf8"));
    },
  };
  try { await run(f); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("context preserves discrepancy, exclusions and source plan links", () => fixture(async (f) => {
  const result = await f.build();
  assert.equal(result.researchStatus, "complete");
  assert.deepEqual(result.coverage, f.coverage.planItems);
  assert.deepEqual(result.pages[0].states[0].planItemIds, f.observation.planItemIds);
  assert.deepEqual(result.pages[0].states[0].ui.messages, ["Observed message"]);
}));

test("rejects unknown plan status", () => fixture(async (f) => {
  f.plan = f.plan.replace("Do not research", "Skipped");
  await assert.rejects(f.build(), /Invalid UI plan row/);
}));

test("rejects evidence belonging to another plan item", () => fixture(async (f) => {
  f.observation.planItemIds = ["UI-PLAN-001"];
  f.coverage.status = "partial";
  f.coverage.planItems[1].status = "partial";
  f.coverage.planItems[1].reason = "Observation is not linked to this item";
  await assert.rejects(f.build(), /Evidence belongs to another plan item/);
}));

test("rejects observations referring to a foreign plan", () => fixture(async (f) => {
  f.observation.planItemIds.push("UI-PLAN-099");
  await assert.rejects(f.build(), /current plan/);
}));

test("rejects omitted coverage", () => fixture(async (f) => {
  f.coverage.planItems.pop();
  await assert.rejects(f.build(), /Coverage item is missing/);
}));

test("accepts partial coverage with evidence", () => fixture(async (f) => {
  f.coverage.status = "partial";
  f.coverage.planItems[1].status = "partial";
  f.coverage.planItems[1].reason = "Only the open page was checked";
  const result = await f.build();
  assert.equal(result.researchStatus, "partial");
  assert.equal(result.coverage[1].status, "partial");
}));

test("accepts blocked item without evidence in a partial run", () => fixture(async (f) => {
  f.coverage.status = "partial";
  f.coverage.planItems[1].status = "blocked";
  f.coverage.planItems[1].reason = "Insufficient permissions for the action";
  f.coverage.planItems[1].evidenceSequences = [];
  assert.equal((await f.build()).coverage[1].status, "blocked");
}));

test("rejects complete coverage with an incomplete item", () => fixture(async (f) => {
  f.coverage.planItems[1].status = "partial";
  f.coverage.planItems[1].reason = "Only the open page was checked";
  await assert.rejects(f.build(), /Complete coverage contains incomplete research/);
}));

test("does not create context for globally blocked research", () => fixture(async (f) => {
  f.coverage.status = "blocked";
  f.coverage.planItems[0].status = "blocked";
  f.coverage.planItems[0].reason = "Playwright MCP is unavailable";
  f.coverage.planItems[0].evidenceSequences = [];
  f.coverage.planItems[1].status = "blocked";
  f.coverage.planItems[1].reason = "Playwright MCP is unavailable";
  f.coverage.planItems[1].evidenceSequences = [];
  await assert.rejects(f.build(), /Blocked UI research cannot create ui-context.json/);
}));

test("rejects evidence for a non-research item", () => fixture(async (f) => {
  f.coverage.planItems[2].evidenceSequences = [1];
  await assert.rejects(f.build(), /Non-research item must not include evidence/);
}));
