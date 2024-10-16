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
    class='lucide lucide-tickets-plane'
    viewBox='0 0 24 24'
    ...attributes
  ><path
      d='M10.5 17h1.227a2 2 0 0 0 1.345-.52L18 12M12 13.5l3.75.5M4.5 8l10.58-5.06a1 1 0 0 1 1.342.488L18.5 8M6 10V8M6 14v1M6 19v2'
    /><rect width='20' height='13' x='2' y='8' rx='2' /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'tickets-plane';
export default IconComponent;
