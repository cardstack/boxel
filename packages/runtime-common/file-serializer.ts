import {
  type LooseSingleCardDocument,
  type CardResource,
  CardDefMeta,
  CardDefFieldMeta,
  isUrlLike,
  maybeRelativeURL,
  isCodeRef,
} from './index';
import { type CardFields, type Meta } from './resource-types';
import { serialize as serializeCodeRef } from './serializers/code-ref';

export default function serialize({
  doc,
  meta,
  realm,
  relativeTo,
  customFieldMetas,
}: {
  doc: LooseSingleCardDocument;
  meta: CardDefMeta;
  realm: string;
  relativeTo: URL;
  customFieldMetas?: Record<string, CardDefFieldMeta>;
}): LooseSingleCardDocument {
  const realmURL = new URL(realm);
  const codeRefOpts = {
    relativeTo,
    trimExecutableExtension: true,
    maybeRelativeURL: (url: string) =>
      maybeRelativeURL(new URL(url), relativeTo, realmURL),
  };

  const result: LooseSingleCardDocument = {
    data: {
      ...doc.data,
    },
  };

  if (result.data.meta?.adoptsFrom) {
    result.data.meta.adoptsFrom = serializeCodeRef(
      result.data.meta.adoptsFrom,
      doc,
      undefined,
      codeRefOpts,
    ) as any;
  }

  if (result.data.meta?.fields) {
    result.data.meta.fields = processMetaFields({
      fields: result.data.meta.fields,
      doc,
      relativeTo,
      realmURL,
      codeRefOpts,
    });
  }

  if (doc.data.attributes) {
    result.data.attributes = processAttributes({
      attributes: doc.data.attributes,
      meta,
      doc,
      relativeTo,
      realmURL,
      codeRefOpts,
      customFieldMetas,
    });
  }

  if (doc.data.relationships) {
    const processedRelationships = processRelationships({
      relationships: doc.data.relationships,
      meta,
      relativeTo,
      realmURL,
      customFieldMetas,
    });
    if (processedRelationships) {
      result.data.relationships = processedRelationships;
    }
  }

  delete result.data.id;
  delete result.data.lid;
  delete result.data.meta.realmInfo;
  delete result.data.meta.realmURL;
  delete result.data.meta.lastModified;
  delete result.data.meta.resourceCreatedAt;
  delete result.included;
  delete result.data.links;
  result.data.type = 'card';

  if (result.data.relationships) {
    for (let relationship of Object.values(result.data.relationships)) {
      if ('data' in relationship) {
        delete relationship.data;
      }
    }
  }

  return result;
}

function processAttributes({
  attributes,
  meta,
  basePath = '',
  doc,
  relativeTo,
  realmURL,
  codeRefOpts,
  customFieldMetas,
}: {
  attributes: Record<string, any>;
  meta: CardDefMeta;
  basePath?: string;
  doc: LooseSingleCardDocument;
  relativeTo: URL;
  realmURL: URL;
  codeRefOpts: { maybeRelativeURL: (url: string) => string };
  customFieldMetas?: Record<string, CardDefFieldMeta>;
}): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [fieldName, fieldValue] of Object.entries(attributes)) {
    const fieldPath = basePath ? `${basePath}.${fieldName}` : fieldName;
    const fieldMeta = getFieldMeta(fieldPath, meta, customFieldMetas);

    if (!fieldMeta || fieldMeta.isComputed) {
      continue;
    }

    // if we have new primitives that are serialized with URL's besides
    // code-refs, then we need to handle them here...
    if (fieldMeta.serializerName === 'code-ref' && isCodeRef(fieldValue)) {
      result[fieldName] = serializeCodeRef(
        fieldValue,
        doc,
        undefined,
        codeRefOpts,
      ) as any;
      continue;
    }

    if (fieldMeta.type === 'containsMany') {
      if (!Array.isArray(fieldValue)) {
        throw new Error(
          `Field '${fieldPath}' is containsMany but value is not an array`,
        );
      }
      if (fieldMeta.isPrimitive) {
        result[fieldName] = fieldValue;
      } else {
        result[fieldName] = fieldValue.map((item) => {
          return processAttributes({
            attributes: item,
            meta,
            basePath: fieldPath,
            doc,
            relativeTo,
            realmURL,
            codeRefOpts,
            customFieldMetas,
          });
        });
      }
    } else if (fieldMeta.isPrimitive) {
      result[fieldName] = fieldValue;
    } else {
      result[fieldName] = processAttributes({
        attributes: fieldValue,
        meta,
        basePath: fieldPath,
        doc,
        relativeTo,
        realmURL,
        codeRefOpts,
        customFieldMetas,
      });
    }
  }

  return result;
}

function processRelationships({
  relationships,
  meta,
  relativeTo,
  realmURL,
  customFieldMetas,
}: {
  relationships: NonNullable<CardResource['relationships']>;
  meta: CardDefMeta;
  relativeTo: URL;
  realmURL: URL;
  customFieldMetas?: Record<string, CardDefFieldMeta>;
}): NonNullable<CardResource['relationships']> | undefined {
  const result: NonNullable<CardResource['relationships']> = {};

  for (const [relationshipKey, value] of Object.entries(relationships)) {
    const { baseFieldPath } = parseRelationshipKey(relationshipKey);
    const fieldMeta = getFieldMeta(baseFieldPath, meta, customFieldMetas);

    if (!fieldMeta || fieldMeta.isComputed) {
      continue;
    }

    const processedValue = { ...value };

    if (processedValue.links && 'self' in processedValue.links) {
      // Handle both truthy and null values for links.self
      if (processedValue.links.self !== null) {
        processedValue.links = {
          self: isRelativeURL(processedValue.links.self)
            ? processedValue.links.self
            : maybeRelativeURL(
                new URL(processedValue.links.self),
                relativeTo,
                realmURL,
              ),
        };
      } else {
        // Preserve null values
        processedValue.links = { self: null };
      }
    } else if (
      processedValue.data &&
      !Array.isArray(processedValue.data) &&
      'id' in processedValue.data
    ) {
      processedValue.links = { self: processedValue.data.id };
      delete processedValue.data;
    } else if (
      processedValue.data &&
      !Array.isArray(processedValue.data) &&
      'lid' in processedValue.data
    ) {
      processedValue.links = { self: null };
      delete processedValue.data;
    } else {
      delete processedValue.links;
    }

    delete processedValue.data;

    if (
      fieldMeta.type === 'linksToMany' &&
      value.data &&
      Array.isArray(value.data)
    ) {
      value.data.forEach((_, index) => {
        result[`${relationshipKey}.${index}`] = {
          links: processedValue.links,
          meta: processedValue.meta,
        };
      });
    } else {
      result[relationshipKey] = processedValue;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function getFieldMeta(
  fieldPath: string,
  meta: CardDefMeta,
  customFieldMetas?: Record<string, CardDefFieldMeta>,
): CardDefFieldMeta | undefined {
  return customFieldMetas?.[fieldPath] ?? meta.fields[fieldPath];
}

function parseRelationshipKey(key: string): {
  baseFieldPath: string;
  arrayIndex: number | null;
} {
  const indexMatch = key.match(/^(.+)\.(\d+)$/);
  if (indexMatch) {
    return {
      baseFieldPath: indexMatch[1],
      arrayIndex: parseInt(indexMatch[2]),
    };
  }

  return {
    baseFieldPath: key,
    arrayIndex: null,
  };
}

function processMetaFields({
  fields,
  doc,
  relativeTo,
  realmURL,
  codeRefOpts,
}: {
  fields: CardFields;
  doc: LooseSingleCardDocument;
  relativeTo: URL;
  realmURL: URL;
  codeRefOpts: { maybeRelativeURL: (url: string) => string };
}): CardFields {
  const result: CardFields = {};
  for (const [fieldName, fieldValue] of Object.entries(fields)) {
    if (Array.isArray(fieldValue)) {
      result[fieldName] = fieldValue.map((item) =>
        processMetaField({
          field: item,
          doc,
          relativeTo,
          realmURL,
          codeRefOpts,
        }),
      );
    } else {
      result[fieldName] = processMetaField({
        field: fieldValue,
        doc,
        relativeTo,
        realmURL,
        codeRefOpts,
      });
    }
  }

  return result;
}

function processMetaField({
  field,
  doc,
  relativeTo,
  realmURL,
  codeRefOpts,
}: {
  field: Partial<Meta>;
  doc: LooseSingleCardDocument;
  relativeTo: URL;
  realmURL: URL;
  codeRefOpts: { maybeRelativeURL: (url: string) => string };
}): Partial<Meta> {
  const result = { ...field };
  if (result.adoptsFrom && isCodeRef(result.adoptsFrom)) {
    result.adoptsFrom = serializeCodeRef(
      result.adoptsFrom,
      doc,
      undefined,
      codeRefOpts,
    ) as any;
  }
  if (result.fields) {
    result.fields = processMetaFields({
      fields: result.fields,
      doc,
      relativeTo,
      realmURL,
      codeRefOpts,
    });
  }

  return result;
}

function isRelativeURL(url: string) {
  return isUrlLike(url) && !url.startsWith('http');
}
