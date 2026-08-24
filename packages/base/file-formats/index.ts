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
  ensureFileViewModel,
  fileProfileSource,
  fileViewModel,
  isFileViewModel,
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
  filePreviewComponentFor,
  type ContentPreviewSignature,
  type FilePreviewComponent,
  type FilePreviewSignature,
} from './file-preview-stage';

// The content-only family renderers: just the file's content, none of the
// shell chrome (no file bar, no inspector, no Download/Copy-link). Pass the
// FileDef instance as `@model` — or a prebuilt view model — and optionally a
// `@mode`, which defaults to 'embedded' (see `ContentPreviewSignature`).
// Loading/failure/staleness treatment belongs to the embedding author; inside
// the default templates it is `FilePreviewStage`'s job. For kind-dispatching
// consumers, `filePreviewComponentFor(file)` resolves the renderer the file's
// own class declares — pass it `ensureFileViewModel(file, mode)` as `@model`,
// since only the content-only components exported here project a bare
// instance themselves; the other family renderers read projection-only fields
// (the fitted budgets among them) straight off `@model`.
export { AudioPreview } from './audio-preview';
export { ImagePreview } from './image-preview';
export { MarkdownPreview } from './markdown-preview';

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
