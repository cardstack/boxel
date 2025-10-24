import { getField } from '@cardstack/runtime-common';
import { enumAllowedValues } from '../enum-utils';
import { resolveFieldConfiguration } from '../field-support';

export default function enumValues(model: object, fieldName: string): any[] {
  let field = getField(model as any, fieldName);
  let cardClass = (field as any)?.card;
  if (cardClass?.isEnumField) {
    let cfg = resolveFieldConfiguration(field as any, model as any) as
      | { options?: any[] }
      | undefined;
    let opts = (cfg?.options ?? cardClass?.enumOptions) ?? [];
    return enumAllowedValues(opts);
  }
  // Fallback for non-enum fields
  let opts = cardClass?.enumOptions ?? [];
  return enumAllowedValues(opts);
}
