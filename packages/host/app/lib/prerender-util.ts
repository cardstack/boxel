import {
  internalKeyFor,
  identifyCard,
  primitive,
  fieldSerializer,
  moduleFrom,
  type LooseCardResource,
  type Loader,
  type ResolvedCodeRef,
  type CardDefMeta,
} from '@cardstack/runtime-common';

import { BaseDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

export function directModuleDeps(
  resource: LooseCardResource,
  instanceURL: URL,
): string[] {
  let result = [
    // we always depend on our own adoptsFrom
    new URL(moduleFrom(resource.meta.adoptsFrom), instanceURL).href,
  ];

  // we might also depend on any polymorphic types in meta.fields
  if (resource.meta.fields) {
    for (let fieldMeta of Object.values(resource.meta.fields)) {
      if (Array.isArray(fieldMeta)) {
        for (let meta of fieldMeta) {
          if (meta.adoptsFrom) {
            result.push(new URL(moduleFrom(meta.adoptsFrom), instanceURL).href);
          }
        }
      } else {
        if (fieldMeta.adoptsFrom) {
          result.push(
            new URL(moduleFrom(fieldMeta.adoptsFrom), instanceURL).href,
          );
        }
      }
    }
  }
  return result;
}

export async function recursiveModuleDeps(
  directDeps: string[],
  loader: Loader,
) {
  return new Set([
    ...directDeps,
    ...(
      await Promise.all(
        directDeps.map((moduleDep) => loader.getConsumedModules(moduleDep)),
      )
    ).flat(),
  ]);
}

export function getFieldMeta(
  api: typeof CardAPI,
  cardDef: typeof BaseDef,
  results: CardDefMeta['fields'] = {},
  prefix = '',
  visited: string[] = [],
) {
  let cardKey = internalKeyFor(
    identifyCard(cardDef) as ResolvedCodeRef,
    undefined,
  );
  if (visited.includes(cardKey)) {
    return results;
  }
  let fields = api.getFields(cardDef, { includeComputeds: true });
  for (let [fieldName, field] of Object.entries(fields)) {
    let fullFieldName = `${prefix ? prefix + '.' : ''}${fieldName}`;
    let isPrimitive = primitive in field.card;
    results[fullFieldName] = {
      type: field.fieldType,
      isPrimitive,
      isComputed: Boolean(field.computeVia),
      fieldOrCard: identifyCard(field.card) as ResolvedCodeRef,
      serializerName:
        fieldSerializer in field.card
          ? (field.card[fieldSerializer] as string)
          : undefined,
    };
    if (!isPrimitive) {
      getFieldMeta(api, field.card, results, fullFieldName, [
        ...visited,
        cardKey,
      ]);
    }
  }
  return results;
}
