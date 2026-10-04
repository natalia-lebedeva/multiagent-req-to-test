import type { MaskedConfluencePage } from "./confluence-masker.js";

export function logPiiAudit(page: MaskedConfluencePage): void {
  const total = Object.values(page.piiMasking.maskedEntities).reduce((sum, count) => sum + count, 0);
  console.error(`[${new Date().toISOString()}] PII masking audit for Confluence page ${page.pageId}: ${total} match${total === 1 ? "" : "es"} replaced`);
}
