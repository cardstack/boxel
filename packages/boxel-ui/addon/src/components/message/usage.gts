import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import cssVar from '../../helpers/css-var.ts';
import { gt } from '../../helpers/truth-helpers.ts';
import BoxelCardContainer from '../card-container/index.gts';
import BoxelHeader from '../header/index.gts';
import BoxelMessage from './index.gts';

export default class MessageUsage extends Component {
  messageArray = [
    'Hello, it’s nice to see you!',
    'Let’s issue a Prepaid Card.',
    'First, you can choose the look and feel of your card, so that your customers and other users recognize that this Prepaid Card came from you.',
  ];

  @tracked name = 'Lola Sampson';
  @tracked imgURL: string | undefined;
  @tracked datetime = '2020-03-07T10:11';
  @tracked notRound = false;
  @tracked hideMeta = false;
  @tracked hideName = false;
  @tracked fullWidth = false;

  cssClassName = 'boxel-message';
  @cssVariable declare boxelMessageAvatarSize: CSSVariableInfo;
  @cssVariable declare boxelMessageMetaHeight: CSSVariableInfo;
  @cssVariable declare boxelMessageGap: CSSVariableInfo;
  @cssVariable declare boxelMessageMarginLeft: CSSVariableInfo;

  @tracked layoutExampleFullWidth = false;
  @action toggleLayoutExampleFullWidth(): void {
    this.layoutExampleFullWidth = !this.layoutExampleFullWidth;
  }
  @tracked isComplete = false;
  @action toggleIsComplete(): void {
    this.isComplete = !this.isComplete;
  }

  <template>
    <FreestyleUsage @name='ThreadMessage'>
      <:example>
        <BoxelMessage
          @name={{this.name}}
          @imgURL={{this.imgURL}}
          @datetime={{this.datetime}}
          @notRound={{this.notRound}}
          @hideMeta={{this.hideMeta}}
          @hideName={{this.hideName}}
          @fullWidth={{this.fullWidth}}
          style={{cssVar
            boxel-message-avatar-size=this.boxelMessageAvatarSize.value
            boxel-message-meta-height=this.boxelMessageMetaHeight.value
            boxel-message-gap=this.boxelMessageGap.value
            boxel-message-margin-left=this.boxelMessageMarginLeft.value
          }}
        >
          Hi Haley, Here’s your manuscript with all the edits I would recommend.
          Please review and let me know if you have any questions. I also added
          a couple tasks for you about things you should think about, as you
          figure out the rest of your story.
        </BoxelMessage>
      </:example>
      <:api as |Args|>
        <Args.Yield @description='Message content' @required={{true}} />
        <Args.String
          @name='name'
          @description='The name displayed above the message'
          @value={{this.name}}
          @onInput={{fn (mut this.name)}}
          @required={{true}}
        />
        <Args.String
          @name='imgURL'
          @description='URL for the user avatar'
          @value={{this.imgURL}}
          @onInput={{fn (mut this.imgURL)}}
        />
        <Args.String
          @name='datetime'
          @description='Message timestamp'
          @defaultValue='(now)'
          @value={{this.datetime}}
          @onInput={{fn (mut this.datetime)}}
        />
        <Args.Bool
          @name='notRound'
          @value={{this.notRound}}
          @description="Avatar is not circle-shaped. This will only work if an 'imgURL' arg is provided"
          @defaultValue={{false}}
          @onInput={{fn (mut this.notRound)}}
        />
        <Args.Bool
          @name='hideMeta'
          @value={{this.hideMeta}}
          @description='Visually hides the user avatar, name, and message timestamp'
          @defaultValue={{false}}
          @onInput={{fn (mut this.hideMeta)}}
        />
        <Args.Bool
          @name='hideName'
          @value={{this.hideName}}
          @description='Visually hides the user name'
          @defaultValue={{false}}
          @onInput={{fn (mut this.hideName)}}
        />
        <Args.Bool
          @name='fullWidth'
          @value={{this.fullWidth}}
          @description='Whether to allocate the full width to the content'
          @defaultValue={{false}}
          @onInput={{fn (mut this.fullWidth)}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='boxel-message-avatar-size'
          @type='dimension'
          @defaultValue={{this.boxelMessageAvatarSize.defaults}}
          @value={{this.boxelMessageAvatarSize.value}}
          @onInput={{this.boxelMessageAvatarSize.update}}
        />
        <Css.Basic
          @name='boxel-message-meta-height'
          @type='dimension'
          @defaultValue={{this.boxelMessageMetaHeight.defaults}}
          @value={{this.boxelMessageMetaHeight.value}}
          @onInput={{this.boxelMessageMetaHeight.update}}
        />
        <Css.Basic
          @name='boxel-message-gap'
          @type='dimension'
          @description='gap after avatar'
          @defaultValue={{this.boxelMessageGap.defaults}}
          @value={{this.boxelMessageGap.value}}
          @onInput={{this.boxelMessageGap.update}}
        />
        <Css.Basic
          @name='boxel-message-margin-left'
          @type='dimension'
          @defaultValue={{this.boxelMessageMarginLeft.defaults}}
          @value={{this.boxelMessageMarginLeft.value}}
          @onInput={{this.boxelMessageMarginLeft.update}}
        />
      </:cssVars>
    </FreestyleUsage>

    <FreestyleUsage @slug='Message-array'>
      <:example>
        <div role='list'>
          {{#each this.messageArray as |message i|}}
            <BoxelMessage
              role='listitem'
              @name='Cardbot'
              @hideMeta={{gt i 0}}
              @hideName={{true}}
              @datetime={{this.datetime}}
            >
              {{message}}
            </BoxelMessage>
          {{/each}}
        </div>
      </:example>
    </FreestyleUsage>

    <FreestyleUsage @slug='with-cards'>
      <:description>
        <p>
          These examples with embedded cards are using the
          <code>@fullWidth</code>
          argument to have access to the full-width content area. Smaller cards
          have a left margin the size of
          <code>var(--boxel-message-margin-left)</code>
          css variable for alignment.
        </p>
        <p>
          Using the
          <code>@fullWidth</code>
          argument:
          <ul>
            <li>Allows the content to have access to the full-width content area</li>
            <li>Adds spacing between the timestamp and the content</li>
            <li>Vertically centers the timestamp in relation to the avatar</li>
          </ul>
        </p>
      </:description>
      <:example>
        <BoxelCardContainer @displayBoundaries={{true}}>
          <BoxelMessage
            @name='Cardbot'
            @hideName={{true}}
            @datetime={{this.datetime}}
          >
            <p>
              Hello, it’s nice to see you!
            </p>
          </BoxelMessage>
          <BoxelMessage
            @name='Cardbot'
            @hideName={{true}}
            @hideMeta={{true}}
            @datetime={{this.datetime}}
          >
            <p>
              Let’s issue a Prepaid Card.
            </p>
          </BoxelMessage>
          <BoxelMessage
            @name='Cardbot'
            @hideName={{true}}
            @datetime={{this.datetime}}
          >
            <p>
              Let’s get down to business. Please choose the asset you would like
              to deposit into the CARD Protocol’s reserve pool.
            </p>
          </BoxelMessage>
          <BoxelMessage
            @name='Cardbot'
            @hideName={{true}}
            @hideMeta={{true}}
            @fullWidth={{true}}
            @datetime={{this.datetime}}
          >
            <BoxelCardContainer @displayBoundaries={{true}}>
              <BoxelHeader @title='Card 1' />
              <p>Card 1 Content...</p>
            </BoxelCardContainer>
          </BoxelMessage>
          <BoxelMessage
            @name='Cardbot'
            @hideName={{true}}
            @fullWidth={{true}}
            @datetime={{this.datetime}}
          >
            <BoxelCardContainer @displayBoundaries={{true}}>
              <BoxelHeader @title='Card 2' />
              <p>Card 2 Content...</p>
            </BoxelCardContainer>
          </BoxelMessage>
          <BoxelMessage
            @name='Cardbot'
            @hideName={{true}}
            @fullWidth={{true}}
            @datetime={{this.datetime}}
          >
            <BoxelCardContainer @displayBoundaries={{true}}>
              <BoxelHeader @title='Card 3' />
              <p>Card 3 Content...</p>
            </BoxelCardContainer>
          </BoxelMessage>
        </BoxelCardContainer>
      </:example>
    </FreestyleUsage>
  </template>
}
