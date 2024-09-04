import Label from '@cardstack/boxel-ui/components/label';
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import { Button } from '@cardstack/boxel-ui';
import { type RealmInfo } from '@cardstack/runtime-common';

interface Action {
  label: string;
  handler: () => void;
  icon: string;
}
export interface BaseArgs {
  title: string | undefined;
  name: string | undefined;
  fileExtension: string;
  realmInfo: RealmInfo | null;
  realmIconURL: string | null | undefined;
  isActive: boolean;
}

interface BaseSignature {
  Element: HTMLElement;
  Args: BaseArgs;
  Blocks: {
    activeContent: [];
  };
}

export class BaseDefinitionContainer extends Component<BaseSignature> {
  get realmName(): string | undefined {
    return this.args.realmInfo?.name;
  }

  <template>
    <div class='container {{if @isActive "active"}}' ...attributes>
      <div class='banner'>
        <Label class='banner-title'>
          {{@title}}</Label>
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
          <div data-test-definition-name class='definition-name'>{{@name}}</div>
        </div>
        {{#if @isActive}}
          {{yield to='activeContent'}}
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
    </style>
  </template>
}

export interface ActiveArgs {
  actions: Action[];
  infoText?: string;
}

interface ActiveSignature {
  Element: HTMLElement;
  Args: ActiveArgs;
}

export class Active extends Component<ActiveSignature> {
  <template>
    <div class='action-buttons'>
      {{#each @actions as |actionButton|}}
        <Button
          data-test-action-button='{{actionButton.label}}'
          class='action-button'
          {{on 'click' actionButton.handler}}
        >
          {{svgJar actionButton.icon width='24px' height='24px'}}
          {{actionButton.label}}
        </Button>
      {{/each}}
      <div class='info-footer' data-test-definition-info-text>
        <div class='message'>{{@infoText}}</div>
      </div>
    </div>
    <style>
      .action-buttons {
        display: flex;
        flex-direction: column;
      }
      .action-button {
        --boxel-button-text-color: var(--boxel-highlight);
        --boxel-button-padding: 0px;
        --icon-color: var(--boxel-highlight);
        color: var(--boxel-highlight);
        border: none;
        justify-content: flex-start;
        gap: var(--boxel-sp-xs);
        align-self: flex-start;
      }
      .info-footer {
        margin-top: var(--boxel-sp-sm);
      }
      .info-footer .message {
        color: var(--boxel-450);
        font: var(--boxel-font-xs);
        font-weight: 500;
      }
    </style>
  </template>
}
