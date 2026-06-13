const ABSOLUTE_PROTOCOL_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const RELATIVE_LINK_RE = /^(\/|\.\/|\.\.\/|#|\?)/;
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export function normalizeLearningLink(input?: string | null) {
  const value = input?.trim();
  if (!value || RELATIVE_LINK_RE.test(value)) return undefined;

  const candidate = ABSOLUTE_PROTOCOL_RE.test(value) ? value : `https://${value}`;

  try {
    const url = new URL(candidate);
    if (!ALLOWED_PROTOCOLS.has(url.protocol) || !url.hostname) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function isLearningLinkValid(input?: string | null) {
  return Boolean(normalizeLearningLink(input));
}
