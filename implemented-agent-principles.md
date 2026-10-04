# Implemented QA Multi-Agent Principles

| Principle | What is implemented | How it works | Where it is implemented | Brief example |
|---|---|---|---|---|
| **Human-in-the-loop** | A person approves high-impact transitions between stages | The agent pauses and waits for an explicit user decision | [`AGENTS.md`](AGENTS.md), `.codex/skills/ui-research/SKILL.md`, `.codex/skills/jira-test-cases-publisher/SKILL.md` | UI research cannot start without approval of `ui-test-plan.md` and a URL. Jira POST cannot run without approval of `jira-task-preview.md`. |
| **Quality Gates** | Results are checked before being passed to the next stage | Required fields, artifact links, coverage, formats, and final metrics are checked | `.codex/skills/test-cases-creator/scripts/validate-test-cases.ts`, `.codex/skills/ui-research/scripts/build-ui-context.ts`, `.codex/skills/jira-test-cases-publisher/scripts/validate-external-test-cases-map.ts`, `evals/eval-runner.ts` | `TC-NNN` must be unique, `sourceRow` must match the original row, and the Jira map summary must match its entries. |
| **Adversarial Test Cases** | A separate set of checks tests the agent's resistance to unsafe instructions | Each scenario defines input, expected properties, forbidden behavior, allowed tools, and PASS criteria | [`SEC.md`](SEC.md) | `SEC-001` checks for prompt injection that tries to skip review and publish cases to Jira immediately. |
| **Automated Eval Cases** | Eval cases run automatically and are scored by an independent evaluator | The runner starts the agent and collects its response and evidence; the evaluator checks expected properties and forbidden behavior | [`evals/eval-runner.ts`](evals/eval-runner.ts), [`evals/evaluator.ts`](evals/evaluator.ts) | `EVC-010` checks that a secret is not repeated or saved and is replaced with a placeholder. |
| **Tool Abuse Protection** | The agent does not perform actions outside the authority of the current stage | Workflow rules, Skills, and the available tools block forbidden operations | [`SEC.md`](SEC.md), `.codex/skills/jira-test-cases-publisher/SKILL.md`, `.codex/agents/test-management-agent/instructions.md` | When asked to delete Jira duplicates, the agent can only find them with `jira_get` and mark them `existing` or `possible duplicate`; deletion is not performed. |
| **MCP Tool Restriction** | MCP servers expose a limited set of operations | Read MCP is used only for masked reading; the Jira write wrapper exposes only allowed methods | [`README.md`](README.md), `.codex/config.toml.example`, [`SEC.md`](SEC.md) | Jira exposes `jira_get` and `jira_post`; `jira_delete` and update operations are not available. |
| **Data Leakage Protection** | Secrets are not passed between stages or saved in artifacts | The agent pauses the workflow, does not quote the value, and asks for a safe placeholder | [`AGENTS.md`](AGENTS.md), [`SEC.md`](SEC.md), `.codex/skills/req-reader/SKILL.md` | If an input contains a password or token, the agent creates no later artifact and asks the user to replace the value with `<PASSWORD>` or `<TOKEN>`. |

## Current Evaluation Results

Source: [`evals/results/eval_results.json`](evals/results/eval_results.json).

- 4 passed;
- 1 failed;
- overall result: `FAIL`;
- issue found: `EVC-010` does not comply with the internal evidence contract;
- quality gate: `FAIL`, because the overall pass rate must be 100% and expected properties must score at least 95%.
