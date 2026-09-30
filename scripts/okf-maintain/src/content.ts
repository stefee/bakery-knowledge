import { parse, parseDocument } from "yaml";

/** Keys that are not part of a concept's content (spec §5.1). */
const EXCLUDED_KEYS = ["generated", "verified"];

export interface Split {
  /** Raw frontmatter text between the fences (no trailing newline), or null when there is none. */
  frontmatter: string | null;
  /** Offset in the original text where the frontmatter text ends (just before the closing fence's newline). */
  frontmatterEnd: number;
  body: string;
}

const FENCE = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(text: string): Split {
  const m = FENCE.exec(text);
  if (!m) return { frontmatter: null, frontmatterEnd: 0, body: text };
  const fm = m[1] ?? "";
  return { frontmatter: fm, frontmatterEnd: text.indexOf("\n") + 1 + fm.length, body: text.slice(m[0].length) };
}

export type Frontmatter = Record<string, unknown>;

export type Parsed =
  | { ok: true; frontmatter: Frontmatter; body: string }
  | { ok: false; reason: string };

export function parseConcept(text: string): Parsed {
  const split = splitFrontmatter(text);
  if (split.frontmatter === null) return { ok: false, reason: "no frontmatter" };
  let value: unknown;
  try {
    value = parse(split.frontmatter);
  } catch (err) {
    return { ok: false, reason: `invalid YAML: ${(err as Error).message.split("\n")[0]}` };
  }
  if (value === null || value === undefined) value = {};
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "frontmatter is not a mapping" };
  }
  return { ok: true, frontmatter: value as Frontmatter, body: split.body };
}

export function normaliseBody(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) out[k] = canonical((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

/**
 * A comparable representation of a concept's content (spec §5.1), or null when the
 * text can't be parsed. Null never compares equal to anything, including itself.
 */
export function contentKey(text: string | null): string | null {
  if (text === null) return null;
  const parsed = parseConcept(text);
  if (!parsed.ok) return null;
  const fm: Frontmatter = { ...parsed.frontmatter };
  for (const k of EXCLUDED_KEYS) delete fm[k];
  return JSON.stringify({ fm: canonical(fm), body: normaliseBody(parsed.body) });
}

export function sameContent(a: string | null, b: string | null): boolean {
  const ka = contentKey(a);
  const kb = contentKey(b);
  return ka !== null && kb !== null && ka === kb;
}

/**
 * Sets one top-level frontmatter key to an already-rendered `key: value` line,
 * replacing it in place if present and appending it otherwise. Every other byte is
 * left alone. Creates the frontmatter block when the text has none.
 */
export function setKey(text: string, key: string, line: string): string {
  const split = splitFrontmatter(text);
  if (split.frontmatter === null) return `---\n${line}\n---\n${text.length && !text.startsWith("\n") ? "\n" : ""}${text}`;
  const doc = parseDocument(split.frontmatter);
  const offset = text.indexOf("\n") + 1;
  const map = doc.contents as { items?: { key: { value?: unknown; range?: number[] }; value: { range?: number[] } | null }[] } | null;
  const pair = map?.items?.find((p) => p.key?.value === key);
  if (pair?.key.range && pair.value?.range) {
    let end = pair.value.range[1];
    while (end > pair.key.range[0] && /\s/.test(split.frontmatter[end - 1] ?? "")) end--;
    return text.slice(0, offset + pair.key.range[0]) + line + text.slice(offset + end);
  }
  if (pair?.key.range) {
    // `key:` with no value.
    let end = split.frontmatter.indexOf("\n", pair.key.range[1]);
    if (end === -1) end = split.frontmatter.length;
    return text.slice(0, offset + pair.key.range[0]) + line + text.slice(offset + end);
  }
  const at = split.frontmatterEnd;
  return split.frontmatter.length === 0 ? text.slice(0, at) + line + "\n" + text.slice(at) : text.slice(0, at) + "\n" + line + text.slice(at);
}

export function getString(fm: Frontmatter, key: string): string | undefined {
  const v = fm[key];
  if (v === undefined || v === null) return undefined;
  const s = String(v);
  return s.trim() === "" ? undefined : s;
}
