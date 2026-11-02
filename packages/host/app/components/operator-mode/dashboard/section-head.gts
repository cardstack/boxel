import type { TemplateOnlyComponent } from '@ember/component/template-only';

import type { Icon } from '@cardstack/boxel-ui/icons';

interface Signature {
  Element: HTMLElement;
  Args: {
    icon: Icon;
    title: string;
    // The section's `aria-labelledby` points here, so a count stays out of
    // its name.
    titleId: string;
    count?: number;
  };
  Blocks: {
    // The hint under the title.
    default: [];
    // Controls beside the title.
    actions: [];
  };
}

// A dashboard section's heading: icon, title and count, then its hint.
const SectionHead: TemplateOnlyComponent<Signature> = <template>
  <div class='section-head' ...attributes>
    <h2 class='section-title'>
      <@icon class='section-icon' width='20' height='20' aria-hidden='true' />
      <span id={{@titleId}}>{{@title}}</span>
      {{#if @count}}
        <span class='section-count'>{{@count}}</span>
      {{/if}}
    </h2>
    {{yield to='actions'}}
    <p class='section-hint'>{{yield}}</p>
  </div>

  <style scoped>
    .section-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      column-gap: var(--boxel-sp-xs);
      row-gap: var(--boxel-sp-2xs);
      padding-bottom: var(--boxel-sp-sm);
      border-bottom: 1px solid var(--boxel-light-10);
    }
    .section-title {
      display: inline-flex;
      align-items: center;
      gap: var(--boxel-sp-xs);
      margin: 0;
      font-size: var(--dashboard-section-title-font-size);
      font-weight: 700;
      letter-spacing: -0.015em;
    }
    .section-icon {
      --icon-color: var(--muted-foreground);
      color: var(--muted-foreground);
      flex-shrink: 0;
    }
    .section-count {
      font-family: var(--boxel-monospace-font-family);
      font-size: var(--boxel-font-size-xs);
      font-weight: 600;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--subtle-foreground);
    }
    .section-count::before {
      content: '· ' / '';
    }
    .section-hint {
      flex-basis: 100%;
      margin: 0;
      font-size: var(--dashboard-section-hint-font-size);
      color: var(--muted-foreground);
    }
  </style>
</template>;

export default SectionHead;
