import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import ViewSelector from './index.gts';

export default class ViewSelectorUsage extends Component {
  standardViewOptions = `[
    { id: 'card', icon: CardIcon },
    { id: 'strip', icon: StripIcon },
    { id: 'grid', icon: GridIcon },
  ]`;

  @tracked selectedId: string | undefined;

  @action onChangeView(id: string) {
    this.selectedId = id;
  }

  <template>
    <FreestyleUsage @name='ViewSelector'>
      <:description>
        This preset view-selector component is used in various boxel apps. It
        uses a customized RadioInput component underneath. Please use the
        RadioInput component for any customization needs.
      </:description>
      <:example>
        <ViewSelector
          @onChange={{this.onChangeView}}
          @selectedId={{this.selectedId}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='items'
          @description='Items with an id and an icon component to render on the view selector'
          @defaultValue='Standard view options'
          @value={{this.standardViewOptions}}
        />
        <Args.String
          @name='selectedId'
          @description='Id of the currently selected item'
          @defaultValue='card'
          @value={{this.selectedId}}
          @onInput={{fn (mut this.selectedId)}}
          @required={{true}}
        />
        <Args.Action
          @name='onChange'
          @description='Receives the selected id as a string'
          @required={{true}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
