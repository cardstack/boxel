import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { restartableTask } from 'ember-concurrency';
import debounce from 'lodash/debounce';
import type CardService from '../services/card-service';
import type LoaderService from '../services/loader-service';
import { BoxelInputValidationState } from '@cardstack/boxel-ui';
import { type InputValidationState } from '@cardstack/boxel-ui/components/input/validation-state';
import {
  isSingleCardDocument,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type { CardDef } from 'https://cardstack.com/base/card-api';

interface Signature {
  cardURL: string;
  setCardURL: (cardURL: string) => void;
  setSelectedCard: (card: CardDef) => void;
}

export default class UrlSearch extends Component<Signature> {
  <template>
    <label class='url-search'>
      <span>Enter Card URL:</span>
      <BoxelInputValidationState
        data-test-url-field
        placeholder='https://'
        @value={{this.cardURL}}
        @onInput={{this.setCardURL}}
        @onKeyPress={{this.onURLFieldKeypress}}
        @state={{this.cardURLFieldState}}
        @errorMessage={{this.cardURLErrorMessage}}
        data-test-url-search
      />
    </label>
    <style>
      .url-search {
        flex-grow: 0.5;
        display: grid;
        grid-template-columns: auto 1fr;
        justify-items: flex-start;
        gap: var(--boxel-sp-xs);
      }
      .url-search > span {
        padding-top: var(--boxel-sp-xxs);
        font: 700 var(--boxel-font-sm);
      }
    </style>
  </template>

  @tracked hasCardURLError = false;
  @service declare cardService: CardService;
  @service declare loaderService: LoaderService;

  get cardURL() {
    return this.args.cardURL;
  }

  get displayErrorState() {
    return this.hasCardURLError && this.cardURL;
  }

  get cardURLErrorMessage() {
    return this.displayErrorState ? 'Not a valid Card URL' : undefined;
  }

  get cardURLFieldState(): InputValidationState {
    return this.displayErrorState ? 'invalid' : 'initial';
  }

  @action
  setCardURL(cardURL: string) {
    this.hasCardURLError = false;
    this.args.setCardURL(cardURL);
    this.debouncedURLFieldUpdate();
  }

  @action
  onURLFieldUpdated() {
    if (this.cardURL) {
      this.getCard.perform(this.cardURL);
    }
  }

  @action
  onURLFieldKeypress(e: KeyboardEvent) {
    if (e.key === 'Enter' && this.cardURL) {
      this.getCard.perform(this.cardURL);
    }
  }

  private getCard = restartableTask(async (searchKey: string) => {
    let search = searchKey.replace(/\.json$/, '');
    let response = await this.loaderService.loader.fetch(search, {
      headers: { Accept: SupportedMimeType.CardJson },
    });
    if (response.ok) {
      let maybeCardDoc = await response.json();
      if (isSingleCardDocument(maybeCardDoc)) {
        let selectedCard = await this.cardService.createFromSerialized(
          maybeCardDoc.data,
          maybeCardDoc,
          new URL(maybeCardDoc.data.id),
        );
        this.args.setSelectedCard(selectedCard);
        return;
      }
    }
    this.hasCardURLError = true;
  });

  debouncedURLFieldUpdate = debounce(() => {
    if (!this.cardURL) {
      return;
    }
    try {
      new URL(this.cardURL);
    } catch (e: any) {
      if (e instanceof TypeError && e.message.includes('Invalid URL')) {
        this.hasCardURLError = true;
        return;
      }
      throw e;
    }
    this.onURLFieldUpdated();
  }, 500);
}
