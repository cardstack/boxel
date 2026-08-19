import GlimmerComponent from '@glimmer/component';

interface Signature {
  Args: {
    // Group heading (file path, module path, instance path, …).
    name?: string;
    // Render the name in monospace (paths) vs. the default face (module names).
    monospaceName?: boolean;
    // Truthy applies the error border.
    hasErrors?: unknown;
    // Status badge text and tone ('clean' | 'errors' | 'running' | 'muted').
    statusLabel: string;
    statusTone: string;
    // When set, renders the error block; pair with no body for error-only rows.
    error?: string | null;
  };
  Blocks: { default: [] };
  Element: HTMLElement;
}

// Shared chrome for a single result detail group: the bordered card, the
// header (name + status badge), an optional error block, and a slot for the
// row list. Composed by every result FieldDef's embedded template so the group
// markup and styling live in one place.
export class ResultDetailGroup extends GlimmerComponent<Signature> {
  <template>
    <div class='detail-group {{if @hasErrors "has-errors"}}' ...attributes>
      <div class='detail-group-header'>
        <span
          class='detail-group-name {{if @monospaceName "mono"}}'
        >{{@name}}</span>
        <span class='group-status {{@statusTone}}'>{{@statusLabel}}</span>
      </div>
      {{#if @error}}
        <pre class='error-code-block'>{{@error}}</pre>
      {{/if}}
      {{yield}}
    </div>
    <style scoped>
      .detail-group {
        border: 1px solid
          color-mix(
            in oklch,
            var(--border, var(--boxel-border-color)) 60%,
            transparent
          );
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-sm);
      }
      .detail-group.has-errors {
        border-color: color-mix(in oklch, oklch(55% 0.22 25) 50%, transparent);
      }
      .detail-group-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding-bottom: var(--boxel-sp-xs);
        border-bottom: 1px solid
          color-mix(
            in oklch,
            var(--border, var(--boxel-border-color)) 50%,
            transparent
          );
        margin-bottom: var(--boxel-sp-xs);
      }
      .detail-group-name {
        font-weight: 600;
        font-size: var(--boxel-font-size-sm);
        word-break: break-all;
      }
      .detail-group-name.mono {
        font-family: var(--boxel-monospace-font-family, monospace);
      }
      .group-status {
        flex-shrink: 0;
        font-size: var(--boxel-font-size-xs);
        font-weight: 500;
        color: var(--muted-foreground, var(--boxel-500));
        text-transform: uppercase;
      }
      .group-status.clean {
        color: oklch(60% 0.17 150);
      }
      .group-status.errors {
        color: oklch(55% 0.22 25);
      }
      .group-status.running {
        color: oklch(60% 0.16 250);
      }
      .error-code-block {
        margin: 0;
        padding: var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
        background: color-mix(in oklch, oklch(55% 0.22 25) 8%, transparent);
        color: oklch(55% 0.22 25);
        font-family: var(--boxel-monospace-font-family, monospace);
        font-size: var(--boxel-font-size-xs);
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 15rem;
        overflow-y: auto;
        line-height: 1.4;
      }
      .detail-group :deep(.containsMany-field.embedded-format) {
        gap: var(--boxel-sp-4xs);
      }
    </style>
  </template>
}
