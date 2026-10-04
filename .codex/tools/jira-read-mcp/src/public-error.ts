const SAFE_MESSAGES = [
  /^Missing required environment variable: JIRA_(?:BASE_URL|EMAIL|API_TOKEN)$/,
  /^JIRA_BASE_URL must (?:be an absolute HTTPS URL|use HTTPS|not contain (?:credentials|a query|a fragment|a path))$/,
  /^Invalid Jira issue key$/,
  /^Jira request failed with HTTP \d{3}$/,
];

export function publicErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Jira request failed";
  return SAFE_MESSAGES.some((pattern) => pattern.test(error.message))
    ? error.message
    : "Jira request failed";
}
