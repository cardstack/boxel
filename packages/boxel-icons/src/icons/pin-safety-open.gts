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
    class='lucide lucide-pin-safety-open'
    viewBox='0 0 24 24'
    ...attributes
  ><path
      d='M20.8 3.2c-1.6-1.6-4.1-1.6-5.7 0L12.3 6S15 9 18 6c-3 3 0 5.7 0 5.7l2.8-2.8c1.6-1.6 1.6-4.2 0-5.7M7.1 21.1l10.3-10.2'
    /><circle cx='5' cy='19' r='3' /><path d='M9 2s-4.1 9.5-6.755 15.8' /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'pin-safety-open';
export default IconComponent;
