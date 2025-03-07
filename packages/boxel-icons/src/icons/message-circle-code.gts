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
    class='lucide lucide-message-circle-code'
    viewBox='0 0 24 24'
    ...attributes
  ><path d='M10 9.5 8 12l2 2.5M14 9.5l2 2.5-2 2.5' /><path
      d='M7.9 20A9 9 0 1 0 4 16.1L2 22z'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'message-circle-code';
export default IconComponent;
