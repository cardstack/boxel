// Pretui — fixtures shared by the forms-picker usage pages.
import { PLACES, SUPPLIERS, pick, seedFrom } from '../examples-kit';
import type { PickerRecord } from './forms-picker';

export const ACCOUNTS: PickerRecord[] = SUPPLIERS.slice(0, 10).map((name, i) => ({
  id: `001R0000${String(i + 11).padStart(2, '0')}`,
  label: name,
  meta: `Account • ${pick(seedFrom(name), i, PLACES)}`,
  icon: 'globe',
}));
