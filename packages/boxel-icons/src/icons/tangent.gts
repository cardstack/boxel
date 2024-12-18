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
    class='lucide lucide-tangent'
    viewBox='0 0 24 24'
    ...attributes
  ><circle cx='17' cy='4' r='2' /><path d='M15.59 5.41 5.41 15.59' /><circle
      cx='4'
      cy='17'
      r='2'
    /><path d='M12 22s-4-9-1.5-11.5S22 12 22 12' /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'tangent';
export default IconComponent;
