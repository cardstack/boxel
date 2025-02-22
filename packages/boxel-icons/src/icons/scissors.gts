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
    class='lucide lucide-scissors'
    viewBox='0 0 24 24'
    ...attributes
  ><circle cx='6' cy='6' r='3' /><path
      d='M8.12 8.12 12 12M20 4 8.12 15.88'
    /><circle cx='6' cy='18' r='3' /><path d='M14.8 14.8 20 20' /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'scissors';
export default IconComponent;
