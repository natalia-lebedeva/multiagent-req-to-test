import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { validateTestCases } from "./validate-test-cases.ts";

const header = "| ID | Requirement | Name | Preconditions | Steps | Expected Result | Test Automation | Priority | Clarifications |\n|---|---|---|---|---|---|---|---|---|";
const row = "| TC-001 | Sign-in: valid password | Successful sign-in | Test account | 1. Enter valid credentials<br>2. Click Sign in | 1. Fields are populated<br>2. Profile opens | Yes | High | Not required |";
const valid = `${header}\n${row}`;

test("accepts direct requirement references, both automation choices and all priorities", () => {
  for (const automation of ["Yes", "No"]) for (const priority of ["Highest", "High", "Medium", "Low", "Lowest"]) {
    assert.deepEqual(validateTestCases(valid.replace("| Yes | High | Not required |", `| ${automation} | ${priority} | Not required |`)), []);
  }
});
test("allows several scenarios for the same requirement and encoded pipe characters", () => {
  assert.deepEqual(validateTestCases(`${valid}\n${row.replace("TC-001", "TC-002").replace("Successful sign-in", "Another scenario &#124; example")}`), []);
});
test("rejects empty documents, empty tables, prose and multiple tables", () => {
  for (const doc of ["", header, `Comment\n${valid}`, `${valid}\nComment`, `${valid}\n${valid}`]) assert(validateTestCases(doc).length > 0);
});
test("rejects missing cells, missing source reference and malformed columns", () => {
  for (const doc of [valid.replace("Test account", ""), valid.replace("Sign-in: valid password", "—"), valid.replace("Successful sign-in", "Sign-in | extra cell")]) assert(validateTestCases(doc).length > 0);
});
test("rejects duplicate and nonsequential IDs and invalid enum values", () => {
  for (const doc of [`${valid}\n${row}`, valid.replace("TC-001", "TC-003"), valid.replace("| Yes |", "| Maybe |"), valid.replace("| High |", "| Critical |")]) assert(validateTestCases(doc).length > 0);
});
test("rejects unequal counts, empty steps, trailing breaks and wrong numbering", () => {
  for (const doc of [valid.replace("<br>2. Profile opens", ""), valid.replace("2. Click Sign in", "2. "), valid.replace("2. Click Sign in", "3. Click Sign in"), valid.replace("2. Profile opens", "2. Profile opens<br>")]) assert(validateTestCases(doc).length > 0);
});
test("CLI accepts one file and fails on invalid input or obsolete extra arguments", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qa-cases-validator-"));
  try {
    const path = join(directory, "cases.md");
    const script = fileURLToPath(new URL("./validate-test-cases.ts", import.meta.url));
    const run = (...args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", script, ...args], { encoding: "utf8" });
    await writeFile(path, valid);
    assert.equal(run(path).status, 0);
    assert.equal(run(path, "unexpected.md").status, 1);
    await writeFile(path, header);
    assert.equal(run(path).status, 1);
    assert.equal(run(join(directory, "absent.md")).status, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

