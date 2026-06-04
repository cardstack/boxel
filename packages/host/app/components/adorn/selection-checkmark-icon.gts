import type { TemplateOnlyComponent } from '@ember/component/template-only';

// SelectionCheckmarkIcon: the dark-circle-with-teal-checkmark artwork
// shared by the Adorn bulk-selection affordances — the teal "N Selected"
// menu trigger and its inert menu header. The companion AdornSelectChip
// renders the same circle/check but strokes with `currentColor` so the
// chip can be themed; here the check is always teal to read against the
// dark circle on a teal pill.
const SelectionCheckmarkIcon: TemplateOnlyComponent<{
  Element: SVGSVGElement;
}> = <template>
  <svg
    viewBox='0 0 14 14'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    aria-hidden='true'
    ...attributes
  >
    <circle cx='7' cy='7' r='7' fill='#0a2e1c' />
    <path
      d='M3.5 7.5L5.5 9.5L10.5 4.5'
      stroke='var(--boxel-teal)'
      stroke-width='1.5'
      stroke-linecap='round'
      stroke-linejoin='round'
    />
  </svg>
</template>;

export default SelectionCheckmarkIcon;
