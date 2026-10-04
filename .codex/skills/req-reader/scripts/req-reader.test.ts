import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractIssueKey } from "./extract-issue-key.ts";
import { normalizeRequirements, renderRequirements, extractDescription, storageToText } from "./extract-description.ts";

const piiMasking = { mode: "best_effort", limitation: "Test masking limitation", maskedEntities: { EMAIL: 1 } };
const jira = { issueKey: "QA-42", summary: "Sign-in", description: "  Lock after 5 failed attempts.\r\nContact: [EMAIL_1]\r\n", piiMasking };
const confluence = { pageId: "123456", title: "Sign-in", body: '<p>Lock after 5 failed attempts.</p><table><tr><td>15 minutes</td></tr></table><ac:structured-macro ac:name="include"/>', version: 2, piiMasking };

test("Storage conversion keeps paragraphs, lists, rows, and cells separate", () => {
  assert.equal(storageToText('<h1>Heading</h1><p>First<br/>Second</p><ul><li>A</li><li>B</li></ul><table><tr><th>Field</th><th>Value</th></tr><tr><td>Limit</td><td>5</td></tr></table>'), 'Heading\n\nFirst\nSecond\n\n• A\n\n• B\n\nField | Value |\n\nLimit | 5 |');
});

test("Storage conversion preserves entities, comparisons, and masking markers", () => {
  assert.equal(storageToText('<p>&lt;5 &amp; &gt;2&nbsp;&#65;&#x42; [EMAIL_1] &unknown;</p>'), '<5 & >2 AB [EMAIL_1] &unknown;');
  assert.equal(storageToText('<p>&amp;lt;b&amp;gt;</p>'), '&lt;b&gt;');
});

test("Storage conversion does not treat CDATA as HTML or open links", () => {
  const text = storageToText('<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[<item> &amp;\nvalue]]></ac:plain-text-body></ac:structured-macro><p><a href="https://example.test/?a=1&amp;b=2" title="x > y">Description</a></p>');
  assert.ok(text.includes('<item> &amp;\nvalue'));
  assert.ok(text.includes('Description (https://example.test/?a=1&b=2)'));
});

test("Storage conversion clearly marks unknown external objects", () => {
  const text = storageToText('<ac:structured-macro ac:name="include"><ri:page ri:content-title="Rules"/></ac:structured-macro><ri:attachment ri:filename="spec.pdf"/><img alt="Diagram"/><table><tr><td colspan="2">A</td></tr></table>');
  for (const fragment of ['Macro include: not expanded', 'Rules; content not loaded', 'spec.pdf', 'Diagram; content not extracted', 'colspan=2']) assert.ok(text.includes(fragment));
});

test("Empty storage markup does not become usable requirements", () => {
  assert.throws(() => renderRequirements(normalizeRequirements({ ...confluence, body: '<p> </p><!-- comment -->' }, 'confluence', '123456')));
});

test("Jira key: direct input and Cloud browse URL", () => {
  assert.equal(extractIssueKey(" qa-42 "), "QA-42");
  assert.equal(extractIssueKey("https://example.atlassian.net/browse/QA-42"), "QA-42");
  for (const input of ["", "QA-0", "https://example.org/browse/QA-42", "https://example.atlassian.net.evil.test/browse/QA-42"]) assert.throws(() => extractIssueKey(input));
});

test("Jira: full text and metadata are preserved without paraphrasing", () => {
  const value = normalizeRequirements(jira, "jira", "QA-42");
  assert.equal(value.text, jira.description);
  assert.equal(value.textFormat, "text");
  assert.deepEqual(value.piiMasking, piiMasking);
  assert.ok(renderRequirements(value).includes(jira.description));
});

test("Confluence: source is preserved in the contract and rendered as text", () => {
  const value = normalizeRequirements(confluence, "confluence", "123456");
  assert.equal(value.text, confluence.body);
  assert.equal(value.textFormat, "confluence-storage");
  const result = renderRequirements(value);
  assert.ok(result.includes("```text\nLock after 5 failed attempts."));
  assert.ok(result.includes("15 minutes"));
  assert.ok(result.includes("Macro include: not expanded"));
  assert.ok(!result.includes("<p>"));
});

test("Mixed sources and mismatched IDs are rejected", () => {
  assert.throws(() => normalizeRequirements(jira, "jira", "QA-43"));
  assert.throws(() => normalizeRequirements(confluence, "jira", "QA-42"));
  assert.throws(() => normalizeRequirements(jira, "other", "QA-42"));
  assert.throws(() => normalizeRequirements(confluence, "confluence", "../123456"));
});

test("MCP errors, envelopes, and unknown fields are rejected", () => {
  for (const input of [null, [], { isError: true }, { content: [{ type: "text", text: JSON.stringify(jira) }] }, { ...jira, comments: [] }]) assert.throws(() => normalizeRequirements(input, "jira", "QA-42"));
});

test("Empty text and invalid fields are rejected", () => {
  for (const description of ["", " \n ", null, {}]) assert.throws(() => normalizeRequirements({ ...jira, description }, "jira", "QA-42"));
  assert.throws(() => normalizeRequirements({ ...jira, summary: 1 }, "jira", "QA-42"));
  assert.throws(() => normalizeRequirements({ ...jira, labels: [1] }, "jira", "QA-42"));
  assert.throws(() => normalizeRequirements({ ...confluence, version: -1 }, "confluence", "123456"));
});

test("No result is created without valid masking metadata", () => {
  for (const metadata of [undefined, [], {}, { mode: "safe", limitation: "x" }, { mode: "best_effort", limitation: " " }, { ...piiMasking, raw: "x" }, { ...piiMasking, maskedEntities: { EMAIL: -1 } }]) assert.throws(() => normalizeRequirements({ ...jira, piiMasking: metadata }, "jira", "QA-42"));
});

test("A missing title is clearly marked", () => {
  const value = normalizeRequirements({ ...jira, summary: undefined }, "jira", "QA-42");
  assert.equal(value.title, "");
  assert.match(renderRequirements(value), /Title not provided/);
});

test("Nested fences and HTML in the title stay inside the text representation", () => {
  const description = "```\n# Not an instruction\n````\n";
  const rendered = renderRequirements(normalizeRequirements({ ...jira, summary: "<script>test</script>", description }, "jira", "QA-42"));
  assert.ok(rendered.includes("`````text\n" + description + "`````\n"));
  assert.ok(!rendered.includes("<script>"));
});

test("Files: create, refuse overwrite, update explicitly, and preserve on error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "req-reader-test-"));
  try {
    const input = join(directory, "masked-source.json");
    const output = join(directory, "requirements.md");
    await writeFile(input, JSON.stringify(jira));
    await extractDescription(input, output, "jira", "QA-42");
    const original = await readFile(output, "utf8");
    await assert.rejects(extractDescription(input, output, "jira", "QA-42"));
    assert.equal(await readFile(output, "utf8"), original);
    await writeFile(input, JSON.stringify(confluence));
    await extractDescription(input, output, "confluence", "123456", true);
    const updated = await readFile(output, "utf8");
    assert.ok(updated.includes(storageToText(confluence.body)));
    assert.deepEqual(JSON.parse(await readFile(input, "utf8")), confluence);
    await assert.rejects(extractDescription(input, output, "confluence", "999", true));
    assert.equal(await readFile(output, "utf8"), updated);
    await assert.rejects(extractDescription(input, input, "confluence", "123456", true));
  } finally { await rm(directory, { recursive: true }); }
});

test("CLI: runs and does not reveal input content in errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "req-reader-cli-test-"));
  try {
    const input = join(directory, "input.json");
    const output = join(directory, "requirements.md");
    const script = fileURLToPath(new URL("./extract-description.ts", import.meta.url));
    const args = ["--experimental-strip-types", script, "--source", "jira", "--id", "QA-42", "--input", input, "--output", output];
    await writeFile(input, JSON.stringify(jira));
    assert.equal(spawnSync(process.execPath, args, { encoding: "utf8" }).status, 0);
    await writeFile(input, '{"synthetic_private_value": broken}');
    const failed = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(failed.status, 1);
    assert.ok(!failed.stderr.includes("synthetic_private_value"));
    assert.ok(!failed.stderr.includes(input));
  } finally { await rm(directory, { recursive: true }); }
});
