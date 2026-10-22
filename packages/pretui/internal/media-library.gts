// Pretui — shared vocabulary for AssetWell and Gallery.
import type { AssetKind } from './media-viewer';

export const KIND_WORD: Readonly<Record<AssetKind, string>> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  model: '3D model',
  unknown: 'File',
};

/** Least-wrong frame for an asset whose dimensions nobody recorded. Stated
 * once so the well and the rail cannot disagree about it. */
export const FALLBACK_RATIO = '4 / 3';
