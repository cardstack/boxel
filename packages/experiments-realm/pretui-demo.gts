import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
import BooleanField from '@cardstack/base/boolean';
import StringField from '@cardstack/base/string';
import { Button } from '@cardstack/pretui/components/button';
import { Switch } from '@cardstack/pretui/components/switch';

export class PretuiDemo extends CardDef {
  static displayName = 'Pret UI Demo';
  @field headline = contains(StringField);
  @field notifications = contains(BooleanField);

  static isolated = class Isolated extends Component<typeof PretuiDemo> {
    setNotifications = (on: boolean) => {
      this.args.model.notifications = on;
    };
    <template>
      <article class='pretui-demo'>
        <h2><@fields.headline /></h2>
        <div class='row'>
          <Switch
            @controlId='pretui-demo-notifications'
            @checked={{@model.notifications}}
            @onCheckedChange={{this.setNotifications}}
          />
          <label for='pretui-demo-notifications'>Notifications
            {{if @model.notifications 'on' 'off'}}</label>
        </div>
        <div class='row'>
          <Button @tone='primary'>Save</Button>
          <Button @tone='danger' @appearance='outlined'>Delete</Button>
        </div>
      </article>
      <style scoped>
        .pretui-demo {
          display: grid;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
        }
        .row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp);
        }
      </style>
    </template>
  };
}
