import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import Tag from './index.gts';

export default class TagUsage extends Component {
  pillKinds = ['button', 'default'];
  @tracked name = 'Meeting Minutes';
  @tracked pillColor?: string;
  @tracked borderColor?: string;
  @tracked fontColor?: string;
  @tracked ellipsize = false;
  @tracked tag?: keyof HTMLElementTagNameMap;

  <template>
    <FreestyleUsage @name='Tag List'>
      <:description>
        Styled pill component.
      </:description>
      <:example>
        <div class='tag-usage-container'>
          <Tag
            @name={{this.name}}
            @pillColor={{this.pillColor}}
            @borderColor={{this.borderColor}}
            @fontColor={{this.fontColor}}
            @tag={{if this.tag this.tag 'div'}}
            @ellipsize={{this.ellipsize}}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='name'
          @description='title of the tag'
          @value={{this.name}}
          @defaultValue=''
          @onInput={{fn (mut this.name)}}
        />
        <Args.String
          @name='pillColor'
          @description='Background color of the pill'
          @value={{this.pillColor}}
          @defaultValue='#ffffff'
          @optional={{true}}
          @onInput={{fn (mut this.pillColor)}}
        />
        <Args.String
          @name='borderColor'
          @description='Border color for the pill'
          @value={{this.borderColor}}
          @defaultValue='pillColor, #afafb7'
          @optional={{true}}
          @onInput={{fn (mut this.borderColor)}}
        />
        <Args.String
          @name='fontColor'
          @description='Font color for the pill'
          @value={{this.fontColor}}
          @defaultValue=' #000000 or #ffffff based on contrast if pillColor is undefined or a hex value'
          @optional={{true}}
          @onInput={{fn (mut this.fontColor)}}
        />
        <Args.Bool
          @name='ellipsize'
          @description='Ellipsize text-overflow instead of wrapping text'
          @value={{this.ellipsize}}
          @defaultValue={{false}}
          @optional={{true}}
          @onInput={{fn (mut this.ellipsize)}}
        />
        <Args.String
          @name='tag'
          @description='HTML element tag name'
          @value={{this.tag}}
          @defaultValue='div'
          @optional={{true}}
          @onInput={{fn (mut this.tag)}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .tag-usage-container {
        width: 100px;
      }
    </style>
  </template>
}
