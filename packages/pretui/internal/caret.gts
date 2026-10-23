// Pretui — Select's caret, a 10px chevron, for the select-type controls that
// draw their own (Combobox and Lookup draw the same path on power-select's
// status icon). The caller sets its color and position, and flips it while
// the control is open.
import type { TemplateOnlyComponent } from '@ember/component/template-only';

interface CaretSignature {
  Element: SVGSVGElement;
}

export const Caret: TemplateOnlyComponent<CaretSignature> = <template>
  {{! aria-hidden after the splat: the caret is decorative whatever the caller passes }}
  <svg
    width='10'
    height='6'
    viewBox='0.41 0.41 10 6'
    ...attributes
    aria-hidden='true'
  ><path
      fill='none'
      stroke='currentColor'
      stroke-linecap='round'
      stroke-linejoin='round'
      stroke-width='2'
      d='m1.414 1.414 4 4 4-4'
    /></svg>
</template>;
