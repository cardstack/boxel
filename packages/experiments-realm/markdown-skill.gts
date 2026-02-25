import { contains, field, linksTo } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import MarkdownField from '@cardstack/base/markdown';
import { MarkdownDef } from '@cardstack/base/markdown-file-def';
import { Skill } from '@cardstack/base/skill';

export class MarkdownSkill extends Skill {
  static displayName = 'Markdown Skill';

  @field instructionsSource = linksTo(MarkdownDef);
  @field instructions = contains(MarkdownField, {
    computeVia: function (this: MarkdownSkill) {
      return this.instructionsSource?.content;
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: MarkdownSkill) {
      return this.instructionsSource?.title;
    },
  });
}
