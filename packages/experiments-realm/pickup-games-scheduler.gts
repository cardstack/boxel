import {
  contains,
  containsMany,
  field,
  linksToMany,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DateTimeField from 'https://cardstack.com/base/datetime';
import { format as formatDate } from 'date-fns';
import CalendarClockIcon from '@cardstack/boxel-icons/calendar-clock';

export class GameSlot extends CardDef {
  static displayName = 'Game Slot';
  static icon = CalendarClockIcon;
  @field location = contains(StringField);
  @field minPlayers = contains(NumberField);
  @field maxPlayers = contains(NumberField);
  @field startTime = contains(DateTimeField);
  @field endTime = contains(DateTimeField);
  @field players = containsMany(StringField);
  @field title = contains(StringField, {
    computeVia(this: GameSlot) {
      if (this.startTime) {
        let result = formatDate(this.startTime, 'iiii M/d h:mm aa');
        if (this.location) {
          result = result + ` (${this.location})`;
        }
        return result;
      }
      return 'Untitled';
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    get playerCount() {
      return this.args.model.players?.length ?? 0;
    }
    get hasEnoughPlayers() {
      return this.playerCount >= (this.args.model.minPlayers || 1);
    }
    <template>
      <div class={{if this.hasEnoughPlayers 'game-on' 'need-more'}}>
        <h3><@fields.title /></h3>
        <ul>
          {{#unless @fields.players.length}}
            <li><em>Nobody yet</em></li>
          {{/unless}}
          {{#each @fields.players as |Player|}}
            <li><Player /></li>
          {{/each}}
        </ul>
      </div>
      <style scoped>
        h3 {
          margin-top: 0;
        }
        .game-on {
          background-color: #d1ffbd;
        }
      </style>
    </template>
  };
}

export class PickupGamesScheduler extends CardDef {
  static displayName = 'Pickup Games Scheduler';
  static icon = CalendarClockIcon;
  @field gameSlots = linksToMany(GameSlot);
}
