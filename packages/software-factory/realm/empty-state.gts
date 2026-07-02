import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { type CardOrFieldTypeIcon } from 'https://cardstack.com/base/card-api';

import { Pill } from '@cardstack/boxel-ui/components';

import CircleDot from '@cardstack/boxel-icons/circle-dot';

interface Signature {
  Element: HTMLElement;
  Args: {
    icon: CardOrFieldTypeIcon;
    title: string;
    // When present, renders the "in progress" status pill above the title.
    badgeLabel?: string;
  };
  Blocks: {
    // Body beneath the title — lede copy, hints, a roadmap, etc.
    default: [];
  };
}

// Shared getting-started / empty hero used by the realm-index tabs while the
// factory is still bootstrapping. It owns the icon chip, status pill, and
// title; callers pass the icon and title and supply the body as a block.
const EmptyState: TemplateOnlyComponent<Signature> = <template>
  <div class='es-hero' ...attributes>
    <span class='es-hero-icon'>
      <@icon width='24' height='24' aria-hidden='true' />
    </span>
    <div class='es-hero-text'>
      {{#if @badgeLabel}}
        <span class='es-badge'>
          <Pill @variant='secondary'>
            <:iconLeft><CircleDot width='13' height='13' /></:iconLeft>
            <:default>{{@badgeLabel}}</:default>
          </Pill>
        </span>
      {{/if}}
      <h2 class='es-title'>{{@title}}</h2>
      {{yield}}
    </div>
  </div>
  <style scoped>
    .es-hero {
      display: flex;
      gap: var(--boxel-sp);
      align-items: flex-start;
      max-width: 42rem;
      margin: 0 auto;
      padding-block: var(--boxel-sp-lg);
    }
    .es-hero-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 3rem;
      height: 3rem;
      flex-shrink: 0;
      border-radius: var(--boxel-border-radius);
      background: var(--muted, var(--boxel-100));
    }
    .es-hero-text {
      display: flex;
      flex-direction: column;
      gap: var(--boxel-sp-xs);
      min-width: 0;
    }
    .es-badge {
      align-self: flex-start;
    }
    .es-title {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
      line-height: 1.3;
    }
  </style>
</template>;

export { EmptyState };
