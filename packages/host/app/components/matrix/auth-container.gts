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

        {{yield}}
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
      width: var(--boxel-sm-container);
      border-radius: var(--boxel-border-radius-xl);
    }

    .header {
      --boxel-header-icon-width: var(--boxel-icon-med);
      --boxel-header-icon-height: var(--boxel-icon-med);
      --boxel-header-padding: var(--boxel-sp);
      --boxel-header-text-size: var(--boxel-font);

      text-transform: uppercase;
      max-width: max-content;
      min-width: 100%;
      gap: var(--boxel-sp-xxs);
      letter-spacing: var(--boxel-lsp-lg);
    }
  </style>
</template>;

export default AuthContainer;
