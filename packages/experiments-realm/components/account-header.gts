import GlimmerComponent from '@glimmer/component';
import ImageIcon from '@cardstack/boxel-icons/image';

interface AccountHeaderArgs {
  Args: {
    logoURL?: string;
    name?: string;
  };
  Blocks: {
    name: [];
    content: [];
  };
  Element: HTMLElement;
}

class AccountHeader extends GlimmerComponent<AccountHeaderArgs> {
  <template>
    <header class='account-header' ...attributes>
      {{#if @logoURL}}
        <img src={{@logoURL}} alt={{@name}} class='account-header-logo' />
      {{else}}
        <ImageIcon class='account-header-logo default-icon-container' />
      {{/if}}
      <div class='account-header-info'>
        {{#if (has-block 'name')}}
          {{yield to='name'}}
        {{/if}}
        {{#if (has-block 'content')}}
          {{yield to='content'}}
        {{/if}}
      </div>
    </header>

    <style scoped>
      .account-header {
        display: flex;
        align-items: start;
        gap: var(--boxel-sp);
        min-width: 0;
      }
      .account-header-logo {
        flex-shrink: 0;
        width: 60px;
        height: 60px;
        object-fit: cover;
        border-radius: var(--boxel-border-radius-xl);
      }
      .default-icon-container {
        background-color: var(--boxel-200);
        color: var(--boxel-400);
      }
      .account-header-info {
        min-width: 0;
        width: 100%;
        overflow: hidden;
      }
    </style>
  </template>
}

export default AccountHeader;
