import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { CardContainer, BoxelHeader } from '@cardstack/boxel-ui/components';
import { BoxelIcon } from '@cardstack/boxel-ui/icons';
import { eq, cn } from '@cardstack/boxel-ui/helpers';

import type { AuthMode } from './auth';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    mode: AuthMode;
  };
  Blocks: { default: [] };
}

const AuthContainer: TemplateOnlyComponent<Signature> = <template>
  <div class='auth'>
    <div class='container'>
      <CardContainer
        class={{cn 'auth-container' no-background=(eq @mode 'payment-setup')}}
      >
        <BoxelHeader
          @title='Boxel'
          @displayBorder={{true}}
          @hasBackground={{false}}
          class={{cn 'header' light=(eq @mode 'payment-setup')}}
        >
          <:icon>
            <BoxelIcon />
          </:icon>
        </BoxelHeader>
        <div class={{cn 'content' no-padding=(eq @mode 'payment-setup')}}>
          {{yield}}
        </div>
      </CardContainer>
    </div>
  </div>

  <style scoped>
    .auth {
      height: 100%;
      overflow: auto;
    }

    .container {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      min-height: 100%;
      padding: var(--boxel-sp-lg);
    }

    .auth-container {
      background-color: var(--boxel-light);
      border: 1px solid var(--boxel-form-control-border-color);
      border-radius: var(--boxel-form-control-border-radius);
      letter-spacing: var(--boxel-lsp);
      width: 550px;
      position: relative;
    }
    .auth-container.no-background {
      background-color: transparent;
      border: none;
    }

    .header {
      --boxel-header-padding: var(--boxel-sp);
      --boxel-header-text-font: var(--boxel-font);

      background-color: var(--boxel-light);
      text-transform: uppercase;
      max-width: max-content;
      min-width: 100%;
      gap: var(--boxel-sp-xxs);
      letter-spacing: var(--boxel-lsp-lg);
    }
    .header.light {
      color: var(--boxel-light);
      background-color: transparent;
    }

    .content {
      display: flex;
      flex-direction: column;
      padding: var(--boxel-sp) var(--boxel-sp-xl) calc(var(--boxel-sp) * 2)
        var(--boxel-sp-xl);
    }
    .content.no-padding {
      padding: 0;
    }
  </style>
</template>;

export default AuthContainer;
