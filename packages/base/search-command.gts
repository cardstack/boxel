import {
  ResolvedCodeRef,
  codeRefWithAbsoluteURL,
  getCards,
  isResolvedCodeRef,
} from '@cardstack/runtime-common';
import { CardTypeFilter, Query } from '@cardstack/runtime-common/query';
import { CommandField } from './command';
import { Component } from './card-api';
import { on } from '@ember/modifier';
import { Button } from '@cardstack/boxel-ui/components';
import { task } from 'ember-concurrency';
import { not } from '@cardstack/boxel-ui/helpers';

export type SearchObject = {
  search: {
    card_id: string; //we search relative to the card that is shared
    filter: CardTypeFilter; //TODO: can be enhanced by other filter types
  };
};

export interface SearchCardPayload {
  type: 'searchCard';
  payload: SearchObject;
  eventId: string;
}

class EmbeddedView extends Component<typeof CommandField> {
  get queryArgs() {
    let query = (this.args.model.payload as SearchObject).search;
    let codeRef = query.filter.type;
    if (!isResolvedCodeRef(codeRef)) {
      return {};
    }
    let adoptsFrom: ResolvedCodeRef = {
      name: codeRef.name,
      module: codeRef.module,
    };
    //If ai returns a relative module path, we make it absolute
    let maybeCodeRef = codeRefWithAbsoluteURL(
      adoptsFrom,
      new URL(query.card_id), //relative to the attached card id shared
    );
    if ('name' in maybeCodeRef && 'module' in maybeCodeRef) {
      query.filter.type = maybeCodeRef;
    }
    return {
      filter: { type: query.filter.type },
    } as Query;
  }
  cardSearchResource = getCards(this.queryArgs);

  apply = task(async () => {
    await this.cardSearchResource.loaded;
    this.args.model.result = this.cardSearchResource.instances.map(
      (card) => card.id,
    );
  });

  <template>
    <div class='embedded-command'>
      <h3>{{this.args.model.commandType}} command</h3>
      {{#if this.apply.isRunning}}
        ...Loading
      {{else}}
        <@fields.result @format='embedded' />
      {{/if}}
      {{#if (not this.args.model.result)}}
        <Button {{on 'click' this.apply.perform}}>Apply</Button>
      {{/if}}
    </div>
    <style>
      .embedded-command {
        border: 2px solid white;
        border-radius: 10px; /* Adjust the radius as needed */
      }
    </style>
  </template>
}

export class SearchCommandField extends CommandField {
  static embedded = EmbeddedView;
}
