import GlimmerComponent from '@glimmer/component';
import ImageField from '../../image';

interface GridPresentationSignature {
  Args: {
    images?: ImageField[];
  };
}

export default class GridPresentation extends GlimmerComponent<GridPresentationSignature> {
  <template>
    <div class='images-grid'>
      {{#each @images as |image|}}
        <div class='grid-item'>
          <img src={{image.url}} alt='' class='grid-image' />
        </div>
      {{/each}}
    </div>

    <style scoped>
      .images-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(6rem, 1fr));
        gap: 0.5rem;
      }

      .grid-item {
        position: relative;
        width: 100%;
        aspect-ratio: 1;
        border: 1px solid var(--border, #e5e7eb);
        border-radius: var(--radius, 0.375rem);
        overflow: hidden;
      }

      .grid-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    </style>
  </template>
}
