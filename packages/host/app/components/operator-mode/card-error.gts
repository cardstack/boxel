import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { CardHeader, LoadingIndicator } from '@cardstack/boxel-ui/components';
import type { MenuItem } from '@cardstack/boxel-ui/helpers';
import { FileAlert, ExclamationCircle } from '@cardstack/boxel-ui/icons';

import type LoaderService from '@cardstack/host/services/loader-service';
import type { CardErrorJSONAPI } from '@cardstack/host/services/store';

import { htmlComponent } from '../../lib/html-component';

import CardErrorDetail from './card-error-detail';

import type { FileDef } from '@cardstack/base/file-api';

interface Signature {
  Args: {
    error: CardErrorJSONAPI;
    cardCreationError?: boolean;
    viewInCodeMode?: boolean;
    title?: string;
    hideHeader?: boolean;
    headerOptions?: {
      isTopCard?: boolean;
      moreOptionsMenuItems?: MenuItem[];
      onClose?: () => void;
    };
    fileToFixWithAi?: FileDef;
    message?: string;
  };
  Element: HTMLElement;
  Blocks: {
    error: [];
  };
}

export default class CardErrorComponent extends Component<Signature> {
  <template>
    {{#unless @hideHeader}}
      <CardHeader
        {{! `error-header` is the structural hook consumers style (e.g. the
            module inspector stretches it to full width), so it stays on in
            both states; `pending` only restyles it. }}
        class='error-header {{if this.isAwaitingIndex "pending"}}'
        @cardTypeDisplayName={{this.headerDisplayName}}
        @cardTypeIcon={{if
          this.isAwaitingIndex
          LoadingIndicator
          ExclamationCircle
        }}
        @isTopCard={{@headerOptions.isTopCard}}
        @moreOptionsMenuItems={{@headerOptions.moreOptionsMenuItems}}
        @onClose={{@headerOptions.onClose}}
        ...attributes
      />
    {{/unless}}

    {{#if this.isAwaitingIndex}}
      {{! A live region: the placeholder promises the card will appear on its
          own, so its arrival has to be announced rather than only drawn. }}
      <div
        class='card-pending'
        role='status'
        aria-live='polite'
        data-test-card-awaiting-index={{this.id}}
      >
        <LoadingIndicator class='pending-icon' />
        <div class='pending-message'>
          <p class='pending-headline'>Preparing this card</p>
          <p class='pending-detail'>
            The workspace has the file and is still getting the card ready. It
            will appear here on its own once that finishes.
          </p>
        </div>
      </div>
    {{else}}
      <div class='card-error' data-test-card-error={{this.id}}>
        {{#if this.lastKnownGoodHtml}}
          <this.lastKnownGoodHtml />
        {{else}}
          <div class='card-error-default'>
            <FileAlert class='icon' />
            <div class='message'>
              {{#if @message}}
                {{@message}}
              {{else if @cardCreationError}}
                Failed to create card.
              {{else}}
                This card contains an error.
              {{/if}}
            </div>
          </div>
        {{/if}}
      </div>
      <CardErrorDetail
        @error={{@error}}
        @title={{this.errorTitle}}
        @viewInCodeMode={{@viewInCodeMode}}
        @fileToFixWithAi={{@fileToFixWithAi}}
        class='card-error-detail'
      >
        <:error>
          {{yield to='error'}}
        </:error>
      </CardErrorDetail>
    {{/if}}
    <style scoped>
      .icon {
        height: 100px;
        width: 100px;
      }
      .card-pending {
        display: flex;
        flex: 1;
        height: 100%;
        align-content: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp);
      }
      .pending-icon {
        --boxel-loading-indicator-size: 60px;
        color: var(--boxel-400);
      }
      .pending-message {
        width: 100%;
        text-align: center;
        text-wrap: pretty;
      }
      .pending-headline {
        margin: 0;
        font: 600 var(--boxel-font);
      }
      .pending-detail {
        margin: var(--boxel-sp-xxs) auto 0;
        max-width: 40ch;
        color: var(--boxel-450);
        font: var(--boxel-font-sm);
      }
      .error-header.pending {
        min-height: var(--boxel-form-control-height);
        background-color: var(--boxel-100);
        box-shadow: 0 1px 0 0 rgba(0 0 0 / 15%);
      }
      /* The consumer sets --boxel-card-header-text-color from the realm's own
         colour — white for a dark realm — which says nothing about the grey
         painted above. Name a colour that belongs to this background, the way
         the error state names its own. */
      .error-header.pending :deep(.card-type-display-name),
      .error-header.pending :deep(.boxel-loading-indicator) {
        color: var(--boxel-dark);
      }
      .card-error-default {
        display: flex;
        height: 100%;
        align-content: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp);
      }
      .card-error {
        flex: 1;
        opacity: 0.4;
        border-radius: 0;
        box-shadow: none;
        overflow-y: auto;
      }
      .message {
        width: 100%;
        text-align: center;
        font: 600 var(--boxel-font);
        text-wrap: pretty;
      }
      .error-header {
        min-height: var(--boxel-form-control-height);
        background-color: var(--boxel-100);
        box-shadow: 0 1px 0 0 rgba(0 0 0 / 15%);
      }
      .error-header :deep(.card-type-display-name) {
        color: var(--boxel-error-300);
      }
      .card-error-detail {
        position: absolute;
        bottom: var(--boxel-sp);
        left: var(--boxel-sp);
        right: var(--boxel-sp);
        max-height: calc(
          100% -
            calc(
              calc(var(--boxel-sp) * 2) +
                var(
                  --card-error-header-height,
                  var(--boxel-form-control-height)
                )
            )
        );
        z-index: 10;
        margin: 0;
      }
    </style>
  </template>

  @service declare private loaderService: LoaderService;

  private get id() {
    return this.args.error.id;
  }

  // The realm answers a card+json read for an instance whose source it holds
  // but has not indexed yet with a 404 carrying this marker. Nothing is wrong
  // with the card — the indexing pass the write kicked off just hasn't landed —
  // and the store reloads the instance when the realm broadcasts the index
  // event for it, so this stands in until the real card takes over rather than
  // reporting a card that isn't there.
  private get isAwaitingIndex() {
    return this.args.error.awaitingIndex === true;
  }

  private get headerDisplayName() {
    return this.isAwaitingIndex
      ? 'Preparing Card'
      : `Card Error: ${this.errorTitle}`;
  }

  private get errorTitle() {
    if (this.args.title) {
      return this.args.title;
    }
    return this.args.error.status === 404 &&
      // a missing link error looks a lot like a missing card error
      this.args.error.message?.includes('missing')
      ? `Link Not Found`
      : this.args.error.title;
  }

  @cached
  get lastKnownGoodHtml() {
    let lastKnownGoodHtml = this.args.error?.meta?.lastKnownGoodHtml;
    if (lastKnownGoodHtml) {
      this.loadScopedCSS.perform();
      return htmlComponent(lastKnownGoodHtml);
    }
    return undefined;
  }

  private loadScopedCSS = restartableTask(async () => {
    let scopedCssUrls = this.args.error?.meta?.scopedCssUrls;
    if (scopedCssUrls) {
      await Promise.all(
        scopedCssUrls.map((cssModuleUrl) =>
          this.loaderService.loader.import(cssModuleUrl),
        ),
      );
    }
  });
}
