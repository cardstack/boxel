import type { TemplateOnlyComponent } from '@ember/component/template-only';

interface Signature {
  Element: HTMLButtonElement;
  Blocks: {
    default: [];
  };
}

// The clickable face of a dashboard tile, sized by the list that holds it.
const ItemContainer: TemplateOnlyComponent<Signature> = <template>
  {{! After the splat: a tile inside a form must never submit it. }}
  <button class='item-container' ...attributes type='button'>
    {{yield}}
  </button>
  <style scoped>
    .item-container {
      position: relative;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: var(--dashboard-tile-height);
      padding: 0;
      border: none;
      border-radius: var(--dashboard-tile-radius);
      overflow: hidden;
    }
    /* The keyboard cursor's ring is drawn by the tile around it, so focus
       draws no outline of its own. */
    .item-container:focus-visible {
      outline: none;
    }
  </style>
</template>;

export default ItemContainer;
