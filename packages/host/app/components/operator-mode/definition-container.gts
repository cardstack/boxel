import Label from '@cardstack/boxel-ui/components/label';
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import { Button } from '@cardstack/boxel-ui';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { assertNever } from '@cardstack/host/utils/assert-never';
// boxel- specific
import { type RealmInfo } from '@cardstack/runtime-common';

export enum DefinitionVariant {
  Instance = 'instance',
  Module = 'module',
}

interface Signature {
  Element: HTMLElement;
  Args: {
    name: string | undefined;
    fileExtension: string;
    realmInfo: RealmInfo | null;
    realmIconURL: string | null | undefined;
    variant: DefinitionVariant;
    isActive: boolean;
    infoText?: string;
    delete: () => void;
  };
}

export default class DefinitionContainer extends Component<Signature> {
  get title(): string {
    switch (this.args.variant) {
      case DefinitionVariant.Module:
        return 'Card Definition';
      case DefinitionVariant.Instance:
        return 'Card Instance';
      default:
        throw assertNever(this.args.variant);
    }
  }
  get realmName(): string | undefined {
    return this.args.realmInfo?.name;
  }

  notImplemented = () => {
    throw new Error(`not implemented`);
  };

  <template>
    <div class='container {{if @isActive "active"}}' ...attributes>
      <div class='banner'>
        <Label class='banner-title'>
          {{this.title}}</Label>
        <span
          class='banner-title'
          data-test-definition-file-extension
        >{{@fileExtension}}</span>
      </div>
      <div class='content'>
        <div class='definition-info'>
          <div class='realm-info'>
            <img src={{@realmIconURL}} alt='realm-icon' />
            <Label class='realm-name' data-test-definition-realm-name>in
              {{this.realmName}}</Label>
          </div>
          <div class='definition-name'>{{@name}}</div>
        </div>
        {{#if @isActive}}
          <div class='action-buttons'>
            {{#if (eq @variant 'module')}}
              <Button class='action-button' {{on 'click' this.notImplemented}}>
                {{svgJar 'icon-plus' width='24px' height='24px'}}
                Create Instance
              </Button>
              <Button class='action-button' {{on 'click' this.notImplemented}}>
                {{svgJar 'icon-inherit' width='24px' height='24px'}}
                Inherit
              </Button>
              <Button class='action-button' {{on 'click' @delete}}>
                {{svgJar 'icon-trash' width='24px' height='24px'}}
                Delete
              </Button>
            {{/if}}
            {{#if (eq @variant 'instance')}}
              <Button class='action-button' {{on 'click' @delete}}>
                {{svgJar 'icon-trash' width='24px' height='24px'}}
                Delete
              </Button>
            {{/if}}
          </div>
          <div class='info-footer' data-test-definition-info-text>
            <div class='message'>{{@infoText}}</div>
          </div>
        {{/if}}
      </div>
    </div>

    <style>
      .container {
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius);
        gap: var(--boxel-sp-xxs);
      }
      .banner {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        padding: var(--boxel-sp-xxs) var(--boxel-sp-sm) var(--boxel-sp-xxs);
        border-top-left-radius: var(--boxel-border-radius);
        border-top-right-radius: var(--boxel-border-radius);
        background-color: var(--boxel-100);
      }
      .banner-title {
        color: #919191;
        font-size: var(--boxel-font-size-sm);
        font-weight: 200;
        letter-spacing: var(--boxel-lsp-xxl);
        text-transform: uppercase;
      }
      .active {
        box-shadow: var(--boxel-box-shadow-hover);
      }

      .active .banner {
        background-color: var(--boxel-highlight);
      }

      .active .banner-title {
        color: var(--boxel-light);
      }
      .active .file-extension {
        color: var(--boxel-light);
      }
      .content {
        display: flex;
        flex-direction: column;
        padding: var(--boxel-sp-xs);
        gap: var(--boxel-sp-sm);
      }
      .realm-info {
        display: flex;
        justify-content: flex-start;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }
      .realm-info img {
        width: var(--boxel-icon-sm);
      }
      .realm-info .realm-name {
        letter-spacing: var(--boxel-lsp-xs);
        font-weight: 500;
        font-size: var(--boxel-font-size-sm);
      }
      .definition-info {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxxs);
      }
      .definition-name {
        font-size: var(--boxel-font-size);
        font-weight: bold;
      }

      .info-footer .message {
        color: #919191;
        font-weight: 200;
      }

      .action-buttons {
        display: flex;
        flex-direction: column;
        width: 80%;
      }
      .action-button {
        --boxel-button-text-color: var(--boxel-highlight);
        --boxel-button-padding: 0px;
        --icon-color: var(--boxel-highlight);
        color: var(--boxel-highlight);
        border: none;
        display: flex;
        justify-content: flex-start;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
}
