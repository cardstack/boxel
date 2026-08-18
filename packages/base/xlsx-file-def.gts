import FileTypeXlsIcon from '@cardstack/boxel-icons/file-type-xls';
import { contains, field } from './card-api';
import { FileDef, type ByteStream, type SerializedFile } from './file-api';
import { OfficeMetadataField } from './file-formats/metadata-fields';
import { OfficePreview } from './file-formats/office-preview';
import { extractXlsxMetadata } from './xlsx-meta-extractor';
import { extractOfficeMetadata } from './office-extract';
import type { OfficeMetadata } from './ooxml';
import type { FilePreviewComponent } from './file-formats/file-preview-stage';

// The Excel (`.xlsx`) family. The four shared shells render this family's own
// preview — the sheet tabs and a sampled grid of the first sheet, since the
// browser cannot display a `.xlsx` natively — and the isolated inspector
// surfaces the workbook's core properties and sheet names read from the OOXML
// package.
export class XlsxDef extends FileDef {
  static displayName = 'Excel Workbook';
  static icon = FileTypeXlsIcon;
  static acceptTypes =
    '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  static fileFamily = 'spreadsheet';
  static fileKind = 'Excel workbook';
  static previewKind = 'spreadsheet';
  static previewAdapter = 'spreadsheet';
  static previewSource = 'extracted';

  // The workbook's identity, sheet names, and a bounded sample of the first
  // sheet's grid, read from the package during the extract pass. Surfaced by the
  // shells as the "N sheets" hero fact and rendered as the sheet preview.
  @field officeMetadata = contains(OfficeMetadataField);

  static previewComponent: FilePreviewComponent = OfficePreview;

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<SerializedFile<{ officeMetadata?: OfficeMetadata }>> {
    let base = await super.extractAttributes(url, getStream, options);
    return extractOfficeMetadata(base, getStream, options, extractXlsxMetadata);
  }
}

export default XlsxDef;
