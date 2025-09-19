import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import { type BoxelSpacing } from '../../helpers.ts';
import BoxelContainer, { type BoxelContainerDisplayOption } from './index.gts';

interface Signature {
  Element: HTMLElement;
}

export default class BoxelContainerUsage extends Component<Signature> {
  private displayOptions: BoxelContainerDisplayOption[] = [
    'default',
    'grid',
    'inline-grid',
    'flex',
    'inline-flex',
  ];
  @tracked private tag?: keyof HTMLElementTagNameMap;
  @tracked private display?: BoxelContainerDisplayOption;
  @tracked private padding?: string | BoxelSpacing;

  <template>
    <FreestyleUsage @name='BoxelContainer'>
      <:description>
        A container that provides standard padding, with options to make it grid
        or flexbox.
      </:description>
      <:example>
        <BoxelContainer
          @display={{this.display}}
          @tag={{if this.tag this.tag 'div'}}
          @padding={{this.padding}}
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
        <Args.String
          @name='display'
          @optional={{true}}
          @description='Css display property for grid, flex, inline-grid, and inline-flex'
          @defaultValue='HTML element default'
          @options={{this.displayOptions}}
          @onInput={{fn (mut this.display)}}
          @value='default'
        />
        <Args.String
          @name='padding'
          @description='Container padding. Accepts string or BoxelSpacing values.'
          @defaultValue='var(--boxel-sp)'
          @value={{this.padding}}
          @optional={{true}}
          @onInput={{fn (mut this.padding)}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
