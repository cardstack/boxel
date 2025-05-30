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
    class='lucide lucide-git-compare'
    viewBox='0 0 24 24'
    ...attributes
  ><circle cx='18' cy='18' r='3' /><circle cx='6' cy='6' r='3' /><path
      d='M13 6h3a2 2 0 0 1 2 2v7M11 18H8a2 2 0 0 1-2-2V9'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'git-compare';
export default IconComponent;
