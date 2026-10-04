import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { pathToFileURL } from "node:url";

function loadDotEnv(path) {
  let text;
  try { text = readFileSync(path, "utf8"); } catch { return; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function launchOptions(os = platform()) {
  // Windows cannot execute a .cmd file directly through spawn. Shell text is constant.
  return os === "win32"
    ? { command: "cmd.exe", args: ["/d", "/s", "/c", "npx -y @aashari/mcp-server-atlassian-jira"] }
    : { command: "npx", args: ["-y", "@aashari/mcp-server-atlassian-jira"] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadDotEnv(".env");
  const { command, args } = launchOptions();
  const child = spawn(command, args, { stdio: "inherit", env: process.env, windowsHide: true });
  child.on("error", () => { console.error("jira-write-mcp startup failed"); process.exitCode = 1; });
  child.on("exit", (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1; });
}
