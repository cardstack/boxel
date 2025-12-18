import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { CardHeader } from '@cardstack/boxel-ui/components';
import type { MenuItem } from '@cardstack/boxel-ui/helpers';
import { FileAlert, ExclamationCircle } from '@cardstack/boxel-ui/icons';

import type LoaderService from '@cardstack/host/services/loader-service';
import type { CardErrorJSONAPI } from '@cardstack/host/services/store';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import { htmlComponent } from '../../lib/html-component';

import CardErrorDetail from './card-error-detail';

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
        class='error-header'
        @cardTypeDisplayName='Card Error: {{this.errorTitle}}'
        @cardTypeIcon={{ExclamationCircle}}
        @isTopCard={{@headerOptions.isTopCard}}
        @moreOptionsMenuItems={{@headerOptions.moreOptionsMenuItems}}
        @onClose={{@headerOptions.onClose}}
        ...attributes
      />
    {{/unless}}

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
    <style scoped>
      .icon {
        height: 100px;
        width: 100px;
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
        color: var(--boxel-error-300);
        min-height: var(--boxel-form-control-height);
        background-color: var(--boxel-100);
        box-shadow: 0 1px 0 0 rgba(0 0 0 / 15%);
      }
      .error-header :deep(.actions) {
        color: var(--boxel-dark);
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

  @service private declare loaderService: LoaderService;

  private get id() {
    return this.args.error.id;
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
    let lastKnownGoodHtml = this.args.error?.meta.lastKnownGoodHtml;
    if (lastKnownGoodHtml) {
      this.loadScopedCSS.perform();
      return htmlComponent(lastKnownGoodHtml);
    }
    return undefined;
  }

  private loadScopedCSS = restartableTask(async () => {
    let scopedCssUrls = this.args.error?.meta.scopedCssUrls;
    if (scopedCssUrls) {
      await Promise.all(
        scopedCssUrls.map((cssModuleUrl) =>
          this.loaderService.loader.import(cssModuleUrl),
        ),
      );
    }
  });
}
