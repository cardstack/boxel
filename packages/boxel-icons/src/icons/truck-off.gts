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
    class='icon icon-tabler icons-tabler-outline icon-tabler-truck-off'
    viewBox='0 0 24 24'
    ...attributes
  ><path stroke='none' d='M0 0h24v24H0z' /><path
      d='M5 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0M15.585 15.586a2 2 0 0 0 2.826 2.831'
    /><path
      d='M5 17H3V6a1 1 0 0 1 1-1h1m3.96 0H13v4m0 4v4m-4 0h6m6 0v-6h-6m-2-5h5l3 5M3 3l18 18'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'truck-off';
export default IconComponent;