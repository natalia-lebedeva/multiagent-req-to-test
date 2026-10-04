import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// A separate report generator.
// It reads an existing eval_results.json and does not run evaluation cases.

const evalsDirectory = import.meta.dirname;
const projectPath = path.resolve(evalsDirectory, "..");
const defaultInputPath = path.join(evalsDirectory, "results", "eval_results.json");
const defaultOutputPath = path.join(evalsDirectory, "results", "eval-report.html");

function getOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function resolveProjectPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(projectPath, filePath);
}

// Escape values before inserting them into HTML.
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function statusClass(status: string): string {
  return status.toLowerCase();
}

function renderCheckList(
  title: string,
  items: Array<Record<string, unknown>>,
  type: "expected" | "forbidden",
): string {
  if (items.length === 0) {
    return `<section><h4>${title}</h4><p class="muted">No checks listed.</p></section>`;
  }

  const rows = items.map((item) => {
    const passed = type === "expected"
      ? item.passed === true
      : item.violated !== true;
    const status = passed ? "PASS" : type === "expected" ? "FAIL" : "VIOLATED";
    const label = type === "expected" ? item.property : item.rule;

    return `
      <li class="check ${passed ? "check-pass" : "check-fail"}">
        <span class="check-status">${status}</span>
        <div>
          <div>${escapeHtml(label)}</div>
          <small>${escapeHtml(item.reason ?? "No reason provided")}</small>
        </div>
      </li>`;
  }).join("");

  return `<section><h4>${title}</h4><ul class="checks">${rows}</ul></section>`;
}

function renderCase(result: Record<string, unknown>): string {
  const status = String(result.status ?? "UNKNOWN");
  const expectedResponse = result.expected_response as Record<string, unknown> | null | undefined;
  const expectedProperties = Array.isArray(result.expected_properties)
    ? result.expected_properties as Array<Record<string, unknown>>
    : [];
  const forbiddenBehavior = Array.isArray(result.forbidden_behavior)
    ? result.forbidden_behavior as Array<Record<string, unknown>>
    : [];

  return `
    <details class="case ${statusClass(status)}">
      <summary>
        <span class="status status-${statusClass(status)}">${escapeHtml(status)}</span>
        <span class="case-id">${escapeHtml(result.id)}</span>
        <span class="case-name">${escapeHtml(result.name)}</span>
        <span class="score">Score: ${escapeHtml(result.score)}</span>
      </summary>
      <div class="case-body">
        ${expectedResponse ? `
          <section>
            <h4>Expected Response</h4>
            <div class="response ${expectedResponse.matched === true ? "response-pass" : "response-fail"}">
              <strong>${expectedResponse.matched === true ? "PASS" : "FAIL"}</strong>
              <span>${escapeHtml(expectedResponse.reason ?? "No reason provided")}</span>
            </div>
          </section>` : ""}
        ${renderCheckList("Expected Properties", expectedProperties, "expected")}
        ${renderCheckList("Forbidden Behaviour", forbiddenBehavior, "forbidden")}
      </div>
    </details>`;
}

function renderReport(report: Record<string, unknown>): string {
  const summary = report.summary as Record<string, unknown>;
  const qualityGate = report.quality_gate as Record<string, unknown>;
  const results = Array.isArray(report.results)
    ? report.results as Array<Record<string, unknown>>
    : [];
  const overallStatus = String(summary.overall_status ?? qualityGate.status ?? "UNKNOWN");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Evaluation Report</title>
  <style>
    :root { font-family: Segoe UI, Arial, sans-serif; color: #172033; background: #f4f7fb; }
    body { max-width: 1180px; margin: 0 auto; padding: 32px; }
    h1 { margin: 0 0 8px; } h2 { margin-top: 30px; }
    .subtitle, .muted, small { color: #667085; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 24px 0; }
    .card { background: white; border: 1px solid #d9e1ee; border-radius: 12px; padding: 16px; box-shadow: 0 2px 8px #17203312; }
    .card-label { color: #667085; font-size: 13px; } .card-value { font-size: 26px; font-weight: 700; margin-top: 6px; }
    .pass { color: #087443; } .fail { color: #b42318; } .error { color: #b54708; }
    .status { border-radius: 999px; padding: 4px 9px; font-size: 12px; font-weight: 700; }
    .status-pass { background: #dcfae6; color: #087443; } .status-fail { background: #fee4e2; color: #b42318; }
    .status-error { background: #fef0c7; color: #b54708; }
    details.case { background: white; border: 1px solid #d9e1ee; border-radius: 12px; margin: 12px 0; overflow: hidden; }
    summary { cursor: pointer; display: flex; align-items: center; gap: 12px; padding: 16px; list-style: none; }
    summary::-webkit-details-marker { display: none; } .case-name { flex: 1; } .case-id { font-weight: 700; }
    .case-body { border-top: 1px solid #e6ebf2; padding: 4px 20px 20px; }
    h4 { margin-bottom: 10px; } section { margin-top: 18px; }
    .checks { padding: 0; margin: 0; list-style: none; } .check { display: flex; gap: 10px; padding: 10px; border-bottom: 1px solid #eef2f6; }
    .check-status { min-width: 72px; font-weight: 700; font-size: 12px; } .check-pass .check-status { color: #087443; } .check-fail .check-status { color: #b42318; }
    .check small { display: block; margin-top: 4px; } .response { display: flex; gap: 12px; padding: 12px; border-radius: 8px; background: #f4f7fb; }
    .response-pass strong { color: #087443; } .response-fail strong { color: #b42318; }
  </style>
</head>
<body>
  <h1>Evaluation Report</h1>
  <div class="subtitle">Summary of the automated evaluation run</div>
  <div class="summary">
    <div class="card"><div class="card-label">Quality Gate</div><div class="card-value ${statusClass(overallStatus)}">${escapeHtml(overallStatus)}</div></div>
    <div class="card"><div class="card-label">Total cases</div><div class="card-value">${escapeHtml(summary.total)}</div></div>
    <div class="card"><div class="card-label">Passed</div><div class="card-value pass">${escapeHtml(summary.passed)}</div></div>
    <div class="card"><div class="card-label">Failed</div><div class="card-value fail">${escapeHtml(summary.failed)}</div></div>
    <div class="card"><div class="card-label">Pass rate</div><div class="card-value">${escapeHtml(summary.pass_rate)}%</div></div>
    <div class="card"><div class="card-label">Expected Properties</div><div class="card-value">${escapeHtml(summary.expected_properties_pass_rate)}%</div></div>
  </div>
  <h2>Eval Cases</h2>
  ${results.length > 0 ? results.map(renderCase).join("") : "<p class=\"muted\">No results found.</p>"}
</body>
</html>`;
}

async function main(): Promise<void> {
  const inputPath = resolveProjectPath(getOption("--input") ?? defaultInputPath);
  const outputPath = resolveProjectPath(getOption("--output") ?? defaultOutputPath);
  const report = JSON.parse(await readFile(inputPath, "utf8")) as Record<string, unknown>;
  await writeFile(outputPath, renderReport(report), "utf8");
  console.log("Report created:", outputPath);
}

main().catch((error) => {
  console.error("Could not create the HTML report:", error);
  process.exitCode = 1;
});
