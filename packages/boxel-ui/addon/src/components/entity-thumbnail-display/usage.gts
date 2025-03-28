import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import Avatar from '../avatar/index.gts';
import Pill from '../pill/index.gts';
import EntityDisplayWithThumbnail from './index.gts';

export default class EntityThumbnailDisplayUsage extends Component {
  @tracked title: string = 'John Doe';
  @tracked center = false;
  @tracked underline = false;

  <template>
    <FreestyleUsage
      @name='EntityDisplayWithThumbnail'
      @description='A component that displays an entity with a thumbnail.'
    >
      <:example>
        <EntityDisplayWithThumbnail @title={{this.title}}>
          <:thumbnail>
            <Avatar
              @userId={{'user123'}}
              @displayName={{this.title}}
              @thumbnailURL={{'https://images.pexels.com/photos/4571943/pexels-photo-4571943.jpeg?auto=compress&cs=tinysrgb&w=300&h=300&dpr=1'}}
              @isReady={{true}}
              class='avatar'
            />
          </:thumbnail>
          <:tag>
            <Pill class='primary-tag' @pillBackgroundColor='#e8e8e8'>
              Primary
            </Pill>
          </:tag>
        </EntityDisplayWithThumbnail>
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
    <style scoped>
      .avatar {
        --profile-avatar-icon-size: 20px;
        --profile-avatar-icon-border: 0px;
        flex-shrink: 0;
      }
      .primary-tag {
        --pill-font-weight: 400;
        --pill-padding: var(--boxel-sp-5xs) var(--boxel-sp-xxs);
        --pill-font: 400 var(--boxel-font-xs);
        --pill-border: none;
      }
    </style>
  </template>
}
