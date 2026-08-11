import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import FileCodeIcon from '@cardstack/boxel-icons/file-code';
import { StringField, contains, field } from './card-api';
import {
  FileContentMismatchError,
  FileDef,
  type ByteStream,
  type SerializedFile,
} from './file-api';
import { HtmlMetadataField } from './file-formats/metadata-fields';
import { HtmlPreview } from './file-formats/html-preview';
import {
  extractHtmlExcerpt,
  extractHtmlMetadata,
  type HtmlDocumentMetadata,
} from './html-meta-extractor';

const HTML_EXTENSIONS = new Set(['.html', '.htm']);
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

// A browser document, not a code file or a prose file: it has a rendered form
// (safe inside a sandboxed frame) and an inspectable source form, and its
// metadata describes DOM shape rather than syntax. The four formats come from
// FileDef's shared shells; this class supplies only its renderer and the
// structural facts the extract persists — never a second copy of the source,
// which the preview fetches at view time.
export class HtmlDef extends FileDef {
  static displayName = 'HTML File';
  static icon = FileCodeIcon;
  static acceptTypes = '.html,.htm,text/html';

  @field title = contains(StringField);
  @field excerpt = contains(StringField);
  @field htmlMetadata = contains(HtmlMetadataField);

  static previewComponent = HtmlPreview;

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string } = {},
  ): Promise<
    SerializedFile<{
      title: string;
      excerpt: string;
      htmlMetadata: HtmlDocumentMetadata;
    }>
  > {
    let extension = getExtension(url);
    if (!HTML_EXTENSIONS.has(extension)) {
      throw new FileContentMismatchError(
        `Expected HTML file extension, got "${extension || 'none'}"`,
      );
    }

    let bytesPromise: Promise<Uint8Array> | undefined;
    let memoizedStream = async () => {
      bytesPromise ??= byteStreamToUint8Array(await getStream());
      return bytesPromise;
    };

    let base = await super.extractAttributes(url, memoizedStream, options);
    let bytes = await memoizedStream();
    let text = new TextDecoder().decode(bytes);
    let htmlMetadata = extractHtmlMetadata(text);
    let fallbackTitle = fileNameWithoutExtension(base.name ?? '');

    return {
      ...base,
      title: htmlMetadata.documentTitle ?? fallbackTitle ?? 'Untitled page',
      excerpt: extractHtmlExcerpt(text, EXCERPT_MAX_LENGTH),
      htmlMetadata,
    };
  }
}

export default HtmlDef;
