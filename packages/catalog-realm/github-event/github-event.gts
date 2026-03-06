import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { JsonField } from 'https://cardstack.com/base/commands/search-card-result';

export class GithubEventCard extends CardDef {
  static displayName = 'GitHub Event';

  @field eventType = contains(StringField); // 'pull_request', 'check_run', etc.
  @field payload = contains(JsonField); // full raw payload

  @field action = contains(StringField, {
    computeVia: function (this: GithubEventCard) {
      return this.payload?.action ?? null;
    },
  });

  @field prNumber = contains(NumberField, {
    computeVia: function (this: GithubEventCard) {
      const isCheckRunEvent = this.payload?.check_run !== undefined;
      return isCheckRunEvent
        ? this.payload?.check_run?.pull_requests?.[0].number
        : (this.payload?.pull_request?.number ?? null);
    },
  });

  @field prUrl = contains(StringField, {
    computeVia: function (this: GithubEventCard) {
      const isCheckRunEvent = this.payload?.check_run !== undefined;
      return isCheckRunEvent
        ? this.payload?.check_run?.pull_requests?.[0].url
        : (this.payload?.pull_request?.html_url ?? null);
    },
  });
}
