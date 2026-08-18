// The extract path the three Office families share: skip an oversize file, read
// the bytes once, let a non-OOXML file's `FileContentMismatchError` propagate so
// the framework falls back to a plain FileDef, and attach the parsed metadata
// only when it carried something. The families differ only in which parser they
// hand in (`extractDocxMetadata`, `extractPptxMetadata`, `extractXlsxMetadata`),
// so keeping this in one place means all three degrade identically.

import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import type { ByteStream, SerializedFile } from './file-api';
import { OOXML_MAX_BYTES, type OfficeMetadata } from './ooxml';

export async function extractOfficeMetadata(
  base: SerializedFile,
  getStream: () => Promise<ByteStream>,
  options: { contentSize?: number },
  parse: (bytes: Uint8Array) => Promise<OfficeMetadata>,
): Promise<SerializedFile<{ officeMetadata?: OfficeMetadata }>> {
  // A known oversize file skips the read entirely rather than buffering it to
  // then reject it. The document still downloads and identifies; only the
  // extracted preview and facts are skipped.
  if (
    options.contentSize !== undefined &&
    options.contentSize > OOXML_MAX_BYTES
  ) {
    return base;
  }

  let bytes: Uint8Array;
  try {
    bytes = await byteStreamToUint8Array(await getStream());
  } catch {
    // A stream that won't read is not a reason to fail the whole extract; the
    // base file identity is already gathered.
    return base;
  }

  if (bytes.byteLength > OOXML_MAX_BYTES) {
    return base;
  }

  // A non-OOXML file throws `FileContentMismatchError` here, which propagates so
  // the extract framework falls back to a plain FileDef. Every parser stamps
  // `kind`, and the family already knows its format statically, so the metadata
  // only earns its attribute when it carries a fact beyond that.
  let parsed = await parse(bytes);
  let hasFacts = Object.keys(parsed).some((key) => key !== 'kind');

  return {
    ...base,
    ...(hasFacts ? { officeMetadata: parsed } : {}),
  };
}
