import { CardDef, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import {
  instance,
  operation,
  params,
  type OperationDeclaration,
} from '@cardstack/base/operations';

// A Slack channel the team reads. Posting a message sends the message to
// everyone in the channel, with the invoking user's own Slack token.
export class SlackChannel extends CardDef {
  static displayName = 'Slack Channel';
  @field name = contains(StringField);
  @field channelId = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: SlackChannel) {
      return this.name ? `#${this.name}` : 'Slack channel';
    },
  });

  @operation static postMessage = {
    base: 'callApi',
    label: 'Post a message to this Slack channel, with your Slack token',
    params: { text: StringField },
    url: 'https://slack.com/api/chat.postMessage',
    headers: { authorization: 'Bearer {{userKey}}' },
    json: { channel: instance('channelId'), text: params('text') },
  } satisfies OperationDeclaration;
}
