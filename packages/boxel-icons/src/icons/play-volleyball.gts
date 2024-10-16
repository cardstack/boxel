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
    class='icon icon-tabler icons-tabler-outline icon-tabler-play-volleyball'
    viewBox='0 0 24 24'
    ...attributes
  ><path stroke='none' d='M0 0h24v24H0z' /><path
      d='M13 4a1 1 0 1 0 2 0 1 1 0 0 0-2 0'
    /><path
      fill='currentColor'
      d='M20.5 10a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z'
    /><path d='m2 16 5 1 .5-2.5M11.5 21l2.5-5.5L8.5 12 12 8l3 4 4 2' /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'play-volleyball';
export default IconComponent;
