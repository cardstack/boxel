import { service } from '@ember/service';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type NetworkService from '../services/network';

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const maybeBuffer = (globalThis as any).Buffer as
    | { from(input: Uint8Array): { toString(encoding: string): string } }
    | undefined;

  if (typeof maybeBuffer !== 'undefined') {
    return maybeBuffer.from(bytes).toString('base64');
  }

  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default class ReadBinaryFileTool extends HostBaseTool<
  typeof BaseToolModule.ReadBinaryFileInput,
  typeof BaseToolModule.ReadBinaryFileResult
> {
  @service declare private network: NetworkService;

  description =
    'Read a binary file from a URL and return its content as base64';
  static actionVerb = 'Read';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { ReadBinaryFileInput } = commandModule;
    return ReadBinaryFileInput;
  }

  requireInputFields = ['fileIdentifier'];

  protected async run(
    input: BaseToolModule.ReadBinaryFileInput,
  ): Promise<BaseToolModule.ReadBinaryFileResult> {
    let response = await this.network.authedFetch(input.fileIdentifier);
    let { ReadBinaryFileResult } = await this.loadToolModule();

    if (!response.ok) {
      throw new Error(
        `Error reading binary file ${input.fileIdentifier}: ${response.statusText}`,
      );
    }

    let arrayBuffer = await response.arrayBuffer();
    let bytes = new Uint8Array(arrayBuffer);
    let base64Content = uint8ArrayToBase64(bytes);
    let contentType = response.headers.get('content-type') ?? '';

    return new ReadBinaryFileResult({ base64Content, contentType });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { ReadBinaryFileTool as ReadBinaryFileCommand };
