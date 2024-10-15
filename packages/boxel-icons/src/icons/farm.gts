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
    class='lucide lucide-farm'
    viewBox='0 0 24 24'
    ...attributes
  ><path
      d='M8 14V4.5a2.5 2.5 0 0 0-5 0V14M8 8l6-5 8 6M20 4v10M12 10h4v4h-4zM2 14h20M2 22l5-8M7 22l5-8M22 22H12l5-8M15 18h7'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'farm';
export default IconComponent;