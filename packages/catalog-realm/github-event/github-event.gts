import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { JsonField } from 'https://cardstack.com/base/commands/search-card-result';

export class GithubEventCard extends CardDef {
  static displayName = 'GitHub Event';

  @field eventType = contains(StringField); // 'pull_request', 'check_run', etc.
  @field action = contains(StringField); // 'opened', 'completed', etc.
  @field prNumber = contains(NumberField);
  @field prUrl = contains(StringField);
  @field payload = contains(JsonField); // full raw payload
}
