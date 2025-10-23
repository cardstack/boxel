import { getField } from '@cardstack/runtime-common';
import { normalizeEnumOptions } from '../enum-utils';
import { resolveFieldConfiguration } from '../field-support';

type RichOption = { value: any; label?: string; icon?: any };

export default function enumOptions(model: object, fieldName: string): RichOption[] {
  let field = getField(model as any, fieldName);
  let cfg = resolveFieldConfiguration(field as any, model as any) as
    | { options?: any[] }
    | undefined;
  let opts = cfg?.options ?? [];
  return normalizeEnumOptions(opts);
}
