import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';

import { type ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import CardSchemaEditor from '@cardstack/host/components/operator-mode/card-schema-editor';
import { CardInheritance } from '@cardstack/host/components/operator-mode/schema-editor-column';

import type { Ready } from '@cardstack/host/resources/file';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    file: Ready;
    cardInheritanceChain: CardInheritance[];
    moduleSyntax: ModuleSyntax;
  };
}

const CardAdoptionChain: TemplateOnlyComponent<Signature> = <template>
  <style>
    .card-adoption-chain {
      background-color: var(--boxel-200);
      height: 100%;
    }
    .content-with-line {
      position: relative;
      transform: translateX(calc(var(--boxel-sp-sm) * -1));

      display: flex;
      align-items: center;
      width: calc(100% + calc(var(--boxel-sp-sm) * 2));
      height: 60px;
      padding: var(--boxel-sp) 0;
    }

    .inherits-from {
      display: flex;
      align-items: center;
      padding: 0 var(--boxel-sp-xs);
      gap: var(--boxel-sp-xxxs);
      font: 500 var(--boxel-font-sm);
      letter-spacing: var(--boxel-lsp-xs);
      text-wrap: nowrap;
      background: var(--boxel-200);

      position: absolute;
      left: 50%;
      transform: translateX(-50%);
    }

    .chain:last-child .content-with-line {
      display: none;
    }

    .inherits-icon {
      height: 24px;
    }

    .line {
      width: 100%;
      border: 1px solid var(--boxel-purple-200);
    }
  </style>

  <div class='card-adoption-chain' ...attributes>
    {{#each @cardInheritanceChain as |item index|}}
      <div class='chain'>
        <CardSchemaEditor
          @card={{item.card}}
          @cardType={{item.cardType}}
          @file={{@file}}
          @moduleSyntax={{@moduleSyntax}}
          @allowAddingFields={{eq index 0}}
        />
        <div class='content-with-line'>
          <hr class='line' />
          <div class='inherits-from'>
            <span class='inherits-icon'>{{svgJar
                'icon-inherit'
                width='24px'
                height='24px'
              }}</span>
            <span>Inherits From</span>
          </div>
        </div>
      </div>
    {{/each}}
  </div>
</template>;

export default CardAdoptionChain;
