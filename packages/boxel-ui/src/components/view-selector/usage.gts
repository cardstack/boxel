import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import ViewSelector from './index.gts';

export default class ViewSelectorUsage extends Component {
  private standardViewOptions = `[
    { id: 'card', icon: CardIcon },
    { id: 'strip', icon: StripIcon },
    { id: 'grid', icon: GridIcon },
  ]`;

  @tracked private selectedId: string | undefined;
  @tracked private disabled?: boolean;

  @action private onChangeView(id: string) {
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
          @disabled={{this.disabled}}
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
        <Args.Bool
          @name='disabled'
          @description='Optional disabled state for item or the whole component'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @onInput={{fn (mut this.disabled)}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='--boxel-view-option-group-column-gap'
          @type='column-gap'
          @description='column-gap for the group'
        />
        <Css.Basic
          @name='--boxel-view-option-group-row-gap'
          @type='row-gap'
          @description='row-gap for the group'
        />
        <Css.Basic
          @name='--boxel-view-option-column-gap'
          @type='column-gap'
          @description='column-gap for button group'
        />
        <Css.Basic
          @name='--boxel-view-option-row-gap'
          @type='row-gap'
          @description='row-gap for button group'
        />
        <Css.Basic
          @name='--boxel-view-option-background'
          @type='background-color'
          @description='button background-color'
        />
        <Css.Basic
          @name='--boxel-view-option-foreground'
          @type='color'
          @description='button foreground'
        />
        <Css.Basic
          @name='--boxel-view-option-radius'
          @type='border-radius'
          @description='button border-radius'
        />
        <Css.Basic
          @name='--boxel-view-option-shadow'
          @type='box-shadow'
          @description='button box-shadow'
        />
        <Css.Basic
          @name='--boxel-view-option-transition'
          @type='transition'
          @description='button transition'
        />
        <Css.Basic
          @name='--boxel-view-option-hover-background'
          @type='background-color'
          @description='button hover state background'
        />
        <Css.Basic
          @name='--boxel-view-option-hover-foreground'
          @type='color'
          @description='button hover state foreground'
        />
        <Css.Basic
          @name='--boxel-view-option-selected-background'
          @type='background-color'
          @description='button selected state background'
        />
        <Css.Basic
          @name='--boxel-view-option-selected-foreground'
          @type='color'
          @description='button selected state foreground'
        />
        <Css.Basic
          @name='--boxel-view-option-selected-hover-background'
          @type='background-color'
          @description='background for hover state on selected button'
        />
        <Css.Basic
          @name='--boxel-view-option-selected-hover-foreground'
          @type='color'
          @description='foreground for hover state on selected button'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      :deep(.FreestyleUsageCssVar input) {
        display: none;
      }
    </style>
  </template>
}
