import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import FileTypePdfIcon from '@cardstack/boxel-icons/file-type-pdf';
import { FileDef, contains, field } from './card-api';
import type { ByteStream, SerializedFile } from './file-api';
import { DocumentInfoField } from './file-formats/metadata-fields';
import { PdfViewer } from './file-formats/pdf-viewer';
import { extractPdfMetadata, type DocumentInfo } from './pdf-meta-extractor';
import type { FilePreviewComponent } from './file-formats/file-preview-stage';

// The PDF family. The four shared shells mount a native page viewer (embedded
// and isolated) and a placeholder page in the budgeted fitted cell; the family
// supplies that renderer and the document metadata read from the file's Info
// dictionary and page tree.
//
// The metadata field and the icon live here rather than in `card-api` so only
// realms that actually hold PDFs pay for the modules, matching how
// `ImageDef`/`AudioDef` keep their own fields off every card's dependency graph.

// A PDF over this size is not read for metadata: the Info dictionary and page
// tree are tiny, but reaching them means scanning the file (and inflating its
// object streams), and a large PDF's bytes are mostly page content this never
// needs. The page viewer still works — the browser streams the file itself — so
// only the inspector's page/title facts are skipped.
const PDF_METADATA_MAX_BYTES = 32 * 1024 * 1024;

export class PdfDef extends FileDef {
  static displayName = 'PDF Document';
  static icon = FileTypePdfIcon;
  static acceptTypes = '.pdf,application/pdf';
  // A PDF served without a useful content type would otherwise route to a
  // generic profile by extension alone, so pin the axes the four shells present
  // rather than depending on every instance carrying `application/pdf`.
  static fileFamily = 'document';
  static fileKind = 'PDF document';
  static previewKind = 'pdf';
  static previewAdapter = 'document';
  static previewSource = 'native';

  // How long the document is, what it calls itself, and who made it — read from
  // the Info dictionary and page tree during the extract pass. Surfaced by the
  // shells as the "N pages" hero fact and the isolated inspector's Document
  // group. Empty for an encrypted PDF, whose Info strings are ciphertext.
  @field documentInfo = contains(DocumentInfoField);

  // The four formats come from FileDef's shared shells; the family supplies only
  // the renderer that draws the pages — a native `<object>` viewer.
  static previewComponent: FilePreviewComponent = PdfViewer;

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<SerializedFile<{ documentInfo?: DocumentInfo }>> {
    let base = await super.extractAttributes(url, getStream, options);

    // A known oversize file skips the read entirely rather than buffering it to
    // then reject it.
    if (
      options.contentSize !== undefined &&
      options.contentSize > PDF_METADATA_MAX_BYTES
    ) {
      return base;
    }

    let bytes: Uint8Array;
    try {
      bytes = await byteStreamToUint8Array(await getStream());
    } catch {
      // A stream that won't read is not a reason to fail the whole extract; the
      // base file identity is already gathered.
      return base;
    }

    if (bytes.byteLength > PDF_METADATA_MAX_BYTES) {
      return base;
    }

    // A non-PDF throws `FileContentMismatchError` here, which propagates so the
    // extract framework falls back to a plain FileDef rather than indexing a
    // broken document. A real PDF with no Info dictionary (or an encrypted one)
    // returns a partial result instead, which adds no attribute when empty.
    let parsed = await extractPdfMetadata(bytes);

    return {
      ...base,
      ...(Object.keys(parsed).length > 0 ? { documentInfo: parsed } : {}),
    };
  }
}

export default PdfDef;
