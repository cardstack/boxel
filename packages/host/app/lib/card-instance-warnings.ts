import { isEqual, isPlainObject } from 'lodash-es';

import {
  getField,
  isCardDocumentString,
  isFileDef,
  primitive,
  relationshipEntries,
  resolveRRIReference,
  rri,
  type CardFields,
  type Loader,
  type LooseSingleCardDocument,
  type Meta,
} from '@cardstack/runtime-common';
import { friendlyCardType } from '@cardstack/runtime-common/helpers/card-type-display-name';

import type {
  BaseDef,
  CardDef,
  Field,
  BaseDefConstructor,
} from '@cardstack/base/card-api';
import type * as EnumModule from '@cardstack/base/enum';
import type * as FieldSupportModule from '@cardstack/base/field-support';

export type LinkTargetStatus = 'found' | 'not-found';
export type CheckLinkTarget = (
  targetId: string,
  opts: { isFile: boolean },
) => Promise<LinkTargetStatus>;

// Keep the correctness result's prompt footprint bounded: a document with a
// systematically wrong shape would otherwise warn once per key.
const MAX_WARNINGS = 20;

// How many link targets are probed at once.
const LINK_PROBE_CONCURRENCY = 6;

type EnumHelpers = Pick<typeof EnumModule, 'enumValues' | 'enumAllowedValues'> &
  Pick<typeof FieldSupportModule, 'mergeConfigurations'>;

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
  rawSource: string; // the instance's .json source as stored in the realm
  instance: CardDef;
  loader: Loader;
  checkLinkTarget: CheckLinkTarget;
}): Promise<string[]> {
  let { cardId, rawSource, instance, loader, checkLinkTarget } = args;
  try {
    if (!isCardDocumentString(rawSource)) {
      return [];
    }
    let rawDoc = JSON.parse(rawSource) as LooseSingleCardDocument;
    let [{ enumValues, enumAllowedValues }, { mergeConfigurations }] =
      await Promise.all([
        loader.import<typeof EnumModule>('@cardstack/base/enum'),
        loader.import<typeof FieldSupportModule>(
          '@cardstack/base/field-support',
        ),
      ]);
    let sink = new WarningSink();
    validateAttributes({
      sink,
      enumModule: { enumValues, enumAllowedValues, mergeConfigurations },
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
      metaFields: rawDoc.data.meta?.fields,
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

  get remaining() {
    return Math.max(0, MAX_WARNINGS - this.warnings.length);
  }

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
    if (field.fieldType === 'linksTo') {
      sink.add(
        `"${path}" is a linksTo relationship of ${typeName} but was written under "attributes"; write it under "relationships" as "${path}": { "links": { "self": "<card url>" } }`,
      );
      continue;
    }
    if (field.fieldType === 'linksToMany') {
      sink.add(
        `"${path}" is a linksToMany relationship of ${typeName} but was written under "attributes"; write it under "relationships" as indexed keys, "${path}.0": { "links": { "self": "<card url>" } }, "${path}.1": …`,
      );
      continue;
    }

    let allowed =
      pathPrefix === ''
        ? instanceEnumAllowedValues(enumModule, instance, key)
        : staticEnumAllowedValues(enumModule, field);
    // Raw values are in serialized form; only options that are plain JSON
    // values compare like-for-like with them (a BigInteger option is a
    // bigint at runtime but a string on disk), so other options aren't judged.
    if (allowed && allowed.every(isJSONPrimitive)) {
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
  metaFields: CardFields | undefined;
  checkLinkTarget: CheckLinkTarget;
}) {
  let { sink, instance, cardId, relationships, metaFields, checkLinkTarget } =
    opts;
  // Links resolve against the instance's own id, exactly as deserialization
  // resolves them, so prefix-form (`@scope/realm/...`) and `$REALM/` links
  // land on the same target the card itself loads.
  let relativeTo = (instance.id as string | undefined) ?? cardId;
  let targets = new Map<string, { isFile: boolean }>();
  let linkChecks: { key: string; target: string }[] = [];
  for (let entry of relationshipEntries(relationships)) {
    let resolved = resolveRelationshipField(
      instance,
      entry.fieldName,
      metaFields,
    );
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
    let data = entry.relationship?.data;
    let dataId = (member: unknown) =>
      isPlainObject(member) ? (member as { id?: unknown }).id : undefined;
    if (field.fieldType === 'linksTo' && entry.isPlural) {
      sink.add(
        `"${entry.fieldName}" is a linksTo (single) relationship of ${typeName} but was written as an indexed list`,
      );
    } else if (
      field.fieldType === 'linksToMany' &&
      !entry.isPlural &&
      !Array.isArray(data) &&
      typeof (self ?? dataId(data)) === 'string'
    ) {
      sink.add(
        `"${entry.fieldName}" is a linksToMany relationship of ${typeName}; write it as indexed keys ("${entry.fieldName}.0", "${entry.fieldName}.1", …)`,
      );
    }
    // Deserialization follows `links.self`, falling back to `data.id`; a
    // linksToMany may also list its members as a `data` array.
    let references: { key: string; reference: unknown }[] = Array.isArray(data)
      ? data.map((member, index) => ({
          key: `${entry.key}.${index}`,
          reference: dataId(member),
        }))
      : [{ key: entry.key, reference: self ?? dataId(data) }];
    for (let { key, reference } of references) {
      if (typeof reference !== 'string' || reference.length === 0) {
        continue;
      }
      let target = resolveLinkTarget(reference, relativeTo);
      if (!target) {
        continue;
      }
      if (!targets.has(target)) {
        targets.set(target, { isFile: isFileDef(field.card) });
      }
      linkChecks.push({ key, target });
    }
  }

  let statuses = await probeLinkTargets(
    targets,
    checkLinkTarget,
    sink.remaining,
  );
  for (let { key, target } of linkChecks) {
    if (statuses.get(target) === 'not-found') {
      sink.add(
        `"${key}" links to ${target}, which does not exist; create it or correct the link`,
      );
    }
  }
}

// Probes distinct targets a few at a time, and stops scheduling new probes
// once enough missing targets are known to fill the remaining warnings.
// Unprobed targets are simply not judged.
async function probeLinkTargets(
  targets: Map<string, { isFile: boolean }>,
  checkLinkTarget: CheckLinkTarget,
  remainingWarnings: number,
): Promise<Map<string, LinkTargetStatus>> {
  let statuses = new Map<string, LinkTargetStatus>();
  let queue = [...targets];
  let missing = 0;
  let worker = async () => {
    while (queue.length > 0 && missing < remainingWarnings) {
      let [target, opts] = queue.shift()!;
      let status = await checkLinkTarget(target, opts);
      statuses.set(target, status);
      if (status === 'not-found') {
        missing++;
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(LINK_PROBE_CONCURRENCY, queue.length) },
      worker,
    ),
  );
  return statuses;
}

// Returns the absolute target a link names, or undefined when it can't be
// resolved to one (e.g. a `$REALM/` link against a URL-form base), in which
// case nothing is judged.
function resolveLinkTarget(
  reference: string,
  relativeTo: string,
): string | undefined {
  let target: string;
  try {
    target = resolveRRIReference(reference, rri(relativeTo));
  } catch {
    return undefined;
  }
  if (target.startsWith('@') || /^https?:\/\//.test(target)) {
    return target;
  }
  return undefined;
}

type ResolvedRelationshipField =
  | { kind: 'ok'; field: Field<BaseDefConstructor>; typeName: string }
  | { kind: 'missing'; segment: string; typeName: string }
  | { kind: 'ambiguous' };

// Resolves a relationship key's (possibly dotted) field name — e.g.
// "address.country" or "timers.0.assignee" — to the declared field it names.
// Numeric segments are containsMany indices and carry no field of their own.
// A path that passes through a polymorphic override (`meta.fields` naming an
// `adoptsFrom`) is judged against a narrower type we haven't loaded, so it is
// reported as ambiguous rather than checked against the declared type.
function resolveRelationshipField(
  instance: CardDef,
  dottedName: string,
  metaFields: CardFields | undefined,
): ResolvedRelationshipField {
  let segments = dottedName.split('.');
  let subject: BaseDef | typeof BaseDef = instance;
  let field: Field<BaseDefConstructor> | undefined;
  let fieldMeta: Partial<Meta> | Partial<Meta>[] | undefined;
  let ownerName = displayNameOf(subject);
  for (let segment of segments) {
    if (/^\d+$/.test(segment)) {
      fieldMeta = elementMeta(fieldMeta, Number(segment));
      continue;
    }
    if (field) {
      // descend into the previous segment's field type
      if (primitive in field.card) {
        return { kind: 'ambiguous' };
      }
      let metas = Array.isArray(fieldMeta) ? fieldMeta : [fieldMeta];
      if (metas.some((meta) => meta?.adoptsFrom)) {
        return { kind: 'ambiguous' };
      }
      metaFields = Array.isArray(fieldMeta) ? undefined : fieldMeta?.fields;
      subject = field.card;
    }
    ownerName = displayNameOf(subject);
    field = getField(subject, segment);
    if (!field) {
      return { kind: 'missing', segment, typeName: ownerName };
    }
    fieldMeta = metaFields?.[segment];
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
    let fromDef = (field.card as any).configuration;
    let fromUsage = field.configuration;
    if (typeof fromDef === 'function' || typeof fromUsage === 'function') {
      return undefined;
    }
    let options = enumModule.mergeConfigurations<{
      enum?: { options?: any[] };
    }>(fromDef, fromUsage as any)?.enum?.options;
    if (!Array.isArray(options) || options.length === 0) {
      return undefined;
    }
    let values = enumModule.enumAllowedValues(options);
    return values.length > 0 ? values : undefined;
  } catch {
    return undefined;
  }
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
  return friendlyCardType(klass);
}

function isJSONPrimitive(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}
