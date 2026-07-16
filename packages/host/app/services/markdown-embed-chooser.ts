import Service from '@ember/service';

import { tracked } from '@glimmer/tracking';

import { Deferred } from '@cardstack/runtime-common';

import type { BfmSizeSpec } from '@cardstack/runtime-common/bfm-card-references';

export type MarkdownEmbedRefType = 'card' | 'file';

export interface MarkdownEmbedResult {
  refType: MarkdownEmbedRefType;
  url: string;
  bfm: string;
}

export type MarkdownEmbedResolution =
  | MarkdownEmbedResult
  | { remove: true }
  | undefined;

export interface MarkdownEmbedInitialTarget {
  refType: MarkdownEmbedRefType;
  url: string;
  // Either a pre-parsed `BfmSizeSpec` (from extractBfmRefRanges) or the raw
  // specifier text after `|`. The pane parses the string form itself.
  sizeSpec?: BfmSizeSpec | string;
  // The directive's placement (`::` block vs `:` inline). Carried separately
  // from `sizeSpec` so a size-less block directive (`::card[url]`) seeds block
  // placement instead of collapsing to an inline atom.
  kind?: 'inline' | 'block';
  // The editing document's own URL. The chooser relativizes the picked ref
  // against it so the inserted directive is `../`-relative, matching the
  // format-picker insertion path.
  documentBaseUrl?: string;
}

export interface MarkdownEmbedChooserRequest {
  defaultTab: MarkdownEmbedRefType;
  initialTarget?: MarkdownEmbedInitialTarget;
  // The editing document's own URL, used to relativize the inserted ref.
  documentBaseUrl?: string;
  deferred: Deferred<MarkdownEmbedResolution>;
}

// Single in-flight request at a time — the modal is the only consumer. If
// another `chooseCardOrFile`/`editEmbed` call lands while a modal is already
// open, the prior caller is resolved with `undefined` (cancel) before the new
// request displaces it.
export default class MarkdownEmbedChooserService extends Service {
  @tracked currentRequest: MarkdownEmbedChooserRequest | undefined;

  chooseCardOrFile(
    opts: { defaultTab?: MarkdownEmbedRefType; documentBaseUrl?: string } = {},
  ): Promise<MarkdownEmbedResolution> {
    return this.open({
      defaultTab: opts.defaultTab ?? 'card',
      documentBaseUrl: opts.documentBaseUrl,
    });
  }

  editEmbed(
    target: MarkdownEmbedInitialTarget,
  ): Promise<MarkdownEmbedResolution> {
    return this.open({
      defaultTab: target.refType,
      initialTarget: target,
      documentBaseUrl: target.documentBaseUrl,
    });
  }

  resolve(result: MarkdownEmbedResolution) {
    let req = this.currentRequest;
    if (!req) return;
    req.deferred.fulfill(result);
  }

  private async open(opts: {
    defaultTab: MarkdownEmbedRefType;
    initialTarget?: MarkdownEmbedInitialTarget;
    documentBaseUrl?: string;
  }): Promise<MarkdownEmbedResolution> {
    if (this.currentRequest) {
      this.currentRequest.deferred.fulfill(undefined);
    }
    let deferred = new Deferred<MarkdownEmbedResolution>();
    this.currentRequest = { ...opts, deferred };
    try {
      return await deferred.promise;
    } finally {
      if (this.currentRequest?.deferred === deferred) {
        this.currentRequest = undefined;
      }
    }
  }
}

declare module '@ember/service' {
  interface Registry {
    'markdown-embed-chooser': MarkdownEmbedChooserService;
  }
}
