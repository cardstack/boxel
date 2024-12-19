import GlimmerComponent from '@glimmer/component';

interface ActivityCardArgs {
  Blocks: {
    header: [];
    title: [];
    thumbnail: [];
    description?: [];
    icon?: [];
    content?: [];
  };
  Element: HTMLElement;
}

export default class ActivityCard extends GlimmerComponent<ActivityCardArgs> {
  <template>
    <article class='activity-card' ...attributes>
      <header class='activity-card-header'>
        <div class='activity-card-title-desc-group'>
          {{#if (has-block 'header')}}
            {{yield to='header'}}
          {{/if}}

          {{#if (has-block 'description')}}
            <p class='activity-card-description'>
              {{yield to='description'}}
            </p>
          {{/if}}
        </div>

        <div class='activity-card-icon'>
          {{#if (has-block 'icon')}}
            {{yield to='icon'}}
          {{/if}}
        </div>
      </header>

      <hr class='activity-card-divider' />

      <div class='activity-card-content'>
        {{#if (has-block 'content')}}
          {{yield to='content'}}
        {{/if}}
      </div>
    </article>

    <style scoped>
      .activity-card {
        background: var(--activity-card-bg, var(--boxel-light));
        border: 1px solid var(--activity-card-border, var(--boxel-300));
        border-radius: var(
          --activity-card-border-radius,
          var(--boxel-border-radius-xl)
        );
        padding: var(--activity-card-padding, var(--boxel-sp-sm));
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: var(--activity-card-gap, 0);
        overflow: hidden;
        min-width: 0;
        container-type: inline-size;
      }
      .activity-card-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--activity-card-header-gap, var(--boxel-sp-sm));
      }
      .activity-card-title-desc-group {
        display: flex;
        align-items: center;
        gap: var(--activity-card-title-desc-group-gap, var(--boxel-sp-sm));
      }
      .activity-card-description {
        margin: 0;
        font-size: var(
          --activity-card-description-font-size,
          var(--boxel-font-size-sm)
        );
        color: var(--activity-card-description-color, var(--boxel-400));
      }
      .activity-card-icon {
        flex-shrink: 0;
        width: var(--activity-card-icon-size, auto);
        height: var(--activity-card-icon-size, auto);
      }
      .activity-card-divider {
        border-top: 1px solid
          var(--activity-card-divider-color, var(--boxel-border));
        margin: var(--activity-card-divider-margin, var(--boxel-sp-sm) 0);
      }
      .activity-card-content {
        padding: var(--activity-card-content-padding, var(--boxel-sp-sm));
      }

      @container (max-width: 447px) {
        .activity-card-header {
          align-items: flex-start;
        }

        .activity-card-title-desc-group {
          flex-direction: column;
          align-items: flex-start;
          gap: var(--boxel-sp-xxxs);
        }
        .activity-card-content {
          padding: var(--activity-card-content-padding, 0);
        }
      }
    </style>
  </template>
}
