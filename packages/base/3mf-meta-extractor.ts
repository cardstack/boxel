import { unzipSync, strFromU8 } from 'fflate';
import { FileContentMismatchError } from './file-api';

// A 3MF file is an OPC package: a ZIP archive of XML parts. The part we read is
// the 3D model (conventionally `3D/3dmodel.model`), whose `<model>` root carries
// a `unit` attribute and a `<metadata>` block — both sitting *above* the
// `<resources>` geometry. Everything a user searches for (title, designer,
// description, license) lives in that header block and is absent from the
// filename, which is why 3MF earns its own FileDef.

export interface ThreeMfMetadata {
  title?: string;
  designer?: string;
  description?: string;
  license?: string;
  unit?: string;
  hasThumbnail: boolean;
}

// The model part holds all the geometry, so it can be large. We only need the
// header, which is small and at the top — decode at most this many bytes before
// parsing so the work stays bounded on the indexing hot path regardless of mesh
// size.
const MODEL_HEADER_MAX_BYTES = 262_144; // 256 KB

// Case-insensitive, namespace-prefix tolerant (`<m:model …>`) matchers. These
// live in a plain `.ts` module (not `.gts`) so regex literals are safe from the
// content-tag lexer quirks that affect `.gts` files.
const MODEL_PART_RE = /\.model$/i;
const GEOMETRY_START_RE = /<(?:\w+:)?(?:resources|build)\b/i;
const MODEL_UNIT_RE =
  /<(?:\w+:)?model\b[^>]*\bunit\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const METADATA_RE =
  /<(?:\w+:)?metadata\b[^>]*\bname\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/(?:\w+:)?metadata>/gi;
const THUMBNAIL_RE = /thumbnail/i;
const IMAGE_EXT_RE = /\.(?:png|jpe?g)$/i;

// 3MF's default unit when the `<model>` element omits it (spec §the model
// element): millimeter. We fill it in so the field is always meaningful.
const DEFAULT_UNIT = 'millimeter';

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&amp;/g, '&');
}

function firstMatch(...values: (string | undefined)[]): string | undefined {
  for (let value of values) {
    if (value != null && value.trim() !== '') {
      return value;
    }
  }
  return undefined;
}

export function extract3mfMetadata(bytes: Uint8Array): ThreeMfMetadata {
  // Collect every entry name via the filter callback (called for all entries)
  // while only inflating the model part — the thumbnail/texture parts stay
  // compressed. The names give us the thumbnail signal for free.
  let names: string[] = [];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        names.push(file.name);
        return MODEL_PART_RE.test(file.name);
      },
    });
  } catch {
    throw new FileContentMismatchError('3MF file is not a valid ZIP archive');
  }

  let modelName =
    Object.keys(files).find((name) => name === '3D/3dmodel.model') ??
    Object.keys(files).find((name) => MODEL_PART_RE.test(name));
  if (!modelName) {
    throw new FileContentMismatchError(
      '3MF archive has no 3D model part (no *.model entry)',
    );
  }

  let modelBytes = files[modelName];
  let header = strFromU8(modelBytes.subarray(0, MODEL_HEADER_MAX_BYTES));
  let geometryStart = header.search(GEOMETRY_START_RE);
  if (geometryStart >= 0) {
    header = header.slice(0, geometryStart);
  }

  let unitMatch = header.match(MODEL_UNIT_RE);
  let unit = firstMatch(unitMatch?.[1], unitMatch?.[2]) ?? DEFAULT_UNIT;

  let metadata: Record<string, string> = {};
  let match: RegExpExecArray | null;
  while ((match = METADATA_RE.exec(header))) {
    let name = firstMatch(match[1], match[2]);
    if (!name) {
      continue;
    }
    let value = decodeXmlEntities((match[3] ?? '').trim());
    if (value !== '') {
      metadata[name] = value;
    }
  }
  // Reset lastIndex so the shared /g regex is safe on the next call.
  METADATA_RE.lastIndex = 0;

  let hasThumbnail = names.some(
    (name) => THUMBNAIL_RE.test(name) && IMAGE_EXT_RE.test(name),
  );

  return {
    title: metadata['Title'],
    designer: metadata['Designer'],
    description: metadata['Description'],
    license: firstMatch(metadata['LicenseTerms'], metadata['Copyright']),
    unit,
    hasThumbnail,
  };
}
