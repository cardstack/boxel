import { contains, field, linksTo } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { MarkdownDef } from 'https://cardstack.com/base/markdown-file-def';
import { Skill } from 'https://cardstack.com/base/skill';

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
