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

  @field branchName = contains(StringField, {
    computeVia: function (this: GithubEventCard) {
      if (this.payload?.pull_request !== undefined) {
        return this.payload?.pull_request?.head?.ref ?? null;
      }
      if (this.payload?.check_run !== undefined) {
        return this.payload?.check_run?.check_suite?.head_branch ?? null;
      }
      if (this.payload?.check_suite !== undefined) {
        return this.payload?.check_suite?.head_branch ?? null;
      }
      if (this.payload?.review !== undefined) {
        return this.payload?.pull_request?.head?.ref ?? null;
      }
      return null;
    },
  });
}
