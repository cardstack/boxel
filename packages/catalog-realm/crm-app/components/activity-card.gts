import GlimmerComponent from '@glimmer/component';

interface ActivityCardArgs {
  Blocks: {
    header?: [];
    content?: [];
  };
  Element: HTMLElement;
}

export default class ActivityCard extends GlimmerComponent<ActivityCardArgs> {
  <template>
    <article class='activity-card' ...attributes>
      {{#if (has-block 'header')}}
        {{yield to='header'}}
      {{/if}}

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
        padding: var(--activity-card-padding, var(--boxel-sp-sm));
        border: 1px solid var(--activity-card-border-color, transparent);
        border-radius: var(--activity-card-border-radius, 0px);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: var(--activity-card-gap, 0);
        overflow: hidden;
        min-width: 0;
      }
      .activity-card-divider {
        border-top: 1px solid
          var(--activity-card-divider-color, var(--boxel-border));
        margin: var(--activity-card-divider-margin, var(--boxel-sp-sm) 0);
      }
      .activity-card-content {
        padding: var(--activity-card-content-padding, var(--boxel-sp-sm));
      }
    </style>
  </template>
}
