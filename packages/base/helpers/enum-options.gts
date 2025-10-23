import { getField } from '@cardstack/runtime-common';

type RichOption = { value: any; label?: string; icon?: any };

export default function enumOptions(model: object, fieldName: string): RichOption[] {
  let field = getField(model as any, fieldName);
  let opts = (field?.card as any)?.enumOptions ?? [];
  return Array.isArray(opts)
    ? opts.map((o: any) =>
        o && typeof o === 'object' && 'value' in o
          ? o
          : ({ value: o, label: String(o) } as RichOption),
      )
    : [];
}

