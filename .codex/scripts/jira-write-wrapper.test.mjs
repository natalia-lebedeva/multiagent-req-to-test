import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { launchOptions } from "./jira-write-wrapper.mjs";

test("Windows launcher executes through cmd; Unix uses npx directly", () => {
  assert.deepEqual(launchOptions("win32"), { command: "cmd.exe", args: ["/d", "/s", "/c", "npx -y @aashari/mcp-server-atlassian-jira"] });
  assert.deepEqual(launchOptions("linux"), { command: "npx", args: ["-y", "@aashari/mcp-server-atlassian-jira"] });
});

test("Windows launch mechanism runs a harmless command without env or network", { skip: process.platform !== "win32" }, () => {
  const { command, args } = launchOptions("win32");
  const result = spawnSync(command, [...args.slice(0, -1), "echo launcher-ok"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "launcher-ok");
});
