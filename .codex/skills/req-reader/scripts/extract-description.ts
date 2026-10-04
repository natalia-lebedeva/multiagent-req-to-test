#!/usr/bin/env node
// Adapted from req-to-test's extract-description.ts to support two masked MCP servers.
import { mkdir, readFile, writeFile, link, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

type Source = "jira" | "confluence";
type Masking = { mode: "best_effort"; limitation: string; maskedEntities?: Record<string, number> };
export interface NormalizedRequirements {
  schemaVersion: 1;
  source: Source;
  id: string;
  title: string;
  text: string;
  textFormat: "text" | "confluence-storage";
  piiMasking: Masking;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object");
  return value as Record<string, unknown>;
}

function onlyFields(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Response contains unsupported fields");
}

function masking(value: unknown): Masking {
  const data = object(value);
  onlyFields(data, ["mode", "limitation", "maskedEntities"]);
  if (data.mode !== "best_effort" || typeof data.limitation !== "string" || !data.limitation.trim()) {
    throw new Error("Expected best_effort mode and a masking limitation description");
  }
  if (data.maskedEntities !== undefined) {
    const counts = object(data.maskedEntities);
    if (Object.entries(counts).some(([key, count]) => !/^[A-Z_]+$/.test(key) || !Number.isSafeInteger(count) || Number(count) < 0)) {
      throw new Error("Invalid masking counters");
    }
  }
  return data as Masking;
}

export function normalizeRequirements(value: unknown, source: string, expectedId: string): NormalizedRequirements {
  if (source !== "jira" && source !== "confluence") throw new Error("Source must be jira or confluence");
  const idPattern = source === "jira" ? /^[A-Z][A-Z0-9_]{0,49}-[1-9]\d*$/ : /^[1-9]\d*$/;
  if (!idPattern.test(expectedId)) throw new Error("Invalid expected ID");
  const data = object(value);
  onlyFields(data, source === "jira"
    ? ["issueKey", "summary", "description", "reporter", "assignee", "labels", "piiMasking"]
    : ["pageId", "title", "body", "version", "piiMasking"]);
  const id = source === "jira" ? data.issueKey : data.pageId;
  if (id !== expectedId) throw new Error("Response ID does not match the request");
  const text = source === "jira" ? data.description : data.body;
  if (typeof text !== "string" || !text.trim()) throw new Error("Requirements text is empty or has an invalid type");
  const title = source === "jira" ? data.summary : data.title;
  if (title !== undefined && typeof title !== "string") throw new Error("Invalid title");
  if (source === "jira") {
    for (const field of ["reporter", "assignee"]) {
      if (data[field] !== undefined && data[field] !== null && typeof data[field] !== "string") throw new Error("Invalid Jira fields");
    }
    if (data.labels !== undefined && (!Array.isArray(data.labels) || data.labels.some(label => typeof label !== "string"))) throw new Error("Invalid labels");
  } else if (data.version !== undefined && data.version !== null && (!Number.isSafeInteger(data.version) || Number(data.version) < 1)) {
    throw new Error("Invalid page version");
  }
  return { schemaVersion: 1, source, id: expectedId, title: title ?? "", text,
    textFormat: source === "jira" ? "text" : "confluence-storage", piiMasking: masking(data.piiMasking) };
}

function inline(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_{}\[\]()#!|~]/g, "\\$&");
}

export function storageToText(storage: string): string {
  const entities: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", bull: "•", copy: "©", reg: "®" };
  const decode = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (original, name: string) => {
    if (!name.startsWith("#")) return entities[name] ?? original;
    const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : original;
  });
  let output = "";
  let pre = 0;
  const links: string[] = [];
  // Decode only text tokens: escaped angle brackets and CDATA are content, not markup.
  const tokens = storage.match(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\/?[a-zA-Z][\w:.-]*(?:"[^"]*"|'[^']*'|[^'">])*\/?\s*>|[^<]+|</g) ?? [];
  for (const token of tokens) {
    if (token.startsWith("<!--")) continue;
    if (token.startsWith("<![CDATA[")) { output += token.slice(9, -3); continue; }
    const tag = /^<(\/?)([\w:.-]+)/.exec(token);
    if (!tag) { output += decode(pre ? token : token.replace(/\s+/g, " ")); continue; }
    const closing = !!tag[1];
    const name = tag[2].toLowerCase();
    const attr = (key: string) => {
      const match = new RegExp(`\\b${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(token);
      return decode(match?.[1] ?? match?.[2] ?? "");
    };
    if (name === "pre" || name === "ac:plain-text-body") pre = Math.max(0, pre + (closing ? -1 : 1));
    if (/^(p|div|h[1-6]|ul|ol|table|tr|blockquote|pre)$/.test(name) || name === "br" || name === "hr") output += "\n";
    if (name === "li") output += closing ? "\n" : "\n• ";
    if ((name === "td" || name === "th") && closing) output += " | ";
    if (!closing && (attr("colspan") || attr("rowspan"))) output += `[Merged cell: colspan=${attr("colspan") || "1"}, rowspan=${attr("rowspan") || "1"}] `;
    if (name === "a") {
      if (!closing) links.push(attr("href"));
      else { const href = links.pop(); if (href) output += ` (${href})`; }
    }
    if (!closing && name === "img") output += `[Image: ${attr("alt") || "no text description"}; content not extracted]`;
    if (!closing && (name === "ac:structured-macro" || name === "ac:macro")) output += `\n[Macro ${attr("ac:name") || "unnamed"}: not expanded; only text present in storage follows]\n`;
    if (name === "ac:parameter" || name === "ac:rich-text-body" || name === "ac:plain-text-body") output += "\n";
    if (!closing && name.startsWith("ri:")) output += `[Reference ${name.slice(3)}: ${attr("ri:content-title") || attr("ri:filename") || attr("ri:value") || "no text description"}; content not loaded]`;
  }
  return output.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function renderRequirements(req: NormalizedRequirements): string {
  const text = req.textFormat === "confluence-storage" ? storageToText(req.text) : req.text;
  if (!text.trim()) throw new Error("No requirements text is available after conversion");
  // Use a fence longer than any run of backticks in the input.
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map(run => run.length));
  const fence = "`".repeat(longest + 1);
  const metadata = [
    `# Requirements: ${inline(req.title.trim() ? req.title : "Title not provided")}`,
    "", "- Contract: NormalizedRequirements v1", `- Source: ${req.source}`,
    `- ID: ${req.id}`, `- Content format: text`,
    "- Masking: best_effort", `- Limitation: ${inline(req.piiMasking.limitation)}`,
  ];
  if (req.piiMasking.maskedEntities) metadata.push(`- Masking counts: ${inline(JSON.stringify(req.piiMasking.maskedEntities))}`);
  if (req.textFormat === "confluence-storage") metadata.push("- Representation: text converted from Confluence storage; the original masked response is saved in masked-source.json. Complex markup is simplified; unknown HTML entities are kept as-is; macros and attachments are not loaded.");
  return `${metadata.join("\n")}\n\n## Full Requirements Text\n\n${fence}text\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}\n`;
}

export async function extractDescription(inputPath: string, outputPath: string, source: string, id: string, overwrite = false): Promise<void> {
  if (resolve(inputPath) === resolve(outputPath)) throw new Error("Input and output paths must be different");
  let value: unknown;
  try { value = JSON.parse(await readFile(inputPath, "utf8")); }
  catch { throw new Error("Could not read the input JSON"); }
  const content = renderRequirements(normalizeRequirements(value, source, id));
  await mkdir(dirname(outputPath), { recursive: true });
  const temp = `${outputPath}.tmp-${randomUUID()}`;
  await writeFile(temp, content, { encoding: "utf8", flag: "wx" });
  try {
    if (overwrite) await rename(temp, outputPath);
    else await link(temp, outputPath);
  } finally {
    await unlink(temp).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}

async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2);
    const values = new Map<string, string>();
    let overwrite = false;
    for (let index = 0; index < args.length; index++) {
      const key = args[index];
      if (key === "--overwrite" && !overwrite) { overwrite = true; continue; }
      if (!["--source", "--id", "--input", "--output"].includes(key) || values.has(key) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Invalid arguments");
      values.set(key, args[++index]);
    }
    if (values.size !== 4) throw new Error("Required arguments: --source, --id, --input, and --output");
    await extractDescription(resolve(values.get("--input")!), resolve(values.get("--output")!), values.get("--source")!, values.get("--id")!, overwrite);
    process.stdout.write("Saved requirements.md\n");
  } catch {
    // Do not print input text, JSON parse snippets, or paths from system errors.
    process.stderr.write("Normalization failed. Check the arguments, response contract, ID, and output file access. Overwriting requires --overwrite.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
