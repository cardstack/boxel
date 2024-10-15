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
    class='lucide lucide-file-lock-2'
    viewBox='0 0 24 24'
    ...attributes
  ><path d='M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v1' /><path
      d='M14 2v4a2 2 0 0 0 2 2h4'
    /><rect width='8' height='5' x='2' y='13' rx='1' /><path
      d='M8 13v-2a2 2 0 1 0-4 0v2'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'file-lock-2';
export default IconComponent;
