import { MaskingSession, type PiiMaskingMetadata } from "@req-to-test/pii-masking";
import type { ConfluencePage } from "./confluence-client.js";

export interface MaskedConfluencePage {
  pageId: string;
  title: string;
  body: string;
  version: number | null;
  piiMasking: PiiMaskingMetadata;
}

function maskAccountIds(storage: string, session: MaskingSession): string {
  return storage.replace(
    /(\bri:account-id\s*=\s*["'])([^"']+)(["'])/gi,
    (_match, prefix: string, accountId: string, suffix: string) =>
      `${prefix}${session.token("ACCOUNT_ID", accountId)}${suffix}`,
  );
}

export function maskPage(page: ConfluencePage): MaskedConfluencePage {
  const session = new MaskingSession();
  const title = session.maskText(page.title ?? "");
  const storage = maskAccountIds(page.body?.storage?.value ?? "", session);
  return {
    pageId: page.id,
    title,
    body: session.maskText(storage),
    version: page.version?.number ?? null,
    piiMasking: session.metadata(),
  };
}
