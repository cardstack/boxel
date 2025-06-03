import GlimmerComponent from '@glimmer/component';

interface SummaryGridContainerArgs {
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

export default class SummaryGridContainer extends GlimmerComponent<SummaryGridContainerArgs> {
  <template>
    <div class='summary-container' ...attributes>
      <div class='summary-grid'>
        {{yield}}
      </div>
    </div>

    <style scoped>
      .summary-container {
        container-type: inline-size;
        container-name: summary-container;
      }
      .summary-grid {
        display: grid;
        gap: var(--boxel-sp-sm);
      }
      @container summary-container (min-width: 800px) {
        .summary-grid {
          grid-template-columns: repeat(4, 1fr);
        }
      }
      @container summary-container (min-width: 447px) and (max-width: 800px) {
        .summary-grid {
          grid-template-columns: repeat(2, 1fr);
        }
      }
      @container summary-container (max-width: 447px) {
        .summary-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}
