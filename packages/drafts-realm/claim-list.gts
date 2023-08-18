import { FieldContainer, GridContainer } from '@cardstack/boxel-ui';
import {
  contains,
  linksToMany,
  field,
  Card,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import { Claim } from './claim';

export class ClaimList extends Card {
  static displayName = 'List of Claims';
  @field description = contains(StringCard);
  @field claims = linksToMany(Claim);
  @field title = contains(StringCard, {
    computeVia: function (this: ClaimList) {
      return this.constructor.displayName;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    get numberOfClaimed() {
      if (!this.args.model.claims) {
        return 0;
      }
      return this.args.model.claims?.filter((o) => o.hasBeenClaimed).length;
    }
    get numberOfUnclaimed() {
      if (!this.args.model.claims) {
        return 0;
      }
      return this.args.model.claims?.filter((o) => !o.hasBeenClaimed).length;
    }
    <template>
      <GridContainer>
        <h2><@fields.description /></h2>
        <FieldContainer @label='Number Claims:'>
          {{@model.claims.length}}
        </FieldContainer>
        <FieldContainer @label='Number Claimed'>
          {{this.numberOfClaimed}}
        </FieldContainer>
        <FieldContainer @label='Number Unclaimed'>
          {{this.numberOfUnclaimed}}
        </FieldContainer>
      </GridContainer>
    </template>
  };
}
