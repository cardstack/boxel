import type { CodeRef } from './code-ref.ts';
import type { RealmResourceIdentifier } from './realm-identifiers.ts';
import { inferContentType } from './infer-content-type.ts';
import {
  fileMetaTimestamps,
  type FileMetaResource,
  type QueryFieldMeta,
} from './resource-types.ts';

export function buildFileResource(
  fileURL: string,
  attributes: Record<string, any>,
  adoptsFrom: CodeRef,
  queryFieldDefs?: Record<string, QueryFieldMeta>,
  fieldsMeta?: NonNullable<FileMetaResource['meta']['fields']>,
  // Stamped through `fileMetaTimestamps` like every other file-meta producer,
  // so a FileDef hydrated from this resource reads them through the same
  // `meta` keys as one hydrated from a served document. Left off entirely
  // when neither is known.
  timestamps?: { lastModified?: number; createdAt?: number },
): FileMetaResource {
  let name = new URL(fileURL).pathname.split('/').pop() ?? fileURL;
  let baseAttributes = {
    name: attributes.name ?? name,
    url: attributes.url ?? fileURL,
    sourceUrl: attributes.sourceUrl ?? fileURL,
    contentType: attributes.contentType ?? inferContentType(name),
  };
  let mergedAttributes: Record<string, unknown> = { ...baseAttributes };
  for (let [key, value] of Object.entries(attributes)) {
    if (value !== undefined && !(key in mergedAttributes)) {
      mergedAttributes[key] = value;
    }
  }
  return {
    id: fileURL as RealmResourceIdentifier,
    type: 'file-meta',
    attributes: mergedAttributes,
    meta: {
      adoptsFrom,
      ...(timestamps?.lastModified !== undefined ||
      timestamps?.createdAt !== undefined
        ? fileMetaTimestamps(timestamps.lastModified, timestamps.createdAt)
        : {}),
      // Per-field subclass overrides for nested polymorphic fields (e.g.
      // `frontmatter` → SkillFrontmatterField). Without this the field rehydrates
      // as its declared base type. Supplied by `extractAttributes` (see below).
      ...(fieldsMeta ? { fields: fieldsMeta } : {}),
      ...(queryFieldDefs ? { queryFieldDefs } : {}),
    },
    links: { self: fileURL },
  };
}
