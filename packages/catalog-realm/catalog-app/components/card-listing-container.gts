import GlimmerComponent from '@glimmer/component';
import { CardContainer } from '@cardstack/boxel-ui/components';

interface CardListingContainerArgs {
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

export default class CardListingContainer extends GlimmerComponent<CardListingContainerArgs> {
  <template>
    <CardContainer class='card-listing-container' ...attributes>
      {{yield}}
    </CardContainer>

    <style scoped>
      .card-listing-container {
        width: var(--card-listing-container-width, 100%);
        height: var(--card-listing-container-height, auto);
        padding: var(--card-listing-container-padding, 0);
        border: var(--card-listing-container-border, 1px);
        border-color: var(--card-listing-container-border-color, transparent);
        border-radius: var(
          --card-listing-container-border-radius,
          var(--boxel-border-radius)
        );
        background-color: var(
          --card-listing-container-background-color,
          var(--boxel-light)
        );
      }
    </style>
  </template>
}
