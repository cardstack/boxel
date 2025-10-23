import { getField } from '@cardstack/runtime-common';
import { getEnumOptionsSync, normalizeEnumOptions } from '../enum-utils';

type RichOption = { value: any; label?: string; icon?: any };

export default function enumOptions(model: object, fieldName: string): RichOption[] {
  let field = getField(model as any, fieldName);
  let cardClass = (field as any)?.card;
  if (cardClass?.isEnumField && typeof cardClass.getEnumOptionsSync === 'function') {
    return getEnumOptionsSync(cardClass);
  }
  let opts = cardClass?.enumOptions ?? [];
  return normalizeEnumOptions(opts);
}
