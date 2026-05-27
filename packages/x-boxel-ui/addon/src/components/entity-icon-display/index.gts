import { concat } from '@ember/helper';
import GlimmerComponent from '@glimmer/component';

interface EntityDisplayWithIconArgs {
  Args: {
    //prefer using args.title if the title is just a string
    center?: boolean;
    title?: string;
    underline?: boolean;
  };
  Blocks: {
    content?: []; //we can choose use this to pass instead of using args.title if the title block HTML is complex
    icon?: [];
    tag?: [];
    title?: [];
  };
  Element: HTMLElement;
}

export default class EntityDisplayWithIcon extends GlimmerComponent<EntityDisplayWithIconArgs> {
  get shouldAlignCenter() {
    return this.args.center;
  }

  get shouldUnderlineText() {
    return this.args.underline;
  }

  <template>
    <div
      class={{concat
        'entity-icon-display'
        (if this.shouldAlignCenter ' center')
      }}
      ...attributes
    >
      {{#if (has-block 'icon')}}
        <span class='entity-icon'>
          {{yield to='icon'}}
        </span>
      {{/if}}

      <div class='entity-info'>
        {{! Title and tag }}
        <div class='entity-title-tag-container'>
          {{! this guard clause is already priotize yield to 'title' instead of using args.title if both are provided}}
          {{#if (has-block 'title')}}
            {{yield to='title'}}
          {{else if @title}}
            <span
              class={{concat
                'entity-title'
                (if this.shouldUnderlineText ' underline')
              }}
            >
              {{@title}}
            </span>
          {{/if}}

          {{#if (has-block 'tag')}}
            {{yield to='tag'}}
          {{/if}}
        </div>

        {{! Extra Content }}
        {{#if (has-block 'content')}}
          <div class='entity-content'>
            {{yield to='content'}}
          </div>
        {{/if}}
      </div>

    </div>
    <style scoped>
      .entity-icon-display {
        display: var(--entity-display-display, flex);
        align-items: var(--entity-display-align-items, flex-start);
        flex-direction: var(--entity-display-flex-direction, row);
        gap: var(--entity-display-gap, var(--boxel-sp-xxxs));
      }
      .entity-icon-display.center {
        align-items: center;
      }
      .entity-icon {
        display: var(--entity-display-icon-display, inline-flex);
        align-items: var(--entity-display-icon-align-items, center);
        justify-content: var(--entity-display-icon-justify-content, center);
        flex-shrink: 0;
        width: var(--entity-display-icon-size, var(--boxel-icon-sm));
        height: var(--entity-display-icon-size, var(--boxel-icon-sm));
      }
      .entity-info {
        display: var(--entity-display-info-display, flex);
        flex-direction: var(--entity-display-info-flex-direction, column);
        gap: var(--entity-display-info-gap, var(--boxel-sp-xxxs));
      }
      .entity-title-tag-container {
        display: var(--entity-display-title-tag-container-display, flex);
        flex-wrap: var(--entity-display-title-tag-container-flex-wrap, wrap);
        align-items: var(
          --entity-display-title-tag-container-align-items,
          center
        );
        gap: var(
          --entity-display-title-tag-container-gap,
          var(--boxel-sp-xxxs)
        );
      }
      .entity-title {
        color: var(--entity-display-title-color, var(--boxel-dark));
        font-size: var(
          --entity-display-title-font-size,
          var(--boxel-font-size-sm)
        );
        font-weight: var(--entity-display-title-font-weight, 600);
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: var(--entity-display-title-line-clamp, 1);
        margin: var(--entity-display-title-margin, 0);
        word-break: var(--entity-display-title-word-break, break-word);
      }
      .entity-title.underline {
        text-decoration: var(--entity-display-title-underline, underline);
      }
      .entity-content {
        color: var(--entity-display-content-color, var(--boxel-400));
        font-size: var(
          --entity-display-content-font-size,
          var(--boxel-font-size-xs)
        );
        font-weight: var(--entity-display-content-font-weight, 400);
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: var(--entity-display-content-line-clamp, 1);
        margin: var(--entity-display-content-margin, 0);
        word-break: var(--entity-display-content-word-break, break-word);
      }
    </style>
  </template>
}
