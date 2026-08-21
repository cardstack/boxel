import {
  byteStreamToUint8Array,
  extractCardReferenceUrls,
  extractFileReferenceUrls,
  FRONTMATTER_DIAGNOSTICS_SYMBOL,
  FRONTMATTER_FILE_META_VALUE_SYMBOL,
  FRONTMATTER_PARSE_ERROR_SYMBOL,
  identifyCard,
  type FrontmatterParseError,
  type ToolContext,
} from '@cardstack/runtime-common';
import MarkdownIcon from '@cardstack/boxel-icons/align-box-left-middle';
import GlimmerComponent from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { markdownToHtml } from '@cardstack/runtime-common/marked-sync';
import {
  type BaseDefComponent,
  CardDef,
  Component,
  NumberField,
  StringField,
  contains,
  containsMany,
  field,
  linksToMany,
} from './card-api';
import MarkdownTemplate from './default-templates/markdown';
import {
  FileContentMismatchError,
  FileDef,
  type ByteStream,
  type SerializedFile,
} from './file-api';
import type { FilePreviewSignature } from './file-formats/file-preview-stage';
import { FrontmatterField } from './frontmatter-field';
import {
  frontmatterFieldForKind,
  isKnownFrontmatterKind,
} from './frontmatter-kinds';
import { parseFrontmatter } from './frontmatter-parse';

// Channel for routing per-field meta (e.g. the concrete subclass of a
// polymorphic field) from `extractAttributes` to the index resource builder,
// without it leaking into the flat `search_doc`. The host file extractor reads
// the same global symbol. See `file-def-attributes-extractor.ts`.
const fileFieldMetaSymbol = Symbol.for('boxel:file-field-meta');

// Best-effort structured view of a YAML parse failure. The `yaml` library
// throws a `YAMLParseError` carrying `linePos` (`[{ line, col }, …]`); read it
// defensively so a non-YAMLParseError still yields a usable message.
function toFrontmatterParseError(err: unknown): FrontmatterParseError {
  let message =
    err instanceof Error ? err.message : `Frontmatter parse failed: ${err}`;
  let pos = (err as { linePos?: Array<{ line?: number; col?: number }> })
    ?.linePos?.[0];
  return {
    message,
    ...(typeof pos?.line === 'number' ? { line: pos.line } : {}),
    ...(typeof pos?.col === 'number' ? { column: pos.col } : {}),
  };
}

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const EXCERPT_MAX_LENGTH = 500;

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

// content-tag misparses backticks inside regex literals in .gts files
const FENCED_CODE_RE = new RegExp('```[\\s\\S]*?```', 'g');
const INLINE_CODE_RE = new RegExp('`([^`]+)`', 'g');

function stripMarkdown(text: string): string {
  return text
    .replace(FENCED_CODE_RE, '')
    .replace(INLINE_CODE_RE, '$1')
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

const HEADING_RE = /^\s*#{1,6}\s+/;

function extractExcerpt(markdown: string): string {
  let normalized = normalizeMarkdown(markdown);
  let paragraphs = normalized.split(/\n\s*\n/);
  for (let paragraph of paragraphs) {
    let trimmed = paragraph.trim();
    if (!trimmed) {
      continue;
    }
    let lines = trimmed.split('\n');
    let hasNonHeading = lines.some((line) => !HEADING_RE.test(line));
    if (!hasNonHeading) {
      continue;
    }
    let withoutHeadings = lines
      .filter((line) => !HEADING_RE.test(line))
      .join(' ');
    let excerpt = stripMarkdown(withoutHeadings);
    if (excerpt) {
      return truncateExcerpt(excerpt);
    }
  }
  return '';
}

function markdownTitle(
  model: { title?: string | null; name?: string | null } | null | undefined,
): string {
  return model?.title ?? model?.name ?? 'Untitled markdown';
}

// The family renderer the four shared shells mount into. Embedded and isolated
// get the full Boxel-flavored-markdown render — rendered markdown with the
// linked-card and linked-file slots resolved — while a fitted collection cell
// gets a lighter, non-interactive rendition of the projection's already-budgeted
// head snippet, so a grid tile never mounts the slot-collection machinery over a
// truncated body.
class MarkdownPreview extends GlimmerComponent<FilePreviewSignature> {
  // The FileDef instance behind the shared projection, reached for the fields
  // the generic view model doesn't carry: the linked cards/files and the id the
  // BFM renderer resolves relative references against.
  get source(): any {
    return this.args.model?.source;
  }

  get content(): string {
    if (this.args.mode === 'fitted') {
      // Budgeted in `fileViewModel`; a fitted cell never touches the whole
      // file — and the presence guard below judges the same bounded snippet
      // the cell draws, so the two can't disagree.
      return this.args.model?.contentPreview ?? '';
    }
    return String(this.source?.content ?? '');
  }

  get hasContent(): boolean {
    return Boolean(this.content.trim());
  }

  get isFitted(): boolean {
    return this.args.mode === 'fitted';
  }

  // `contentPreview` is truncated to the fitted character/line budget in
  // `fileViewModel`, so the snippet parse stays bounded no matter the file size.
  get snippetHtml() {
    return htmlSafe(markdownToHtml(this.args.model?.contentPreview ?? ''));
  }

  <template>
    {{#if this.isFitted}}
      <div class='md-preview md-preview--fitted' data-test-markdown-preview>
        {{#if this.hasContent}}
          <div class='md-snippet'>{{this.snippetHtml}}</div>
        {{else}}
          <p class='md-preview__empty'>No content</p>
        {{/if}}
      </div>
    {{else}}
      <div
        class='md-preview md-preview--full'
        data-mode={{@mode}}
        data-test-markdown-preview
      >
        {{#if this.hasContent}}
          <MarkdownTemplate
            @content={{this.content}}
            @linkedCards={{this.source.linkedCards}}
            @linkedFiles={{this.source.linkedFiles}}
            @cardReferenceBaseUrl={{this.source.id}}
          />
        {{else}}
          <p class='md-preview__empty'>No content</p>
        {{/if}}
      </div>
    {{/if}}
    <style scoped>
      .md-preview {
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: auto;
        background: var(--card);
        color: var(--foreground);
        text-align: left;
      }
      .md-preview--full {
        padding: var(--boxel-sp-lg);
      }
      /* Inside the embedded shell's bounded body, keep the first heading from
         pushing a gap above the render. */
      .md-preview--full :deep(h1:first-child),
      .md-preview--full :deep(h2:first-child),
      .md-preview--full :deep(h3:first-child),
      .md-preview--full :deep(h4:first-child),
      .md-preview--full :deep(h5:first-child),
      .md-preview--full :deep(h6:first-child) {
        margin-top: 0;
      }
      .md-preview__empty {
        margin: 0;
        padding: var(--boxel-sp);
        color: var(--muted-foreground);
        font-size: var(--boxel-font-sm);
      }

      /* Fitted: a glanceable mini-page. Rendered, but with its own compact type
         scale and a fade so the clip reads as "more below". */
      .md-preview--fitted {
        overflow: hidden;
        position: relative;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        -webkit-mask-image: linear-gradient(to bottom, black 74%, transparent);
        mask-image: linear-gradient(to bottom, black 74%, transparent);
      }
      .md-snippet {
        font-size: 0.6875rem;
        line-height: 1.5;
      }
      .md-snippet :deep(h1),
      .md-snippet :deep(h2),
      .md-snippet :deep(h3),
      .md-snippet :deep(h4) {
        font-weight: 700;
        font-size: 0.8125rem;
        margin: 0 0 0.25em;
        line-height: 1.25;
      }
      .md-snippet :deep(p),
      .md-snippet :deep(ul),
      .md-snippet :deep(ol) {
        margin: 0 0 0.5em;
      }
      .md-snippet :deep(ul),
      .md-snippet :deep(ol) {
        padding-left: 1.2em;
      }
      .md-snippet :deep(pre),
      .md-snippet :deep(code) {
        font-family: var(--font-mono, monospace);
        font-size: 0.625rem;
      }
      .md-snippet :deep(pre) {
        white-space: pre-wrap;
        overflow: hidden;
      }
      .md-snippet :deep(img) {
        max-width: 100%;
      }
    </style>
  </template>
}

class Head extends Component<typeof MarkdownDef> {
  get title() {
    return markdownTitle(this.args.model);
  }

  get description() {
    return this.args.model?.excerpt;
  }

  <template>
    {{! template-lint-disable no-forbidden-elements }}
    <title data-test-card-head-title>{{this.title}}</title>

    <meta property='og:title' content={{this.title}} />
    <meta name='twitter:title' content={{this.title}} />
    <meta property='og:url' content={{@model.id}} />

    {{#if this.description}}
      <meta name='description' content={{this.description}} />
      <meta property='og:description' content={{this.description}} />
      <meta name='twitter:description' content={{this.description}} />
    {{/if}}

    <meta name='twitter:card' content='summary' />
    <meta property='og:type' content='article' />
  </template>
}

export class MarkdownDef extends FileDef {
  static displayName = 'Markdown';
  static icon = MarkdownIcon;
  static acceptTypes = '.md,.markdown';

  // A `.md` served without (or with an uninformative) content type would route
  // to a generic profile by extension alone, so pin the document axes the four
  // shells present — the family, the labeled kind, and the text renderer — off
  // the class rather than depending on every instance carrying `text/markdown`.
  static fileFamily = 'document';
  static fileKind = 'Markdown';
  static previewKind = 'markdown';
  static previewAdapter = 'text';
  static previewSource = 'extracted';

  @field title = contains(StringField);
  @field excerpt = contains(StringField);
  @field content = contains(StringField);
  // Surfaced by the shells as an isolated inspector row; the hero fact for a
  // markdown file is its word count, computed by the shared projection.
  @field lineCount = contains(NumberField);

  // The frontmatter's `boxel.kind`, surfaced as a direct, indexed field so
  // skills are findable via `searchFiles({ filter: { eq: { kind: 'skill' } } })`.
  // Empty for plain markdown.
  @field kind = contains(StringField);

  // The file's parsed YAML frontmatter. `rawContent` holds the whole thing as
  // JSON; when `boxel.kind` names a recognized kind (e.g. `skill`) this
  // rehydrates as the matching `FrontmatterField` subclass (e.g.
  // `SkillFrontmatterField`) via `meta.fields.frontmatter.adoptsFrom`, set in
  // `extractAttributes`.
  @field frontmatter = contains(FrontmatterField);

  @field cardReferenceUrls = containsMany(StringField, {
    computeVia: function (this: MarkdownDef) {
      if (!this.content) {
        return [];
      }
      return extractCardReferenceUrls(this.content, this.id ?? '');
    },
  });

  @field linkedCards = linksToMany(CardDef, {
    query: {
      filter: {
        in: { id: '$this.cardReferenceUrls' },
      },
    },
  });

  @field fileReferenceUrls = containsMany(StringField, {
    computeVia: function (this: MarkdownDef) {
      if (!this.content) {
        return [];
      }
      return extractFileReferenceUrls(this.content, this.id ?? '');
    },
  });

  // Resolve by `url` rather than `id`: a FileDef's search doc is its
  // extractAttributes output ({ url, name, contentType, ... }) and carries no
  // queryable `id` (unlike CardDef instances), so `in: { id }` never matches.
  @field linkedFiles = linksToMany(FileDef, {
    query: {
      filter: {
        in: { url: '$this.fileReferenceUrls' },
      },
    },
  });

  // The bespoke isolated/embedded/fitted/atom are gone: MarkdownDef now inherits
  // the four shared shells from FileDef and supplies only the renderer they
  // mount, so identity, facts, budgets, and state handling stay in one place
  // across every file family.
  static previewComponent = MarkdownPreview;
  static head: BaseDefComponent = Head;

  // CS-10787: markdown files already are markdown, so pass the content
  // through verbatim rather than wrapping in a fenced block that would
  // double-render when consumed.
  static markdown: BaseDefComponent = class Markdown extends Component<
    typeof MarkdownDef
  > {
    get text() {
      return this.args.model?.content ?? '';
    }
    <template>{{this.text}}</template>
  };

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    // `toolContext` is the owner-carrying context index-time tool schema
    // generation constructs tool classes with; only the indexing path
    // provides one (see `FromFrontmatterContext`).
    options: { contentHash?: string; toolContext?: ToolContext } = {},
  ): Promise<
    SerializedFile<{
      title: string;
      excerpt: string;
      content: string;
      lineCount: number;
      cardReferenceUrls: string[];
      fileReferenceUrls: string[];
      // The frontmatter's `boxel.kind`, as a direct searchable field (e.g.
      // `searchFiles({ filter: { eq: { kind: 'skill' } } })`).
      kind?: string;
      // The `frontmatter` field value: `{ rawContent, … }`, typed by
      // `boxel.kind` via the registry.
      frontmatter?: Record<string, unknown>;
    }>
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

    let frontmatterData: Record<string, unknown> = {};
    let body = markdown;
    let frontmatterParseError: FrontmatterParseError | undefined;
    try {
      let parsed = parseFrontmatter(normalizeMarkdown(markdown));
      frontmatterData = parsed.data;
      body = parsed.body;
    } catch (err) {
      // Invalid YAML: index the markdown without frontmatter rather than fail
      // the whole file, but capture the failure so it surfaces via indexing
      // diagnostics (CS-11548) instead of silently dropping whatever the
      // frontmatter declared (e.g. a skill's commands). Routed out-of-band via
      // `FRONTMATTER_PARSE_ERROR_SYMBOL`, picked up by the host file extractor.
      frontmatterParseError = toFrontmatterParseError(err);
      console.warn(
        `[markdown-file-def] frontmatter parse failed for ${url}:`,
        err,
      );
    }

    let attributes: SerializedFile<{
      title: string;
      excerpt: string;
      content: string;
      lineCount: number;
      cardReferenceUrls: string[];
      fileReferenceUrls: string[];
      kind?: string;
      frontmatter?: Record<string, unknown>;
    }> = {
      ...base,
      title: extractTitle(body, fallbackTitle),
      excerpt: extractExcerpt(body),
      // The body with any frontmatter block stripped — what the markdown /
      // isolated / embedded paths render. The parsed frontmatter lives in
      // `frontmatter.rawContent`, and the verbatim file is always served from
      // the realm, so nothing is lost.
      content: body,
      // Counted over the rendered body, not the frontmatter; a trailing newline
      // shouldn't inflate it and empty content is zero lines.
      lineCount: body ? body.replace(/\n$/, '').split('\n').length : 0,
      cardReferenceUrls: extractCardReferenceUrls(body, url),
      fileReferenceUrls: extractFileReferenceUrls(body, url),
    };

    // Boxel-specific frontmatter is namespaced under `boxel:`; generic
    // top-level keys (shared with Claude Code) never trigger Boxel behavior.
    let boxelNamespace =
      frontmatterData.boxel &&
      typeof frontmatterData.boxel === 'object' &&
      !Array.isArray(frontmatterData.boxel)
        ? (frontmatterData.boxel as Record<string, unknown>)
        : undefined;
    let kind =
      typeof boxelNamespace?.kind === 'string'
        ? boxelNamespace.kind
        : undefined;
    if (kind !== undefined) {
      attributes.kind = kind; // direct, indexed, searchable
    }

    // `boxel.kind` selects the FrontmatterField subclass; the subclass maps the
    // parsed frontmatter into its own field value (the base keeps the raw copy)
    // and produces any index-time enrichment of it (e.g. a skill's generated
    // tool definitions). MarkdownDef stays ignorant of any kind's schema. A
    // recognized kind is recorded so the field rehydrates as that subclass on
    // read; the enriched copy and any diagnostics findings ride out-of-band on
    // the same symbol channels the parse error uses, so neither leaks into the
    // flat `search_doc`.
    if (Object.keys(frontmatterData).length > 0) {
      let frontmatterFieldClass = frontmatterFieldForKind(kind);
      let frontmatterResult = await frontmatterFieldClass.fromFrontmatter(
        frontmatterData,
        { fileURL: url, toolContext: options.toolContext },
      );
      attributes.frontmatter = frontmatterResult.attributes;
      let bag = attributes as Record<PropertyKey, unknown>;
      if (frontmatterResult.fileMetaAttributes) {
        bag[FRONTMATTER_FILE_META_VALUE_SYMBOL] =
          frontmatterResult.fileMetaAttributes;
      }
      if (frontmatterResult.diagnostics) {
        bag[FRONTMATTER_DIAGNOSTICS_SYMBOL] = frontmatterResult.diagnostics;
      }
      if (isKnownFrontmatterKind(kind)) {
        let adoptsFrom = identifyCard(frontmatterFieldClass);
        if (adoptsFrom) {
          bag[fileFieldMetaSymbol] = {
            frontmatter: { adoptsFrom },
          };
        }
      }
    }

    if (frontmatterParseError) {
      (attributes as Record<PropertyKey, unknown>)[
        FRONTMATTER_PARSE_ERROR_SYMBOL
      ] = frontmatterParseError;
    }

    return attributes;
  }
}

export default MarkdownDef;
