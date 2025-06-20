import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import { cssVar } from '../../helpers.ts';
import TagList, { type TagItem } from './index.gts';

export default class TagListUsage extends Component {
  private tagItems: TagItem[] = [
    { id: 'tag1', displayName: 'JavaScript' },
    { id: 'tag2', displayName: 'TypeScript' },
    { id: 'tag3', displayName: 'React' },
    { id: 'tag4', displayName: 'Vue' },
    { id: 'tag5', displayName: 'Angular' },
    { id: 'tag6', displayName: 'Ember' },
  ];

  @tracked private selectedTags: TagItem[] = [
    this.tagItems[0]!,
    this.tagItems[2]!,
  ];

  @cssVariable({ cssClassName: 'tag-list-usage' })
  declare tagListGap: CSSVariableInfo;

  @cssVariable({ cssClassName: 'tag-list-usage' })
  declare tagListPillBackgroundColor: CSSVariableInfo;

  @cssVariable({ cssClassName: 'tag-list-usage' })
  declare tagListPillSelectedBackgroundColor: CSSVariableInfo;

  @cssVariable({ cssClassName: 'tag-list-usage' })
  declare tagListPillFontColor: CSSVariableInfo;

  @cssVariable({ cssClassName: 'tag-list-usage' })
  declare tagListPillSelectedFontColor: CSSVariableInfo;

  private onTagSelect = (tag: TagItem) => {
    this.selectedTags = this.selectedTags.some((t) => t.id === tag.id)
      ? this.selectedTags.filter((t) => t.id !== tag.id)
      : [...this.selectedTags, tag];
  };

  <template>
    <div
      class='tag-list-usage'
      style={{cssVar
        tag-list-gap=this.tagListGap.value
        tag-list-pill-background-color=this.tagListPillBackgroundColor.value
        tag-list-pill-selected-background-color=this.tagListPillSelectedBackgroundColor.value
        tag-list-pill-font-color=this.tagListPillFontColor.value
        tag-list-pill-selected-font-color=this.tagListPillSelectedFontColor.value
      }}
    >
      <FreestyleUsage @name='Tag List'>
        <:description>
          A simple list of selectable tags using Pill components. Supports
          multiple selection.
        </:description>
        <:example>
          <TagList
            @tags={{this.tagItems}}
            @selectedTags={{this.selectedTags}}
            @onTagSelect={{this.onTagSelect}}
          />
        </:example>
        <:api as |Args|>
          <Args.Object
            @name='tags'
            @description='Array of tag items with id and displayName'
            @value={{this.tagItems}}
            @defaultValue='[]'
          />
          <Args.Object
            @name='selectedTags'
            @description='Array of selected tag objects'
            @value={{this.selectedTags}}
            @defaultValue='[]'
          />
          <Args.Action
            @name='onTagSelect'
            @description='Callback when a tag is clicked'
          />
        </:api>
        <:cssVars as |Css|>
          <Css.Basic
            @name='tag-list-gap'
            @type='dimension'
            @description='Gap between tags'
            @value={{this.tagListGap.value}}
            @onInput={{this.tagListGap.update}}
          />
          <Css.Basic
            @name='tag-list-pill-background-color'
            @type='color'
            @description='Background color of unselected tags'
            @value={{this.tagListPillBackgroundColor.value}}
            @onInput={{this.tagListPillBackgroundColor.update}}
          />
          <Css.Basic
            @name='tag-list-pill-selected-background-color'
            @type='color'
            @description='Background color of selected tags'
            @value={{this.tagListPillSelectedBackgroundColor.value}}
            @onInput={{this.tagListPillSelectedBackgroundColor.update}}
          />
          <Css.Basic
            @name='tag-list-pill-font-color'
            @type='color'
            @description='Font color of unselected tags'
            @value={{this.tagListPillFontColor.value}}
            @onInput={{this.tagListPillFontColor.update}}
          />
          <Css.Basic
            @name='tag-list-pill-selected-font-color'
            @type='color'
            @description='Font color of selected tags'
            @value={{this.tagListPillSelectedFontColor.value}}
            @onInput={{this.tagListPillSelectedFontColor.update}}
          />
        </:cssVars>
      </FreestyleUsage>
    </div>
  </template>
}
