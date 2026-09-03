import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import WriteBinaryFileTool from './write-binary-file';

import type NetworkService from '../services/network';
import type RealmService from '../services/realm';
import type * as BaseToolModule from '@cardstack/base/command';

// Encode raw bytes as base64 without a text round-trip. `Buffer` when it exists
// (Node / prerender); otherwise `btoa` over the binary string, chunked so a
// large file doesn't blow the argument limit of `String.fromCharCode`.
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const maybeBuffer = (globalThis as any).Buffer as
    | { from(input: Uint8Array): { toString(encoding: string): string } }
    | undefined;
  if (typeof maybeBuffer !== 'undefined') {
    return maybeBuffer.from(bytes).toString('base64');
  }
  if (typeof btoa === 'function') {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }
  throw new Error('No base64 encoder available in this environment');
}

export default class DownloadFileToRealmTool extends HostBaseTool<
  typeof BaseToolModule.DownloadFileToRealmInput,
  typeof BaseToolModule.DownloadFileToRealmResult
> {
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;

  static actionVerb = 'Download';
  description =
    "Download a file from a URL and write it into a realm. Give the destination a path with the right extension (e.g. 'Screenshots/card.png') — the realm infers the file type from it. `realm` selects the target realm; when omitted, the default writable realm is used.";

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { DownloadFileToRealmInput } = commandModule;
    return DownloadFileToRealmInput;
  }

  requireInputFields = ['sourceUrl', 'path'];

  protected async run(
    input: BaseToolModule.DownloadFileToRealmInput,
  ): Promise<BaseToolModule.DownloadFileToRealmResult> {
    let { sourceUrl, realm, path, useNonConflictingFilename } = input;
    if (!sourceUrl) {
      throw new Error('A sourceUrl is required to download a file.');
    }
    if (!path) {
      throw new Error('A destination path is required.');
    }
    // The input's documented default. Resolved here — before the download —
    // because the binary-write path has no default of its own: handing it an
    // undefined realm would surface as an opaque `Invalid URL` TypeError
    // after the whole body had already been fetched.
    if (!realm) {
      let fallback = this.realm.defaultWritableRealm?.path;
      if (!fallback) {
        throw new Error(
          'No realm provided and no writable realm is available.',
        );
      }
      realm = fallback;
    }

    // `authedFetch` attaches the per-realm token when the URL belongs to a
    // known realm (so a gated realm's `_screenshot/` URL downloads), and is a
    // plain fetch for anything else. We read the body as bytes, not text, so a
    // binary file survives the download intact.
    let response = await this.network.authedFetch(sourceUrl, { method: 'GET' });
    if (!response.ok) {
      let text = await response.text().catch(() => '');
      throw new Error(
        `Failed to download ${sourceUrl} (${response.status} ${response.statusText}): ${text}`,
      );
    }

    let bytes = new Uint8Array(await response.arrayBuffer());
    let base64Content = uint8ArrayToBase64(bytes);

    // Persist through the existing binary-write path so the non-conflicting
    // filename handling, upload plumbing, and indexer promotion all stay in one
    // place — the caller never has to touch the bytes.
    // No content type is forwarded: the binary-write path always posts
    // octet-stream and the realm infers the file type from the destination
    // path's extension — which is why the description asks for one.
    let writeResult = await new WriteBinaryFileTool(this.toolContext).execute({
      path,
      realm,
      base64Content,
      useNonConflictingFilename,
    });

    let commandModule = await this.loadToolModule();
    const { DownloadFileToRealmResult } = commandModule;
    return new DownloadFileToRealmResult({
      fileIdentifier: writeResult.fileIdentifier,
    });
  }
}

// Pre-rename spelling parity with the other tools' command aliases.
export { DownloadFileToRealmTool as DownloadFileToRealmCommand };
