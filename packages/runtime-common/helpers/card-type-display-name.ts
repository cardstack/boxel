import type {
  BaseDef,
  BaseDefConstructor,
  Field,
} from '@cardstack/base/card-api';

import { getField } from '../code-ref.ts';

// The card type's friendly display name as stamped into a row's `search_doc`
// `_cardType` key by the prerender meta route (routes/render/meta.ts): a class
// whose displayName is exactly 'Card' (i.e. `CardDef` itself) falls back to its
// class name. Kept here as the single source of truth so the index stamp and
// the client-side matcher shim (instance-filter-matcher.ts) agree byte-for-byte.
// NOTE: this is deliberately NOT `cardTypeDisplayName` below — that one calls
// `getDisplayName` and lacks the 'Card' → class-name fallback, so it would
// diverge from the stamped value.
export function friendlyCardType(klass: {
  displayName: string;
  name: string;
}): string {
  return klass.displayName === 'Card' ? klass.name : klass.displayName;
}

export function cardTypeDisplayName(cardOrField: BaseDef): string {
  // A not-yet-loaded or broken relationship link can surface an undefined
  // model to a card's own template (the linksTo component only renders the
  // broken-link template for specific membership states). Guard like the
  // sibling helpers below so an unguarded `{{cardTypeDisplayName @model}}`
  // renders empty instead of throwing and failing the whole card render.
  if (!cardOrField?.constructor) {
    return '';
  }
  return cardOrField.constructor.getDisplayName(cardOrField);
}

export function cardTypeIcon(cardOrField: BaseDef) {
  if (!cardOrField.constructor) {
    console.warn('cardOrField.constructor is undefined', cardOrField);
  }
  return cardOrField.constructor?.getIconComponent?.(cardOrField);
}

export function getFieldIcon(
  baseDef: Partial<BaseDef> | undefined,
  fieldName: string | undefined,
) {
  if (!baseDef?.constructor || !fieldName) {
    console.warn('baseDef, baseDef.constructor, or fieldName is undefined');
    return;
  }
  const field: Field<BaseDefConstructor> | undefined = getField(
    baseDef.constructor,
    fieldName,
  );
  let fieldInstance = field?.card;
  return fieldInstance?.icon;
}
