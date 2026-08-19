// The public surface a FileDef family builds on: the taxonomy registry, the
// presentation projection, the four format shells, the preview slot, and the
// wrapper-free resource primitives.
//
// A family issue adds its `@field`s and a `static previewComponent`; it should
// not need to re-implement identity, facts, budgets, or state handling.

export {
  contentTypeForFile,
  extensionOfFile,
  previewAdapterForKind,
  profileForFile,
  type FileCapability,
  type FileFamily,
  type FileTypeInput,
  type FileTypeProfile,
  type PreviewAdapter,
  type PreviewSource,
} from './file-type-profile';

export {
  DETAILED_WAVEFORM_BAR_BUDGET,
  FITTED_ARCHIVE_ENTRY_BUDGET,
  FITTED_CODE_SYMBOL_BUDGET,
  FITTED_SCHEMA_ROW_BUDGET,
  FITTED_TEXT_CHARACTER_BUDGET,
  FITTED_TEXT_LINE_BUDGET,
  FITTED_WAVEFORM_BAR_BUDGET,
  fileProfileSource,
  fileViewModel,
  type FileFormat,
  type FileModelLike,
  type FileProfileSource,
  type FileState,
  type FileViewModel,
} from './file-view-model';

export {
  boundedVideoFrameAspectRatio,
  containEmbeddedInteraction,
  fileIconFor,
  formatClock,
  humanSize,
  relativeDate,
  shortDate,
  type FileIconComponent,
} from './file-presentation';

export {
  FilePreviewStage,
  type FilePreviewComponent,
  type FilePreviewSignature,
} from './file-preview-stage';

export { ImagePreview } from './image-preview';

// The compound metadata shapes an extractor writes into. Shared per metadata
// family rather than per file extension, so a camera or a color profile reads
// the same wherever the bytes came from. A family that only needs the shapes
// should import this module directly rather than through this barrel, which also
// pulls in the four shells.
export {
  CameraCaptureField,
  CodedValueField,
  ColorProfileField,
  DocumentInfoField,
  ExifMetadataField,
  FontMetadataField,
  GeoLocationField,
  HtmlMetadataField,
  METADATA_VOCABULARIES,
  OfficeMetadataField,
  QuantityField,
  labelForCode,
} from './metadata-fields';

export { FileAtomShell } from './file-shell-atom';
export { FileEmbeddedShell } from './file-shell-embedded';
export { FileFittedShell } from './file-shell-fitted';
export { FileIsolatedShell } from './file-shell-isolated';

export {
  FileAudio,
  FileImage,
  FileObject,
  FileResource,
  FileVideo,
  applyFileFont,
  fileResourceURL,
  type FileResourceLike,
  type ResolvedFileResource,
} from './file-resources';
