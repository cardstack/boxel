import Label from '@cardstack/boxel-ui/components/label';
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import { Button } from '@cardstack/boxel-ui';
import { eq, and } from '@cardstack/boxel-ui/helpers/truth-helpers';
// boxel- specific
import { type RealmInfo } from '@cardstack/runtime-common';

export type DefinitionVariant = 'instance' | 'module';

interface Signature {
  Element: HTMLElement;
  Args: {
    name: string | undefined;
    fileExtension: string;
    realmInfo: RealmInfo | null;
    infoText: string | undefined;
    variant: DefinitionVariant;
    isActive: boolean;
    onCreate?: () => void;
    onInherit?: () => void;
    onDuplicate?: () => void;
  };
}

export default class DefinitionContainer extends Component<Signature> {
  get title(): string {
    switch (this.args.variant) {
      case 'module':
        return 'CARD DEFINITION';
      case 'instance':
        return 'CARD INSTANCE';
      default:
        return 'CARD DEFINITION';
    }
  }
  get realmName(): string | undefined {
    return this.args.realmInfo?.name;
  }
  get realmIconSrc(): string | null | undefined {
    return this.args.realmInfo?.iconURL;
  }

  <template>
    <div class='container' ...attributes>
      <div class='banner {{if @isActive "active"}}'>
        <Label class='banner-title'>
          {{this.title}}</Label>
        <span
          class='banner-title'
          data-test-definition-file-extension
        >{{@fileExtension}}</span>
      </div>
      <div class='content'>
        <div class='realm-info'>
          <img src={{this.realmIconSrc}} alt='realm-icon' />
          <Label
            class='realm-name'
            data-test-definition-realm-name
          >{{this.realmName}}</Label>
        </div>
        <div class='name'>{{@name}}</div>
      </div>
      <div class='action-buttons'>
        {{#if (and (eq @variant 'module') @isActive)}}
          {{#if @onCreate}}
            <Button class='action-button' {{on 'click' @onCreate}}>
              {{svgJar 'icon-plus' width='24px' height='24px'}}
              Create Instance
            </Button>
          {{/if}}
          {{#if @onInherit}}
            <Button class='action-button' {{on 'click' @onInherit}}>
              {{svgJar 'icon-inherit' width='24px' height='24px'}}
              Inherit
            </Button>
          {{/if}}
          {{#if @onDuplicate}}
            <Button class='action-button' {{on 'click' @onDuplicate}}>
              {{svgJar 'copy' width='24px' height='24px'}}
              Duplicate
            </Button>
          {{/if}}
        {{/if}}
        {{#if (eq @variant 'instance')}}
          {{#if @onDuplicate}}
            <Button class='action-button' {{on 'click' @onDuplicate}}>
              {{svgJar 'copy' width='24px' height='24px'}}
              Duplicate
            </Button>
          {{/if}}
        {{/if}}
      </div>
      {{#if @isActive}}
        <div class='info-footer' data-test-definition-info-text>
          <p class='message'>{{@infoText}}</p>
        </div>
      {{/if}}
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
        gap: var(--boxel-sp-xs);
        align-items: center;
        padding: var(--boxel-sp-xs);
        border-top-left-radius: var(--boxel-border-radius);
        border-top-right-radius: var(--boxel-border-radius);
        background-color: var(--boxel-100);
      }
      .banner-title {
        color: #919191;
        font-size: var(--boxel-font-size-xs);
        font-weight: 500;
        letter-spacing: var(--boxel-lsp-lg);
      }
      .active {
        background-color: var(--boxel-highlight);
      }

      .active .banner-title {
        color: var(--boxel-light);
      }
      .active .file-extension {
        color: var(--boxel-light);
      }
      .content {
        padding: var(--boxel-sp-sm);
      }
      .realm-info {
        display: flex;
        justify-content: flex-start;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .realm-info img {
        width: 22px;
      }

      .realm-name {
        letter-spacing: var(--boxel-lsp-xs);
        font-weight: 500;
      }
      .name {
        font-size: var(--boxel-font-size);
        font-weight: bold;
      }

      .info-footer {
        padding: var(--boxel-sp-sm);
      }
      .info-footer .message {
        color: #919191;
      }

      .action-buttons {
        display: flex;
        flex-direction: column;
        width: 80%;
        padding: var(--boxel-sp-sm);
      }
      .action-button {
        --boxel-button-text-color: var(--boxel-highlight);
        --icon-color: var(--boxel-highlight);
        color: var(--boxel-highlight);
        border: none;
        padding: 0;
        display: flex;
        justify-content: flex-start;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
}
