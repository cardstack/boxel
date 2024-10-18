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
    class='icon icon-tabler icons-tabler-outline icon-tabler-truck-loading'
    viewBox='0 0 24 24'
    ...attributes
  ><path stroke='none' d='M0 0h24v24H0z' /><path
      d='M2 3h1a2 2 0 0 1 2 2v10a2 2 0 0 0 2 2h15'
    /><path
      d='M9 9a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3zM7 19a2 2 0 1 0 4 0 2 2 0 1 0-4 0M16 19a2 2 0 1 0 4 0 2 2 0 1 0-4 0'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'truck-loading';
export default IconComponent;