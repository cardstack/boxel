// Atom: a small inline reference to a file — type icon, name, extension. It is
// meant to sit inside prose and a custom summary line, so it mounts no domain
// renderer and takes no more vertical space than the text around it.
import GlimmerComponent from '@glimmer/component';

import { fileIconFor } from './file-presentation';
import type { FileViewModel } from './file-view-model';

interface FileAtomShellSignature {
  Args: {
    model: FileViewModel;
  };
  Element: HTMLElement;
}

export class FileAtomShell extends GlimmerComponent<FileAtomShellSignature> {
  get icon() {
    return fileIconFor(this.args.model);
  }

  get baseName() {
    return (
      this.args.model?.baseName || this.args.model?.name || 'Untitled file'
    );
  }

  <template>
    <span class='ft-atom' title={{@model.name}} data-test-file-atom>
      <this.icon width='14' height='14' aria-hidden='true' />
      <span class='atom-name'>{{this.baseName}}</span>
      {{#if @model.extension}}
        <span class='atom-ext'>.{{@model.extension}}</span>
      {{/if}}
    </span>
    <style scoped>
      .ft-atom {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        max-width: 100%;
        vertical-align: baseline;
        font-family: var(--font-sans);
        font-size: inherit;
        color: var(--foreground);
      }
      .ft-atom svg {
        flex-shrink: 0;
        color: var(--muted-foreground);
      }
      .atom-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 500;
      }
      .atom-ext {
        flex-shrink: 0;
        font-family: var(--font-mono);
        font-size: 0.6em;
        font-weight: 700;
        letter-spacing: 0.03em;
        color: var(--fd-paper, var(--card, #f7f7f5));
        background: var(--fd-slate, var(--foreground));
        padding: 1px 5px;
        border-radius: 3px;
      }
    </style>
  </template>
}
