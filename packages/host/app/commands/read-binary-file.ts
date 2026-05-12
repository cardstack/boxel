import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

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

export default class ReadBinaryFileCommand extends HostBaseCommand<
  typeof BaseCommandModule.ReadBinaryFileInput,
  typeof BaseCommandModule.ReadBinaryFileResult
> {
  @service declare private network: NetworkService;

  description =
    'Read a binary file from a URL and return its content as base64';
  static actionVerb = 'Read';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ReadBinaryFileInput } = commandModule;
    return ReadBinaryFileInput;
  }

  requireInputFields = ['fileIdentifier'];

  protected async run(
    input: BaseCommandModule.ReadBinaryFileInput,
  ): Promise<BaseCommandModule.ReadBinaryFileResult> {
    let response = await this.network.authedFetch(input.fileIdentifier);
    let { ReadBinaryFileResult } = await this.loadCommandModule();

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
