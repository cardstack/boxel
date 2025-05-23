// This file is auto-generated by 'pnpm rebuild:all'
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import type { Signature } from '../types.ts';

const IconComponent: TemplateOnlyComponent<Signature> = <template>
  <svg
    xmlns='http://www.w3.org/2000/svg'
    width='24'
    height='24'
    fill='none'
    stroke='currentColor'
    stroke-linecap='round'
    stroke-linejoin='round'
    stroke-width='2'
    class='icon icon-tabler icons-tabler-outline icon-tabler-treadmill'
    viewBox='0 0 24 24'
    ...attributes
  ><path stroke='none' d='M0 0h24v24H0z' /><path
      d='M10 3a1 1 0 1 0 2 0 1 1 0 0 0-2 0M3 14l4 1 .5-.5M12 18v-3l-3-2.923L9.75 7'
    /><path
      d='M6 10V8l4-1 2.5 2.5 2.5.5M21 22a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1M18 21l1-11 2-1'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'treadmill';
export default IconComponent;
