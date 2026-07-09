import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type NetworkService from '../services/network';

export default class AuthedFetchTool extends HostBaseTool<
  typeof BaseCommandModule.AuthedFetchInput,
  typeof BaseCommandModule.AuthedFetchResult
> {
  @service declare private network: NetworkService;

  description = 'Perform an authenticated HTTP fetch';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { AuthedFetchInput } = commandModule;
    return AuthedFetchInput;
  }

  requireInputFields = ['url'];

  protected async run(
    input: BaseCommandModule.AuthedFetchInput,
  ): Promise<BaseCommandModule.AuthedFetchResult> {
    let commandModule = await this.loadCommandModule();
    const { AuthedFetchResult } = commandModule;
    const headers: Record<string, string> = {};
    if (input.acceptHeader) {
      headers['Accept'] = input.acceptHeader;
    }
    const response = await this.network.authedFetch(input.url, {
      method: input.method ?? 'GET',
      headers,
    });
    let body: Record<string, any> = {};
    if (response.ok) {
      let text = await response.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = { rawText: text };
      }
    }
    return new AuthedFetchResult({
      ok: response.ok,
      status: response.status,
      body,
    });
  }
}
