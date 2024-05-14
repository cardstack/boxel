import { type Actions, type Format } from '@cardstack/runtime-common';
import { type CardDef } from 'card-def';
import { type FieldType } from 'field-types/utils';
import type Modifier from 'ember-modifier';

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
