import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import SendRequestViaProxyCommand from './send-request-via-proxy';

import type CommandService from '../services/command-service';

export default class SearchGoogleImagesCommand extends HostBaseCommand<
  typeof BaseCommandModule.SearchGoogleImagesInput,
  typeof BaseCommandModule.SearchGoogleImagesResult
> {
  @service declare private commandService: CommandService;

  static actionVerb = 'Search Google Images';
  description = 'Search for images on Google using the Custom Search API';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { SearchGoogleImagesInput } = commandModule;
    return SearchGoogleImagesInput;
  }

  protected async run(
    input: BaseCommandModule.SearchGoogleImagesInput,
  ): Promise<BaseCommandModule.SearchGoogleImagesResult> {
    const commandModule = await this.loadCommandModule();
    const { SearchGoogleImagesResult } = commandModule;

    try {
      const maxResults = input.maxResults || 10;
      const searchQuery = encodeURIComponent(input.query);

      // Build the Google Custom Search API URL
      // The API key and search engine ID will be handled by the proxy endpoint
      const searchUrl = `https://www.googleapis.com/customsearch/v1?q=${searchQuery}&searchType=image&num=${Math.min(maxResults, 10)}`;

      const sendRequestViaProxyCommand = new SendRequestViaProxyCommand(
        this.commandService.commandContext,
      );

      const result = await sendRequestViaProxyCommand.execute({
        url: searchUrl,
        method: 'GET',
        requestBody: '',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!result.response.ok) {
        throw new Error(
          `Failed to search Google Images: ${result.response.statusText}`,
        );
      }

      const responseData = await result.response.json();

      // Extract image results from Google API response
      const images =
        responseData.items?.map((item: any) => ({
          title: item.title || '',
          imageUrl: item.link || '',
          thumbnailUrl: item.image?.thumbnailLink || '',
          contextUrl: item.image?.contextLink || '',
          width: item.image?.width || 0,
          height: item.image?.height || 0,
        })) || [];

      const totalResults = responseData.searchInformation?.totalResults || 0;
      const searchTime = responseData.searchInformation?.searchTime || 0;

      return new SearchGoogleImagesResult({
        images,
        totalResults: parseInt(totalResults) || 0,
        searchTime: parseFloat(searchTime) || 0,
      });
    } catch (error) {
      console.error('Google Image Search error:', error);
      throw error;
    }
  }
}
