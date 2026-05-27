import PhoneIcon from '@cardstack/boxel-icons/phone';
import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import EntityDisplayWithIcon from './index.gts';

export default class EntityIconDisplayUsage extends Component {
  @tracked title: string | null = null;
  @tracked center = false;
  @tracked underline = false;

  <template>
    <FreestyleUsage
      @name='EntityDisplayWithIcon'
      @description='A component that displays an entity with an icon.'
    >
      <:example>
        <EntityDisplayWithIcon @underline={{false}}>
          <:title>
            +60123456789
          </:title>
          <:icon>
            <PhoneIcon class='icon' />
          </:icon>
        </EntityDisplayWithIcon>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='title'
          @optional={{false}}
          @description='Entity display title.'
          @value={{this.title}}
          @onInput={{fn (mut this.title)}}
        />
        <Args.Bool
          @name='center'
          @description='Whether to center the entity display.'
          @value={{this.center}}
          @onInput={{fn (mut this.center)}}
          @defaultValue={{false}}
        />
        <Args.Bool
          @name='underline'
          @description='Whether to underline the entity display title.'
          @value={{this.underline}}
          @onInput={{fn (mut this.underline)}}
          @defaultValue={{false}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
