import GlimmerComponent from '@glimmer/component';
interface EntityDisplayArgs {
  Args: {
    center?: boolean;
    underline?: boolean;
  };
  Blocks: {
    title: [];
    thumbnail: [];
    tag: [];
    content: [];
  };
  Element: HTMLElement;
}

export class EntityDisplay extends GlimmerComponent<EntityDisplayArgs> {
  get shouldAlignCenter() {
    return this.args.center;
  }

  get shouldUnderlineText() {
    return this.args.underline;
  }

  <template>
    <div
      class='entity-display {{if this.shouldAlignCenter "center"}}'
      ...attributes
    >
      <div class='entity-thumbnail'>{{yield to='thumbnail'}}</div>

      <div class='entity-info'>
        <div class='entity-name-tag'>
          <span class='entity-name {{if this.shouldUnderlineText "underline"}}'>
            {{yield to='title'}}
          </span>

          {{yield to='tag'}}
        </div>

        <div class='entity-content'>
          {{yield to='content'}}
        </div>
      </div>
    </div>
    <style scoped>
      .entity-display {
        display: inline-flex;
        align-items: start;
        gap: var(--entity-display-gap, var(--boxel-sp-xs));
      }
      .entity-display.center {
        align-items: center;
      }
      .entity-thumbnail {
        width: var(--entity-display-thumbnail-size, var(--boxel-icon-sm));
        height: calc(
          var(--entity-display-thumbnail-size, var(--boxel-icon-sm)) - 2px
        );
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: var(--entity-display-thumbnail-color, var(--boxel-600));
      }
      .entity-info {
        display: flex;
        flex-direction: column;
        gap: var(--entity-display-info-gap, var(--boxel-sp-xxxs));
      }
      .entity-name-tag {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--entity-display-name-tag-gap, var(--boxel-sp-xxxs));
      }
      .entity-name {
        word-break: break-word;
      }
      .entity-name.underline {
        text-decoration: underline;
      }
      .entity-content {
        margin: 0;
        font-size: var(
          --entity-display-content-font-size,
          var(--boxel-font-size-sm)
        );
        color: var(--entity-display-content-color, var(--boxel-400));
      }
    </style>
  </template>
}
