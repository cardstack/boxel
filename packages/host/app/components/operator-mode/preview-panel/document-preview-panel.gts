import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import {
  BoxelButton,
  CardContainer,
  CardHeader,
} from '@cardstack/boxel-ui/components';
import { eq, or } from '@cardstack/boxel-ui/helpers';
import { Eye, IconCode } from '@cardstack/boxel-ui/icons';

import {
  cardDefFormats,
  rri,
  type BoxelDescription,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import BoxelDocumentRenderer from '@cardstack/host/components/boxel-document-renderer';
import FormatChooser from '@cardstack/host/components/operator-mode/code-submode/format-chooser';
import type NetworkService from '@cardstack/host/services/network';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';

import type { Format, ViewCardFn } from '@cardstack/base/card-api';

interface Signature {
  Args: {
    document: LooseSingleCardDocument;
    cardURL: string;
    format?: Format;
    setFormat: (format: Format) => void;
    viewCard?: ViewCardFn;
  };
  Element: HTMLElement;
}

/**
 * Code-mode preview for an inert card document.
 *
 * The executable definition stays owned by Direct or the Sandbox child. The
 * Host receives only the cloneable type description needed for its controls;
 * it never asks the Store or Host Loader to materialize authored code.
 */
export default class DocumentPreviewPanel extends Component<Signature> {
  @service declare private network: NetworkService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: RealmService;

  @tracked private description: BoxelDescription | undefined;

  private get availableFormats(): Format[] {
    let described = this.description?.formats
      .map(({ format }) => format)
      .filter((format): format is Format =>
        cardDefFormats.includes(format as Format),
      );
    return described?.length ? described : cardDefFormats;
  }

  private get format(): Format {
    let format = this.args.format ?? 'isolated';
    return this.availableFormats.includes(format) ? format : 'isolated';
  }

  private get displayName(): string {
    if (this.args.cardURL.endsWith('/index')) {
      return 'Workspace';
    }
    return (
      this.description?.presentation.displayName ??
      this.adoptsFromName ??
      'Card'
    );
  }

  private get title(): string {
    let attributes = this.args.document.data?.attributes;
    if (attributes) {
      for (let key of ['cardTitle', 'title', 'name', 'label']) {
        let value = attributes[key];
        if (typeof value === 'string' && value.trim()) {
          return value;
        }
      }
    }
    return this.displayName;
  }

  private get adoptsFrom() {
    return this.args.document.data?.meta?.adoptsFrom;
  }

  private get adoptsFromName(): string | undefined {
    let adoptsFrom = this.adoptsFrom;
    return adoptsFrom && 'name' in adoptsFrom ? adoptsFrom.name : undefined;
  }

  private get realmInfo() {
    return this.realm.info(this.args.cardURL);
  }

  private get canEdit(): boolean {
    return this.format !== 'edit' && this.realm.canWrite(this.args.cardURL);
  }

  private openInInteractMode = () => {
    this.operatorModeStateService.openCardInInteractMode(
      this.args.cardURL,
      'isolated',
      'card',
    );
  };

  private editTemplate = () => {
    let adoptsFrom = this.adoptsFrom;
    if (!adoptsFrom || !('module' in adoptsFrom)) {
      return;
    }
    let moduleRef = adoptsFrom.module.endsWith('.gts')
      ? adoptsFrom.module
      : `${adoptsFrom.module}.gts`;
    let moduleURL = this.network.virtualNetwork.toURL(
      this.network.virtualNetwork.resolveRRI(moduleRef, rri(this.args.cardURL)),
    );
    this.operatorModeStateService.updateCodePath(moduleURL);
  };

  @action private receiveDescription(description: BoxelDescription): void {
    this.description = description;
  }

  <template>
    <div class='preview-buttons'>
      <BoxelButton
        @kind='secondary-light'
        @size='small'
        {{on 'click' this.editTemplate}}
        data-test-edit-template-button
      >
        <IconCode class='button-icon' />
        Edit Template
      </BoxelButton>

      <span class='preview-text'>Preview</span>

      <BoxelButton
        @kind='secondary-light'
        @size='small'
        {{on 'click' this.openInInteractMode}}
        data-test-open-in-interact-button
      >
        <Eye class='button-icon' />
        Open in Interact
      </BoxelButton>
    </div>

    <div class='card-renderer-body' data-test-code-mode-card-renderer-body>
      <div class='card-renderer-content'>
        {{#if (or (eq this.format 'isolated') (eq this.format 'edit'))}}
          <CardContainer class='full-height-preview'>
            <CardHeader
              class='card-renderer-header'
              @cardTypeDisplayName={{this.displayName}}
              @cardTitle={{this.title}}
              @realmInfo={{this.realmInfo}}
              @onEdit={{if this.canEdit (fn @setFormat 'edit')}}
              @onFinishEditing={{if
                (eq this.format 'edit')
                (fn @setFormat 'isolated')
              }}
              @isTopCard={{true}}
              data-test-code-mode-card-renderer-header={{@cardURL}}
            />
            <BoxelDocumentRenderer
              class='preview'
              @document={{@document}}
              @relativeTo={{@cardURL}}
              @format={{this.format}}
              {{! Code mode scrolls around the card but does not allocate the
                  card's own height. Let the child report intrinsic height. }}
              @hostOwnsBox={{false}}
              @viewCard={{@viewCard}}
              @onDescription={{this.receiveDescription}}
              data-test-card-resource-loaded
            />
          </CardContainer>
        {{else if (eq this.format 'atom')}}
          <div class='atom-preview-container' data-test-atom-preview>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
            <BoxelDocumentRenderer
              class='atom-preview'
              @document={{@document}}
              @relativeTo={{@cardURL}}
              @format={{this.format}}
              @hostOwnsBox={{false}}
              @viewCard={{@viewCard}}
              @onDescription={{this.receiveDescription}}
            />
            tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim
            veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex
            ea commodo consequat.
          </div>
        {{else}}
          <CardContainer class='preview-container'>
            <BoxelDocumentRenderer
              class='preview'
              @document={{@document}}
              @relativeTo={{@cardURL}}
              @format={{this.format}}
              @hostOwnsBox={{false}}
              @viewCard={{@viewCard}}
              @onDescription={{this.receiveDescription}}
            />
          </CardContainer>
        {{/if}}
      </div>
    </div>

    <div class='card-renderer-format-chooser-container'>
      <FormatChooser
        class='card-renderer-format-chooser'
        @format={{this.format}}
        @setFormat={{@setFormat}}
        @formats={{this.availableFormats}}
      />
    </div>

    <style scoped>
      .preview-buttons {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--boxel-sp-xs) 0;
        background-color: #75707e;
      }
      .preview-text {
        color: var(--boxel-light);
        font: 600 var(--boxel-font-sm);
        letter-spacing: 0.13px;
      }
      .button-icon {
        width: 1rem;
        height: 1rem;
        margin-right: var(--boxel-sp-xxs);
        --icon-color: var(--boxel-teal);
      }
      .preview-buttons :deep(.boxel-button) {
        color: var(--boxel-light);
        font: 500 var(--boxel-font-xs);
        letter-spacing: 0.17px;
        border: none;
        min-height: 1.1875rem;
        min-width: fit-content;
        padding: 0 var(--boxel-sp-xs);
      }
      .card-renderer-body {
        flex-grow: 1;
        overflow-y: auto;
        padding-bottom: calc(
          var(--operator-mode-spacing) * 2 + var(--container-button-size)
        );
        z-index: 0;
      }
      .card-renderer-content,
      .preview-container {
        height: auto;
      }
      .full-height-preview {
        flex-grow: 1;
        min-width: 0;
      }
      .card-renderer-header {
        min-height: max-content;
        box-shadow: 0 1px 0 0 rgba(0 0 0 / 15%);
        z-index: 1;
      }
      .card-renderer-header:not(.is-editing) {
        background-color: var(--boxel-100);
      }
      .preview {
        box-shadow: none;
        border-radius: 0;
      }
      .atom-preview-container {
        color: #c7c7c7;
        font: 500 var(--boxel-font-sm);
        line-height: 2.15;
        letter-spacing: 0.13px;
      }
      .atom-preview {
        display: inline;
      }
      .card-renderer-format-chooser-container {
        position: absolute;
        bottom: var(--operator-mode-spacing);
        left: 0;
        right: 0;
        display: flex;
        justify-content: center;
        padding: 0 var(--operator-mode-spacing);
        padding-right: calc(
          var(--operator-mode-spacing) * 2 + var(--container-button-size)
        );
      }
      .card-renderer-format-chooser {
        --boxel-format-chooser-border-color: var(--boxel-400);
        margin: 0;
        max-width: 100%;
        box-shadow: none;
        border-radius: var(--boxel-border-radius-2xl);
      }
    </style>
  </template>
}
