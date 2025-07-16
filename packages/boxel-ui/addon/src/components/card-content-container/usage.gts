import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import BoxelContainer from './index.gts';

interface Signature {
  Element: HTMLElement;
}

export default class BoxelContainerUsage extends Component<Signature> {
  @tracked tag?: keyof HTMLElementTagNameMap;
  @tracked isGrid?: boolean;
  @tracked isFlex?: boolean;

  <template>
    <FreestyleUsage @name='BoxelContainer'>
      <:description>
        A container that provides standard padding, with options to make it grid
        or flexbox.
      </:description>
      <:example>
        <BoxelContainer
          @tag={{if this.tag this.tag 'div'}}
          @isFlex={{this.isFlex}}
          @isGrid={{this.isGrid}}
        >
          <h3>h3</h3>
          <p>Hello</p>
        </BoxelContainer>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='tag'
          @description='HTML element tag name (ie. button, section, ul, etc)'
          @value={{this.tag}}
          @defaultValue='div'
          @optional={{true}}
          @onInput={{fn (mut this.tag)}}
        />
        <Args.Bool
          @name='isGrid'
          @description='Makes the element a block-level grid container with standard spacing'
          @value={{this.isGrid}}
          @defaultValue={{false}}
          @optional={{true}}
          @onInput={{fn (mut this.isGrid)}}
        />
        <Args.Bool
          @name='isFlex'
          @description='Makes the element a block-level flex container with standard spacing'
          @value={{this.isFlex}}
          @defaultValue={{false}}
          @optional={{true}}
          @onInput={{fn (mut this.isFlex)}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
