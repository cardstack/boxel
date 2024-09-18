// This file is auto-generated by 'pnpm rebuild:icons'
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import type { Signature } from './types.ts';

const IconComponent: TemplateOnlyComponent<Signature> = <template>
  <svg
    xmlns='http://www.w3.org/2000/svg'
    width='50'
    height='53'
    fill='var(--icon-color, #000)'
    stroke='var(--icon-color, #000)'
    stroke-width='3'
    viewBox='0 0 50 53'
    ...attributes
  ><path
      d='M25 3c-6.637 0-12 5.363-12 12v5H9c-1.645 0-3 1.355-3 3v24c0 1.645 1.355 3 3 3h32c1.645 0 3-1.355 3-3V23c0-1.645-1.355-3-3-3h-4v-5c0-6.637-5.363-12-12-12Zm0 2c5.566 0 10 4.434 10 10v5H15v-5c0-5.566 4.434-10 10-10ZM9 22h32c.555 0 1 .445 1 1v24c0 .555-.445 1-1 1H9c-.555 0-1-.445-1-1V23c0-.555.445-1 1-1'
    /></svg>
</template>;

// @ts-expect-error this is the only way to set a name on a Template Only Component currently
IconComponent.name = 'Lock';
export default IconComponent;
