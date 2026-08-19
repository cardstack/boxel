import { parse as parseYaml } from 'yaml';

export interface ParsedFrontmatter {
  // The parsed YAML frontmatter as a plain object (empty when the file has no
  // frontmatter block).
  data: Record<string, unknown>;
  // The markdown body with the leading frontmatter block removed.
  body: string;
}

// Matches a leading YAML frontmatter block delimited by `---` fences at the
// very start of the file: `---\n<yaml>\n---\n`.
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

// Parse a leading `--- … ---` YAML frontmatter block. Throws if the block is
// present but contains invalid YAML, so callers can surface the parse failure
// rather than silently dropping it.
export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  if (!markdown.startsWith('---')) {
    return { data: {}, body: markdown };
  }
  let match = FRONTMATTER_RE.exec(markdown);
  if (!match) {
    return { data: {}, body: markdown };
  }
  let parsed = parseYaml(match[1]);
  let data =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  return { data, body: markdown.slice(match[0].length) };
}
