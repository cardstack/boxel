import { service } from '@ember/service';

import { v4 as uuidv4 } from 'uuid';

import { rri } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';
import { findNonConflictingFilename } from '../utils/file-name';

import type CardService from '../services/card-service';
import type NetworkService from '../services/network';
import type RealmService from '../services/realm';
import type * as BaseToolModule from '@cardstack/base/command';

function base64ToUint8Array(base64: string): Uint8Array {
  const maybeBuffer = (globalThis as any).Buffer as
    | { from(input: string, encoding: string): Buffer }
    | undefined;

  if (typeof maybeBuffer !== 'undefined') {
    return new Uint8Array(maybeBuffer.from(base64, 'base64'));
  }

  if (typeof atob === 'function') {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  throw new Error('No base64 decoder available in this environment');
}

export default class WriteBinaryFileTool extends HostBaseTool<
  typeof BaseToolModule.WriteBinaryFileInput,
  typeof BaseToolModule.WriteBinaryFileResult
> {
  @service declare private cardService: CardService;
  @service declare private realm: RealmService;
  @service declare private network: NetworkService;

  description = 'Write a binary file to a realm';
  static actionVerb = 'Write';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { WriteBinaryFileInput } = commandModule;
    return WriteBinaryFileInput;
  }

  requireInputFields = ['path', 'base64Content'];

  protected async run(
    input: BaseToolModule.WriteBinaryFileInput,
  ): Promise<BaseToolModule.WriteBinaryFileResult> {
    let realm;
    if (input.realm) {
      realm = this.realm.realmOf(rri(input.realm));
      if (!realm) {
        throw new Error(`Invalid or unknown realm provided: ${input.realm}`);
      }
    }

    let path = input.path;
    if (path.startsWith('/')) {
      path = path.slice(1);
    }

    let url = new URL(path, realm);
    let finalUrl = url;

    if (input.useNonConflictingFilename) {
      let existing = await this.cardService.getSource(url);
      if (existing.status === 200 || existing.status === 406) {
        let nonConflictingUrl = await findNonConflictingFilename(
          url.href,
          (candidateUrl) => this.fileExists(candidateUrl),
        );
        finalUrl = new URL(nonConflictingUrl);
      } else if (existing.status !== 404) {
        throw new Error(
          `Error checking if file exists at ${url}: ${existing.status}`,
        );
      }
    }

    let bytes = base64ToUint8Array(input.base64Content);
    let blob = new Blob([bytes as any]);

    let clientRequestId = `binary:${uuidv4()}`;
    this.cardService.clientRequestIds.add(clientRequestId);

    let response = await this.network.authedFetch(finalUrl, {
      method: 'POST',
      headers: {
        // Realm router matches binary uploads by application/octet-stream
        'Content-Type': 'application/octet-stream',
        'X-Boxel-Client-Request-Id': clientRequestId,
      },
      body: blob,
    });

    if (!response.ok) {
      const MAX_RESPONSE_TEXT_LENGTH = 500;
      let responseText: string;
      try {
        let rawText = await response.text();
        responseText =
          rawText.length > MAX_RESPONSE_TEXT_LENGTH
            ? rawText.slice(0, MAX_RESPONSE_TEXT_LENGTH) +
              `… (${rawText.length} chars total)`
            : rawText;
      } catch {
        responseText = '(unable to read response body)';
      }
      let wafRule = response.headers.get('x-blocked-by-waf-rule');
      let details = [
        `[WriteBinaryFile] Failed to write ${finalUrl}`,
        `Status: ${response.status} ${response.statusText}`,
        `File size: ${bytes.byteLength} bytes`,
        wafRule ? `WAF rule: ${wafRule}` : null,
        `Response: ${responseText}`,
      ]
        .filter(Boolean)
        .join(' | ');
      console.error(details);
      throw new Error(details);
    }

    let commandModule = await this.loadToolModule();
    const { WriteBinaryFileResult } = commandModule;
    return new WriteBinaryFileResult({ fileIdentifier: finalUrl.href });
  }

  private async fileExists(fileUrl: string): Promise<boolean> {
    let getSourceResult = await this.cardService.getSource(rri(fileUrl));
    return getSourceResult.status !== 404;
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { WriteBinaryFileTool as WriteBinaryFileCommand };
