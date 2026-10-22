import Component from '@glimmer/component';

import type { GalleryDemo } from '../demo';
import { realmFile } from '../lib/realm-url';

interface Signature {
  Args: { demo: GalleryDemo };
  Element: HTMLAnchorElement;
}

/**
 * "Read the guide →": a real link to the concept guide the demo's lesson
 * names, a Markdown file in the realm's `docs/guides/`. Following it is the
 * host's navigation, so the guide opens as its own file at its own URL.
 */
export class GuideLink extends Component<Signature> {
  get href(): string | undefined {
    let guide = this.args.demo.lesson?.guide;
    return guide ? realmFile(`docs/guides/${guide}.md`) : undefined;
  }

  <template>
    {{#if this.href}}
      <a
        href={{this.href}}
        class='guide-link'
        data-demo-guide={{@demo.lesson.guide}}
        ...attributes
      >Read the guide <span aria-hidden='true'>→</span></a>
    {{/if}}
    <style scoped>
      .guide-link {
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--copper-ink);
      }

      @media (hover: hover) {
        .guide-link:hover {
          color: var(--ink);
        }
      }
    </style>
  </template>
}
