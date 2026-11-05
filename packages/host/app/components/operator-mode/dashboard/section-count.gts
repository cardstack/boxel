import type { TemplateOnlyComponent } from '@ember/component/template-only';

interface Signature {
  Element: HTMLSpanElement;
  Args: { count: number };
}

// The count beside a dashboard heading, as the sections and their flyouts
// show it.
const SectionCount: TemplateOnlyComponent<Signature> = <template>
  <span class='section-count' ...attributes>{{@count}}</span>

  <style scoped>
    .section-count {
      font-family: var(--boxel-monospace-font-family);
      font-size: var(--boxel-font-size-xs);
      font-weight: 600;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--muted-foreground);
    }
    .section-count::before {
      content: '· ' / '';
    }
  </style>
</template>;

export default SectionCount;
