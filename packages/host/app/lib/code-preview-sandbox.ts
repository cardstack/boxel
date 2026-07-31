import { tracked } from '@glimmer/tracking';

import type { CardRenderSandboxTier } from '@cardstack/host/lib/realm-sandbox-source-policy';

export const CodePreviewSandboxContextName = 'code-preview-sandbox';

let nextPreviewSandbox = 0;

export interface CodePreviewDraft {
  readonly sourceURL: string;
  readonly source: string;
  readonly revision: number;
}

// One instance belongs to one mounted Code mode surface. The unsaved Monaco
// buffer is deliberately held outside the Store and ordinary realm loaders so
// an editor can evaluate drafts without changing Interact or another preview.
export default class CodePreviewSandbox {
  readonly id = `code-preview-${++nextPreviewSandbox}`;
  active = true;

  // Source and revision are one atomic value. Evaluators must capture this
  // object before they yield so revision N can never fetch revision N + 1's
  // mutable source while Monaco is producing another change.
  @tracked draft?: CodePreviewDraft;
  // Code mode always owns one detached iframe runtime. This keeps Monaco and
  // the host route independent from preview compilation, while the iframe's
  // document, MessageChannel, and Loader remain mounted across draft updates.
  // Interact mode still uses source classification to select SES vs iframe.
  @tracked sandboxTier: CardRenderSandboxTier = 'iframe';
  @tracked sandboxReason = 'code-preview-dedicated-iframe';

  get sourceURL() {
    return this.draft?.sourceURL;
  }

  get source() {
    return this.draft?.source;
  }

  get revision() {
    return this.draft?.revision ?? 0;
  }

  update(sourceURL: string, source: string) {
    if (this.sourceURL === sourceURL && this.source === source) {
      return;
    }
    let draft = Object.freeze({
      sourceURL,
      source,
      revision: this.revision + 1,
    });
    this.draft = draft;
  }

  applySandboxDecision(tier: CardRenderSandboxTier, reason: string) {
    if (!this.active) {
      return;
    }
    this.sandboxTier = tier;
    this.sandboxReason = reason;
  }

  deactivate() {
    this.active = false;
  }
}
