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
