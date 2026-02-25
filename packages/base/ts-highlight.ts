function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function spanWrap(className: string, text: string): string {
  return `<span class="${className}">${escapeHtml(text)}</span>`;
}

const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_RE = /\/\/[^\n]*/g;
const TEMPLATE_TAG_RE = /<\/?template>/g;
const STRING_DOUBLE_RE = /"(?:[^"\\]|\\.)*"/g;
const STRING_SINGLE_RE = /'(?:[^'\\]|\\.)*'/g;
const STRING_TEMPLATE_RE = /`(?:[^`\\]|\\.)*`/g;
const DECORATOR_RE = /@\w+/g;
const NUMBER_RE = /\b\d+(?:\.\d+)?\b/g;
const KEYWORD_RE =
  /\b(?:import|export|default|from|class|extends|static|async|await|function|const|let|var|if|else|return|new|this|super|typeof|instanceof|void|null|undefined|true|false|yield|of|in|for|while|do|switch|case|break|continue|try|catch|finally|throw|type|interface|declare|as|implements|readonly|enum|abstract|private|protected|public|get|set)\b/g;
const TYPE_RE = /(?:(?::\s*)|(?:extends\s+))([A-Z]\w*)/g;

interface Token {
  start: number;
  end: number;
  className: string;
  text: string;
}

function collectMatches(
  source: string,
  regex: RegExp,
  className: string,
  tokens: Token[],
): void {
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(source)) !== null) {
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
      className,
      text: match[0],
    });
  }
}

function collectTypeMatches(source: string, tokens: Token[]): void {
  TYPE_RE.lastIndex = 0;
  let match;
  while ((match = TYPE_RE.exec(source)) !== null) {
    let typeName = match[1];
    let typeStart = match.index + match[0].length - typeName.length;
    tokens.push({
      start: typeStart,
      end: typeStart + typeName.length,
      className: 'ts-type',
      text: typeName,
    });
  }
}

export function highlightTs(source: string): string {
  let tokens: Token[] = [];

  // Collect all tokens (order matters for priority — earlier = higher)
  collectMatches(source, BLOCK_COMMENT_RE, 'ts-comment', tokens);
  collectMatches(source, LINE_COMMENT_RE, 'ts-comment', tokens);
  collectMatches(source, STRING_DOUBLE_RE, 'ts-string', tokens);
  collectMatches(source, STRING_SINGLE_RE, 'ts-string', tokens);
  collectMatches(source, STRING_TEMPLATE_RE, 'ts-string', tokens);
  collectMatches(source, TEMPLATE_TAG_RE, 'ts-keyword', tokens);
  collectMatches(source, DECORATOR_RE, 'ts-decorator', tokens);
  collectMatches(source, NUMBER_RE, 'ts-number', tokens);
  collectMatches(source, KEYWORD_RE, 'ts-keyword', tokens);
  collectTypeMatches(source, tokens);

  // Sort by start position, then by priority (earlier collected = higher priority via stable sort)
  tokens.sort((a, b) => a.start - b.start);

  // Remove overlapping tokens (keep the first one encountered)
  let filtered: Token[] = [];
  let lastEnd = 0;
  for (let token of tokens) {
    if (token.start >= lastEnd) {
      filtered.push(token);
      lastEnd = token.end;
    }
  }

  // Build output
  let result = '';
  let pos = 0;
  for (let token of filtered) {
    if (token.start > pos) {
      result += escapeHtml(source.slice(pos, token.start));
    }
    result += spanWrap(token.className, token.text);
    pos = token.end;
  }
  if (pos < source.length) {
    result += escapeHtml(source.slice(pos));
  }
  return result;
}
