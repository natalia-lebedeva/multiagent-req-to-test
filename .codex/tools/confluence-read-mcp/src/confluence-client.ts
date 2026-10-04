import type { ConfluenceConfig } from "./config.js";

export interface ConfluencePage {
  id: string;
  title?: string;
  body?: { storage?: { value?: string; representation?: string } };
  version?: { number?: number };
}

export function normalizePageId(value: string): string {
  const pageId = value.trim();
  if (!/^[1-9]\d*$/.test(pageId)) throw new Error("Invalid Confluence page ID");
  return pageId;
}

export class ConfluenceClient {
  public constructor(private readonly config: ConfluenceConfig) {}

  public async getPage(rawPageId: string): Promise<ConfluencePage> {
    const pageId = normalizePageId(rawPageId);
    const url = new URL(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}`, this.config.baseUrl);
    url.searchParams.set("body-format", "storage");
    const authorization = Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString("base64");
    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: `Basic ${authorization}` },
    });
    if (!response.ok) throw new Error(`Confluence request failed with HTTP ${response.status}`);
    return (await response.json()) as ConfluencePage;
  }
}
