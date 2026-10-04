export interface ConfluenceConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function normalizeConfluenceBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("CONFLUENCE_URL must be an absolute HTTPS URL");
  }
  if (url.protocol !== "https:") throw new Error("CONFLUENCE_URL must use HTTPS");
  if (url.username || url.password) throw new Error("CONFLUENCE_URL must not contain credentials");
  if (url.search) throw new Error("CONFLUENCE_URL must not contain a query");
  if (url.hash) throw new Error("CONFLUENCE_URL must not contain a fragment");
  if (url.pathname !== "/") throw new Error("CONFLUENCE_URL must not contain a path");
  return url.origin;
}

export function loadConfig(): ConfluenceConfig {
  return {
    baseUrl: normalizeConfluenceBaseUrl(required("CONFLUENCE_URL")),
    email: required("CONFLUENCE_EMAIL"),
    apiToken: required("CONFLUENCE_API_TOKEN"),
  };
}
