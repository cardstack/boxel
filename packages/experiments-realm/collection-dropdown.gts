import { type CardContext } from 'https://cardstack.com/base/card-api';

import GlimmerComponent from '@glimmer/component';
import {
  CodeRef,
  Query,
  ResolvedCodeRef,
  getCard,
} from '@cardstack/runtime-common';

import { action } from '@ember/object';
import { restartableTask } from 'ember-concurrency';
import { BoxelInput, BoxelSelect } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { FiltersToQuery } from './collection';
import { on } from '@ember/modifier';

export class DropdownMenu extends GlimmerComponent<{
  Args: {
    filter: FiltersToQuery;
    context?: CardContext;
    query?: Query;
    model?: any;
    currentRealm?: URL;
    onSelect?: (value: any, fieldName?: string, innerName?: string) => void;
    toggleActive: (key: string) => void;
  };
  Element: HTMLElement;
}> {
  <template>
    {{#let
      (component @context.prerenderedCardSearchComponent)
      as |PrerenderedCardSearch|
    }}
      <PrerenderedCardSearch
        @query={{this.query}}
        @format='atom'
        @realms={{this.realms}}
      >

        <:loading>
          Loading...
        </:loading>
        <:response as |cards|>

          <h4>{{@filter.name}}.{{@filter.innerName}}</h4>

          <button type='button' {{on 'click' this.toggleActive}}>
            Toggle active
          </button>
          <div>
            <BoxelSelect
              @options={{cards}}
              @onChange={{this.onSelect}}
              @selected={{this.selected}}
              @placeholder={{'Select Item'}}
              as |item|
            >
              {{#let (component item.component) as |Component|}}
                <Component />
              {{/let}}
            </BoxelSelect>
          </div>
        </:response>
      </PrerenderedCardSearch>
    {{/let}}
    <style></style>
  </template>

  @tracked selected: any = null; //state for selection
  @action onSelect(selection: any) {
    debugger;
    this.selected = selection;
    console.log('===');
    console.log(this.selected);
    this.args.onSelect?.(
      selection,
      this.args.filter?.name,
      this.args.filter?.innerName,
    );
  }

  @action toggleActive() {
    let key = this.args.filter?.name + '.' + this.args.filter?.innerName;
    this.args.toggleActive(key);
  }

  // selecting a links to card
  private selectCard = restartableTask(async (id: string) => {
    //chosenCard
    let url = new URL(id);
    let cardResource = await getCard(url);
    await cardResource.loaded;
    let card = cardResource.card;
    //#Pattern2: Linking card
    //im not sure if this is the right way to do this
    let currentCardList = this.args.model['cardsList'] ?? [];
    if (card) {
      let newCardList = [...currentCardList, card];
      this.args.model['cardsList'] = newCardList;
    }

    // this.args.model;
    // this.args.fields;
  });

  get query() {
    return {
      filter: {
        every: [
          {
            ...{
              type: this.args.filter.codeRef,
            },
          },
          ,
        ],
      },
    };
  }

  get realms() {
    return ['http://localhost:4201/experiments/'];
  }
}
