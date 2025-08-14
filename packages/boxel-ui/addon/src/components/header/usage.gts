import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import ThreeDotsHorizontal from '../../icons/three-dots-horizontal.gts';
import BoxelDropdown from '../dropdown/index.gts';
import IconButton from '../icon-button/index.gts';
import BoxelHeader from './index.gts';
import CardIcon from '@cardstack/boxel-icons/captions';

export default class HeaderUsage extends Component {
  @tracked title = 'Title';
  @tracked size: 'large' | undefined = 'large';
  @tracked hasBackground = true;
  @tracked hasBottomBorder = false;

  get sizes() {
    return ['<unset>', 'large'];
  }

  <template>
    <FreestyleUsage @name='Header'>
      <:description>
        Usually shown at the top of card containers
      </:description>
      <:example>
        <BoxelHeader
          @title={{this.title}}
          @size={{this.size}}
          @hasBackground={{this.hasBackground}}
          @hasBottomBorder={{this.hasBottomBorder}}
        >
          <:icon>
            <CardIcon />
          </:icon>
          <:detail>
            <BoxelDropdown>
              <:trigger as |bindings|>
                <IconButton
                  @icon={{ThreeDotsHorizontal}}
                  @width='20px'
                  @height='20px'
                  aria-label='Options'
                  {{bindings}}
                />
              </:trigger>
            </BoxelDropdown>
          </:detail>
          <:default>
            <div>~ Default Content Block ~</div>
          </:default>
        </BoxelHeader>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='title'
          @description='Title'
          @value={{this.title}}
          @onInput={{fn (mut this.title)}}
        />
        <Args.String
          @name='size'
          @description='large header and title option'
          @options={{this.sizes}}
          @value={{this.size}}
          @onInput={{fn (mut this.size)}}
        />
        <Args.Bool
          @name='hasBackground'
          @description='(styling) Adds muted background'
          @defaultValue={{false}}
          @value={{this.hasBackground}}
          @onInput={{fn (mut this.hasBackground)}}
        />
        <Args.Bool
          @name='hasBottomBorder'
          @description='Adds bottom-border'
          @defaultValue={{false}}
          @value={{this.hasBottomBorder}}
          @onInput={{fn (mut this.hasBottomBorder)}}
        />
        <Args.Yield
          @name='icon'
          @description='Content for the icon of the header'
        />
        <Args.Yield
          @name='detail'
          @description='Content aligned to the end of the container'
        />
      </:api>
    </FreestyleUsage>

    <FreestyleUsage @name='Definition Usage'>
      <:example>
        <BoxelHeader @title='Definition' class='definition-container'>
          <:detail>
            .gts
          </:detail>
        </BoxelHeader>
      </:example>
    </FreestyleUsage>
    <style scoped>
      .definition-container {
        --boxel-header-min-height: 1.56rem;
        --boxel-header-padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        --boxel-header-background-color: var(--boxel-300);
        --boxel-header-text-color: var(--boxel-dark);

        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xl);
        text-transform: uppercase;
      }
    </style>
  </template>
}
