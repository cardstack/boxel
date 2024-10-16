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
    class='lucide lucide-bell-concierge-off'
    viewBox='0 0 24 24'
    ...attributes
  ><path
      d='m2 2 20 20M12 4v2.3M10 4h4M19.8 14.1a8 8 0 0 0-5.9-5.9M8.7 8.7C5.9 10 4 12.8 4 16'
    /><path d='M16 16H4a2 2 0 0 0-2 2v2h18' /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'bell-concierge-off';
export default IconComponent;
