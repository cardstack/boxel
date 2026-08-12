import FileArchiveIcon from '@cardstack/boxel-icons/file-archive';
import FolderIcon from '@cardstack/boxel-icons/folder';
import FileIcon from '@cardstack/boxel-icons/file';
import { htmlSafe } from '@ember/template';
import GlimmerComponent from '@glimmer/component';

import {
  BaseDefComponent,
  Component,
  FieldDef,
  NumberField,
  StringField,
  contains,
  containsMany,
  field,
} from './card-api';
import BooleanField from './boolean';
import DateTimeField from './datetime';
import {
  FileContentMismatchError,
  FileDef,
  type ByteStream,
  type SerializedFile,
} from './file-api';
import { humanSize } from './file-formats/file-presentation';
import type { FilePreviewSignature } from './file-formats/file-preview-stage';
import { extractZipListing } from './zip-archive';

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

// One file inside the archive, as its central-directory header declares it. No
// bytes are inflated to produce this: the sizes and timestamp come straight from
// the directory. It is a real persisted field, so the same component serves the
// isolated inspector and the default editor.
export class ArchiveEntryField extends FieldDef {
  static displayName = 'Archive Entry';
  static icon = FileIcon;

  // The archived path, always forward-slashed, e.g. src/index.ts
  @field path = contains(StringField);
  // Uncompressed size — what the file expands to on extraction.
  @field size = contains(NumberField);
  // Compressed size — the room it takes inside the archive.
  @field compressedSize = contains(NumberField);
  @field modifiedAt = contains(DateTimeField);

  // The last path segment, for a listing that shows names rather than full
  // paths. A trailing slash (a directory marker) resolves to its own last
  // segment rather than an empty string.
  @field name = contains(StringField, {
    computeVia: function (this: ArchiveEntryField) {
      let path = this.path ?? '';
      let segments = path.split('/').filter(Boolean);
      return segments[segments.length - 1] ?? path;
    },
  });

  static atom = class Atom extends Component<typeof ArchiveEntryField> {
    <template>
      <span class='archive-entry-atom' title={{@model.path}}>{{@model.path}}</span>
      <style scoped>
        .archive-entry-atom {
          font-family: var(--font-mono);
          font-size: 0.6875rem;
          overflow-wrap: anywhere;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof ArchiveEntryField> {
    get sizeLabel() {
      return this.args.model?.size == null
        ? ''
        : humanSize(this.args.model.size);
    }

    <template>
      <div class='archive-entry' data-test-archive-entry>
        <span class='archive-entry__path' title={{@model.path}}>
          {{@model.path}}
        </span>
        {{#if this.sizeLabel}}
          <span class='archive-entry__size'>{{this.sizeLabel}}</span>
        {{/if}}
      </div>
      <style scoped>
        .archive-entry {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 0.75rem;
          padding: 0.1875rem 0;
          font-size: 0.75rem;
        }
        .archive-entry__path {
          font-family: var(--font-mono);
          font-size: 0.6875rem;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .archive-entry__size {
          flex-shrink: 0;
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground);
        }
      </style>
    </template>
  };
}

// A depth-tagged row in the flattened directory tree the preview renders.
interface TreeRow {
  kind: 'dir' | 'file';
  name: string;
  size: string;
  indent: ReturnType<typeof htmlSafe>;
}

// How many rows the tree draws before it stops and reports the remainder. Even a
// reading format has to bound its DOM against an archive of tens of thousands of
// entries.
const TREE_ROW_BUDGET = 400;

// The family renderer the four shared shells mount into. An archive's "picture"
// is its contents, so the reading formats draw a folder tree while the budgeted
// fitted cell shows a compact count-and-size summary with a few leading names.
class ArchivePreview extends GlimmerComponent<FilePreviewSignature> {
  get isFitted(): boolean {
    return this.args.mode === 'fitted';
  }

  get entryCount(): number {
    return this.args.model?.archiveEntryCount ?? 0;
  }

  get totalSize(): string {
    let bytes = this.args.model?.source?.uncompressedSize;
    return bytes == null ? '' : humanSize(bytes);
  }

  get isTruncated(): boolean {
    return Boolean(this.args.model?.source?.truncatedListing);
  }

  // Up to the fitted budget of leading paths, projected in `fileViewModel`, with
  // their basenames for a compact cell.
  get fittedNames(): string[] {
    let entries = this.args.model?.archiveEntries ?? [];
    return entries.map((path) => {
      let segments = String(path).split('/').filter(Boolean);
      return segments[segments.length - 1] ?? String(path);
    });
  }

  get fittedOverflow(): number {
    return Math.max(0, this.entryCount - this.fittedNames.length);
  }

  // Flatten the entry paths into an indented tree: every path segment becomes a
  // folder row the first time it appears, and each entry a file row beneath its
  // folders. Sorting by path groups a directory's contents together.
  get tree(): { rows: TreeRow[]; hidden: number } {
    let raw = this.args.model?.source?.archiveContents;
    let entries = (raw ? Array.from(raw) : [])
      .map((entry: any) => ({
        path: String(entry?.path ?? ''),
        size: entry?.size,
      }))
      .filter((entry) => entry.path);
    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    let rows: TreeRow[] = [];
    let emittedDirs = new Set<string>();
    let filesShown = 0;
    for (let { path, size } of entries) {
      if (rows.length >= TREE_ROW_BUDGET) {
        break;
      }
      let segments = path.split('/').filter(Boolean);
      let fileName = segments.pop() ?? path;
      let prefix = '';
      segments.forEach((segment, depth) => {
        prefix = prefix ? `${prefix}/${segment}` : segment;
        if (!emittedDirs.has(prefix)) {
          emittedDirs.add(prefix);
          rows.push({
            kind: 'dir',
            name: segment,
            size: '',
            indent: indentFor(depth),
          });
        }
      });
      rows.push({
        kind: 'file',
        name: fileName,
        size: size == null ? '' : humanSize(size),
        indent: indentFor(segments.length),
      });
      filesShown++;
    }
    return { rows, hidden: Math.max(0, entries.length - filesShown) };
  }

  <template>
    {{#if this.isFitted}}
      <div class='archive-fitted' data-test-archive-preview data-mode='fitted'>
        <FileArchiveIcon
          class='archive-fitted__glyph'
          width='22'
          height='22'
          aria-hidden='true'
        />
        <div class='archive-fitted__summary'>
          <span class='archive-fitted__count'>
            {{this.entryCount}}
            {{if (eqNum this.entryCount 1) 'entry' 'entries'}}
          </span>
          {{#if this.totalSize}}
            <span class='archive-fitted__size'>{{this.totalSize}}</span>
          {{/if}}
        </div>
        {{#if this.fittedNames.length}}
          <ul class='archive-fitted__list'>
            {{#each this.fittedNames as |name|}}
              <li title={{name}}>{{name}}</li>
            {{/each}}
            {{#if this.fittedOverflow}}
              <li class='archive-fitted__more'>+{{this.fittedOverflow}} more</li>
            {{/if}}
          </ul>
        {{/if}}
      </div>
    {{else}}
      <div class='archive-tree' data-test-archive-preview data-mode={{@mode}}>
        {{#if this.tree.rows.length}}
          <ul class='archive-tree__list'>
            {{#each this.tree.rows as |row|}}
              <li
                class='archive-tree__row {{row.kind}}'
                style={{row.indent}}
                data-test-archive-tree-row={{row.kind}}
              >
                {{#if (eqStr row.kind 'dir')}}
                  <FolderIcon
                    class='archive-tree__icon'
                    width='14'
                    height='14'
                    aria-hidden='true'
                  />
                {{else}}
                  <FileIcon
                    class='archive-tree__icon'
                    width='14'
                    height='14'
                    aria-hidden='true'
                  />
                {{/if}}
                <span class='archive-tree__name' title={{row.name}}>{{row.name}}</span>
                {{#if row.size}}
                  <span class='archive-tree__size'>{{row.size}}</span>
                {{/if}}
              </li>
            {{/each}}
          </ul>
          {{#if this.tree.hidden}}
            <div class='archive-tree__more'>
              +{{this.tree.hidden}}
              more
              {{if (eqNum this.tree.hidden 1) 'entry' 'entries'}}
              not shown
            </div>
          {{else if this.isTruncated}}
            <div class='archive-tree__more'>Listing truncated — archive too large
              to read in full</div>
          {{/if}}
        {{else}}
          <p class='archive-tree__empty'>Empty archive</p>
        {{/if}}
      </div>
    {{/if}}
    <style scoped>
      .archive-fitted {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.375rem;
        padding: 0.625rem;
        text-align: center;
        background: var(--card);
        color: var(--foreground);
        overflow: hidden;
      }
      .archive-fitted__glyph {
        color: var(--muted-foreground);
      }
      .archive-fitted__summary {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        font-family: var(--font-mono);
        font-size: 0.625rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .archive-fitted__count {
        font-weight: 700;
        color: var(--foreground);
      }
      .archive-fitted__list {
        margin: 0;
        padding: 0;
        list-style: none;
        max-width: 100%;
        display: flex;
        flex-direction: column;
        gap: 0.0625rem;
        font-family: var(--font-mono);
        font-size: 0.5625rem;
        color: var(--muted-foreground);
      }
      .archive-fitted__list li {
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .archive-fitted__more {
        color: var(--muted-foreground);
        opacity: 0.8;
      }
      .archive-tree {
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: auto;
        padding: 0.5rem 0;
        background: var(--card);
        color: var(--foreground);
        text-align: left;
      }
      .archive-tree__list {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .archive-tree__row {
        display: flex;
        align-items: baseline;
        gap: 0.4375rem;
        padding: 0.15625rem 0.75rem;
        min-width: 0;
      }
      .archive-tree__icon {
        flex-shrink: 0;
        align-self: center;
        color: var(--muted-foreground);
      }
      .archive-tree__row.dir .archive-tree__name {
        font-weight: 600;
      }
      .archive-tree__name {
        flex: 1;
        min-width: 0;
        font-family: var(--font-mono);
        font-size: 0.71875rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .archive-tree__size {
        flex-shrink: 0;
        font-family: var(--font-mono);
        font-size: 0.625rem;
        font-variant-numeric: tabular-nums;
        color: var(--muted-foreground);
      }
      .archive-tree__more {
        padding: 0.5rem 0.75rem 0.25rem;
        font-family: var(--font-mono);
        font-size: 0.625rem;
        color: var(--muted-foreground);
      }
      .archive-tree__empty {
        margin: 0;
        padding: 1rem 0.75rem;
        color: var(--muted-foreground);
        font-size: var(--boxel-font-sm);
      }
    </style>
  </template>
}

function indentFor(depth: number): ReturnType<typeof htmlSafe> {
  return htmlSafe(`padding-left: ${(depth * 0.875 + 0.75).toFixed(4)}rem`);
}

// Template-only equality helpers, kept local so the preview needs no runtime
// helper imports. `eq` from boxel-ui would also serve, but these keep the two
// comparisons this template makes explicit at the call site.
function eqNum(a: number | undefined, b: number): boolean {
  return a === b;
}

function eqStr(a: string | undefined, b: string): boolean {
  return a === b;
}

// The attributes a ZIP subclass's `extractAttributes` adds on top of the base
// file identity. Each entry arrives as a plain nested object, which is how a
// contained FieldDef is carried over the wire.
export interface SerializedArchiveEntry {
  path: string;
  size?: number;
  compressedSize?: number;
  modifiedAt?: string;
}

export interface ZipAttributes {
  archiveContents?: SerializedArchiveEntry[];
  uncompressedSize?: number;
  compressedSize?: number;
  truncatedListing?: boolean;
}

export class ZipDef extends FileDef {
  static displayName = 'ZIP Archive';
  static icon = FileArchiveIcon;
  static acceptTypes = '.zip,application/zip';

  // A `.zip` served without (or with an uninformative) content type would route
  // to a generic profile by extension alone, so pin the archive axes the four
  // shells present — the family, the labeled kind, and the archive renderer —
  // off the class rather than depending on every instance carrying
  // `application/zip`.
  static fileFamily = 'archive';
  static fileKind = 'ZIP archive';
  static previewKind = 'archive';
  static previewAdapter = 'archive';
  static previewSource = 'extracted';

  // The file listing read from the central directory. Files only — the folder
  // structure the preview draws is recovered from the paths, so explicit
  // directory markers are dropped at extract time.
  @field archiveContents = containsMany(ArchiveEntryField);
  // Total uncompressed bytes across the entries — what the archive expands to.
  @field uncompressedSize = contains(NumberField);
  // Total compressed bytes across the entries.
  @field compressedSize = contains(NumberField);
  // Whether the central directory ran past the tail window we read, making the
  // listing a prefix of the whole rather than complete.
  @field truncatedListing = contains(BooleanField);

  // The four formats come from FileDef's shared shells; the family supplies only
  // the renderer that draws its contents.
  static previewComponent = ArchivePreview;

  // Markdown has no archive syntax, so emit a plain link to the file — a
  // downstream consumer gets something navigable rather than a dropped
  // reference.
  static markdown: BaseDefComponent = class Markdown extends Component<
    typeof ZipDef
  > {
    get text() {
      let model = this.args.model;
      if (!model) {
        return '';
      }
      let url = model.url ?? model.sourceUrl ?? '';
      let name = model.name ?? 'archive.zip';
      if (!url) {
        return '';
      }
      return `[${name}](${url})`;
    }
    <template>{{this.text}}</template>
  };

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<SerializedFile<ZipAttributes>> {
    let extension = getExtension(url);
    if (extension !== '.zip') {
      throw new FileContentMismatchError(
        `Expected a .zip file extension, got "${extension || 'none'}"`,
      );
    }

    let base = await super.extractAttributes(url, getStream, options);
    let listing = await extractZipListing(await getStream());
    if (!listing) {
      // A `.zip` that carries no readable central directory (empty or corrupt)
      // still gets its identity; it simply lists nothing.
      return base;
    }

    return {
      ...base,
      archiveContents: listing.entries.map((entry) => ({
        path: entry.path,
        size: entry.uncompressedSize,
        compressedSize: entry.compressedSize,
        ...(entry.modifiedAt ? { modifiedAt: entry.modifiedAt } : {}),
      })),
      uncompressedSize: listing.uncompressedSize,
      compressedSize: listing.compressedSize,
      truncatedListing: listing.truncated,
    };
  }
}

export default ZipDef;
