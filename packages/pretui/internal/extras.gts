// Pretui — controls territory, extras wave: the remaining boxel-ui INPUT
// controls plus the typed-input split (NumberInput, PasswordInput,
// SearchInput, UrlInput). Foundation rules in force: wrap boxel-ui at
// runtime where its machinery earns its keep (EmailInput / PhoneInput
// validation engines, InputGroup's contextual accessory surface, the
// BoxelInput core under every typed input), build fresh where boxel-ui has
// nothing standalone (Stepper) or its wart list forbids reuse (CopyButton
// rides ember-velcro Tooltip) — all dressed in Pretui tokens only (h28,
// --field/--input, --radius, --text-ui-md 12.5px).
// Wave-0 adaptations (documented inline): CopyButton resets its copied
// state on pointerleave/blur instead of setTimeout (realm forbids timers);
// the boxel-ui wrappers re-skin through the semantic-token + --boxel-*
// custom-property channel on a wrapper div (their internal debounce is
// boxel-ui's own runtime, not authored here).
//
// (the extras group)

// Pretui — style shared by the typed inputs (Number, Password, Url).
import { htmlSafe } from '@ember/template';

// ── Typed inputs ─────────────────────────────────────────────────────────
// Each rides BoxelInput's machinery for its native type and adds the one
// behavior that type deserves (spinners+clamping, reveal, clear,
// validation). Kit contract throughout: value?/onInput? in the EmailInput
// arg style, controlId for label wiring, data-test-pretui-* on the
// wrapper, data-* state reflection. The shared inline style wins the two
// spots the token channel cannot reach (UA font; element-local vars in
// boxel's sheet).
// Same 28px pin as controls.gts's INPUT_FONT — the seven typed wrappers
// carry the identical --boxel-sp-xs channel and were all 29.31px.
export const TYPED_FONT = htmlSafe(
  'font: inherit; letter-spacing: inherit; line-height: 18px; padding-block: 4px;',
);
