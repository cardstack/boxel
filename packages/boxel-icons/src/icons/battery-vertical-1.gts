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
    class='icon icon-tabler icons-tabler-outline icon-tabler-battery-vertical-1'
    viewBox='0 0 24 24'
    ...attributes
  ><path stroke='none' d='M0 0h24v24H0z' /><path
      d='M7 18V7a2 2 0 0 1 2-2h.5a.5.5 0 0 0 .5-.5.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5.5.5 0 0 0 .5.5h.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2M10 17h4'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'battery-vertical-1';
export default IconComponent;
