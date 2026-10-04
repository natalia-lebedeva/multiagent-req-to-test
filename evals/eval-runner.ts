import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

import { evaluateResponse, type EvalCase } from "./evaluator.ts";

// This file runs one or more evaluation cases.
//
// For each case, the runner loads the inputs, builds a prompt, starts the
// Codex CLI, collects the response and run events, calls the evaluator, and
// saves the final report.
//
// The evaluator decides whether a case passed. The runner starts the agent
// under test and collects evidence of what it did.

// =============================================================
// FILE PATHS
// =============================================================

const evalsDirectory = import.meta.dirname;
const projectPath = path.resolve(evalsDirectory, "..");
const datasetPath = path.join(evalsDirectory, "dataset", "golden-dataset.json");
const resultsDirectory = path.join(evalsDirectory, "results");
const resultsPath = path.join(resultsDirectory, "eval_results.json");

// =============================================================
// QUALITY GATE THRESHOLDS
// =============================================================

const MIN_PASS_RATE = 100.0;
const MIN_EXPECTED_PROPERTIES_PASS_RATE = 95.0;
const MAX_FORBIDDEN_BEHAVIOR_VIOLATION_RATE = 0.0;
const MAX_ERRORS = 0;
// Retrieving a requirement through MCP and saving files can take several
// minutes, so the QA agent has a ten-minute timeout.
const AGENT_TIMEOUT_MS = 600_000;

// =============================================================
// DATA TYPES
// =============================================================

type EvalResult = {
  id: string;
  name: string;
  status: string;
  score: number;
  expected_response?: Record<string, unknown> | null;
  expected_properties: Array<Record<string, unknown>>;
  forbidden_behavior: Array<Record<string, unknown>>;
};

type AgentRunResult = {
  returnCode: number;
  response: string;
  stderr: string;
  events: unknown[];
};

type ArtifactEvidence = {
  path: string;
  exists: boolean;
};

type ReferenceArtifactEvidence = {
  path: string;
  content: string | null;
};

// =============================================================
// QA AGENT PROMPT
// =============================================================

function buildAgentPrompt(evalCase: EvalCase): string {
  const {
    source,
    task,
    page_id: pageId,
    artifacts_directory: artifactsDirectory,
  } = evalCase.input;

  // `task` describes the operation for this case. The other fields describe
  // the test environment.
  const promptLines = [
    `Task: ${task}`,
    `Source: ${source}.`,
    pageId ? `Page ID: ${pageId}.` : "",
    artifactsDirectory ? `Artifacts directory: ${artifactsDirectory}.` : "",
    "Follow the project instructions and the relevant agent's rules.",
    "When finished, report the result and the artifacts you created.",
  ];

  // Optional fields may be empty. Remove them before joining the prompt into
  // separate readable lines.
  return promptLines.filter(Boolean).join("\n");
}

// Check the minimum data required to run an evaluation case.
function validateEvalCase(evalCase: EvalCase): void {
  const {
    source,
    task,
    page_id: pageId,
    artifacts_directory: artifactsDirectory,
  } = evalCase.input;

  if (!source) {
    throw new Error(`input.source is missing in ${evalCase.id}.`);
  }

  if (!task) {
    throw new Error(`input.task is missing in ${evalCase.id}.`);
  }

  if (source === "confluence" && !pageId) {
    throw new Error(
      `input.page_id is required for ${evalCase.id} when source=confluence.`,
    );
  }

  if (!artifactsDirectory) {
    throw new Error(
      `input.artifacts_directory is missing in ${evalCase.id}.`,
    );
  }
}

// Create the artifact directory before starting the agent.
// If the directory already exists, leave it unchanged.
async function prepareArtifactsDirectory(evalCase: EvalCase): Promise<void> {
  const artifactsDirectory = evalCase.input.artifacts_directory;

  if (!artifactsDirectory) {
    throw new Error(
      `Cannot create the artifact directory for ${evalCase.id}: no path was provided.`,
    );
  }

  const absolutePath = path.resolve(projectPath, artifactsDirectory);
  await mkdir(absolutePath, { recursive: true });
}

// Convert paths in references to real paths for this run.
// The `<artefacts>` placeholder keeps the dataset independent of any
// computer-specific directory.
function resolveExpectedArtifactPaths(evalCase: EvalCase): string[] {
  const artifactsDirectory = evalCase.input.artifacts_directory;
  const expectedArtifacts =
    evalCase.references?.expected_response?.artifacts ?? [];

  if (!artifactsDirectory) {
    return [];
  }

  return expectedArtifacts.map((artifactPath) => {
    const resolvedPath = artifactPath.replace(
      "<artefacts>",
      artifactsDirectory,
    );

    return path.resolve(projectPath, resolvedPath);
  });
}

// Check for the expected files after the agent finishes.
// File names come from the evaluation case, so this works across workflow
// stages without hard-coding a specific case.
async function collectArtifactEvidence(
  evalCase: EvalCase,
): Promise<ArtifactEvidence[]> {
  const expectedPaths = resolveExpectedArtifactPaths(evalCase);

  return Promise.all(
    expectedPaths.map(async (artifactPath) => {
      try {
        await access(artifactPath);
        return { path: artifactPath, exists: true };
      } catch {
        return { path: artifactPath, exists: false };
      }
    }),
  );
}

// Load reference files for the LLM evaluator.
// The runner does not compare files itself; it passes them to the evaluator
// with the explanation from reference_artifacts.description.
async function loadReferenceArtifacts(
  evalCase: EvalCase,
): Promise<ReferenceArtifactEvidence[]> {
  const referencePaths = evalCase.references?.reference_artifacts?.paths ?? [];

  return Promise.all(
    referencePaths.map(async (referencePath) => {
      const absolutePath = path.resolve(projectPath, referencePath);

      try {
        return {
          path: absolutePath,
          content: await readFile(absolutePath, "utf8"),
        };
      } catch {
        return {
          path: absolutePath,
          content: null,
        };
      }
    }),
  );
}

// =============================================================
// START CODEX AND READ JSONL EVENTS
// =============================================================

function runAgent(prompt: string): Promise<AgentRunResult> {
  return new Promise((resolve, reject) => {
    // `codex exec` starts Codex without an interactive terminal.
    // `--json` writes run events to stdout as JSONL.
    // `--cd` sets the project root so Codex loads AGENTS.md, project agents,
    // Skills, and MCP configuration.
    // On Windows, start the npm launcher codex.cmd.
    // Pass the prompt through stdin so the shell does not split it at spaces.
    const codexCommand = process.platform === "win32"
      ? "codex.cmd"
      : "codex";

    const child = spawn(
      codexCommand,
      [
        "exec",
        // During automated evaluation, Codex must not wait for manual approval;
        // otherwise, an MCP call is cancelled after stdin closes.
        "-c",
        'approval_policy="never"',
        "-c",
        'sandbox_mode="workspace-write"',
        "--json",
        "--cd",
        projectPath,
        "-",
      ],
      {
        cwd: projectPath,
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32",
      },
    );

    // The `-` argument tells Codex to read the prompt from stdin.
    child.stdin.write(prompt);
    child.stdin.end();

    const textParts: string[] = [];
    const events: unknown[] = [];

    // A stdout chunk may end in the middle of a JSON line. Keep the unfinished
    // part until the next chunk arrives.
    let stdoutBuffer = "";
    let stderr = "";
    let finished = false;

    // The timeout prevents the runner from waiting for Codex forever.
    const timeout = setTimeout(() => {
      finished = true;
      child.kill();
      reject(
        new Error(`Codex did not finish within ${AGENT_TIMEOUT_MS / 1000} seconds.`),
      );
    }, AGENT_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        try {
          const event = JSON.parse(trimmedLine) as {
            type?: string;
            item?: {
              type?: string;
              text?: string;
            };
          };
          // Keep all events so later checks can use actual tool calls and
          // execution order, not only the agent's final text.
          events.push(event);
          // The assistant's final message arrives as an item of type agent_message.
          if (
            event.type === "item.completed" &&
            event.item?.type === "agent_message" &&
            event.item.text
          ) {
            textParts.push(event.item.text);
          }
        } catch {
          console.log("Could not parse a Codex event.");
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (returnCode) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeout);

      const trailingLine = stdoutBuffer.trim();
      if (trailingLine) {
        try {
          const event = JSON.parse(trailingLine) as {
            type?: string;
            item?: {
              type?: string;
              text?: string;
            };
          };
          events.push(event);
          if (
            event.type === "item.completed" &&
            event.item?.type === "agent_message" &&
            event.item.text
          ) {
            textParts.push(event.item.text);
          }
        } catch {
          console.log("Could not parse the final Codex event.");
        }
      }

      resolve({
        returnCode: returnCode ?? 1,
        response: textParts.join("\n").trim(),
        stderr,
        events,
      });
    });
  });
}

// =============================================================
// HELPER FUNCTIONS
// =============================================================

function createErrorResult(evalCase: EvalCase): EvalResult {
  return { id: evalCase.id, name: evalCase.name, status: "ERROR", score: 0.0, expected_properties: [], forbidden_behavior: [] };
}

function toEvalResult(evalCase: EvalCase, evaluation: Record<string, unknown>): EvalResult {
  return {
    id: evalCase.id,
    name: evalCase.name,
    status: String(evaluation.status),
    score: Number(evaluation.score),
    expected_response: evaluation.expected_response as Record<string, unknown> | null | undefined,
    expected_properties: evaluation.expected_properties as Array<Record<string, unknown>>,
    forbidden_behavior: evaluation.forbidden_behavior as Array<Record<string, unknown>>,
  };
}

// Print a readable evaluation result for one case.
function printEvaluation(evaluation: Record<string, unknown>): void {
  const expectedProperties = Array.isArray(evaluation.expected_properties)
    ? evaluation.expected_properties as Array<Record<string, unknown>>
    : [];
  const forbiddenBehavior = Array.isArray(evaluation.forbidden_behavior)
    ? evaluation.forbidden_behavior as Array<Record<string, unknown>>
    : [];

  const expectedResponse = evaluation.expected_response as Record<string, unknown> | null | undefined;

  if (expectedResponse) {
    const status = expectedResponse.matched === true ? "PASS" : "FAIL";
    console.log("\nEXPECTED RESPONSE CHECK (MEANING):");
    console.log(`- [${status}] Reference response matches the actual response in meaning`);
    if (expectedResponse.reason) {
      console.log(`  Reason: ${String(expectedResponse.reason)}`);
    }
  }

  console.log("\nEXPECTED PROPERTIES CHECK:");
  for (const property of expectedProperties) {
    const status = property.passed === true ? "PASS" : "FAIL";
    console.log(`- [${status}] ${String(property.property ?? "Untitled")}`);
    if (property.reason) {
      console.log(`  Reason: ${String(property.reason)}`);
    }
  }

  console.log("\nFORBIDDEN BEHAVIOUR CHECK:");
  for (const behavior of forbiddenBehavior) {
    const status = behavior.violated === true ? "VIOLATED" : "PASS";
    console.log(`- [${status}] ${String(behavior.rule ?? "Untitled")}`);
    if (behavior.reason) {
      console.log(`  Reason: ${String(behavior.reason)}`);
    }
  }

  console.log(`\nEVAL CASE STATUS: ${String(evaluation.status)}`);
  console.log(`SCORE: ${String(evaluation.score)}`);
}

// Show useful check progress without Codex's technical JSONL events.
function printArtifactProgress(
  artifacts: ArtifactEvidence[],
  referenceArtifacts: ReferenceArtifactEvidence[],
): void {
  console.log("\nARTIFACT CHECK:");

  if (artifacts.length === 0) {
    console.log("- [INFO] No expected artifacts are listed for this evaluation case.");
  }

  for (const artifact of artifacts) {
    const status = artifact.exists ? "PASS" : "FAIL";
    console.log(`- [${status}] ${artifact.path}`);
  }

  console.log("\nREFERENCE CHECK:");

  if (referenceArtifacts.length === 0) {
    console.log("- [INFO] No reference artifacts are listed.");
    return;
  }

  const loadedCount = referenceArtifacts.filter(
    (artifact) => artifact.content !== null,
  ).length;

  console.log(
    `- [${loadedCount === referenceArtifacts.length ? "PASS" : "FAIL"}] ` +
      `Reference artifacts loaded: ${loadedCount}/${referenceArtifacts.length}`,
  );

  for (const artifact of referenceArtifacts) {
    const status = artifact.content !== null ? "PASS" : "FAIL";
    console.log(`- [${status}] ${artifact.path}`);
  }

  console.log("- [INFO] Reference artifacts passed to the LLM evaluator.");
  console.log("- [INFO] The evaluator checks structure and format.");
}

// =============================================================
// LOAD THE GOLDEN DATASET
// =============================================================

async function loadEvalCases(): Promise<EvalCase[]> {
  return JSON.parse(await readFile(datasetPath, "utf8")) as EvalCase[];
}

// Get a case ID from the command line.
// Without this option, the runner executes the full golden dataset.
function getRequestedCaseId(): string | undefined {
  const caseOptionIndex = process.argv.indexOf("--case");

  if (caseOptionIndex === -1) {
    return undefined;
  }

  const caseId = process.argv[caseOptionIndex + 1];

  if (!caseId || caseId.startsWith("--")) {
    throw new Error("Provide an evaluation case ID after --case, for example EVC-012.");
  }

  return caseId;
}

// Keep only the selected case when the runner uses --case.
function selectEvalCases(evalCases: EvalCase[]): EvalCase[] {
  const requestedCaseId = getRequestedCaseId();

  if (!requestedCaseId) {
    return evalCases;
  }

  const selectedCase = evalCases.find((evalCase) => evalCase.id === requestedCaseId);

  if (!selectedCase) {
    const availableCaseIds = evalCases.map((evalCase) => evalCase.id).join(", ");
    throw new Error(
      `Evaluation case ${requestedCaseId} was not found. Available cases: ${availableCaseIds}`,
    );
  }

  return [selectedCase];
}

// =============================================================
// SUMMARY, METRICS, AND QUALITY GATE
// =============================================================

function buildReport(results: EvalResult[]) {
  const total = results.length;
  const passed = results.filter((result) => result.status === "PASS").length;
  const failed = results.filter((result) => result.status === "FAIL").length;
  const errors = results.filter((result) => result.status === "ERROR").length;
  const passRate = total > 0
    ? (passed / total) * 100
    : 0.0;

  const averageScore = total > 0
    ? results.reduce((sum, result) => sum + result.score, 0) / total
    : 0.0;

  const expectedProperties = results.flatMap(
    (result) => result.expected_properties,
  );

  const forbiddenBehavior = results.flatMap(
    (result) => result.forbidden_behavior,
  );

  const passedExpectedProperties = expectedProperties.filter(
    (property) => property.passed === true,
  ).length;

  const violatedForbiddenBehavior = forbiddenBehavior.filter(
    (behavior) => behavior.violated === true,
  ).length;

  const expectedPropertiesPassRate = expectedProperties.length > 0
    ? (passedExpectedProperties / expectedProperties.length) * 100
    : 0.0;

  const forbiddenBehaviorViolationRate = forbiddenBehavior.length > 0
    ? (violatedForbiddenBehavior / forbiddenBehavior.length) * 100
    : 0.0;

  const qualityGate = {
    passRate: passRate >= MIN_PASS_RATE,
    expectedProperties: expectedPropertiesPassRate >= MIN_EXPECTED_PROPERTIES_PASS_RATE,
    forbiddenBehavior: forbiddenBehaviorViolationRate <= MAX_FORBIDDEN_BEHAVIOR_VIOLATION_RATE,
    errors: errors <= MAX_ERRORS,
  };
  const overallStatus = Object.values(qualityGate).every(Boolean)
    ? "PASS"
    : "FAIL";

  const summary = {
    total,
    passed,
    failed,
    errors,
    pass_rate: Number(passRate.toFixed(1)),
    average_score: Number(averageScore.toFixed(2)),
    expected_properties_pass_rate: Number(
      expectedPropertiesPassRate.toFixed(1),
    ),
    forbidden_behavior_violation_rate: Number(
      forbiddenBehaviorViolationRate.toFixed(1),
    ),
    overall_status: overallStatus,
  };

  const metrics = {
    expected_properties: {
      total: expectedProperties.length,
      passed: passedExpectedProperties,
      pass_rate: Number(expectedPropertiesPassRate.toFixed(1)),
    },
    forbidden_behavior: {
      total: forbiddenBehavior.length,
      violated: violatedForbiddenBehavior,
      violation_rate: Number(forbiddenBehaviorViolationRate.toFixed(1)),
    },
  };

  const qualityGateReport = {
    status: overallStatus,
    criteria: {
      pass_rate: {
        threshold: MIN_PASS_RATE,
        actual: Number(passRate.toFixed(1)),
        passed: qualityGate.passRate,
      },
      expected_properties_pass_rate: {
        threshold: MIN_EXPECTED_PROPERTIES_PASS_RATE,
        actual: Number(expectedPropertiesPassRate.toFixed(1)),
        passed: qualityGate.expectedProperties,
      },
      forbidden_behavior_violation_rate: {
        threshold: MAX_FORBIDDEN_BEHAVIOR_VIOLATION_RATE,
        actual: Number(forbiddenBehaviorViolationRate.toFixed(1)),
        passed: qualityGate.forbiddenBehavior,
      },
      errors: {
        threshold: MAX_ERRORS,
        actual: errors,
        passed: qualityGate.errors,
      },
    },
  };

  return {
    summary,
    metrics,
    quality_gate: qualityGateReport,
    results,
  };
}

// =============================================================
// MAIN
// =============================================================

async function main(): Promise<void> {
  const allEvalCases = await loadEvalCases();
  const evalCases = selectEvalCases(allEvalCases);
  const evalResults: EvalResult[] = [];

  for (const evalCase of evalCases) {
    const {
      source,
      page_id: pageId,
      artifacts_directory: artifactsDirectory,
    } = evalCase.input;
    console.log("\n" + "=".repeat(80));
    console.log("STARTING QA AGENT");
    console.log("=".repeat(80));
    console.log("Eval Case:", evalCase.id, evalCase.name);
    console.log("Source:", source);
    if (pageId) console.log("pageId:", pageId);
    if (artifactsDirectory) console.log("Artifacts directory:", artifactsDirectory);

    try {
      // Validate the inputs and prepare the results directory first.
      validateEvalCase(evalCase);
      console.log("[SETUP] Inputs validated.");
      await prepareArtifactsDirectory(evalCase);
      console.log("[SETUP] Artifact directory prepared.");
    } catch (error) {
      console.error("Could not prepare the evaluation case:", error);
      evalResults.push(createErrorResult(evalCase));
      continue;
    }

    // Start the agent only after the case is prepared successfully.
    let agentRun: AgentRunResult;

    try {
      console.log("[AGENT] Starting the Codex agent.");
      agentRun = await runAgent(buildAgentPrompt(evalCase));
      console.log("[AGENT] Codex agent finished.");
    } catch (error) {
      console.error("Could not start the QA agent:", error);
      evalResults.push(createErrorResult(evalCase));
      continue;
    }

    if (agentRun.returnCode !== 0 || !agentRun.response) {
      if (agentRun.stderr) console.log(agentRun.stderr);
      evalResults.push(createErrorResult(evalCase));
      continue;
    }

    console.log("\nQA AGENT RESPONSE\n" + agentRun.response);

    try {
      const artifacts = await collectArtifactEvidence(evalCase);
      const referenceArtifacts = await loadReferenceArtifacts(evalCase);
      printArtifactProgress(artifacts, referenceArtifacts);
      console.log("[EVALUATOR] Evaluating the agent response.");
      const evaluation = await evaluateResponse(evalCase, {
        response: agentRun.response,
        returnCode: agentRun.returnCode,
        artifacts,
        referenceArtifacts,
      });
      console.log("[EVALUATOR] Evaluation finished.");
      printEvaluation(evaluation);
      evalResults.push(toEvalResult(evalCase, evaluation));
    } catch (error) {
      console.error("Evaluator error:", error);
      evalResults.push(createErrorResult(evalCase));
    }
  }

  const report = buildReport(evalResults);
  console.log("\n" + "=".repeat(80));
  console.log("EVALUATION SUMMARY");
  console.log("=".repeat(80));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log("QUALITY GATE STATUS:", report.quality_gate.status);

  await mkdir(resultsDirectory, { recursive: true });
  await writeFile(resultsPath, JSON.stringify(report, null, 2), "utf8");
  console.log("Results saved:", resultsPath);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
