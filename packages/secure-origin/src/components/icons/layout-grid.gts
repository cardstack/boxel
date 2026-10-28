import type { IconComponent } from './types.ts';

// boxel-icons' layout-grid icon (lucide).
const LayoutGrid: IconComponent = <template>
  <svg
    xmlns='http://www.w3.org/2000/svg'
    fill='none'
    stroke='currentColor'
    stroke-linecap='round'
    stroke-linejoin='round'
    stroke-width='2'
    viewBox='0 0 24 24'
    ...attributes
  ><rect width='7' height='7' x='3' y='3' rx='1' /><rect
      width='7'
      height='7'
      x='14'
      y='3'
      rx='1'
    /><rect width='7' height='7' x='14' y='14' rx='1' /><rect
      width='7'
      height='7'
      x='3'
      y='14'
      rx='1'
    /></svg>
</template>;

export default LayoutGrid;
