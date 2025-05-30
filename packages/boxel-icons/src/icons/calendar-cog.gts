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
    class='lucide lucide-calendar-cog'
    viewBox='0 0 24 24'
    ...attributes
  ><path
      d='m15.2 16.9-.9-.4M15.2 19.1l-.9.4M16 2v4M16.9 15.2l-.4-.9M16.9 20.8l-.4.9M19.5 14.3l-.4.9M19.5 21.7l-.4-.9M21 10.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6M21.7 16.5l-.9.4M21.7 19.5l-.9-.4M3 10h18M8 2v4'
    /><circle cx='18' cy='18' r='3' /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'calendar-cog';
export default IconComponent;
