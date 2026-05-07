import {
  getImmediateFieldDef,
  isResolvedCodeRef,
  type Definition,
  type FieldDefinition,
} from './index';
import {
  type LooseSingleCardDocument,
  type CardResource,
  type Relationship,
  relationshipEntries,
  isCodeRef,
} from './index';
import { resolveCardReference } from './card-reference-resolver';
import type { CardFields, Meta } from './resource-types';
import type { DefinitionLookup } from './definition-lookup';
import { serialize as serializeCodeRef } from './serializers/code-ref';
import { maybeRelativeURL as makeRelativeURL } from './url';

export default async function serialize({
  doc,
  definition,
  relativeTo,
  definitionLookup,
}: {
  doc: LooseSingleCardDocument;
  definition: Definition;
  relativeTo: URL;
  definitionLookup: DefinitionLookup;
}): Promise<LooseSingleCardDocument> {
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
    result.data.attributes = await processAttributes({
      attributes: doc.data.attributes,
      definition,
      doc,
      relativeTo,
      codeRefOpts: metaCodeRefOpts,
      definitionLookup,
    });
  }

  if (doc.data.relationships) {
    const processedRelationships = await processRelationships({
      relationships: doc.data.relationships,
      definition,
      relativeTo,
      realmURL,
      definitionLookup,
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
    for (let { relationship } of relationshipEntries(
      result.data.relationships,
    )) {
      delete relationship.data;
    }
  }

  return result;
}

// Recurse one level at a time, switching to the child `Definition`
// whenever we descend into a non-primitive field. Each segment of a
// nested path is resolved via the *current* definition's immediate
// field map; this matches the new top-level-only `Definition.fields`
// shape and avoids relying on dotted-path materialization.
async function processAttributes({
  attributes,
  definition,
  doc,
  relativeTo,
  codeRefOpts,
  definitionLookup,
}: {
  attributes: Record<string, any>;
  definition: Definition;
  doc: LooseSingleCardDocument;
  relativeTo: URL;
  codeRefOpts: {
    relativeTo: URL;
    trimExecutableExtension: true;
    allowRelative?: true;
    maybeRelativeURL?: (url: string) => string;
  };
  definitionLookup: DefinitionLookup;
}): Promise<Record<string, any>> {
  const result: Record<string, any> = {};

  for (const [fieldName, fieldValue] of Object.entries(attributes)) {
    const fieldDefinition = getImmediateFieldDef(definition, fieldName);

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
          `Field '${fieldName}' is containsMany but value is not an array`,
        );
      }
      if (fieldDefinition.isPrimitive) {
        result[fieldName] = fieldValue;
      } else {
        let childDef = await resolveChildDef(fieldDefinition, definitionLookup);
        if (!childDef) {
          continue;
        }
        result[fieldName] = await Promise.all(
          fieldValue.map((item) =>
            processAttributes({
              attributes: item,
              definition: childDef!,
              doc,
              relativeTo,
              codeRefOpts,
              definitionLookup,
            }),
          ),
        );
      }
    } else if (fieldDefinition.isPrimitive) {
      result[fieldName] = fieldValue;
    } else {
      let childDef = await resolveChildDef(fieldDefinition, definitionLookup);
      if (!childDef) {
        continue;
      }
      result[fieldName] = await processAttributes({
        attributes: fieldValue,
        definition: childDef,
        doc,
        relativeTo,
        codeRefOpts,
        definitionLookup,
      });
    }
  }

  return result;
}

async function resolveChildDef(
  fieldDefinition: FieldDefinition,
  definitionLookup: DefinitionLookup,
): Promise<Definition | undefined> {
  if (!isResolvedCodeRef(fieldDefinition.fieldOrCard)) {
    return undefined;
  }
  return await definitionLookup.lookupDefinition(fieldDefinition.fieldOrCard);
}

async function processRelationships({
  relationships,
  definition,
  relativeTo,
  realmURL,
  definitionLookup: _definitionLookup,
}: {
  relationships: NonNullable<CardResource['relationships']>;
  definition: Definition;
  relativeTo: URL;
  realmURL?: URL;
  definitionLookup: DefinitionLookup;
}): Promise<NonNullable<CardResource['relationships']> | undefined> {
  const result: NonNullable<CardResource['relationships']> = {};

  const normalizeRelationship = (relationship: Relationship): Relationship => {
    const processedValue = { ...relationship };

    if (processedValue.links && 'self' in processedValue.links) {
      // Handle both truthy and null values for links.self
      if (processedValue.links.self !== null) {
        let selfLink = processedValue.links.self;
        if (realmURL && selfLink) {
          try {
            selfLink = makeRelativeURL(
              new URL(resolveCardReference(selfLink, relativeTo)),
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

    return processedValue;
  };

  for (const [relationshipKey, value] of Object.entries(relationships)) {
    // Relationship paths are emitted by the host with optional `.N`
    // suffixes for linksToMany entries (e.g. `friends.0`) and
    // intermediate-card prefixes for nested relationships
    // (e.g. `inners.0.other`). Strip the numeric indices and resolve
    // the remaining dotted path through the immediate field maps,
    // descending into linked card definitions on demand.
    const cleanedKey = parseRelationshipKey(relationshipKey);
    const fieldDefinition = await resolveDottedFieldDef(
      definition,
      cleanedKey,
      _definitionLookup,
    );

    if (!fieldDefinition || fieldDefinition.isComputed) {
      continue;
    }

    if (Array.isArray(value)) {
      result[relationshipKey] = value.map((entry) =>
        normalizeRelationship(entry),
      );
      continue;
    }

    const processedValue = normalizeRelationship(value);

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

// Walk a (possibly-dotted) relationship path from the root definition,
// descending one immediate field at a time and looking up the linked
// card's definition between segments.
async function resolveDottedFieldDef(
  rootDefinition: Definition,
  dottedPath: string,
  definitionLookup: DefinitionLookup,
): Promise<FieldDefinition | undefined> {
  let segments = dottedPath.split('.');
  let current: Pick<Definition, 'fields' | 'fieldDefs'> = rootDefinition;
  for (let i = 0; i < segments.length; i++) {
    let fieldDef = getImmediateFieldDef(current, segments[i]);
    if (!fieldDef) {
      return undefined;
    }
    if (i === segments.length - 1) {
      return fieldDef;
    }
    if (fieldDef.isPrimitive) {
      return undefined;
    }
    let next = await resolveChildDef(fieldDef, definitionLookup);
    if (!next) {
      return undefined;
    }
    current = next;
  }
  return undefined;
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
