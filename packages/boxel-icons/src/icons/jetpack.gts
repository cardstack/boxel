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
    class='icon icon-tabler icons-tabler-outline icon-tabler-jetpack'
    viewBox='0 0 24 24'
    ...attributes
  ><path stroke='none' d='M0 0h24v24H0z' /><path
      d='M10 6a3 3 0 1 0-6 0v7h6V6zM14 13h6V6a3 3 0 0 0-6 0v7zM5 16c0 2.333.667 4 2 5 1.333-1 2-2.667 2-5M15 16c0 2.333.667 4 2 5 1.333-1 2-2.667 2-5M10 8h4M10 11h4'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'jetpack';
export default IconComponent;