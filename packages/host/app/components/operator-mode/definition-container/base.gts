import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';

import { service } from '@ember/service';
import Component from '@glimmer/component';

import {
  Button,
  CardContainer,
  Header,
  Label,
  RealmIcon,
} from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';
import type { Icon } from '@cardstack/boxel-ui/icons';

import type RealmService from '@cardstack/host/services/realm';

import type { ComponentLike } from '@glint/template';

interface BaseContainerHeaderSignature {
  Args: {
    title: string;
    isActive?: boolean;
  };
  Element: HTMLElement;
  Blocks: { default: [] };
}
const BaseContainerHeader: TemplateOnlyComponent<BaseContainerHeaderSignature> =
  <template>
    <Header
      @title={{@title}}
      @hasBackground={{true}}
      class={{cn 'base-container-header' is-active=@isActive}}
      ...attributes
    >
      <:detail>
        {{yield}}
      </:detail>
    </Header>
    <style scoped>
      .base-container-header {
        --boxel-header-min-height: 1.56rem;
        --boxel-header-font-weight: 500;
        --boxel-header-text-font: var(--boxel-font-xs);
        --boxel-header-padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        --boxel-header-text-transform: uppercase;
        --boxel-header-letter-spacing: var(--boxel-lsp-xl);
        --boxel-header-detail-max-width: none;
        --boxel-header-background-color: var(--boxel-100);
        --boxel-header-text-color: var(--boxel-dark);
        --boxel-header-detail-max-width: 100%;
        height: var(
          --base-container-header-height,
          var(--boxel-header-min-height)
        );
      }
      .base-container-header.is-active {
        --boxel-header-background-color: var(--boxel-highlight);
        --boxel-header-text-color: var(--boxel-dark);
      }
    </style>
  </template>;

interface BaseContainerSignature {
  Args: { isActive?: boolean };
  Element: HTMLElement;
  Blocks: { default: [ComponentLike<BaseContainerHeaderSignature>] };
}
export const BaseContainer: TemplateOnlyComponent<BaseContainerSignature> =
  <template>
    <CardContainer
      class={{cn 'base-container' is-active=@isActive}}
      ...attributes
    >
      {{yield (component BaseContainerHeader)}}
    </CardContainer>
    <style scoped>
      .base-container {
        border-radius: var(--code-mode-container-border-radius);
        overflow: hidden;
        overflow-wrap: break-word;
      }
      .base-container.is-active {
        box-shadow: var(--code-mode-active-box-shadow);
      }
    </style>
  </template>;

interface Action {
  label: string;
  handler: (args: any) => void | Promise<void>; // TODO: narrow this for each type of module
  icon: Icon;
}
export interface BaseArgs {
  title: string;
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

class BaseDefinitionContainer extends Component<BaseSignature> {
  @service private declare realm: RealmService;

  <template>
    <BaseContainer @isActive={{@isActive}} as |BaseHeader|>
      <BaseHeader
        @title={{@title}}
        @isActive={{@isActive}}
        data-test-definition-header
      >
        <div data-test-definition-file-extension>
          {{@fileExtension}}
        </div>
      </BaseHeader>
      <div class='content'>
        <div class='definition-info'>
          {{#if @fileURL}}
            {{#let (this.realm.info @fileURL) as |realmInfo|}}
              <div class='realm-info'>
                <RealmIcon class='realm-info-icon' @realmInfo={{realmInfo}} />
                <Label
                  class='realm-name'
                  data-test-definition-realm-name
                  @ellipsize={{true}}
                >in
                  {{realmInfo.name}}</Label>
              </div>
            {{/let}}
          {{/if}}
          <div data-test-definition-name class='definition-name'>{{@name}}</div>

        </div>
        {{#if @isActive}}
          {{yield to='activeContent'}}
        {{/if}}
      </div>
    </BaseContainer>

    <style scoped>
      .content {
        display: flex;
        flex-direction: column;
        padding: var(--boxel-sp-xs);
        gap: var(--boxel-sp-xs);
      }
      .realm-info {
        display: flex;
        justify-content: flex-start;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }
      .realm-info-icon {
        --boxel-realm-icon-border: none;
        --boxel-realm-icon-border-radius: var(
          --code-mode-realm-icon-border-radius
        );
        flex-shrink: 0;
        min-width: var(--code-mode-realm-icon-size);
        min-height: var(--code-mode-realm-icon-size);
      }
      .realm-name {
        --boxel-label-font: var(--boxel-font-xs);
      }
      .definition-info {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-5xs);
      }
      .definition-name {
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
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

const Active: TemplateOnlyComponent<ActiveSignature> = <template>
  <div class='action-buttons'>
    {{#each @actions as |actionButton|}}
      <Button
        data-test-action-button='{{actionButton.label}}'
        class='action-button'
        @size='extra-small'
        @kind='text-only'
        {{on 'click' actionButton.handler}}
      >
        <actionButton.icon width='13' height='13' />
        {{actionButton.label}}
      </Button>
    {{/each}}
  </div>
  <div class='info-footer' data-test-definition-info-text data-test-percy-hide>
    {{@infoText}}
  </div>
  <style scoped>
    .action-buttons {
      display: grid;
      grid-auto-columns: max-content;
      gap: var(--boxel-sp-5xs);
    }
    .action-button {
      --boxel-button-min-height: 1.5rem;
      --boxel-button-padding: 0 var(--boxel-sp-5xs);
      --boxel-button-font: 600 var(--boxel-font-xs);
      justify-content: flex-start;
      gap: var(--boxel-sp-xxxs);
      align-self: flex-start;
    }
    .info-footer {
      color: var(--boxel-450);
      font: var(--boxel-font-xs);
      letter-spacing: var(--boxel-lsp-sm);
    }
  </style>
</template>;

export { Active, BaseDefinitionContainer };
