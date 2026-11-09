import type { IconComponent } from './types.ts';

// boxel-ui's IconPlus icon.
const IconPlus: IconComponent = <template>
  <svg
    xmlns='http://www.w3.org/2000/svg'
    viewBox='3.5 3.5 17 17'
    ...attributes
  ><path
      fill='var(--icon-color, #000)'
      stroke='var(--icon-color, #000)'
      d='M19 11h-6V5a1 1 0 0 0-2 0v6H5a1 1 0 0 0 0 2h6v6a1 1 0 0 0 2 0v-6h6a1 1 0 0 0 0-2Z'
    /></svg>
</template>;

export default IconPlus;
