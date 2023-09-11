import Label from '@cardstack/boxel-ui/components/label';
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { not } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import { Button } from '@cardstack/boxel-ui';
import { action } from '@ember/object';
import { type RealmInfo } from '@cardstack/runtime-common';

interface Action {
  label: string;
  handler: () => void;
  icon: string;
}

interface BaseArgs {
  title: string | undefined;
  name: string | undefined;
  fileExtension: string;
  realmInfo: RealmInfo | null;
  realmIconURL: string | null | undefined;
  isActive: boolean;
  actions: Action[];
  url?: URL;
  onSelectDefinition?: (newUrl: URL | undefined) => void;
  infoText?: string;
}

interface BaseSignature {
  Element: HTMLElement;
  Args: BaseArgs;
}

class BaseDefinitionContainer extends Component<BaseSignature> {
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
          <div class='action-buttons'>
            {{#each @actions as |actionButton|}}
              <Button class='action-button' {{on 'click' actionButton.handler}}>
                {{svgJar actionButton.icon width='24px' height='24px'}}
                {{actionButton.label}}
              </Button>
            {{/each}}

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
    </style>
  </template>
}

export class InstanceDefinitionContainer extends Component<BaseSignature> {
  <template>
    <BaseDefinitionContainer
      @title={{@title}}
      @name={{@name}}
      @fileExtension={{@fileExtension}}
      @realmInfo={{@realmInfo}}
      @realmIconURL={{@realmIconURL}}
      @isActive={{@isActive}}
      @infoText={{@infoText}}
      @actions={{@actions}}
      data-test-card-instance-definition
    />
  </template>
}

export class ModuleDefinitionContainer extends Component<BaseSignature> {
  <template>
    {{#if (not @isActive)}}
      <Clickable
        @onSelectDefinition={{@onSelectDefinition}}
        @url={{@url}}
        data-test-definition-container
      >
        <BaseDefinitionContainer
          @title={{@title}}
          @name={{@name}}
          @fileExtension={{@fileExtension}}
          @realmInfo={{@realmInfo}}
          @realmIconURL={{@realmIconURL}}
          @isActive={{@isActive}}
          @infoText={{@infoText}}
          @actions={{@actions}}
          data-test-card-module-definition
        />
      </Clickable>
    {{else}}
      <BaseDefinitionContainer
        @title={{@title}}
        @name={{@name}}
        @fileExtension={{@fileExtension}}
        @realmInfo={{@realmInfo}}
        @realmIconURL={{@realmIconURL}}
        @isActive={{@isActive}}
        @actions={{@actions}}
        data-test-card-module-definition
      />
    {{/if}}
  </template>
}

interface ClickableSignature {
  Element: HTMLElement;
  Args: {
    onSelectDefinition?: (newUrl: URL | undefined) => void;
    url?: URL | undefined;
  };
  Blocks: {
    default: [];
  };
}

class Clickable extends Component<ClickableSignature> {
  @action
  handleClick() {
    if (this.args.onSelectDefinition && this.args.url) {
      this.args.onSelectDefinition(this.args.url);
    }
  }
  <template>
    <button
      type='button'
      {{on 'click' this.handleClick}}
      class='clickable-button'
      ...attributes
    >
      {{yield}}
    </button>
    <style>
      .clickable-button {
        background: none;
        border: none;
        padding: 0;
        margin: 0;
        cursor: pointer;
        width: 100%;
        height: 100%;
        appearance: none;
        -webkit-appearance: none;
        -moz-appearance: none;
        border-radius: var(--boxel-border-radius);
        text-align: inherit;
      }

      .clickable-button:hover {
        outline: 2px solid var(--boxel-highlight);
      }
    </style>
  </template>
}
