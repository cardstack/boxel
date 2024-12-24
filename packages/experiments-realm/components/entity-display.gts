import GlimmerComponent from '@glimmer/component';
import { or } from '@cardstack/boxel-ui/helpers';

interface EntityDisplayArgs {
  Args: {
    center?: boolean;
    underline?: boolean;
  };
  Blocks: {
    title?: [];
    thumbnail?: []; // we will always target thumbnail first if the user pass both thumbnail and icon blocks
    icon?: [];
    tag?: [];
    content?: [];
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
      {{#if (or (has-block 'thumbnail') (has-block 'icon'))}}
        {{#if (has-block 'thumbnail')}}
          <div class='entity-thumbnail'>
            {{yield to='thumbnail'}}
          </div>
        {{else if (has-block 'icon')}}
          <div class='entity-icon'>
            {{yield to='icon'}}
          </div>
        {{/if}}
      {{/if}}

      {{#if (or (has-block 'title') (has-block 'tag') (has-block 'content'))}}
        <div class='entity-info'>
          <div class='entity-name-tag'>
            {{#if (has-block 'title')}}
              <span
                class='entity-name {{if this.shouldUnderlineText "underline"}}'
              >
                {{yield to='title'}}
              </span>
            {{/if}}

            {{#if (has-block 'tag')}}
              {{yield to='tag'}}
            {{/if}}
          </div>

          {{#if (has-block 'content')}}
            <div class='entity-content'>
              {{yield to='content'}}
            </div>
          {{/if}}
        </div>
      {{/if}}
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
      /* always prioritize the thumbnail block, we dont control the default size of the thumbnail */
      .entity-thumbnail {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: var(--entity-display-thumbnail-color, var(--boxel-600));
        object-fit: cover;
        border: none;
        width: auto;
        height: auto;
      }
      .entity-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        width: auto;
        height: auto;
        max-width: var(--entity-display-icon-size, var(--boxel-icon-sm));
        max-height: var(--entity-display-icon-size, var(--boxel-icon-sm));
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
