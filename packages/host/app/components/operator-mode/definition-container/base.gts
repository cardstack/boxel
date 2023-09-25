import Label from '@cardstack/boxel-ui/components/label';
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import { Button } from '@cardstack/boxel-ui';
import { type RealmInfo } from '@cardstack/runtime-common';
import { CardContainer } from '@cardstack/boxel-ui';

interface Action {
  label: string;
  handler: () => void;
  icon: string;
}
export interface BaseArgs {
  title: string | undefined;
  name: string | undefined;
  fileExtension: string | undefined;
  realmInfo: RealmInfo | undefined | null;
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

  get realmIcon(): string | undefined | null {
    return this.args.realmInfo?.iconURL;
  }

  <template>
    <CardContainer>
      <div class='banner {{if @isActive "active"}}'>
        <Label class='banner-title'>
          {{@title}}</Label>
        <span
          class='banner-title'
          data-test-definition-file-extension
        >{{@fileExtension}}</span>
      </div>
      <div class='content'>
        <div class='definition-info'>
          {{#if @realmInfo}}
            <div class='realm-info'>
              <img src={{this.realmIcon}} alt='realm-icon' />
              <Label class='realm-name' data-test-definition-realm-name>in
                {{this.realmName}}</Label>
            </div>
          {{/if}}
          <div data-test-definition-name class='definition-name'>{{@name}}</div>
        </div>
        {{#if @isActive}}
          {{yield to='activeContent'}}
        {{/if}}
      </div>

    </CardContainer>

    <style>
      .header {
        --boxel-header-text-size: var(--boxel-font-size-sm);
      }

      .banner {
        display: flex;
        justify-content: space-between;
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

      .banner.active {
        background-color: var(--boxel-highlight);
      }

      .banner.active .banner-title {
        color: var(--boxel-light);
      }
      .banner.active .file-extension {
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
