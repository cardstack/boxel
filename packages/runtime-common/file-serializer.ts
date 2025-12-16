import type { Definition, FieldDefinition } from './index';
import {
  type LooseSingleCardDocument,
  type CardResource,
  isCodeRef,
} from './index';
import type { CardFields, Meta } from './resource-types';
import { serialize as serializeCodeRef } from './serializers/code-ref';
import { maybeRelativeURL as makeRelativeURL } from './url';

export default function serialize({
  doc,
  definition,
  relativeTo,
  customFieldDefinitions,
}: {
  doc: LooseSingleCardDocument;
  definition: Definition;
  relativeTo: URL;
  customFieldDefinitions?: Record<string, FieldDefinition>;
}): LooseSingleCardDocument {
  const realmURL = doc.data.meta?.realmURL
    ? new URL(doc.data.meta.realmURL)
    : undefined;

  const codeRefOpts = {
    relativeTo,
    trimExecutableExtension: true as true,
  };
  const metaCodeRefOpts = {
    ...codeRefOpts,
    allowRelative: true as true,
    ...(realmURL && {
      maybeRelativeURL: (url: string) =>
        makeRelativeURL(new URL(url, relativeTo), relativeTo, realmURL),
    }),
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
      metaCodeRefOpts,
    ) as any;
  }

  if (result.data.meta?.fields) {
    result.data.meta.fields = processMetaFields({
      fields: result.data.meta.fields,
      doc,
      relativeTo,
      codeRefOpts: metaCodeRefOpts,
    });
  }

  if (doc.data.attributes) {
    result.data.attributes = processAttributes({
      attributes: doc.data.attributes,
      definition,
      doc,
      relativeTo,
      codeRefOpts,
      customFieldDefinitions,
    });
  }

  if (doc.data.relationships) {
    const processedRelationships = processRelationships({
      relationships: doc.data.relationships,
      definition,
      relativeTo,
      realmURL,
      customFieldDefinitions,
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
  definition,
  basePath = '',
  doc,
  relativeTo,
  codeRefOpts,
  customFieldDefinitions,
}: {
  attributes: Record<string, any>;
  definition: Definition;
  basePath?: string;
  doc: LooseSingleCardDocument;
  relativeTo: URL;
  codeRefOpts: {
    relativeTo: URL;
    trimExecutableExtension: true;
    allowRelative?: true;
    maybeRelativeURL?: (url: string) => string;
  };
  customFieldDefinitions?: Record<string, FieldDefinition>;
}): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [fieldName, fieldValue] of Object.entries(attributes)) {
    const fieldPath = basePath ? `${basePath}.${fieldName}` : fieldName;
    const fieldDefinition = getFieldDefinition(
      fieldPath,
      definition,
      customFieldDefinitions,
    );

    if (!fieldDefinition || fieldDefinition.isComputed) {
      continue;
    }

    // if we have new primitives that are serialized with URL's besides
    // code-refs, then we need to handle them here...
    if (
      fieldDefinition.serializerName === 'code-ref' &&
      isCodeRef(fieldValue)
    ) {
      result[fieldName] = serializeCodeRef(
        fieldValue,
        doc,
        undefined,
        codeRefOpts,
      ) as any;
      continue;
    }

    if (fieldDefinition.type === 'containsMany') {
      if (!Array.isArray(fieldValue)) {
        throw new Error(
          `Field '${fieldPath}' is containsMany but value is not an array`,
        );
      }
      if (fieldDefinition.isPrimitive) {
        result[fieldName] = fieldValue;
      } else {
        result[fieldName] = fieldValue.map((item) => {
          return processAttributes({
            attributes: item,
            definition,
            basePath: fieldPath,
            doc,
            relativeTo,
            codeRefOpts,
            customFieldDefinitions,
          });
        });
      }
    } else if (fieldDefinition.isPrimitive) {
      result[fieldName] = fieldValue;
    } else {
      result[fieldName] = processAttributes({
        attributes: fieldValue,
        definition,
        basePath: fieldPath,
        doc,
        relativeTo,
        codeRefOpts,
        customFieldDefinitions,
      });
    }
  }

  return result;
}

function processRelationships({
  relationships,
  definition,
  relativeTo,
  realmURL,
  customFieldDefinitions,
}: {
  relationships: NonNullable<CardResource['relationships']>;
  definition: Definition;
  relativeTo: URL;
  realmURL?: URL;
  customFieldDefinitions?: Record<string, FieldDefinition>;
}): NonNullable<CardResource['relationships']> | undefined {
  const result: NonNullable<CardResource['relationships']> = {};

  for (const [relationshipKey, value] of Object.entries(relationships)) {
    const baseFieldPath = parseRelationshipKey(relationshipKey);
    const fieldDefinition = getFieldDefinition(
      baseFieldPath,
      definition,
      customFieldDefinitions,
    );

    if (!fieldDefinition || fieldDefinition.isComputed) {
      continue;
    }

    const processedValue = { ...value };

    if (processedValue.links && 'self' in processedValue.links) {
      // Handle both truthy and null values for links.self
      if (processedValue.links.self !== null) {
        let selfLink = processedValue.links.self;
        if (realmURL && selfLink) {
          try {
            selfLink = makeRelativeURL(
              new URL(selfLink, relativeTo),
              relativeTo,
              realmURL,
            );
          } catch (e) {
            // ignore malformed URLs and leave as-is
          }
        }
        processedValue.links = {
          self: selfLink,
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
      fieldDefinition.type === 'linksToMany' &&
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

function getFieldDefinition(
  fieldPath: string,
  definition: Definition,
  customFieldDefinitions?: Record<string, FieldDefinition>,
): FieldDefinition | undefined {
  return customFieldDefinitions?.[fieldPath] ?? definition.fields[fieldPath];
}

function parseRelationshipKey(key: string): string {
  // chains like "inners.0.other" need to become "inners.other" here. This is a
  // lossy transformation, it would be better to refactor this so it's
  // schema-driven and known plural fields strip off their own numeric segments.
  return key.replace(/\.\d+/g, '');
}

function processMetaFields({
  fields,
  doc,
  relativeTo,
  codeRefOpts,
}: {
  fields: CardFields;
  doc: LooseSingleCardDocument;
  relativeTo: URL;
  codeRefOpts: {
    relativeTo: URL;
    trimExecutableExtension: true;
    allowRelative?: true;
    maybeRelativeURL?: (url: string) => string;
  };
}): CardFields {
  const result: CardFields = {};
  for (const [fieldName, fieldValue] of Object.entries(fields)) {
    if (Array.isArray(fieldValue)) {
      result[fieldName] = fieldValue.map((item) =>
        processMetaField({
          field: item,
          doc,
          relativeTo,
          codeRefOpts,
        }),
      );
    } else {
      result[fieldName] = processMetaField({
        field: fieldValue,
        doc,
        relativeTo,
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
  codeRefOpts,
}: {
  field: Partial<Meta>;
  doc: LooseSingleCardDocument;
  relativeTo: URL;
  codeRefOpts: {
    relativeTo: URL;
    trimExecutableExtension: true;
    allowRelative?: true;
    maybeRelativeURL?: (url: string) => string;
  };
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
      codeRefOpts,
    });
  }

  return result;
}
