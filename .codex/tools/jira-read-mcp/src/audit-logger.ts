import type { MaskCategory, MaskedIssue } from "./pii-masker.js";

type MaskedEntities = MaskedIssue["piiMasking"]["maskedEntities"];

export function formatPiiAuditLog(
  issueKey: string,
  maskedEntities: MaskedEntities,
): string {
  const entries = Object.entries(maskedEntities) as [MaskCategory, number][];
  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  if (total === 0) {
    return `PII masking audit for ${issueKey}: no configured patterns or known user fields matched`;
  }

  const replacements = entries.flatMap(([category, count]) =>
    Array.from({ length: count }, (_, index) => `[${category}_${index + 1}]`),
  );

  return (
    `PII masking audit for ${issueKey}: ${total} configured pattern or known-user ` +
    `match${total === 1 ? "" : "es"} replaced with ` +
    replacements.join(", ")
  );
}

export function logPiiAudit(issue: MaskedIssue): void {
  const message = formatPiiAuditLog(
    issue.issueKey,
    issue.piiMasking.maskedEntities,
  );

  // The message contains only counts and replacement markers; stdout is reserved for MCP stdio messages.
  console.error(`[${new Date().toISOString()}] ${message}`);
}
