import {
  APP_BOXEL_EXTERNAL_FIELDS_KEY,
  MAX_MATRIX_EVENT_CONTENT_BYTES,
} from '../matrix-constants.ts';

import { canonicalizeMatrixMediaKey } from './matrix-utils.ts';

// Where each field an event carries in Matrix media lives, by field name.
export type ExternalFields = Record<string, string>;

function contentBytes(content: Record<string, unknown>): number {
  return new TextEncoder().encode(JSON.stringify(content)).length;
}

// An event whose content would pass the size limit carries the named fields
// in Matrix media instead: each one is uploaded as JSON, removed from the
// content, and listed under APP_BOXEL_EXTERNAL_FIELDS_KEY with its media URL.
// Content within the limit is returned as it is. `upload` stores the JSON and
// returns its media URL. Throws when the content is still too large without
// those fields, since Matrix would refuse the event.
export async function externalizeOversizedFields<
  T extends Record<string, unknown>,
>(
  content: T,
  fields: string[],
  upload: (json: string) => Promise<string>,
  maxContentBytes = MAX_MATRIX_EVENT_CONTENT_BYTES,
): Promise<T> {
  if (contentBytes(content) <= maxContentBytes) {
    return content;
  }
  let external: ExternalFields = {};
  let rest: Record<string, unknown> = { ...content };
  for (let field of fields) {
    if (rest[field] === undefined) {
      continue;
    }
    let url = canonicalizeMatrixMediaKey(
      await upload(JSON.stringify(rest[field])),
    );
    if (!url?.startsWith('mxc://')) {
      throw new Error(`the upload of ${field} returned no Matrix media URL`);
    }
    external[field] = url;
    delete rest[field];
  }
  rest[APP_BOXEL_EXTERNAL_FIELDS_KEY] = external;
  let bytes = contentBytes(rest);
  if (bytes > maxContentBytes) {
    throw new Error(
      `event content is ${bytes} bytes without ${fields.join(', ')}, over the ${maxContentBytes}-byte limit`,
    );
  }
  return rest as T;
}

// Puts back the fields an event carries in Matrix media, in place. Only
// Matrix media is fetched, from the reader's own homeserver: `download` gets
// the mxc:// URL and returns its text. A field that can't be fetched stays
// listed under APP_BOXEL_EXTERNAL_FIELDS_KEY, and the reason is returned.
export async function restoreExternalFields(
  content: Record<string, any> | undefined,
  download: (mxcUrl: string) => Promise<string>,
): Promise<string[]> {
  let external = content?.[APP_BOXEL_EXTERNAL_FIELDS_KEY];
  if (!content || !external || typeof external !== 'object') {
    return [];
  }
  let errors: string[] = [];
  let unresolved: ExternalFields = {};
  await Promise.all(
    Object.entries(external as Record<string, unknown>).map(
      async ([field, url]) => {
        let mxcUrl =
          typeof url === 'string' ? canonicalizeMatrixMediaKey(url) : null;
        if (!mxcUrl?.startsWith('mxc://')) {
          errors.push(`${field} is not in Matrix media`);
          return;
        }
        try {
          content[field] = JSON.parse(await download(mxcUrl));
        } catch (error) {
          unresolved[field] = mxcUrl;
          errors.push(
            `could not load ${field}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    ),
  );
  if (Object.keys(unresolved).length) {
    content[APP_BOXEL_EXTERNAL_FIELDS_KEY] = unresolved;
  } else {
    delete content[APP_BOXEL_EXTERNAL_FIELDS_KEY];
  }
  return errors;
}
