import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  linksTo,
} from '../card-api';
import BooleanField from '../boolean';

import IconTerminal2 from '@cardstack/boxel-icons/terminal-2';

export class RemixInput extends CardDef {
  @field realm = contains(StringField);
  @field listing = linksTo(CardDef);
}

class RemixResultView extends Component<typeof RemixResult> {
  <template>
    <div>
      <div class='remix-result-status {{if @model.success "success" "error"}}'>
        {{if @model.success 'Success' 'Failed'}}
      </div>
    </div>
    <style>
      .remix-result-status {
        font-weight: 500;
        padding: 0.75rem;
        border-radius: 0.25rem;
      }

      .success {
        background-color: rgba(0, 200, 83, 0.1);
        color: var(--boxel-success-300);
      }

      .error {
        background-color: rgba(244, 67, 54, 0.1);
        color: var(--boxel-error-300);
      }
    </style>
  </template>
}

export class RemixResult extends CardDef {
  static displayName = 'Remix Command';
  static icon = IconTerminal2;
  @field success = contains(BooleanField);
  @field title = contains(StringField, {
    computeVia: function (this: RemixResult) {
      return 'Remix Command';
    },
  });

  static embedded = RemixResultView;
  static isolated = RemixResultView;
}
