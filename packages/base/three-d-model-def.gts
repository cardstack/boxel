import File3dIcon from '@cardstack/boxel-icons/file-3d';
import { FileDef, contains, field } from './card-api';
import { Model3dMetadataField } from './file-formats/metadata-fields';
import { Model3DPreview } from './file-formats/model3d-preview';

// Extracted to a module const: a regex literal inline in a `.gts` (with `/`
// inside a character class) can confuse the content-tag template lexer.
const EXTENSION_RE = new RegExp('\\.[^/.]+$');

// Lowercased file extension (including the leading dot) from a URL, e.g.
// `.stl`. Shared by the leaf `extractAttributes` methods to reject a file whose
// bytes don't match its extension. Falls back to a plain string scan when the
// value isn't a parseable URL.
export function getExtension(url: string): string {
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

// The wire shape a leaf's `extractAttributes` projects onto the shared `model3d`
// field. Every key is optional: a leaf sets only what its header carries, and
// `model3dAttributes` drops the rest so an absent fact never overwrites the
// field with an empty value.
export interface SerializedModel3d {
  format?: string;
  meshes?: number;
  triangles?: number;
  vertices?: number;
  materials?: number;
  materialNames?: string[];
  unit?: string;
  nodes?: number;
  animations?: number;
  textures?: number;
  dimensions?: string;
  generator?: string;
  solidName?: string;
  designer?: string;
  license?: string;
  plateCount?: number;
  printPartCount?: number;
  extruderCount?: number;
  hasColorData?: boolean;
}

// Prune undefined / empty facts, then wrap the result as the `model3d`
// attribute — omitting it entirely when the leaf extracted nothing, so an
// unparseable-but-still-3D file keeps identity-only rather than a blank panel.
export function model3dAttributes(facts: SerializedModel3d): {
  model3d?: SerializedModel3d;
} {
  let model3d: SerializedModel3d = {};
  for (let [key, value] of Object.entries(facts)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    (model3d as Record<string, unknown>)[key] = value;
  }
  return Object.keys(model3d).length > 0 ? { model3d } : {};
}

// Re-exported for a leaf that wants to strip an extension off a file name.
export { EXTENSION_RE };

// The 3D model family. Like the audio/video families it sits directly under
// `FileDef` and supplies just two things — its icon and its live renderer —
// inheriting the four shared format shells (atom, fitted, embedded, isolated)
// and their chrome. The family's metadata lands on the `model3d` field, which
// the isolated shell renders in its `3D model` inspector section; the fitted
// hero fact reads `model3d.triangles`. Leaves (StlDef, ThreeMfDef) add only
// their `extractAttributes`, projecting each format's header facts onto that one
// field via `model3dAttributes`.
export class ThreeDModelDef extends FileDef {
  static displayName = '3D Model';
  static icon = File3dIcon;

  static previewComponent = Model3DPreview;

  @field model3d = contains(Model3dMetadataField);
}

export default ThreeDModelDef;
