import { unzipSync, strFromU8 } from 'fflate';

// Bounded, header-only 3MF (OPC ZIP) reader. A 3MF package's useful text
// metadata lives at the TOP of the `*.model` part — the `<model>` root's
// namespaces/unit, the `<metadata>` children, and the `<basematerials>` in
// `<resources>` — all of which precede the geometry (`<object>`/`<mesh>`/
// `<vertices>`). This reader exploits that layout to avoid paying for the
// geometry:
//   1. `unzipSync`'s `filter` runs BEFORE decompression, so we decompress only
//      the `.model` and `model_settings.config` entries — every other package
//      entry (embedded plate-thumbnail PNGs, textures, `.rels`) is skipped, and
//      any entry declaring an implausibly large decompressed size is rejected
//      as a ZIP-bomb backstop.
//   2. We read metadata off the model part's PROLOGUE (everything up to the
//      first `<object>`) with lightweight regex — no DOM parse of the vertex/
//      triangle body, and no per-vertex bounding-box scan. Physical dimensions
//      come from the live client-side viewer instead, which is both cheaper at
//      index time and correct (it applies the build/component transforms this
//      reader would have ignored).
// Pure JS (`fflate` + regex, no DOM), so it is directly unit-testable. Returns
// `undefined` for anything that isn't a 3MF core package — a non-ZIP payload, a
// package with no `.model` part, or a `.model` whose root isn't the 3MF
// `<model>` core element — and the calling FileDef turns that into a
// `FileContentMismatchError`.

// ZIP-bomb backstop: reject any entry that DECLARES a decompressed size beyond
// this. A 3MF's model XML compresses well, so a legitimate part can be many
// times the (write-capped) archive — but never hundreds of MB. Declared sizes
// can be forged, so this stops the honest bomb, not an adversarial one; realm
// files come from authenticated members, so this is hardening, not a hard DoS
// guarantee.
const MAX_DECOMPRESSED_BYTES = 128 * 1024 * 1024;
const CORE_NS = '3dmanufacturing/core';

const MODEL_PART_RE = /\.model$/i;
const CONFIG_PART_RE = /(?:^|\/)model_settings\.config$/i;

interface ThreeMfPrintPartData {
  name?: string;
  extruder?: number;
  faceCount?: number;
}

export interface ThreeMfMetadata {
  unit?: string;
  language?: string;
  modelPart?: string;
  extensionCount?: number;
  extensions?: string[];
  title?: string;
  designer?: string;
  application?: string;
  bambuStudioVersion?: string;
  creationDate?: string;
  licenseTerms?: string;
  description?: string;
  plateCount?: number;
  printPartCount?: number;
  configuredFaceCount?: number;
  extruderCount?: number;
  materialNames?: string[];
  materialColors?: string[];
  printParts?: ThreeMfPrintPartData[];
}

function decodeXmlEntities(value: string): string {
  return (
    value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
        String.fromCodePoint(parseInt(hex, 16)),
      )
      // `&amp;` last so a literal `&amp;lt;` doesn't double-decode.
      .replace(/&amp;/g, '&')
  );
}

// Read a single `name="value"` attribute out of a raw start-tag string.
function attr(tag: string, name: string): string | undefined {
  let match = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return match ? decodeXmlEntities(match[1]) : undefined;
}

export function parseThreeMf(
  buf: ArrayBuffer,
): { threeMfMetadata: ThreeMfMetadata } | undefined {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buf), {
      // Runs before decompression: only the entries we actually read are
      // inflated, and an oversized declared entry is refused outright.
      filter: (file) =>
        (MODEL_PART_RE.test(file.name) || CONFIG_PART_RE.test(file.name)) &&
        file.originalSize <= MAX_DECOMPRESSED_BYTES,
    }) as Record<string, Uint8Array>;
  } catch {
    // Not a valid ZIP / OPC package.
    return undefined;
  }

  let modelName = Object.keys(files).find((name) => MODEL_PART_RE.test(name));
  if (!modelName) {
    return undefined;
  }
  let modelText = strFromU8(files[modelName]);

  // Require a real 3MF core `<model>` root — not merely a `.model`-named XML
  // file. This rejects a mislabeled document (e.g. `<document/>`) that would
  // otherwise be stamped as a 3MF and handed to a viewer that can't parse it.
  let rootTag = modelText.match(/<model\b[^>]*>/i)?.[0];
  if (!rootTag || !new RegExp(CORE_NS, 'i').test(rootTag)) {
    return undefined;
  }
  if (
    !/^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<model\b/i.test(
      modelText,
    )
  ) {
    return undefined;
  }

  // The metadata prologue: everything before the first geometry object. All the
  // facts we read (metadata children, basematerials) live here.
  let objectIndex = modelText.search(/<object\b/i);
  let prologue =
    objectIndex === -1 ? modelText : modelText.slice(0, objectIndex);

  let metadata = new Map<string, string>();
  let metadataRe = /<metadata\b([^>]*)>([\s\S]*?)<\/metadata>/gi;
  for (let match; (match = metadataRe.exec(prologue)); ) {
    let key = attr(match[1], 'name');
    if (key) {
      metadata.set(key.toLowerCase(), decodeXmlEntities(match[2].trim()));
    }
  }

  let materialNames: string[] = [];
  let materialColors: string[] = [];
  let baseRe = /<base\b([^>]*?)\/?>/gi;
  for (let match; (match = baseRe.exec(prologue)); ) {
    let name = attr(match[1], 'name');
    let color = attr(match[1], 'displaycolor');
    if (name) {
      materialNames.push(name);
    }
    if (color) {
      materialColors.push(color);
    }
  }

  let extensions: string[] = [];
  let namespaceRe = /xmlns:([\w-]+)\s*=\s*"([^"]*)"/gi;
  for (let match; (match = namespaceRe.exec(rootTag)); ) {
    extensions.push(`${match[1]} · ${match[2]}`);
  }

  let application =
    metadata.get('application') ??
    metadata.get('producer') ??
    metadata.get('generator');

  // The slicer config is a separate, small entry — decompressed in full and
  // parsed for the Bambu/PrusaSlicer print-part facts (plates, extruders,
  // per-part face counts). Absent for non-slicer 3MFs, which simply omit these.
  let configName = Object.keys(files).find((name) => CONFIG_PART_RE.test(name));
  let printParts: ThreeMfPrintPartData[] = [];
  let plateCount = 0;
  let configuredFaceCount = 0;
  let extruders = new Set<number>();
  if (configName) {
    let config = strFromU8(files[configName]);
    plateCount = (config.match(/<plate\b/gi) ?? []).length;
    let partRe = /<part\b([^>]*)>([\s\S]*?)<\/part>/gi;
    for (let partMatch; (partMatch = partRe.exec(config)); ) {
      let partAttrs = partMatch[1];
      let body = partMatch[2];
      let values = new Map<string, string>();
      let kvRe = /<metadata\b([^>]*?)\/?>/gi;
      for (let kv; (kv = kvRe.exec(body)); ) {
        let key = attr(kv[1], 'key');
        if (key) {
          values.set(key, attr(kv[1], 'value') ?? '');
        }
      }
      let faceCount = Number(
        body.match(/<mesh_stat\b[^>]*\bface_count\s*=\s*"([^"]*)"/i)?.[1] ?? 0,
      );
      let extruder = Number(values.get('extruder') ?? 0);
      if (extruder > 0) {
        extruders.add(extruder);
      }
      if (Number.isFinite(faceCount)) {
        configuredFaceCount += faceCount;
      }
      printParts.push({
        name:
          values.get('name') ||
          `Part ${attr(partAttrs, 'id') ?? printParts.length + 1}`,
        extruder: extruder || undefined,
        faceCount: faceCount || undefined,
      });
    }
  }

  return {
    threeMfMetadata: {
      unit: attr(rootTag, 'unit') ?? 'millimeter',
      language: attr(rootTag, 'xml:lang'),
      modelPart: modelName,
      extensionCount: extensions.length || undefined,
      extensions,
      title: metadata.get('title'),
      designer: metadata.get('designer'),
      application,
      bambuStudioVersion: metadata.get('bambustudio:3mfversion'),
      creationDate: metadata.get('creationdate'),
      licenseTerms: metadata.get('licenseterms'),
      description: metadata.get('description'),
      plateCount: plateCount || undefined,
      printPartCount: printParts.length || undefined,
      configuredFaceCount: configuredFaceCount || undefined,
      extruderCount: extruders.size || undefined,
      materialNames,
      materialColors,
      printParts,
    },
  };
}
