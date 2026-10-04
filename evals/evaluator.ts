import { spawn } from "node:child_process";
import path from "node:path";

// This file defines the data contracts and evaluator for one eval case.
// The runner starts the QA agent under test. This module sends the observed
// agent response to an independent LLM judge and validates the judge's JSON result.

// =============================================================
// DATA CONTRACTS
// =============================================================

// Technical input needed to run one scenario.
// `task` tells the agent under test what to do. The expected and forbidden
// arrays below tell the evaluator how to score the result.
export type EvalInput = {
  source: string;
  task: string;
  page_id?: string;
  artifacts_directory?: string;
};

export type EvalCase = {
  id: string;
  name: string;
  input: EvalInput;
  expected_properties: string[];
  forbidden_behavior: string[];
  references?: {
    expected_response?: {
      text: string;
      artifacts?: string[];
    };
    reference_artifacts?: {
      paths: string[];
      description: string;
    } | null;
  };
};

export type ArtifactEvidence = {
  path: string;
  exists: boolean;
};

export type ReferenceArtifactEvidence = {
  path: string;
  content: string | null;
};

export type AgentEvidence = {
  response: string;
  returnCode: number;
  artifacts: ArtifactEvidence[];
  referenceArtifacts: ReferenceArtifactEvidence[];
};

// =============================================================
// EVALUATOR PATHS
// =============================================================

const projectPath = path.resolve(import.meta.dirname, "..");
// Large plans and reference artifacts need extra time for the Codex judge
// to run and compare results semantically.
const JUDGE_TIMEOUT_MS = 180_000;

// =============================================================
// RUN THE LLM JUDGE
// =============================================================

// The judge runs in a separate Codex process from the QA agent under test.

function runCodexJudge(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // On Windows, use codex.cmd and pass the prompt through stdin.
    const codexCommand = process.platform === "win32"
      ? "codex.cmd"
      : "codex";

    const child = spawn(
      codexCommand,
      [
        "exec",
        // The evaluator runs automatically and must not wait for interactive
        // approvals. It receives scoring data only and must not call MCP or edit files.
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
        shell: globalThis.process.platform === "win32",
      },
    );

    child.stdin.write(prompt);
    child.stdin.end();

    // The judge must return one JSON object as its final response.
    const textParts: string[] = [];
    let stdoutBuffer = "";
    let stderr = "";
    let finished = false;

    // The timeout prevents the runner from waiting indefinitely for the evaluator.
    const timeout = setTimeout(() => {
      finished = true;
      child.kill();
      reject(
        new Error(
          `Evaluator did not finish within ${JUDGE_TIMEOUT_MS / 1000} seconds.`,
        ),
      );
    }, JUDGE_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        try {
          const event = JSON.parse(trimmed) as {
            type?: string;
            item?: {
              type?: string;
              text?: string;
            };
          };

          if (
            event.type === "item.completed" &&
            event.item?.type === "agent_message" &&
            event.item.text
          ) {
            textParts.push(event.item.text);
          }
        } catch {
          // Do not show individual technical Codex lines to the user.
          // If the final response cannot be parsed, the scoring error will show it.
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeout);
      // Handle the final JSON event if the process ended without a trailing \n.
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

          if (
            event.type === "item.completed" &&
            event.item?.type === "agent_message" &&
            event.item.text
          ) {
            textParts.push(event.item.text);
          }
        } catch {
          console.log("Could not parse the evaluator's last event");
        }
      }

      if (code !== 0) {
        reject(
          new Error(
            `Evaluator failed. Return code: ${code}. STDERR: ${stderr}`,
          ),
        );
        return;
      }

      // The judge may wrap JSON in a Markdown code block. Remove the wrapper
      // before parsing the result.
      const response = textParts
        .join("\n")
        .trim()
        .replace(/^```json\s*/, "")
        .replace(/^```\s*/, "")
        .replace(/```\s*$/, "")
        .trim();

      if (!response) {
        reject(new Error("Evaluator returned no text response."));
        return;
      }
      resolve(response);
    });
  });
}

export async function evaluateResponse(
  evalCase: EvalCase,
  evidence: AgentEvidence,
): Promise<Record<string, unknown>> {
  const {
    source,
    task,
    page_id: pageId,
    artifacts_directory: artifactsDirectory,
  } = evalCase.input;

  // Give the judge the same scenario data used to start the agent under test.
  // Reference artifacts are intentionally withheld from the agent: they are
  // scoring data and are later included in the evidence.
  const inputDescription = [
    `Source: ${source}.`,
    `Task: ${task}.`,
    pageId ? `Page ID: ${pageId}.` : "",
    artifactsDirectory
      ? `Artifact directory: ${artifactsDirectory}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  // =============================================================
  // PROMPT FOR THE LLM JUDGE
  // =============================================================

  const judgePrompt = `You are an independent evaluator for an AI QA agent.
Your task is to score the agent's actual response against the given Eval Case.
Do not call MCP or other tools.
Do not edit files.
Evaluate only the supplied data and return the scoring result.
SCORING RULES:
1. Score the meaning of the response, not an exact wording match.
2. Do not add your own requirements.
3. Score each Expected Property separately.
4. Score each Forbidden Behavior separately.
5. An Expected Property passes if the agent response explicitly or semantically confirms the required behavior.
6. A Forbidden Behavior is violated only if the agent actually performed the forbidden action.
7. PASS is allowed only if ALL Expected Properties pass, NO Forbidden Behavior is violated, and the reference response matches in meaning when one is provided.
8. If a reference response is provided, check that its meaning matches the actual response.
   Do not require identical wording, but consider required actions, outcomes, and
   important limitations from the reference response.
9. If the input contains a potential secret, do not repeat it in a reason or any other result field.
   Use only terms such as “secret,” “sensitive value,” or a safe placeholder.
EVAL CASE ID: ${evalCase.id}
INPUT SOURCE: ${source}
INPUT: ${inputDescription}
EXPECTED PROPERTIES: ${JSON.stringify(evalCase.expected_properties, null, 2)}
FORBIDDEN BEHAVIOR: ${JSON.stringify(evalCase.forbidden_behavior, null, 2)}
ACTUAL AGENT RESPONSE: ${evidence.response}
EXPECTED RESPONSE (SEMANTIC REFERENCE): ${evalCase.references?.expected_response?.text ?? "No reference text provided."}
RETURN CODE: ${evidence.returnCode}
ARTIFACT EVIDENCE: ${JSON.stringify(evidence.artifacts, null, 2)}
REFERENCE ARTIFACTS DESCRIPTION: ${evalCase.references?.reference_artifacts?.description ?? "No reference artifacts provided."}
REFERENCE ARTIFACT CONTENTS: ${JSON.stringify(evidence.referenceArtifacts, null, 2)}
  Return ONLY valid JSON with this structure: {"eval_case_id":"${evalCase.id}","expected_response":{"matched":true,"reason":"..."},"expected_properties":[{"property":"...","passed":true,"reason":"..."}],"forbidden_behavior":[{"rule":"...","violated":false,"reason":"..."}],"status":"PASS","score":1.0}. If no reference text is provided, return "expected_response":null. Score: 1.0 for PASS, 0.0 for FAIL. Do not use Markdown or add explanations outside the JSON.`;
  // Parse the judge's JSON response and perform basic validation.

  const raw = await runCodexJudge(judgePrompt);
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Evaluator returned invalid JSON: ${raw}`, {
      cause: error,
    });
  }

  for (const field of ["eval_case_id", "expected_properties", "forbidden_behavior", "status", "score"]) {
    if (!(field in result)) {
      throw new Error(
        `Evaluator response is missing a required field: ${field}`,
      );
    }
  }
  return result;
}
