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
    class='lucide lucide-cup-to-go'
    viewBox='0 0 24 24'
    ...attributes
  ><path
      d='M4 7h16M18.2 11l.8-4-.8-4c-.1-.5-.6-1-1.2-1H7c-.6 0-1.1.4-1.2 1C5.5 4.4 5 7 5 7l.8 4M18 18H6l-1-7h14ZM7.2 18l.6 3c.1.5.6 1 1.2 1h6c.6 0 1.1-.4 1.2-1l.6-3'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'cup-to-go';
export default IconComponent;