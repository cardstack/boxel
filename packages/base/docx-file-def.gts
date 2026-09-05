import FileTypeDocIcon from '@cardstack/boxel-icons/file-type-doc';
import { contains, field } from './card-api';
import { FileDef, type ByteStream, type SerializedFile } from './file-api';
import { OfficeMetadataField } from './file-formats/metadata-fields';
import { OFFICE_FAMILY_SCREENSHOTS } from './file-formats/office-captures';
import { OfficePreview } from './file-formats/office-preview';
import { extractDocxMetadata } from './docx-meta-extractor';
import { extractOfficeMetadata } from './office-extract';
import type { OfficeMetadata } from './ooxml';
import type { FilePreviewComponent } from './file-formats/file-preview-stage';

// The Word (`.docx`) family. The four shared shells render this family's own
// preview — a document's extracted text flow, since the browser cannot display
// a `.docx` natively — and the isolated inspector surfaces the core properties
// and length read from the OOXML package.
//
// The metadata field and the icon live here rather than in `card-api` so only
// realms that actually hold Word documents pay for the modules, matching how
// `ImageDef`/`AudioDef` keep their own fields off every card's dependency graph.
export class DocxDef extends FileDef {
  static displayName = 'Word Document';
  static icon = FileTypeDocIcon;
  static acceptTypes =
    '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  // A `.docx` served without a useful content type would otherwise route to a
  // generic profile by extension alone, so pin the axes the four shells present.
  // The preview is structured information the extractor derived, not a native
  // rendering, so `previewSource` is 'extracted'.
  static fileFamily = 'document';
  static fileKind = 'Word document';
  static previewKind = 'word';
  static previewAdapter = 'document';
  static previewSource = 'extracted';

  // The document's identity, length, and a bounded sample of its text flow, read
  // from the package during the extract pass. Surfaced by the shells as the
  // "N pages" hero fact and the isolated inspector's Office group, and rendered
  // as the document preview.
  @field officeMetadata = contains(OfficeMetadataField);

  static previewComponent: FilePreviewComponent = OfficePreview;

  // The fitted poster: a capture-only render of the extracted structure's
  // first unit, keyed on the file's bytes and flagged useAsThumbnail. The
  // typed placeholder stays the fallback until a capture serves.
  static screenshots = OFFICE_FAMILY_SCREENSHOTS;

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<SerializedFile<{ officeMetadata?: OfficeMetadata }>> {
    let base = await super.extractAttributes(url, getStream, options);
    return extractOfficeMetadata(base, getStream, options, extractDocxMetadata);
  }
}

export default DocxDef;
