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
  formatClock,
  humanSize,
  iconFor,
  relativeDate,
  shortDate,
} from './file-presentation';

export {
  FilePreviewStage,
  type FilePreviewComponent,
  type FilePreviewSignature,
} from './file-preview-stage';

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
