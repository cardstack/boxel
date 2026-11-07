// Pretui — controls territory, extras wave: the remaining boxel-ui INPUT
// controls plus the typed-input split (NumberInput, PasswordInput,
// SearchInput, UrlInput). Foundation rules in force: wrap boxel-ui at
// runtime where its machinery earns its keep (EmailInput / PhoneInput
// validation engines, InputGroup's contextual accessory surface, the
// BoxelInput core under every typed input), build fresh where boxel-ui has
// nothing standalone (Stepper) or its wart list forbids reuse (CopyButton
// rides ember-velcro Tooltip) — all on Input's field style.
// Wave-0 adaptations (documented inline): CopyButton resets its copied
// state on pointerleave/blur instead of setTimeout (realm forbids timers);
// the boxel-ui wrappers re-skin through the semantic-token + --boxel-*
// custom-property channel on a wrapper div (their internal debounce is
// boxel-ui's own runtime, not authored here).
//
// Pretui — Input's field style for the typed inputs built on BoxelInput
// (Email, Number, Password, Phone, Search, Url).
import { htmlSafe } from '@ember/template';
import type { KeptProperty } from './keep-style';

// ── Typed inputs ─────────────────────────────────────────────────────────
// Each rides BoxelInput's machinery for its native type and adds the one
// behavior that type deserves (spinners+clamping, reveal, clear,
// validation). Kit contract throughout: value?/onInput? in the EmailInput
// arg style, controlId for label wiring, data-test-pretui-* on the
// wrapper, data-* state reflection. The shared inline style wins the two
// spots the token channel cannot reach (UA font; element-local vars in
// boxel's sheet).
// `--boxel-input-height` is a MIN-height, and the inherited `normal`
// line-height overshoots it. Borders, padding-block and
// --boxel-form-control-line-height-sm add up to --boxel-form-control-height-sm
// (1.75rem); the line-height token assumes this padding-block, so change them
// together.
// The inline inset is left to the wrapper's --boxel-sp-sm and
// --boxel-input-padding-inline-end, so BoxelInput can reserve the validation
// icon's column. A control that pads around its own icon or button (Search's
// magnifier, Password's reveal) adds that side's padding to TYPED_PROPERTIES.
//
// The same rules come two ways. TYPED_PROPERTIES is the list `keepStyle`
// writes through the CSSOM, for a control that renders no `style` attribute,
// which is what a control the secure origin ships must do (its policy refuses
// one). TYPED_BLOCK_RULES and TYPED_FONT are those declarations as a `style`
// string, for the typed inputs that still bind one.

export const TYPED_PROPERTIES: KeptProperty[] = [
  { property: 'font', value: 'inherit', strength: 'arg' },
  { property: 'letter-spacing', value: 'inherit', strength: 'arg' },
  {
    property: 'line-height',
    value: 'var(--boxel-form-control-line-height-sm)',
    strength: 'arg',
  },
  { property: 'padding-block', value: '0.25rem', strength: 'arg' },
];

// TYPED_PROPERTIES with more of a control's own properties after them.
export function typedProperties(
  more: Record<string, string> = {},
): KeptProperty[] {
  return [
    ...TYPED_PROPERTIES,
    ...Object.entries(more).map(
      ([property, value]): KeptProperty => ({
        property,
        value,
        strength: 'arg',
      }),
    ),
  ];
}

export const TYPED_BLOCK_RULES = TYPED_PROPERTIES.map(
  ({ property, value }) => `${property}: ${value};`,
).join(' ');
export const TYPED_FONT = htmlSafe(TYPED_BLOCK_RULES);
