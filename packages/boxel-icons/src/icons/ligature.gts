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
    class='lucide lucide-ligature'
    viewBox='0 0 24 24'
    ...attributes
  ><path
      d='M8 20V8c0-2.2 1.8-4 4-4 1.5 0 2.8.8 3.5 2M6 12h4M14 12h2v8M6 20h4M14 20h4'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'ligature';
export default IconComponent;