import { getField } from '@cardstack/runtime-common';
import { getEnumOptionsSync, enumAllowedValues } from '../enum-utils';

export default function enumValues(model: object, fieldName: string): any[] {
  let field = getField(model as any, fieldName);
  let cardClass = (field as any)?.card;
  if (cardClass?.isEnumField && typeof cardClass.getEnumOptionsSync === 'function') {
    // Use class API when available for consistency
    let opts = getEnumOptionsSync(cardClass);
    return enumAllowedValues(opts);
  }
  // Fallback for non-enum fields
  let opts = cardClass?.enumOptions ?? [];
  return enumAllowedValues(opts);
}
