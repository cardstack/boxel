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
    class='lucide lucide-baggage-claim'
    viewBox='0 0 24 24'
    ...attributes
  ><path d='M22 18H6a2 2 0 0 1-2-2V7a2 2 0 0 0-2-2' /><path
      d='M17 14V4a2 2 0 0 0-2-2h-1a2 2 0 0 0-2 2v10'
    /><rect width='13' height='8' x='8' y='6' rx='1' /><circle
      cx='18'
      cy='20'
      r='2'
    /><circle cx='9' cy='20' r='2' /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'baggage-claim';
export default IconComponent;