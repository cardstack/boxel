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
    class='lucide lucide-corner-left-up'
    viewBox='0 0 24 24'
    ...attributes
  ><path d='M14 9 9 4 4 9' /><path d='M20 20h-7a4 4 0 0 1-4-4V4' /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'corner-left-up';
export default IconComponent;