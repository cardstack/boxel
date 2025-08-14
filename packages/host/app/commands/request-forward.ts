import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type RealmServerService from '../services/realm-server';

export default class RequestForwardCommand extends HostBaseCommand<
  typeof BaseCommandModule.RequestForwardInput,
  typeof BaseCommandModule.RequestForwardResult
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Forward Request';
  description = 'Forward a request to an external API through the realm server';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { RequestForwardInput } = commandModule;
    return RequestForwardInput;
  }

  protected async run(
    input: BaseCommandModule.RequestForwardInput,
  ): Promise<BaseCommandModule.RequestForwardResult> {
    const commandModule = await this.loadCommandModule();
    const { RequestForwardResult } = commandModule;

    try {
      // Make the HTTP request to the realm server's _request-forward endpoint
      const response = await this.realmServer.requestForward({
        url: input.url,
        method: input.method,
        requestBody: input.requestBody,
        headers: input.headers,
      });

      return new RequestForwardResult({
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

      return new RequestForwardResult({
        response: errorResponse,
      });
    }
  }
}
