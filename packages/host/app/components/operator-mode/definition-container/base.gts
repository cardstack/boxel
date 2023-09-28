import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { Button } from '@cardstack/boxel-ui';
import { CardContainer, Header } from '@cardstack/boxel-ui';
import Label from '@cardstack/boxel-ui/components/label';

import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';

import RealmInfoProvider from '@cardstack/host/components/operator-mode/realm-info-provider';

interface Action {
  label: string;
  handler: () => void;
  icon: string;
}
export interface BaseArgs {
  title: string | undefined;
  name: string | undefined;
  fileExtension: string | undefined;
  isActive: boolean;
  fileURL?: string;
}

interface BaseSignature {
  Element: HTMLElement;
  Args: BaseArgs;
  Blocks: {
    activeContent: [];
  };
}

export class BaseDefinitionContainer extends Component<BaseSignature> {
  <template>
    <CardContainer ...attributes>
      <Header
        @title={{@title}}
        @hasBackground={{true}}
        class='header {{if @isActive "active"}}'
        data-test-definition-header
      >
        <:detail>
          <div data-test-definition-file-extension>
            {{@fileExtension}}
          </div>
        </:detail>
      </Header>
      <div class='content'>
        <div class='definition-info'>
          {{#if @fileURL}}
            <RealmInfoProvider @fileURL={{@fileURL}}>
              <:ready as |realmInfo|>
                <div class='realm-info'>
                  <img
                    src={{realmInfo.iconURL}}
                    alt='realm-icon'
                    data-test-realm-icon-url={{realmInfo.iconURL}}
                  />
                  <Label class='realm-name' data-test-definition-realm-name>in
                    {{realmInfo.name}}</Label>
                </div>
              </:ready>
            </RealmInfoProvider>
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
        --boxel-header-padding: var(--boxel-sp-xs);
        --boxel-header-text-size: var(--boxel-font-size-sm);
        --boxel-header-text-transform: uppercase;
        --boxel-header-letter-spacing: var(--boxel-lsp-xxl);
        --boxel-header-detail-margin-left: auto;
        --boxel-header-detail-max-width: none;
        --boxel-header-background-color: var(--boxel-100);
        --boxel-header-text-color: var(--boxel-450);
      }

      .header.active {
        --boxel-header-background-color: var(--boxel-highlight);
        --boxel-header-text-color: var(--boxel-light);
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
