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
    class='lucide lucide-mailbox-flag'
    viewBox='0 0 24 24'
    ...attributes
  ><path
      d='M20 5.5A4 4 0 0 1 22 9v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a4 4 0 0 1 8 0v8a2 2 0 0 1-2 2M6 5h4'
    /><path d='M14 9V5h2v1h-2' /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'mailbox-flag';
export default IconComponent;
