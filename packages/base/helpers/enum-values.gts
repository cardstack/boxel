import { getField } from '@cardstack/runtime-common';

export default function enumValues(model: object, fieldName: string): any[] {
  let field = getField(model as any, fieldName);
  let opts = (field?.card as any)?.enumOptions ?? [];
  return Array.isArray(opts)
    ? opts.map((o: any) =>
        o && typeof o === 'object' && 'value' in o ? o.value : o,
      )
    : [];
}
