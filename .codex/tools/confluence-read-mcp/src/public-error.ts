const SAFE_MESSAGES = [
  /^Missing required environment variable: CONFLUENCE_(?:URL|EMAIL|API_TOKEN)$/,
  /^CONFLUENCE_URL must (?:be an absolute HTTPS URL|use HTTPS|not contain (?:credentials|a query|a fragment|a path))$/,
  /^Invalid Confluence page ID$/,
  /^Confluence request failed with HTTP \d{3}$/,
];

export function publicErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Confluence request failed";
  return SAFE_MESSAGES.some((pattern) => pattern.test(error.message))
    ? error.message
    : "Confluence request failed";
}
