// Pretui — shared vocabulary for AssetGrid and MediaInspector.
import type { AssetKind } from './media-viewer';

export const KIND_WORD: Readonly<Record<AssetKind, string>> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  model: '3D model',
  unknown: 'File',
};
