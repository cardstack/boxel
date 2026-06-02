import {
  codeRefWithAbsoluteIdentifier,
  getImmediateFieldDef,
  isResolvedCodeRef,
  type CodeRef,
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
import type { VirtualNetwork } from './virtual-network';
import { isMeta, type CardFields, type Meta } from './resource-types';
import type { DefinitionLookup } from './definition-lookup';
import { serialize as serializeCodeRef } from './serializers/code-ref';
import { maybeRelativeReference as makeRelativeReference } from './url';

export default async function serialize({
  doc,
  definition,
  relativeTo,
  definitionLookup,
  virtualNetwork,
}: {
  doc: LooseSingleCardDocument;
  definition: Definition;
  relativeTo: URL;
  definitionLookup: DefinitionLookup;
  virtualNetwork: VirtualNetwork;
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
      maybeRelativeReference: (reference: string) =>
        makeRelativeReference(
          new URL(reference, relativeTo),
          relativeTo,
          realmURL,
        ),
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
      metaFields: doc.data.meta?.fields,
      doc,
      relativeTo,
      codeRefOpts: metaCodeRefOpts,
      definitionLookup,
      virtualNetwork,
    });
  }

  if (doc.data.relationships) {
    const processedRelationships = await processRelationships({
      relationships: doc.data.relationships,
      definition,
      metaFields: doc.data.meta?.fields,
      relativeTo,
      realmURL,
      definitionLookup,
      virtualNetwork,
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
//
// `metaFields` carries the doc's `meta.fields` sub-tree at the current
// recursion level. For fields whose stored value is a polymorphic
// override (a `FieldDef` subclass that's not the field's declared
// type — common for `containsMany(FieldDef)` / `contains(FieldDef)`
// holders), the per-item meta entry's `adoptsFrom` names the actual
// type. We use that override in preference to the field's declared
// `fieldOrCard` when fetching the child definition; otherwise nested
// fields on the polymorphic subtype would be missing from the child
// definition lookup and the values would silently drop.
async function processAttributes({
  attributes,
  definition,
  metaFields,
  doc,
  relativeTo,
  codeRefOpts,
  definitionLookup,
  virtualNetwork,
}: {
  attributes: Record<string, any>;
  definition: Definition;
  metaFields: CardFields | undefined;
  doc: LooseSingleCardDocument;
  relativeTo: URL;
  codeRefOpts: {
    relativeTo: URL;
    trimExecutableExtension: true;
    allowRelative?: true;
    maybeRelativeReference?: (reference: string) => string;
  };
  definitionLookup: DefinitionLookup;
  virtualNetwork: VirtualNetwork;
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

    let metaForField = metaFields?.[fieldName];

    if (fieldDefinition.type === 'containsMany') {
      if (!Array.isArray(fieldValue)) {
        throw new Error(
          `Field '${fieldName}' is containsMany but value is not an array`,
        );
      }
      if (fieldDefinition.isPrimitive) {
        result[fieldName] = fieldValue;
      } else {
        let metaArray = Array.isArray(metaForField) ? metaForField : undefined;
        result[fieldName] = await Promise.all(
          fieldValue.map(async (item, index) => {
            let itemMeta = metaArray?.[index];
            let itemAdoptsFrom = isMeta(itemMeta)
              ? itemMeta.adoptsFrom
              : undefined;
            let itemNestedFields = isMeta(itemMeta)
              ? itemMeta.fields
              : undefined;
            let childDef = await resolveChildDef(
              fieldDefinition,
              itemAdoptsFrom,
              relativeTo,
              definitionLookup,
              virtualNetwork,
            );
            if (!childDef) {
              return {};
            }
            return await processAttributes({
              attributes: item,
              definition: childDef,
              metaFields: itemNestedFields,
              doc,
              relativeTo,
              codeRefOpts,
              definitionLookup,
              virtualNetwork,
            });
          }),
        );
      }
    } else if (fieldDefinition.isPrimitive) {
      result[fieldName] = fieldValue;
    } else {
      let polymorphicAdoptsFrom = isMeta(metaForField)
        ? metaForField.adoptsFrom
        : undefined;
      let nestedMetaFields = isMeta(metaForField)
        ? metaForField.fields
        : undefined;
      let childDef = await resolveChildDef(
        fieldDefinition,
        polymorphicAdoptsFrom,
        relativeTo,
        definitionLookup,
        virtualNetwork,
      );
      if (!childDef) {
        continue;
      }
      result[fieldName] = await processAttributes({
        attributes: fieldValue,
        definition: childDef,
        metaFields: nestedMetaFields,
        doc,
        relativeTo,
        codeRefOpts,
        definitionLookup,
        virtualNetwork,
      });
    }
  }

  return result;
}

// Pick the child Definition for a non-primitive field. If the doc
// supplies a polymorphic `adoptsFrom` (per-instance override), use
// that. Otherwise fall back to the field's declared `fieldOrCard`
// type. Either source's CodeRef may be relative; resolve to absolute
// before looking up.
async function resolveChildDef(
  fieldDefinition: FieldDefinition,
  polymorphicAdoptsFrom: CodeRef | undefined,
  relativeTo: URL,
  definitionLookup: DefinitionLookup,
  virtualNetwork: VirtualNetwork,
): Promise<Definition | undefined> {
  let codeRef = polymorphicAdoptsFrom
    ? codeRefWithAbsoluteIdentifier(
        polymorphicAdoptsFrom,
        relativeTo,
        undefined,
        virtualNetwork,
      )
    : fieldDefinition.fieldOrCard;
  if (!isResolvedCodeRef(codeRef)) {
    return undefined;
  }
  return await definitionLookup.lookupDefinition(codeRef);
}

async function processRelationships({
  relationships,
  definition,
  metaFields,
  relativeTo,
  realmURL,
  definitionLookup,
  virtualNetwork,
}: {
  relationships: NonNullable<CardResource['relationships']>;
  definition: Definition;
  metaFields: CardFields | undefined;
  relativeTo: URL;
  realmURL?: URL;
  definitionLookup: DefinitionLookup;
  virtualNetwork: VirtualNetwork;
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
            selfLink = makeRelativeReference(
              virtualNetwork.resolveURL(selfLink, relativeTo),
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
    // descending into linked card definitions on demand. Polymorphic
    // overrides live in `metaFields[fieldName].adoptsFrom`; when a
    // segment has one, the traversal uses it for the next lookup.
    const cleanedKey = parseRelationshipKey(relationshipKey);
    const fieldDefinition = await resolveDottedFieldDef(
      definition,
      cleanedKey,
      metaFields,
      relativeTo,
      definitionLookup,
      virtualNetwork,
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
// card's definition between segments. `metaFields` is the doc's
// `meta.fields` sub-tree at the root; we walk it in parallel with the
// path segments so polymorphic per-segment overrides drive the
// definition lookup.
async function resolveDottedFieldDef(
  rootDefinition: Definition,
  dottedPath: string,
  metaFields: CardFields | undefined,
  relativeTo: URL,
  definitionLookup: DefinitionLookup,
  virtualNetwork: VirtualNetwork,
): Promise<FieldDefinition | undefined> {
  let segments = dottedPath.split('.');
  let current: Pick<Definition, 'fields' | 'fieldDefs'> = rootDefinition;
  let currentMeta = metaFields;
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
    let metaForSeg = currentMeta?.[segments[i]];
    let polymorphicAdoptsFrom = isMeta(metaForSeg)
      ? metaForSeg.adoptsFrom
      : undefined;
    let next = await resolveChildDef(
      fieldDef,
      polymorphicAdoptsFrom,
      relativeTo,
      definitionLookup,
      virtualNetwork,
    );
    if (!next) {
      return undefined;
    }
    current = next;
    currentMeta = isMeta(metaForSeg) ? metaForSeg.fields : undefined;
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
    maybeRelativeReference?: (reference: string) => string;
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
    maybeRelativeReference?: (reference: string) => string;
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
