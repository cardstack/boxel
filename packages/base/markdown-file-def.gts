import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import { StringField, contains, field } from './card-api';
import MarkdownFilePreview from './markdown-file-preview';
import {
  FileContentMismatchError,
  FileDef,
  type ByteStream,
  type SerializedFile,
} from './file-api';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const EXCERPT_MAX_LENGTH = 240;

function getExtension(url: string): string {
  try {
    let parsed = new URL(url);
    let name = parsed.pathname.split('/').pop() ?? '';
    let dot = name.lastIndexOf('.');
    return dot === -1 ? '' : name.slice(dot).toLowerCase();
  } catch {
    let dot = url.lastIndexOf('.');
    return dot === -1 ? '' : url.slice(dot).toLowerCase();
  }
}

function fileNameWithoutExtension(name: string): string {
  return name.replace(/\.[^/.]+$/, '');
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateExcerpt(text: string): string {
  if (text.length <= EXCERPT_MAX_LENGTH) {
    return text;
  }
  return `${text.slice(0, EXCERPT_MAX_LENGTH - 3).trimEnd()}...`;
}

function extractTitle(markdown: string, fallback: string): string {
  let normalized = normalizeMarkdown(markdown);
  for (let line of normalized.split('\n')) {
    let match = line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
    if (match?.[1]) {
      let title = stripMarkdown(match[1]);
      if (title) {
        return title;
      }
    }
  }
  return fallback;
}

function extractExcerpt(markdown: string): string {
  let normalized = normalizeMarkdown(markdown);
  let paragraphs = normalized.split(/\n\s*\n/);
  for (let paragraph of paragraphs) {
    let trimmed = paragraph.trim();
    if (!trimmed) {
      continue;
    }
    let lines = trimmed.split('\n');
    let hasNonHeading = lines.some((line) => !/^\s*#{1,6}\s+/.test(line));
    if (!hasNonHeading) {
      continue;
    }
    let withoutHeadings = lines
      .filter((line) => !/^\s*#{1,6}\s+/.test(line))
      .join(' ');
    let excerpt = stripMarkdown(withoutHeadings);
    if (excerpt) {
      return truncateExcerpt(excerpt);
    }
  }
  return '';
}

export class MarkdownDef extends FileDef {
  static displayName = 'Markdown';

  @field title = contains(StringField);
  @field excerpt = contains(StringField);
  @field content = contains(StringField);

  static embedded = MarkdownFilePreview;
  static fitted = MarkdownFilePreview;
  static isolated = MarkdownFilePreview;

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string } = {},
  ): Promise<
    SerializedFile<{ title: string; excerpt: string; content: string }>
  > {
    let extension = getExtension(url);
    if (!MARKDOWN_EXTENSIONS.has(extension)) {
      throw new FileContentMismatchError(
        `Expected markdown file extension, got "${extension || 'none'}"`,
      );
    }

    let bytesPromise: Promise<Uint8Array> | undefined;
    let memoizedStream = async () => {
      bytesPromise ??= byteStreamToUint8Array(await getStream());
      return bytesPromise;
    };

    let base = await super.extractAttributes(url, memoizedStream, options);
    let bytes = await memoizedStream();
    let markdown = new TextDecoder().decode(bytes);
    let fallbackTitle = fileNameWithoutExtension(base.name ?? '');

    return {
      ...base,
      title: extractTitle(markdown, fallbackTitle),
      excerpt: extractExcerpt(markdown),
      content: markdown,
    };
  }
}
