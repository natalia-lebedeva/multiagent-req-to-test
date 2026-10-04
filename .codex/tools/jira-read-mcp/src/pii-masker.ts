import {
  MaskingSession,
  type MaskCategory,
  type PiiMaskingMetadata,
} from "@req-to-test/pii-masking";
import type { JiraIssue, JiraUser } from "./jira-client.js";

export type { MaskCategory } from "@req-to-test/pii-masking";

export interface MaskedIssue {
  issueKey: string;
  summary: string;
  description: string;
  reporter: string | null;
  assignee: string | null;
  labels: string[];
  piiMasking: PiiMaskingMetadata;
}

function renderAdfNode(value: unknown, indent = 0): string {
  if (!value || typeof value !== "object") return "";
  const node = value as Record<string, unknown>;
  const content = Array.isArray(node.content) ? node.content : [];

  if (node.type === "text") {
    return typeof node.text === "string" ? node.text : "";
  }
  if (node.type === "mention") {
    const attrs = node.attrs as Record<string, unknown> | undefined;
    return typeof attrs?.text === "string" ? attrs.text : "";
  }
  if (node.type === "hardBreak") return "\n";

  if (node.type === "bulletList" || node.type === "orderedList") {
    const start =
      node.type === "orderedList" && node.attrs && typeof node.attrs === "object"
        ? Number((node.attrs as Record<string, unknown>).order) || 1
        : 1;

    return content
      .map((item, index) => {
        const marker = node.type === "bulletList" ? "-" : `${start + index}.`;
        const rendered = renderAdfNode(item, indent + 2).trim();
        const continuation = " ".repeat(indent + marker.length + 1);
        return (
          " ".repeat(indent) +
          marker +
          " " +
          rendered.replace(/\n/g, `\n${continuation}`)
        );
      })
      .join("\n");
  }

  const rendered = content.map((item) => renderAdfNode(item, indent)).join("");
  if (["paragraph", "heading", "listItem"].includes(String(node.type))) {
    return `${rendered.trimEnd()}\n`;
  }
  if (node.type === "doc") return rendered.trim();
  return rendered;
}

function toPlainText(value: unknown): string {
  if (typeof value === "string") return value;
  return renderAdfNode(value).trim();
}

function maskKnownUser(
  session: MaskingSession,
  user: JiraUser | null | undefined,
  role: "REPORTER" | "ASSIGNEE",
): string | null {
  if (!user) return null;

  const roleToken = session.token(
    role,
    user.accountId ?? user.displayName ?? role,
  );
  for (const value of [user.displayName, user.emailAddress]) {
    if (value) session.registerKnownValue(value, roleToken);
  }
  if (user.accountId) {
    const accountToken = session.token("ACCOUNT_ID", user.accountId);
    session.registerKnownValue(user.accountId, accountToken);
  }
  return roleToken;
}

function maskAdfValue(session: MaskingSession, value: unknown): unknown {
  if (typeof value === "string") return session.maskText(value);
  if (Array.isArray(value)) {
    return value.map((item) => maskAdfValue(session, item));
  }
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  if (record.type === "mention" && record.attrs && typeof record.attrs === "object") {
    const attrs = record.attrs as Record<string, unknown>;
    const id = typeof attrs.id === "string" ? attrs.id : undefined;
    const text = typeof attrs.text === "string" ? attrs.text : undefined;
    return {
      ...record,
      attrs: {
        ...attrs,
        ...(id ? { id: session.token("ACCOUNT_ID", id) } : {}),
        ...(text ? { text: session.token("USER", id ?? text) } : {}),
      },
    };
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [
      key,
      key === "localId" ? item : maskAdfValue(session, item),
    ]),
  );
}

export function maskIssue(issue: JiraIssue): MaskedIssue {
  const session = new MaskingSession();
  const reporter = maskKnownUser(session, issue.fields.reporter, "REPORTER");
  const assignee = maskKnownUser(session, issue.fields.assignee, "ASSIGNEE");
  const summary = session.maskText(issue.fields.summary ?? "");
  const description = toPlainText(
    maskAdfValue(session, issue.fields.description ?? null),
  );
  const labels = (issue.fields.labels ?? []).map((label) =>
    session.maskText(label),
  );

  return {
    issueKey: issue.key,
    summary,
    description,
    reporter,
    assignee,
    labels,
    piiMasking: session.metadata(),
  };
}
