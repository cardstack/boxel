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
    class='lucide lucide-message-square-dashed'
    viewBox='0 0 24 24'
    ...attributes
  ><path
      d='M10 17H7l-4 4v-7M14 17h1M14 3h1M19 3a2 2 0 0 1 2 2M21 14v1a2 2 0 0 1-2 2M21 9v1M3 9v1M5 3a2 2 0 0 0-2 2M9 3h1'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'message-square-dashed';
export default IconComponent;
