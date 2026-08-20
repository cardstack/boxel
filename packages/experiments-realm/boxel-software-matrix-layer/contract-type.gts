import StringField from 'https://cardstack.com/base/string';
import enumField from 'https://cardstack.com/base/enum';

/**
 * The seven contract types.
 *
 * WHY THIS IS ITS OWN MODULE. It started life inside `contract.gts`, which put
 * every consumer of the type vocabulary — `signatory.gts` in particular — into
 * an import cycle with the Contract card and everything Contract links to.
 * A `containsMany(ContractTypeField)` is not thunkable, so on the wrong load
 * order it resolved to `undefined` and the realm threw
 * "cardOrThunk was undefined. There might be a cyclic dependency."
 *
 * A vocabulary has no dependencies of its own, so it belongs in a leaf module.
 * Anything can import it without dragging in a card.
 */

export const CONTRACT_TYPES = [
  'vendor',
  'customer',
  'employment',
  'contractor',
  'nda',
  'partnership',
  'lease',
];

export const CONTRACT_TYPE_LABELS: Record<string, string> = {
  vendor: 'Vendor / Supplier',
  customer: 'Customer / Sales',
  employment: 'Employment',
  contractor: 'Contractor',
  nda: 'NDA',
  partnership: 'Partnership',
  lease: 'Lease',
};

export const ContractTypeField = enumField(StringField, {
  options: CONTRACT_TYPES.map((value) => ({
    value,
    label: CONTRACT_TYPE_LABELS[value],
  })),
  displayName: 'Contract Type',
});

export function contractTypeLabel(value?: string | null): string {
  return CONTRACT_TYPE_LABELS[value ?? ''] ?? value ?? '—';
}
