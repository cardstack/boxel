import GlimmerComponent from '@glimmer/component';
import { concat } from '@ember/helper';

interface EntityDisplayWithIconArgs {
  Args: {
    title?: string; //prefer using args.title if the title is just a string
    center?: boolean;
    underline?: boolean;
  };
  Blocks: {
    title?: []; //we can choose use this to pass instead of using args.title if the title block HTML is complex
    icon?: [];
    tag?: [];
    content?: [];
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
        <aside class='entity-icon'>
          {{yield to='icon'}}
        </aside>
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
        --icon-size: var(--entity-display-icon-size, var(--boxel-icon-sm));
        --title-font-size: var(
          --entity-display-title-font-size,
          var(--boxel-font-size-sm)
        );
        --title-color: var(--entity-display-title-color, var(--boxel-dark));
        --title-font-weight: var(--entity-display-title-font-weight, 600);
        --content-font-size: var(
          --entity-display-content-font-size,
          var(--boxel-font-size-xs)
        );
        --content-font-weight: var(
          --entity-display-content-font-weight,
          var(--boxel-font-weight-normal)
        );
        --content-color: var(--entity-display-content-color, var(--boxel-400));
        --content-gap: var(--entity-display-content-gap, var(--boxel-sp-xxxs));
        display: flex;
        align-items: flex-start;
        gap: var(--content-gap);
      }
      .entity-icon-display.center {
        align-items: center;
      }
      .entity-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        width: var(--icon-size);
        height: var(--icon-size);
      }
      .entity-info {
        display: flex;
        flex-direction: column;
        gap: var(--content-gap);
      }
      .entity-title-tag-container {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--content-gap);
      }
      .entity-title {
        word-break: break-word;
        color: var(--title-color);
        font-size: var(--title-font-size);
        font-weight: var(--title-font-weight);
      }
      .entity-title.underline {
        text-decoration: underline;
      }
      .entity-content {
        margin: 0;
        font-size: var(--content-font-size);
        font-weight: var(--content-font-weight);
        color: var(--content-color);
      }
    </style>
  </template>
}
