import GlimmerComponent from '@glimmer/component';
import { CardContainer } from '@cardstack/boxel-ui/components';

// Purpose to create this component:
// Defaults boundaries to false, unlike CardContainer, we do not want to display boundaries by default.
// Defaults padding to 0, if you want padding, you can pass in the cssVar --content-container-padding.
// Defaults background color to light, if you want a different background color, you can pass in the cssVar --content-container-background-color.
// Defaults width to 100%, if you want a different width, you can pass in the cssVar --content-container-width.
// Defaults height to auto, if you want a different height, you can pass in the cssVar --content-container-height.
interface ContentContainerArgs {
  Args: {
    displayBoundaries?: boolean;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

export default class ContentContainer extends GlimmerComponent<ContentContainerArgs> {
  <template>
    <CardContainer
      @displayBoundaries={{@displayBoundaries}}
      class='content-container'
      ...attributes
    >
      {{yield}}
    </CardContainer>

    <style scoped>
      .content-container {
        width: var(--content-container-width, 100%);
        height: var(--content-container-height, auto);
        padding: var(--content-container-padding, 0);
        border-radius: var(
          --content-container-border-radius,
          var(--boxel-border-radius)
        );
        background-color: var(
          --content-container-background-color,
          var(--boxel-light)
        );
      }
    </style>
  </template>
}
