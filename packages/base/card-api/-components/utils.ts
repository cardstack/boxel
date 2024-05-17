import GlimmerComponent from '@glimmer/component';
import { ComponentLike } from '@glint/template';
import Modifier from 'ember-modifier';
import { Actions, primitive } from '@cardstack/runtime-common';
import { type BaseDefConstructor, type BaseDef } from '../-base-def';
import { type FieldType, type Format } from '../-constants';
import { type CardDef } from '../-card-def';
import { type BoxComponent } from './field-component';

type Setter = (value: any) => void;

export interface CardContext {
  actions?: Actions;
  cardComponentModifier?: typeof Modifier<{
    Args: {
      Named: {
        card: CardDef;
        format: Format | 'data';
        fieldType: FieldType | undefined;
        fieldName: string | undefined;
      };
    };
  }>;
}

export type BaseDefComponent = ComponentLike<{
  Blocks: {};
  Element: any;
  Args: {
    cardOrField: typeof BaseDef;
    fields: any;
    format: Format;
    model: any;
    set: Setter;
    fieldName: string | undefined;
    context?: CardContext;
    canEdit?: boolean;
  };
}>;

export type PartialBaseInstanceType<T extends BaseDefConstructor> = T extends {
  [primitive]: infer P;
}
  ? P | null
  : Partial<InstanceType<T>>;
export type FieldsTypeFor<T extends BaseDef> = {
  [Field in keyof T]: BoxComponent &
    (T[Field] extends ArrayLike<unknown>
      ? BoxComponent[]
      : T[Field] extends BaseDef
      ? FieldsTypeFor<T[Field]>
      : unknown);
};

export type SignatureFor<CardT extends BaseDefConstructor> = {
  Args: {
    model: PartialBaseInstanceType<CardT>;
    fields: FieldsTypeFor<InstanceType<CardT>>;
    set: Setter;
    fieldName: string | undefined;
    context?: CardContext;
    canEdit?: boolean;
  };
};

export class Component<
  CardT extends BaseDefConstructor,
> extends GlimmerComponent<SignatureFor<CardT>> {}
