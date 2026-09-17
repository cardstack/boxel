import { getBxlComputeDefinition } from '@cardstack/bxl';
import { getFieldDefinitions } from './definitions.ts';
import type {
  BaseCardComputeName,
  NativeValueCodec,
  Definition,
  LatticeDataProjection,
} from './definitions.ts';
import { fieldSerializer, primitive, identifyCard } from './index.ts';
import { assertIsSerializerName } from './serializers/index.ts';
import type * as CardAPI from '@cardstack/base/card-api';
import type { BaseDef } from '@cardstack/base/card-api';
import { baseJsonQueryableValue } from './base-card-computations.ts';

// Import this entry at definition indexing, rather than loading BXL through
// the runtime-common barrel. Ordinary definition/schema consumers need only
// the serialized program data.
export function getLatticeFieldDefinitions(
  api: typeof CardAPI,
  cardDef: typeof BaseDef,
) {
  const baseFields = api.getFields(api.CardDef, { includeComputeds: true });
  const names: BaseCardComputeName[] = [
    'cardTitle',
    'cardDescription',
    'cardTheme',
    'cardThumbnailURL',
  ];
  const base = new Map<unknown, BaseCardComputeName>(
    names.map((name) => [baseFields[name].computeVia, name]),
  );
  const definitions = getFieldDefinitions(
    api,
    cardDef,
    (compute, valueType) => {
      const nativeCodec = getLatticeValueCodec(api, valueType);
      const bxl = getBxlComputeDefinition(compute);
      if (bxl) return { bxl, nativeCodec };
      const baseCompute =
        typeof compute === 'function' ? base.get(compute) : undefined;
      return { ...(baseCompute ? { baseCompute } : {}), nativeCodec };
    },
  );
  return {
    ...definitions,
    nativeCodec: getLatticeValueCodec(api, cardDef),
    nativeIndex: getLatticeIndexMetadata(api, cardDef),
    ...((cardDef === api.CardDef || cardDef.prototype instanceof api.CardDef) &&
    (cardDef as typeof CardAPI.CardDef).queryInputs
      ? {
          nativeQueryInputs: JSON.parse(
            JSON.stringify((cardDef as typeof CardAPI.CardDef).queryInputs),
          ) as Record<string, LatticeDataProjection>,
        }
      : {}),
    ...((cardDef === api.CardDef || cardDef.prototype instanceof api.CardDef) &&
    (cardDef as typeof CardAPI.CardDef).linkInputs
      ? {
          nativeLinkInputs: JSON.parse(
            JSON.stringify((cardDef as typeof CardAPI.CardDef).linkInputs),
          ) as Record<string, LatticeDataProjection>,
        }
      : {}),
  };
}

function getLatticeIndexMetadata(
  api: typeof CardAPI,
  cardDef: typeof BaseDef,
): Definition['nativeIndex'] {
  if (cardDef !== api.CardDef && !(cardDef.prototype instanceof api.CardDef))
    return undefined;
  const types: NonNullable<Definition['nativeIndex']>['types'] = [];
  const displayNames: string[] = [];
  let current: typeof BaseDef | null = cardDef;
  while (current) {
    const ref = identifyCard(current);
    if (!ref) return undefined;
    types.push(ref);
    if (current === api.BaseDef) {
      return {
        types,
        displayNames,
        cardType:
          cardDef.displayName === 'Card' ? cardDef.name : cardDef.displayName,
        ...((cardDef as typeof CardAPI.CardDef).materialized
          ? { materialized: true as const }
          : {}),
        ...(Number.isFinite(
          (cardDef as typeof CardAPI.CardDef).latticeSettleMs,
        ) && (cardDef as typeof CardAPI.CardDef).latticeSettleMs > 0
          ? { settleMs: (cardDef as typeof CardAPI.CardDef).latticeSettleMs }
          : {}),
      };
    }
    const name = current.displayName;
    displayNames.push(
      (name === 'Card' && current.name !== 'CardDef') ||
        (name === 'Field' && current.name !== 'FieldDef') ||
        (name === 'Base' && current.name !== 'BaseDef')
        ? current.name
        : name,
    );
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

function getLatticeValueCodec(
  api: typeof CardAPI,
  valueType: typeof BaseDef,
): NativeValueCodec | undefined {
  const card =
    valueType === api.CardDef || valueType.prototype instanceof api.CardDef;
  const file =
    valueType === api.FileDef || valueType.prototype instanceof api.FileDef;
  const family = card ? api.CardDef : file ? api.FileDef : api.BaseDef;
  const json =
    primitive in valueType &&
    valueType[api.queryableValue] === baseJsonQueryableValue &&
    !(fieldSerializer in valueType);
  if (
    valueType[api.serialize] !== api.BaseDef[api.serialize] ||
    valueType[api.deserialize] !== api.BaseDef[api.deserialize] ||
    (!json &&
      valueType[api.queryableValue] !== api.BaseDef[api.queryableValue]) ||
    valueType.assignInitialFieldValue !== family.assignInitialFieldValue
  ) {
    return undefined;
  }
  if (!(primitive in valueType)) {
    const resourceType = card
      ? ('card' as const)
      : file
        ? ('file-meta' as const)
        : undefined;
    return { kind: 'compound', resourceType };
  }
  // A getter may read ambient state. Only a literal inherited default belongs
  // in a definition artifact; undefined remains absent after JSON serialization.
  let holder: typeof BaseDef | null = valueType;
  let descriptor: PropertyDescriptor | undefined;
  while (holder && !descriptor) {
    descriptor = Object.getOwnPropertyDescriptor(holder, api.emptyValue);
    holder = Object.getPrototypeOf(holder);
  }
  if (descriptor?.get || descriptor?.set) return undefined;
  const empty: unknown = descriptor?.value;
  if (
    empty !== undefined &&
    empty !== null &&
    typeof empty !== 'string' &&
    typeof empty !== 'boolean' &&
    !(typeof empty === 'number' && Number.isFinite(empty))
  ) {
    return undefined;
  }
  if (json) return { kind: 'json', empty };
  let serializer;
  if (fieldSerializer in valueType) {
    serializer = valueType[fieldSerializer];
    assertIsSerializerName(serializer);
  }
  const scalar =
    valueType === api.StringField ||
    valueType.prototype instanceof api.StringField
      ? ('string' as const)
      : undefined;
  return { kind: 'primitive', scalar, serializer, empty };
}
