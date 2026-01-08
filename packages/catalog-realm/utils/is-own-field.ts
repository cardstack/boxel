import type { BaseDef } from 'https://cardstack.com/base/card-api';

// When checking ColorFieldSpec:
// ✅ Returns: 'standard', 'wheel', 'sliderRgb', etc. (directly on ColorFieldSpec)
// ❌ Does NOT return: 'readMe', 'ref', 'title' (from Spec.prototype - inherited)
// ❌ Does NOT return: 'id' (from CardDef.prototype - inherited)
export function isOwnField(card: typeof BaseDef, fieldName: string): boolean {
  return Object.keys(Object.getOwnPropertyDescriptors(card.prototype)).includes(
    fieldName,
  );
}
