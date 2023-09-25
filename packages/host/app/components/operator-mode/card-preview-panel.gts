import { fn, array } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';

import { Tooltip, IconButton, BoxelDropdown } from '@cardstack/boxel-ui';

import BoxelMenu from '@cardstack/boxel-ui/components/menu';

import menuItem from '@cardstack/boxel-ui/helpers/menu-item';

import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';

import { cardTypeDisplayName } from '@cardstack/runtime-common';

import Preview from '@cardstack/host/components/preview';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';

interface Signature {
  Element: HTMLElement;
  Args: {
    card: CardDef;
    realmIconURL: string | null | undefined;
  };
  Blocks: {};
}

export default class CardPreviewPanel extends Component<Signature> {
  copyToClipboard = task(async () => {
    await navigator.clipboard.writeText(this.args.card.id);
  });

  @tracked previewFormat: Format = 'isolated';

  @action setPreviewFormat(format: Format) {
    this.previewFormat = format;
  }

  <template>
    <div
      class='preview-header'
      data-test-code-mode-card-preview-header
      ...attributes
    >
      <div class='header-icon'>
        <img src={{@realmIconURL}} alt='Realm icon' />
      </div>
      <div class='header-title'>
        {{cardTypeDisplayName @card}}
      </div>
      <div class='header-actions'>
        <BoxelDropdown class='card-options'>
          <:trigger as |bindings|>
            <Tooltip @placement='top'>
              <:trigger>
                <IconButton
                  @icon='three-dots-horizontal'
                  @width='20px'
                  @height='20px'
                  class='icon-button'
                  aria-label='Options'
                  data-test-more-options-button
                  {{bindings}}
                />
              </:trigger>
              <:content>
                More Options
              </:content>
            </Tooltip>
          </:trigger>
          <:content as |dd|>
            <BoxelMenu
              @closeMenu={{dd.close}}
              @items={{array
                (menuItem
                  'Copy Card URL'
                  (perform this.copyToClipboard)
                  icon='icon-link'
                )
              }}
            />
          </:content>
        </BoxelDropdown>
      </div>
    </div>

    <div class='preview-body' data-test-code-mode-card-preview-body>
      <Preview @card={{@card}} @format={{this.previewFormat}} />
    </div>

    <div class='preview-footer' data-test-code-mode-card-preview-footer>
      <div class='footer-buttons'>
        <button
          class='footer-button
            {{if (eq this.previewFormat "isolated") "active"}}'
          {{on 'click' (fn this.setPreviewFormat 'isolated')}}
          data-test-preview-card-footer-button-isolated
        >Isolated</button>
        <button
          class='footer-button
            {{if (eq this.previewFormat "embedded") "active"}}'
          {{on 'click' (fn this.setPreviewFormat 'embedded')}}
          data-test-preview-card-footer-button-embedded
        >
          Embedded</button>
        <button
          class='footer-button {{if (eq this.previewFormat "edit") "active"}}'
          {{on 'click' (fn this.setPreviewFormat 'edit')}}
          data-test-preview-card-footer-button-edit
        >Edit</button>
      </div>
    </div>

    <style>
      :global(:root) {
        --code-mode-preview-footer-height: 70px;
        --code-mode-preview-header-height: 70px;
      }

      .preview-header {
        background: white;
        height: var(--code-mode-preview-header-height);
        border-top-left-radius: var(--boxel-border-radius);
        border-top-right-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-lg);
        display: flex;
      }

      .header-icon > img {
        height: 25px;
        width: 25px;
      }

      .header-icon {
        margin-right: var(--boxel-sp-xxs);
      }

      .preview-body {
        height: calc(
          100% - var(--code-mode-preview-footer-height) -
            var(--code-mode-preview-header-height)
        );
        overflow-y: auto;
      }

      .header-actions {
        margin-left: auto;
      }

      .preview-body > :deep(.boxel-card-container) {
        border-radius: 0;
        box-shadow: none;
      }

      .header-title {
        font-weight: 600;
        font-size: 1.2rem;
      }

      .preview-footer {
        bottom: 0;
        height: var(--code-mode-preview-footer-height);
        background-color: var(--boxel-200);
        border-bottom-left-radius: var(--boxel-border-radius);
        border-bottom-right-radius: var(--boxel-border-radius);
      }

      .footer-buttons {
        margin: auto;
        display: flex;
        gap: var(--boxel-sp-sm);
      }

      .footer-button {
        padding: var(--boxel-sp-xxxs) var(--boxel-sp-lg);
        font-weight: 600;
        background: transparent;
        color: var(--boxel-dark);
        border-radius: 6px;
        border: 1px solid var(--boxel-400);
      }

      .footer-button.active {
        background: #27232f;
        color: var(--boxel-teal);
      }

      .preview-footer {
        display: flex;
      }

      .icon-button {
        --icon-color: var(--boxel-highlight);
        --boxel-icon-button-width: 28px;
        --boxel-icon-button-height: 28px;
        border-radius: 4px;

        display: flex;
        align-items: center;
        justify-content: center;

        font: var(--boxel-font-sm);
        margin-left: var(--boxel-sp-xxxs);
        z-index: 1;
      }

      .icon-button:hover {
        --icon-color: var(--boxel-light);
        background-color: var(--boxel-highlight);
      }
    </style>
  </template>
}
