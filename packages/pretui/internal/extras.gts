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
// BoxelInput pads only the physical left, so the inline style sets Select's
// inset on both inline sides, which also holds in right-to-left text. A
// control that pads around its own icon or button (Search's magnifier,
// Password's reveal) builds on TYPED_BLOCK_RULES.
export const TYPED_BLOCK_RULES =
  'font: inherit; letter-spacing: inherit; line-height: var(--boxel-form-control-line-height-sm); padding-block: 0.25rem;';
export const TYPED_INSET = 'calc(0.625rem - 1px)';
const TYPED_FONT_RULES = `${TYPED_BLOCK_RULES} padding-inline: ${TYPED_INSET};`;
export const TYPED_FONT = htmlSafe(TYPED_FONT_RULES);
