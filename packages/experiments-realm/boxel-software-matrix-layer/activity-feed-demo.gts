import {
  CardDef,
  Component,
  field,
  linksToMany,
} from '@cardstack/base/card-api';
import RssIcon from '@cardstack/boxel-icons/rss';

import { Activity } from './activity';
import { ActivityFeed } from './components/activity-feed';

// Usage page for the ActivityFeed block: real Activity cards rendered as a
// stream, newest first, with a status change shown as a system rule.
export class ActivityFeedDemo extends CardDef {
  static displayName = 'Activity Feed Demo';
  static icon = RssIcon;

  @field records = linksToMany(() => Activity);

  static isolated = class Isolated extends Component<typeof ActivityFeedDemo> {
    <template>
      <div class='demo'>
        <ActivityFeed @activities={{@model.records}} />
      </div>
      <style scoped>
        .demo {
          max-width: 40rem;
          margin: 0 auto;
          padding: 1.5rem 1rem;
        }
      </style>
    </template>
  };
}
