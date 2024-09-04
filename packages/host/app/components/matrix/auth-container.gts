import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { CardContainer, BoxelHeader } from '@cardstack/boxel-ui/components';
import { BoxelIcon } from '@cardstack/boxel-ui/icons';

interface Signature {
  Element: HTMLDivElement;
  Args: {};
  Blocks: { default: [] };
}

const AuthContainer: TemplateOnlyComponent<Signature> = <template>
  <div class='auth'>
    <div class='container'>
      <CardContainer class='auth-container'>
        <BoxelHeader
          @title='Boxel'
          @displayBorder={{true}}
          @hasBackground={{false}}
          class='header'
        >
          <:icon>
            <BoxelIcon />
          </:icon>
        </BoxelHeader>
        <div class='content'>
          {{yield}}
        </div>
      </CardContainer>
    </div>
  </div>

  <style>
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
    .header {
      --boxel-header-icon-width: var(--boxel-icon-med);
      --boxel-header-icon-height: var(--boxel-icon-med);
      --boxel-header-padding: var(--boxel-sp);
      --boxel-header-text-size: var(--boxel-font);

      background-color: var(--boxel-light);
      text-transform: uppercase;
      max-width: max-content;
      min-width: 100%;
      gap: var(--boxel-sp-xxs);
      letter-spacing: var(--boxel-lsp-lg);
    }
    .content {
      display: flex;
      flex-direction: column;
      padding: var(--boxel-sp) var(--boxel-sp-xl) calc(var(--boxel-sp) * 2)
        var(--boxel-sp-xl);
    }
  </style>
</template>;

export default AuthContainer;
