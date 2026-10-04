export type MaskCategory =
  | "EMAIL"
  | "PHONE"
  | "PASSWORD"
  | "API_SECRET"
  | "BEARER_TOKEN"
  | "IBAN"
  | "CARD_NUMBER"
  | "REPORTER"
  | "ASSIGNEE"
  | "USER"
  | "ACCOUNT_ID";

export interface PiiMaskingMetadata {
  mode: "best_effort";
  maskedEntities: Partial<Record<MaskCategory, number>>;
  limitation: string;
}

export const PII_MASKING_LIMITATION =
  "Pattern-based masking may miss sensitive data in free-form text; this output is not guaranteed to be anonymized.";

const PATTERNS = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  phone: /(?<![\dA-Za-z])\+?\d[\d\s\-()]{7,}\d(?![\dA-Za-z])/g,
  password: /(password\s*[:=]\s*)\S+/gi,
  passwordList: /((?:passwords?)\s*:\s*)([^<\r\n]+)/gi,
  apiSecret:
    /((?:api\s*[_-]?\s*key|access\s*[_-]?\s*token|auth\s*[_-]?\s*token|client\s*[_-]?\s*secret|secret)\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{16,}["']?/gi,
  bearerToken: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  iban: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
  cardCandidate: /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g,
} as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isValidCard(candidate: string): boolean {
  const digits = candidate.replace(/[ -]/g, "");
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

export class MaskingSession {
  private readonly values = new Map<string, string>();
  private readonly counts: Partial<Record<MaskCategory, number>> = {};

  public token(category: MaskCategory, value?: string): string {
    const key = value ? `${category}:${value.toLocaleLowerCase()}` : undefined;
    if (key && this.values.has(key)) return this.values.get(key)!;

    const number = (this.counts[category] ?? 0) + 1;
    this.counts[category] = number;
    const token = `[${category}_${number}]`;
    if (key) this.values.set(key, token);
    return token;
  }

  public registerKnownValue(value: string, token: string): void {
    if (value) this.values.set(`KNOWN:${value.toLocaleLowerCase()}`, token);
  }

  private maskKnownValues(text: string): string {
    const known = [...this.values.entries()]
      .filter(([key]) => key.startsWith("KNOWN:"))
      .sort((a, b) => b[0].length - a[0].length);

    return known.reduce((result, [key, token]) => {
      const rawValue = key.slice("KNOWN:".length);
      return result.replace(new RegExp(escapeRegExp(rawValue), "gi"), token);
    }, text);
  }

  public maskText(input: string): string {
    let text = this.maskKnownValues(input);
    text = text.replace(PATTERNS.iban, (value) => this.token("IBAN", value));

    const protectedCardCandidates: string[] = [];
    text = text.replace(PATTERNS.cardCandidate, (value) => {
      if (isValidCard(value)) return this.token("CARD_NUMBER", value);
      const marker = `\uE000CARD_${protectedCardCandidates.length}\uE001`;
      protectedCardCandidates.push(value);
      return marker;
    });

    text = text.replace(PATTERNS.password, (_match, prefix: string) =>
      `${prefix}${this.token("PASSWORD")}`,
    );
    text = text.replace(PATTERNS.passwordList, (_match, prefix: string, values: string) =>
      `${prefix}${values.replace(/(^|[,;]\s*)([^\s,;]+)/g, (_value, separator: string) =>
        `${separator}${this.token("PASSWORD")}`)}`,
    );
    text = text.replace(PATTERNS.apiSecret, (_match, prefix: string) =>
      `${prefix}${this.token("API_SECRET")}`,
    );
    text = text.replace(PATTERNS.bearerToken, (value) =>
      `Bearer ${this.token("BEARER_TOKEN", value)}`,
    );
    text = text.replace(PATTERNS.email, (value) => this.token("EMAIL", value));
    text = text.replace(PATTERNS.phone, (value) => this.token("PHONE", value));

    protectedCardCandidates.forEach((value, index) => {
      text = text.replace(`\uE000CARD_${index}\uE001`, value);
    });

    return text;
  }

  public maskValue(value: unknown): unknown {
    if (typeof value === "string") return this.maskText(value);
    if (Array.isArray(value)) return value.map((item) => this.maskValue(item));
    if (!value || typeof value !== "object") return value;

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, this.maskValue(item)]),
    );
  }

  public summary(): Partial<Record<MaskCategory, number>> {
    return { ...this.counts };
  }

  public metadata(): PiiMaskingMetadata {
    return {
      mode: "best_effort",
      maskedEntities: this.summary(),
      limitation: PII_MASKING_LIMITATION,
    };
  }
}
