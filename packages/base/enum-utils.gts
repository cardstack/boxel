export type RichOption = { value: any; label?: string; icon?: any };

export function normalizeEnumOptions(rawOpts: any[]): RichOption[] {
  return (rawOpts ?? []).map((v) =>
    v && typeof v === 'object' && 'value' in v
      ? (v as RichOption)
      : ({ value: v, label: String(v) } as RichOption),
  );
}

export function enumAllowedValues(rawOpts: any[]): any[] {
  return normalizeEnumOptions(rawOpts).map((o) => o.value);
}

// For now, only supports static options; returns normalized options synchronously.
// Deprecated: static enumOptions have been removed; prefer resolving options
// via field configuration at runtime.
