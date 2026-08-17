import FileTypePptIcon from '@cardstack/boxel-icons/file-type-ppt';
import { contains, field } from './card-api';
import { FileDef, type ByteStream, type SerializedFile } from './file-api';
import { OfficeMetadataField } from './file-formats/metadata-fields';
import { OfficePreview } from './file-formats/office-preview';
import { extractPptxMetadata } from './pptx-meta-extractor';
import { extractOfficeMetadata } from './office-extract';
import type { OfficeMetadata } from './ooxml';
import type { FilePreviewComponent } from './file-formats/file-preview-stage';

// The PowerPoint (`.pptx`) family. The four shared shells render this family's
// own preview — the extracted slide outline, since the browser cannot display a
// `.pptx` natively — and the isolated inspector surfaces the deck's core
// properties and slide count read from the OOXML package.
export class PptxDef extends FileDef {
  static displayName = 'PowerPoint Presentation';
  static icon = FileTypePptIcon;
  static acceptTypes =
    '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation';
  static fileFamily = 'presentation';
  static fileKind = 'PowerPoint presentation';
  static previewKind = 'presentation';
  static previewAdapter = 'presentation';
  static previewSource = 'extracted';

  // The deck's identity, slide count, and a bounded outline (slide titles and
  // bullet lines), read from the package during the extract pass. Surfaced by
  // the shells as the "N slides" hero fact and rendered as the deck preview.
  @field officeMetadata = contains(OfficeMetadataField);

  static previewComponent: FilePreviewComponent = OfficePreview;

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<SerializedFile<{ officeMetadata?: OfficeMetadata }>> {
    let base = await super.extractAttributes(url, getStream, options);
    return extractOfficeMetadata(base, getStream, options, extractPptxMetadata);
  }
}

export default PptxDef;
