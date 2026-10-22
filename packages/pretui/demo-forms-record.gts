// Pretui — demo-forms-record: the seed and option helpers the CompoundField and RecordDetail usage pages share.
import type { SelectOption } from './components/select';
import { seedFrom } from './examples';

export const SEED = seedFrom('pretui-forms-record');

/** The record's values are PLAIN — no FieldDef anywhere in this territory —
 *  so an editor block gets `unknown` and coerces at the boundary it owns. */
export function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

export function asOptions(values: string[]): SelectOption[] {
  return values.map((v) => ({ value: v, label: v }));
}

