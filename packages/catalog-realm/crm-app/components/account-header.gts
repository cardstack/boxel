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
        <div class='account-header-logo default-icon-container'>
          <ImageIcon width='24' height='24' />
        </div>
      {{/if}}
      <div class='account-header-info'>
        {{#if (has-block 'name')}}
          {{yield to='name'}}
        {{else}}
          <h3 class='account-header-name'>{{@name}}</h3>
        {{/if}}

        {{#if (has-block 'content')}}
          <div class='account-header-info-content'>
            {{yield to='content'}}
          </div>
        {{/if}}
      </div>
    </header>

    <style scoped>
      .account-header {
        display: var(--account-header-display, flex);
        align-items: var(--account-header-align-items, start);
        gap: var(--account-header-gap, var(--boxel-sp));
        min-width: 0;
      }
      .account-header-logo {
        flex-shrink: 0;
        width: var(--account-header-logo-size, 60px);
        height: var(--account-header-logo-size, 60px);
        object-fit: var(--account-header-logo-object-fit, cover);
        border-radius: var(
          --account-header-logo-border-radius,
          var(--boxel-border-radius-xl)
        );
      }
      .default-icon-container {
        display: var(--account-header-logo-display, flex);
        align-items: var(--account-header-logo-align-items, center);
        justify-content: var(--account-header-logo-justify-content, center);
        background-color: var(
          --account-header-logo-background-color,
          var(--boxel-200)
        );
        color: var(--account-header-logo-color, var(--boxel-400));
        padding: var(--account-header-logo-padding, 5px);
      }
      .account-header-info {
        display: var(--account-header-info-display, flex);
        flex-direction: var(--account-header-info-flex-direction, column);
        gap: var(--account-header-info-gap, var(--boxel-sp-xxs));
        min-width: 0;
        width: 100%;
        overflow: hidden;
      }
      .account-header-name {
        margin: 0;
        font: var(--account-header-name-font, 600 var(--boxel-font-md));
        letter-spacing: var(
          --account-header-name-letter-spacing,
          var(--boxel-lsp-sm)
        );
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: var(--account-header-name-line-clamp, 1);
      }
      .account-header-info-content {
        display: var(--account-header-info-content-display, flex);
        flex-direction: var(--account-header-info-content-flex-direction, row);
        gap: var(--account-header-info-content-gap, var(--boxel-sp-xxs));
      }
    </style>
  </template>
}

export default AccountHeader;
