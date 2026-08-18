import PrinterIcon from '@cardstack/boxel-icons/printer';
import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import { DEFAULT_FILE_SIZE_LIMIT_BYTES } from '@cardstack/runtime-common/constants';
import {
  FileContentMismatchError,
  type ByteStream,
  type SerializedFile,
} from './file-api';
import {
  ThreeDModelDef,
  getExtension,
  model3dAttributes,
  type SerializedModel3d,
} from './three-d-model-def';
import { parseThreeMf, type ThreeMfMetadata } from './three-mf-meta-extractor';

// Project the 3MF package header + slicer config onto the shared `model3d`
// field. Triangle and mesh counts come from the slicer config (`printParts` /
// summed configured face count) when present; a package without one keeps its
// material and provenance facts but reports no geometry counts, which is the
// honest header-only answer.
function threeMfToModel3d(t: ThreeMfMetadata): SerializedModel3d {
  return {
    format: '3MF package',
    meshes: t.printPartCount,
    triangles: t.configuredFaceCount,
    materials: t.materialNames?.length || undefined,
    materialNames: t.materialNames,
    unit: t.unit,
    generator: t.application,
    designer: t.designer,
    license: t.licenseTerms,
    plateCount: t.plateCount,
    printPartCount: t.printPartCount,
    extruderCount: t.extruderCount,
  };
}

export class ThreeMfDef extends ThreeDModelDef {
  static displayName = '3MF Package';
  static icon = PrinterIcon;
  static acceptTypes = '.3mf,model/3mf,application/vnd.ms-3mfdocument';

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: {
      contentHash?: string;
      contentSize?: number;
      // Backstop bound on the bytes we're willing to read at index time,
      // threaded from the host (see `FileDefAttributesExtractor`); defaults to
      // the realm's standard file-size limit (`DEFAULT_FILE_SIZE_LIMIT_BYTES`),
      // the same ceiling the write path enforces, so the two stay in step.
      fileSizeLimitBytes?: number;
    } = {},
  ): Promise<SerializedFile<Partial<{ model3d: SerializedModel3d }>>> {
    let extension = getExtension(url);
    if (extension !== '.3mf') {
      throw new FileContentMismatchError(
        `Expected .3mf file extension, got "${extension || 'none'}"`,
      );
    }

    let bytesPromise: Promise<Uint8Array> | undefined;
    let memoizedStream = async () => {
      bytesPromise ??= byteStreamToUint8Array(await getStream());
      return bytesPromise;
    };

    let base = await super.extractAttributes(url, memoizedStream, options);
    let bytes = await memoizedStream();
    // Over the size cap, skip the read but keep the ThreeMfDef type — the file
    // still renders via the live client-side viewer (which parses its own
    // geometry); it just has an empty inspector panel and the cube placeholder.
    // Do NOT throw FileContentMismatchError here: that would demote the file to
    // a plain FileDef and lose the 3D card entirely.
    let sizeCap = options.fileSizeLimitBytes ?? DEFAULT_FILE_SIZE_LIMIT_BYTES;
    if (bytes.byteLength > sizeCap) {
      console.warn(
        `[ThreeMfDef] skipping metadata extraction for ${url}: ${bytes.byteLength} bytes exceeds cap ${sizeCap}`,
      );
      return { ...base };
    }
    let parsed = parseThreeMf(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    );
    if (!parsed) {
      throw new FileContentMismatchError('File is not a parseable 3MF package');
    }
    return {
      ...base,
      ...model3dAttributes(threeMfToModel3d(parsed.threeMfMetadata)),
    };
  }
}

export default ThreeMfDef;
