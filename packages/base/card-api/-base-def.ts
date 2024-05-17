import { type CardDocument, primitive } from '@cardstack/runtime-common';
import {
  type JSONAPISingleResourceDocument,
  isBaseInstance,
  relativeTo,
  serialize,
  formatQuery,
  queryableValue,
  deserialize,
} from './-constants';
import { Box } from './-box';
import { type IdentityContext } from './-identity-context';
import { _createFromSerialized, serializeCardResource } from './-serialization';
import { getQueryableValue } from './-query-support';
import {
  type Field,
  getFields,
  isNotLoadedValue,
  peekAtField,
  type SerializeOpts,
} from './-fields/storage';
import {
  type BoxComponent,
  getBoxComponent,
} from './-components/field-component';

// TODO: consider making this abstract
export class BaseDef {
  // this is here because CardBase has no public instance methods, so without it
  // typescript considers everything a valid card.
  [isBaseInstance] = true;
  // [relativeTo] actually becomes really important for Card/Field separation. FieldDefs
  // may contain interior fields that have relative links. FieldDef's though have no ID.
  // So we need a [relativeTo] property that derives from the root document ID in order to
  // resolve relative links at the FieldDef level.
  [relativeTo]: URL | undefined = undefined;
  declare ['constructor']: BaseDefConstructor;
  static baseDef: undefined;
  static data?: Record<string, any>; // TODO probably refactor this away all together
  static displayName = 'Base';

  static getDisplayName(instance: BaseDef) {
    return instance.constructor.displayName;
  }

  static [serialize](
    value: any,
    doc: JSONAPISingleResourceDocument,
    visited?: Set<string>,
    opts?: SerializeOpts,
  ): any {
    // note that primitive can only exist in field definition
    if (primitive in this) {
      // primitive cards can override this as need be
      return value;
    } else {
      return serializeCardResource(value, doc, opts, visited);
    }
  }

  static [formatQuery](value: any): any {
    if (primitive in this) {
      return value;
    }
    throw new Error(`Cannot format query value for composite card/field`);
  }

  static [queryableValue](value: any, stack: BaseDef[] = []): any {
    if (primitive in this) {
      return value;
    } else {
      if (value == null) {
        return null;
      }
      if (stack.includes(value)) {
        return { id: value.id };
      }
      return Object.fromEntries(
        Object.entries(
          getFields(value, { includeComputeds: true, usedFieldsOnly: true }),
        ).map(([fieldName, field]) => {
          let rawValue = peekAtField(value, fieldName);
          if (field?.fieldType === 'linksToMany') {
            return [
              fieldName,
              field.queryableValue(rawValue, [value, ...stack]),
            ];
          }
          if (isNotLoadedValue(rawValue)) {
            return [fieldName, { id: rawValue.reference }];
          }
          return [
            fieldName,
            getQueryableValue(field!, value[fieldName], [value, ...stack]),
          ];
        }),
      );
    }
  }

  static async [deserialize]<T extends BaseDefConstructor>(
    this: T,
    data: any,
    relativeTo: URL | undefined,
    doc?: CardDocument,
    identityContext?: IdentityContext,
  ): Promise<BaseInstanceType<T>> {
    if (primitive in this) {
      // primitive cards can override this as need be
      return data;
    }
    return _createFromSerialized(this, data, doc, relativeTo, identityContext);
  }

  static getComponent(card: BaseDef, field?: Field) {
    return getComponent(card, field);
  }

  static assignInitialFieldValue(
    instance: BaseDef,
    fieldName: string,
    value: any,
  ) {
    (instance as any)[fieldName] = value;
  }

  constructor(data?: Record<string, any>) {
    if (data !== undefined) {
      for (let [fieldName, value] of Object.entries(data)) {
        this.constructor.assignInitialFieldValue(this, fieldName, value);
      }
    }
  }
}

export type BaseDefConstructor = typeof BaseDef;

export type BaseInstanceType<T extends BaseDefConstructor> = T extends {
  [primitive]: infer P;
}
  ? P
  : InstanceType<T>;

export function getComponent(model: BaseDef, field?: Field): BoxComponent {
  let box = Box.create(model);
  let boxComponent = getBoxComponent(
    model.constructor as BaseDefConstructor,
    box,
    field,
  );
  return boxComponent;
}

export function cardThunk<CardT extends BaseDefConstructor>(
  cardOrThunk: CardT | (() => CardT),
): () => CardT {
  if (!cardOrThunk) {
    throw new Error(
      `cardOrThunk was ${cardOrThunk}. There might be a cyclic dependency in one of your fields.
      Use '() => CardName' format for the fields with the cycle in all related cards.
      e.g.: '@field friend = linksTo(() => Person)'`,
    );
  }
  return (
    'baseDef' in cardOrThunk ? () => cardOrThunk : cardOrThunk
  ) as () => CardT;
}
