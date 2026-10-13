import { isEqual } from 'lodash-es';

import {
  getField,
  primitive,
  relationshipEntries,
  type CardFields,
  type Loader,
  type LooseSingleCardDocument,
  type Meta,
} from '@cardstack/runtime-common';

import type {
  BaseDef,
  CardDef,
  Field,
  BaseDefConstructor,
} from '@cardstack/base/card-api';
import type * as EnumModule from '@cardstack/base/enum';

export type LinkTargetStatus = 'found' | 'not-found' | 'error';

// Keep the correctness result's prompt footprint bounded: a document with a
// systematically wrong shape would otherwise warn once per key.
const MAX_WARNINGS = 20;

type EnumHelpers = Pick<typeof EnumModule, 'enumValues' | 'enumAllowedValues'>;

// Compares a raw card-instance document against the adopted type's declared
// fields and reports, as warnings, the mistakes that indexing accepts but
// silently drops or mis-renders: attributes/relationships the type doesn't
// declare, writes to computed fields, values written in the wrong bucket,
// enum values outside the field's options, and links whose target doesn't
// resolve. The raw document is required because deserialization discards
// undeclared keys, so the loaded instance no longer shows them.
//
// None of these make the instance an error — it still indexes and renders —
// so this never contributes to `errors`. It also fails open: any unexpected
// shape or thrown helper yields no warning rather than a false positive.
export async function collectCardInstanceWarnings(args: {
  cardId: string; // instance id, without the .json extension
  rawDoc: LooseSingleCardDocument;
  instance: CardDef;
  loader: Loader;
  checkLinkTarget: (targetId: string) => Promise<LinkTargetStatus>;
}): Promise<string[]> {
  let { cardId, rawDoc, instance, loader, checkLinkTarget } = args;
  try {
    let enumModule = await loader.import<typeof EnumModule>(
      '@cardstack/base/enum',
    );
    let sink = new WarningSink();
    validateAttributes({
      sink,
      enumModule,
      instance,
      subject: instance,
      pathPrefix: '',
      attributes: rawDoc.data.attributes ?? {},
      metaFields: rawDoc.data.meta?.fields,
    });
    await validateRelationships({
      sink,
      instance,
      cardId,
      relationships: rawDoc.data.relationships,
      checkLinkTarget,
    });
    return sink.list();
  } catch (error) {
    console.warn(`card-instance-warnings: unable to validate ${cardId}`, error);
    return [];
  }
}

class WarningSink {
  private warnings: string[] = [];
  private overflow = 0;

  add(warning: string) {
    if (this.warnings.length < MAX_WARNINGS) {
      this.warnings.push(warning);
    } else {
      this.overflow++;
    }
  }

  list(): string[] {
    if (this.overflow === 0) {
      return this.warnings;
    }
    return [
      ...this.warnings,
      `…and ${this.overflow} more warning${this.overflow === 1 ? '' : 's'}`,
    ];
  }
}

function validateAttributes(opts: {
  sink: WarningSink;
  enumModule: EnumHelpers;
  instance: CardDef; // top-level instance, for instance-resolved enum options
  subject: BaseDef | typeof BaseDef; // the instance at the top, the FieldDef class below
  pathPrefix: string;
  attributes: Record<string, any>;
  metaFields: CardFields | undefined;
}) {
  let { sink, enumModule, instance, subject, pathPrefix, attributes } = opts;
  let typeName = displayNameOf(subject);
  for (let [key, value] of Object.entries(attributes)) {
    let path = pathPrefix ? `${pathPrefix}.${key}` : key;
    let field = getField(subject, key);
    if (!field) {
      sink.add(
        `"${path}" is not a field of ${typeName}; this attribute will be dropped when the card loads`,
      );
      continue;
    }
    if (field.computeVia) {
      sink.add(
        `"${path}" is a computed field of ${typeName}; its value is derived, so the written value will be ignored`,
      );
      continue;
    }
    if (field.fieldType === 'linksTo' || field.fieldType === 'linksToMany') {
      sink.add(
        `"${path}" is a ${field.fieldType} relationship of ${typeName} but was written under "attributes"; write it under "relationships" with { "links": { "self": "<card url>" } }`,
      );
      continue;
    }

    let allowed =
      pathPrefix === ''
        ? instanceEnumAllowedValues(enumModule, instance, key)
        : staticEnumAllowedValues(enumModule, field);
    if (allowed) {
      let candidates =
        field.fieldType === 'containsMany'
          ? Array.isArray(value)
            ? value
            : []
          : [value];
      for (let candidate of candidates) {
        if (candidate == null) {
          continue;
        }
        if (!allowed.some((option) => isEqual(option, candidate))) {
          sink.add(
            `"${path}" value ${JSON.stringify(candidate)} is not one of the allowed options; allowed options are: ${allowed
              .map((option) => JSON.stringify(option))
              .join(', ')}`,
          );
        }
      }
    }

    if (!(primitive in field.card)) {
      let fieldMeta = opts.metaFields?.[key];
      if (field.fieldType === 'contains' && isPlainObject(value)) {
        let meta = Array.isArray(fieldMeta) ? undefined : fieldMeta;
        if (meta?.adoptsFrom) {
          // polymorphic override: the written shape belongs to a narrower
          // type we haven't loaded, so judge nothing beneath it
          continue;
        }
        validateAttributes({
          ...opts,
          subject: field.card,
          pathPrefix: path,
          attributes: value,
          metaFields: meta?.fields,
        });
      } else if (field.fieldType === 'containsMany' && Array.isArray(value)) {
        value.forEach((element, index) => {
          if (!isPlainObject(element)) {
            return;
          }
          let meta = elementMeta(fieldMeta, index);
          if (meta?.adoptsFrom) {
            return;
          }
          validateAttributes({
            ...opts,
            subject: field.card,
            pathPrefix: `${path}.${index}`,
            attributes: element,
            metaFields: meta?.fields,
          });
        });
      }
    }
  }
}

async function validateRelationships(opts: {
  sink: WarningSink;
  instance: CardDef;
  cardId: string;
  relationships: LooseSingleCardDocument['data']['relationships'];
  checkLinkTarget: (targetId: string) => Promise<LinkTargetStatus>;
}) {
  let { sink, instance, cardId, relationships, checkLinkTarget } = opts;
  let targetStatuses = new Map<string, Promise<LinkTargetStatus>>();
  for (let entry of relationshipEntries(relationships)) {
    let resolved = resolveRelationshipField(instance, entry.fieldName);
    if (resolved.kind === 'ambiguous') {
      continue;
    }
    if (resolved.kind === 'missing') {
      sink.add(
        `"relationships.${entry.key}": "${resolved.segment}" is not a field of ${resolved.typeName}; this relationship will be dropped when the card loads`,
      );
      continue;
    }
    let { field, typeName } = resolved;
    if (field.computeVia) {
      sink.add(
        `"${entry.fieldName}" is a computed field of ${typeName}; its value is derived, so the written value will be ignored`,
      );
      continue;
    }
    if (field.queryDefinition) {
      // query-backed relationships legitimately persist seed data in the
      // document, in shapes this walker doesn't model
      continue;
    }
    if (field.fieldType === 'contains' || field.fieldType === 'containsMany') {
      sink.add(
        `"${entry.fieldName}" is a ${field.fieldType} attribute of ${typeName} but was written under "relationships"; write its value under "attributes"`,
      );
      continue;
    }
    let self = entry.relationship?.links?.self;
    if (field.fieldType === 'linksTo' && entry.isPlural) {
      sink.add(
        `"${entry.fieldName}" is a linksTo (single) relationship of ${typeName} but was written as an indexed list`,
      );
    } else if (
      field.fieldType === 'linksToMany' &&
      !entry.isPlural &&
      typeof self === 'string'
    ) {
      sink.add(
        `"${entry.fieldName}" is a linksToMany relationship of ${typeName}; write it as indexed keys ("${entry.fieldName}.0", "${entry.fieldName}.1", …)`,
      );
    }
    if (typeof self === 'string' && self.length > 0) {
      let target: string;
      try {
        target = new URL(self, cardId).href;
      } catch {
        continue;
      }
      let status = targetStatuses.get(target);
      if (!status) {
        status = checkLinkTarget(target);
        targetStatuses.set(target, status);
      }
      let result = await status;
      if (result === 'not-found') {
        sink.add(
          `"${entry.key}" links to ${target}, which does not exist; create that card or correct the link`,
        );
      } else if (result === 'error') {
        sink.add(
          `"${entry.key}" links to ${target}, which is currently in an error state`,
        );
      }
    }
  }
}

type ResolvedRelationshipField =
  | { kind: 'ok'; field: Field<BaseDefConstructor>; typeName: string }
  | { kind: 'missing'; segment: string; typeName: string }
  | { kind: 'ambiguous' };

// Resolves a relationship key's (possibly dotted) field name — e.g.
// "address.country" or "timers.0.assignee" — to the declared field it names.
// Numeric segments are containsMany indices and carry no field of their own.
function resolveRelationshipField(
  instance: CardDef,
  dottedName: string,
): ResolvedRelationshipField {
  let segments = dottedName.split('.');
  let subject: BaseDef | typeof BaseDef = instance;
  let field: Field<BaseDefConstructor> | undefined;
  let ownerName = displayNameOf(subject);
  for (let segment of segments) {
    if (/^\d+$/.test(segment)) {
      continue;
    }
    if (field) {
      // descend into the previous segment's field type
      if (primitive in field.card) {
        return { kind: 'ambiguous' };
      }
      subject = field.card;
    }
    ownerName = displayNameOf(subject);
    field = getField(subject, segment);
    if (!field) {
      return { kind: 'missing', segment, typeName: ownerName };
    }
  }
  if (!field) {
    return { kind: 'ambiguous' };
  }
  return { kind: 'ok', field, typeName: ownerName };
}

function instanceEnumAllowedValues(
  enumModule: EnumHelpers,
  instance: CardDef,
  fieldName: string,
): any[] | undefined {
  try {
    let values = enumModule.enumValues(instance, fieldName);
    return values.length > 0 ? values : undefined;
  } catch {
    return undefined;
  }
}

// Below the top level there is no field instance to resolve function-form
// configuration against, so only statically declared options are checked.
function staticEnumAllowedValues(
  enumModule: EnumHelpers,
  field: Field<BaseDefConstructor>,
): any[] | undefined {
  try {
    let fromDef = asPlainConfiguration((field.card as any).configuration);
    let fromUsage = asPlainConfiguration(field.configuration);
    let options = fromUsage?.enum?.options ?? fromDef?.enum?.options;
    if (!Array.isArray(options) || options.length === 0) {
      return undefined;
    }
    let values = enumModule.enumAllowedValues(options);
    return values.length > 0 ? values : undefined;
  } catch {
    return undefined;
  }
}

function asPlainConfiguration(
  configuration: unknown,
): { enum?: { options?: any[] } } | undefined {
  return isPlainObject(configuration)
    ? (configuration as { enum?: { options?: any[] } })
    : undefined;
}

function elementMeta(
  fieldMeta: Partial<Meta> | Partial<Meta>[] | undefined,
  index: number,
): Partial<Meta> | undefined {
  if (Array.isArray(fieldMeta)) {
    return fieldMeta[index];
  }
  return fieldMeta;
}

function displayNameOf(subject: BaseDef | typeof BaseDef): string {
  let klass =
    typeof subject === 'function'
      ? (subject as typeof BaseDef)
      : (subject.constructor as typeof BaseDef);
  return (klass as any).displayName ?? klass.name;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
