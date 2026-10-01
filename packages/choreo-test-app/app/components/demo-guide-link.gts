import { LinkTo } from '@ember/routing';
import Component from '@glimmer/component';
import lessons from 'test-app/content/demo-lessons.json';

/** Use the same source-reviewed mapping as the documentation embeds. */
export class DemoGuideLink extends Component<{
  Args: { id: string };
  Element: HTMLAnchorElement;
}> {
  get lesson() {
    return lessons.find((lesson) => lesson.id === this.args.id);
  }
  <template>
    {{#if this.lesson}}{{#let this.lesson as |lesson|}}
        <LinkTo
          @route="docs.topic"
          @model={{lesson.guide}}
          data-test-demo-guide={{@id}}
          ...attributes
        >Read the guide →</LinkTo>
      {{/let}}{{/if}}
  </template>
}
