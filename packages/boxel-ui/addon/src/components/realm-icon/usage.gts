import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import { TrackedObject } from 'tracked-built-ins';

import RealmIcon from './index.gts';

export default class RealmIconUsage extends Component {
  @tracked canAnimate = false;
  realmInfo = new TrackedObject({
    iconURL: 'https://boxel-images.boxel.ai/icons/Letter-c.png',
    name: "Carl's Workspace",
    isIndexing: false,
    publishable: null,
  });

  <template>
    <FreestyleUsage @name='Realm Icon'>
      <:example>
        <RealmIcon
          @realmInfo={{this.realmInfo}}
          @canAnimate={{this.canAnimate}}
        />

        {{! Below is for preview only }}
        {{#if this.canAnimate}}
          <label>
            Preview animation
            <input
              type='checkbox'
              checked={{this.realmInfo.isIndexing}}
              name='animate'
              {{on 'input' this.animate}}
            />
          </label>
        {{/if}}
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='canAnimate'
          @optional={{true}}
          @defaultValue={{false}}
          @onInput={{fn (mut this.canAnimate)}}
          @value={{this.canAnimate}}
        />
        <Args.Object
          @required={{true}}
          @name='realmInfo'
          @description='realm information'
          @value={{this.realmInfo}}
        />
      </:api>
    </FreestyleUsage>
  </template>

  @action animate(ev: Event) {
    this.realmInfo.isIndexing = (ev.target as HTMLInputElement).checked;
  }
}
