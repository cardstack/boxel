import Component from '@glimmer/component';

/** SVG paths copied from the matching glyphs in @cardstack/boxel-icons/src/icons.
 * Source: cardstack/boxel, packages/boxel-icons (Lucide, ISC license).
 * Kept inline so the standalone gallery needs no icon font or remote request.
 */
const paths = {
  menu: 'M4 5h16M4 12h16M4 19h16',
  'arrow-up-right': 'M7 7h10v10M7 17 17 7',
  x: 'M18 6 6 18M6 6l12 12',
  'arrow-left': 'm12 19-7-7 7-7M19 12H5',
  'arrow-right': 'M5 12h14M12 5l7 7-7 7',
};
export class BoxelGlyph extends Component<{
  Args: { name: keyof typeof paths };
  Element: SVGSVGElement;
}> {
  get path() {
    return paths[this.args.name];
  }
  <template>
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      aria-hidden="true"
      focusable="false"
      class="boxel-glyph"
      ...attributes
    >
      <path d={{this.path}} />
    </svg>
  </template>
}
