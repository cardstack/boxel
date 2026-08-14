import { contains, field, StringField } from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import enumField from '@cardstack/base/enum';
import BallFootballIcon from '@cardstack/boxel-icons/ball-football';

import { Event } from '../event';

export const HomeAwayField = enumField(StringField, {
  displayName: 'Home / Away',
  options: [
    { value: 'Home', label: 'Home' },
    { value: 'Away', label: 'Away' },
  ],
});

export const CompetitionField = enumField(StringField, {
  displayName: 'Competition',
  options: ['League', 'Cup', 'Friendly'],
});

/**
 * A fixture IS an Event — the club adds who we play, where we stand in the
 * tie, and the ops-maintained sales tally. `capacity` (the ceiling and its
 * allocations), venue, kickoff and status are consumed unchanged from the
 * block.
 *
 * `ticketsSold` is the box office's own running total (it includes season
 * tickets and sales outside this system), which is why it is a stored
 * baseline the ops team maintains rather than a count of Booking cards.
 */
export class Match extends Event {
  static displayName = 'Match';
  static icon = BallFootballIcon;

  @field opponent = contains(StringField);
  @field homeAway = contains(HomeAwayField);
  @field competition = contains(CompetitionField);
  @field ticketsSold = contains(NumberField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Match) {
      if (this.opponent?.trim()?.length) {
        return `${this.homeAway === 'Away' ? 'at' : 'v'} ${this.opponent}`;
      }
      return this.title?.trim()?.length ? this.title : 'Untitled Match';
    },
  });
}
