import type { TemplateOnlyComponent } from '@ember/component/template-only';

interface Signature {
  Element: HTMLSpanElement;
}

// Marks a workspace with published sites: lime, with its dot. A caller sets
// `--hosted-pill-background` to match the surface it sits on.
const HostedPill: TemplateOnlyComponent<Signature> = <template>
  <span class='hosted-pill' ...attributes>Hosted</span>

  <style scoped>
    .hosted-pill {
      flex: none;
      padding: var(--boxel-sp-6xs) var(--boxel-sp-xs);
      border-radius: var(--boxel-border-radius-lg);
      background-color: var(--hosted-pill-background, var(--boxel-dark-40));
      color: var(--boxel-lime);
      font-family: var(--boxel-monospace-font-family);
      font-size: var(--boxel-font-size-2xs);
      font-weight: 600;
      line-height: 1.5;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .hosted-pill::before {
      content: '● ' / '';
    }
  </style>
</template>;

export default HostedPill;
