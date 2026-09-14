import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import type RealmServerService from '../services/realm-server';
import type * as BaseToolModule from '@cardstack/base/command';

export default class SendRequestViaProxyTool extends HostBaseTool<
  typeof BaseToolModule.SendRequestViaProxyInput,
  typeof BaseToolModule.SendRequestViaProxyResult
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Send';
  description =
    'Make a request to an external API through the Boxel proxy. ' +
    'Optionally set timeoutMs to give up on a slow upstream and release ' +
    'the per-user lock that serializes your calls; omit it to wait ' +
    'indefinitely. Model calls through this proxy commonly take tens of ' +
    'seconds and have been observed beyond 100s, so a budget under two ' +
    'minutes will abandon answers that were coming. A call that times out ' +
    'returns no answer, and must not be assumed to have had no effect ' +
    'upstream.';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { SendRequestViaProxyInput } = commandModule;
    return SendRequestViaProxyInput;
  }

  protected async run(
    input: BaseToolModule.SendRequestViaProxyInput,
  ): Promise<BaseToolModule.SendRequestViaProxyResult> {
    const commandModule = await this.loadToolModule();
    const { SendRequestViaProxyResult } = commandModule;

    try {
      // Make the HTTP request to the realm server's _request-forward endpoint
      const response = await this.realmServer.requestForward({
        url: input.url,
        method: input.method,
        requestBody: input.requestBody,
        headers: input.headers,
        multipart: input.multipart,
        timeoutMs: input.timeoutMs,
      });

      return new SendRequestViaProxyResult({
        response,
      });
    } catch (error) {
      // Handle errors gracefully
      console.error('Request forward error:', error);

      // Create an error response object with proper type checking
      const errorMessage =
        error instanceof Error ? error.message : 'Request forward failed';
      const errorDetails =
        error instanceof Error ? error.toString() : String(error);

      const errorResponse = new Response(
        JSON.stringify({
          error: errorMessage,
          details: errorDetails,
        }),
        {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'Content-Type': 'application/json' },
        },
      );

      return new SendRequestViaProxyResult({
        response: errorResponse,
      });
    }
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { SendRequestViaProxyTool as SendRequestViaProxyCommand };
