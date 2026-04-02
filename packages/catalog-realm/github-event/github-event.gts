import { CardDef, field, contains } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import { JsonField } from '@cardstack/base/commands/search-card-result';

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
      if (this.payload?.check_run !== undefined) {
        return this.payload?.check_run?.pull_requests?.[0]?.number ?? null;
      }
      if (this.payload?.check_suite !== undefined) {
        return this.payload?.check_suite?.pull_requests?.[0]?.number ?? null;
      }
      return this.payload?.pull_request?.number ?? null;
    },
  });

  @field prUrl = contains(StringField, {
    computeVia: function (this: GithubEventCard) {
      if (this.payload?.check_run !== undefined) {
        return this.payload?.check_run?.pull_requests?.[0]?.url ?? null;
      }
      if (this.payload?.check_suite !== undefined) {
        return this.payload?.check_suite?.pull_requests?.[0]?.url ?? null;
      }
      return this.payload?.pull_request?.html_url ?? null;
    },
  });
}
