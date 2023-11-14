/* eslint-disable no-console */
import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import cn from '../../helpers/cn.ts';
import { eq } from '../../helpers/truth-helpers.ts';
import BoxelButton, {
  type BoxelButtonKind,
  type BoxelButtonSize,
} from './index.gts';

export default class ButtonUsage extends Component {
  sizeVariants = ['extra-small', 'small', 'base', 'tall', 'touch'];
  kindVariants = {
    all: [
      'primary',
      'primary-dark',
      'secondary-light',
      'secondary-dark',
      'danger',
    ],
    light: ['primary', 'secondary-light'],
    dark: ['primary', 'secondary-dark'],
  };

  // base button arguments
  @tracked as = 'button';
  @tracked size: BoxelButtonSize = 'tall';
  @tracked kind: BoxelButtonKind = 'primary';
  @tracked disabled = false;
  @tracked loading = false;

  // for @as === 'anchor'
  @tracked href = '#';

  // for @as === 'link-to'
  @tracked route = 'index';
  // @model and @query seem hard to use here so leaving them aside for now

  @action
  alert(): void {
    alert('Hey! You clicked the button.');
  }

  <template>
    <FreestyleUsage @name='Button'>
      <:example>
        <div
          class={{cn
            'usage-button-centers-component'
            usage-button-dark-mode-background=(eq this.kind 'secondary-dark')
          }}
        >
          <BoxelButton
            @as={{this.as}}
            @kind={{this.kind}}
            @size={{this.size}}
            @disabled={{this.disabled}}
            @loading={{this.loading}}
            @href={{this.href}}
            @route={{this.route}}
            {{on 'click' this.alert}}
          >
            Button Text
          </BoxelButton>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='as'
          @optional={{true}}
          @value={{this.as}}
          @options={{array 'button' 'anchor' 'link-to'}}
          @description="Determines the component/tag that is used to render the element. 'button' renders a 'button', 'anchor' renders an 'a', and 'link-to' renders a 'LinkTo'. Note that for accessibility purposes, you should be careful about adding aria/other attributes to a disabled link."
          @onInput={{fn (mut this.as)}}
        />
        <Args.String
          @name='route'
          @optional={{true}}
          @description='The route argument for LinkTo'
          @onInput={{fn (mut this.route)}}
          @value={{this.route}}
        />
        <Args.Object
          @name='models'
          @description='The models argument for LinkTo'
          @optional={{true}}
          @defaultValue='[]'
        />
        <Args.String
          @name='query'
          @description='The query argument for LinkTo'
          @optional={{true}}
        />
        <Args.String
          @name='href'
          @optional={{true}}
          @description='A url that the button can lead to'
          @onInput={{fn (mut this.href)}}
          @value={{this.href}}
        />
        <Args.String
          @name='kind'
          @optional={{true}}
          @description='Controls the colors of the button'
          @defaultValue={{'secondary-light'}}
          @options={{this.kindVariants.all}}
          @onInput={{fn (mut this.kind)}}
          @value={{this.kind}}
        />
        <Args.String
          @name='size'
          @optional={{true}}
          @description='Controls the size of the button'
          @defaultValue={{'base'}}
          @options={{this.sizeVariants}}
          @onInput={{fn (mut this.size)}}
          @value={{this.size}}
        />
        <Args.Bool
          @name='disabled'
          @optional={{true}}
          @description='Controls whether the button is disabled'
          @onInput={{fn (mut this.disabled)}}
          @value={{this.disabled}}
        />
        <Args.Bool
          @name='loading'
          @optional={{true}}
          @description='Controls whether the button is loading'
          @onInput={{fn (mut this.loading)}}
          @value={{this.loading}}
        />
        <Args.Yield @description='Contents of the button' />
      </:api>
      <:description>
        Depending on the value of
        <code>@as</code>, the button will accept different arguments.
        <table class='usage-button-explanation'>
          <tbody>
            <tr>
              <td>
                <code>
                  @as
                </code>
              </td>
              <td>
                Accepted arguments
              </td>
              <td>
                Used for
              </td>
            </tr>
            <tr>
              <td>
                button
              </td>
              <td>
                <ul>
                  <li><code>@size</code></li>
                  <li><code>@kind</code></li>
                  <li><code>@disabled</code></li>
                  <li><code>@loading</code></li>
                </ul>
              </td>
              <td>
                Actions
              </td>
            </tr>
            <tr>
              <td>
                anchor
              </td>
              <td>
                <ul>
                  <li><code>@size</code></li>
                  <li><code>@kind</code></li>
                  <li><code>@disabled</code></li>
                  <li><code>@href</code></li>
                </ul>
              </td>
              <td>
                Any navigation, e.g. external CTA
              </td>
            </tr>
            <tr>
              <td>
                link-to
              </td>
              <td>
                <ul>
                  <li><code>@size</code></li>
                  <li><code>@kind</code></li>
                  <li><code>@disabled</code></li>
                  <li><code>@route</code></li>
                  <li><code>@models</code></li>
                  <li><code>@query</code></li>
                </ul>
                <br />
                <code>@route, @models,</code>
                and
                <code>@query</code>
                are passed to
                <code>LinkTo</code>
                directly
              </td>
              <td>
                Navigation within the app
              </td>
            </tr>
          </tbody>
        </table>
      </:description>
    </FreestyleUsage>

    <FreestyleUsage
      @name='LinkTo button'
      @description='This button links you to the index page'
    >
      <:example>
        <div
          class={{cn
            'usage-button-centers-component'
            usage-button-dark-mode-background=(eq this.kind 'secondary-dark')
          }}
        >
          <BoxelButton
            @as='link-to'
            @kind='primary'
            @size='base'
            @route='index'
            @query=''
          >
            Button Text
          </BoxelButton>
        </div>
      </:example>
    </FreestyleUsage>
    <style>
      .usage-button-container {
        display: flex;
        flex-wrap: wrap;
      }

      .usage-button-dark-mode-background {
        background-color: var(--boxel-purple-600);
        padding: 4px;
      }

      .usage-button-explanation {
        border: 1px solid black;
        border-collapse: collapse;
        margin-top: 1rem;
      }

      .usage-button-explanation td {
        border: 1px solid black;
        padding: 0.25rem;
      }

      .usage-button-centers-component {
        flex-basis: 0;
        flex-grow: 99;
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100%;
        padding: 2rem;
      }
    </style>
  </template>
}
