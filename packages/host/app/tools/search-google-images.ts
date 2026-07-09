import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import SendRequestViaProxyCommand from './send-request-via-proxy';

export default class SearchGoogleImagesCommand extends HostBaseCommand<
  typeof BaseCommandModule.SearchGoogleImagesInput,
  typeof BaseCommandModule.SearchGoogleImagesResult
> {
  static actionVerb = 'Search Google Images';
  description = 'Search for images on Google using the Custom Search API';
  requireInputFields = ['query'];

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
      const startIndex = input.startIndex || 1;
      const searchQuery = encodeURIComponent(input.query);

      // Build the Google Custom Search API URL
      // The API key will be handled by the proxy endpoint
      const searchUrl = `https://www.googleapis.com/customsearch/v1?q=${searchQuery}&searchType=image&num=${Math.min(maxResults, 10)}&start=${startIndex}&cx=064501294a5c9430a`;

      const sendRequestViaProxyCommand = new SendRequestViaProxyCommand(
        this.commandContext,
      );

      const result = await sendRequestViaProxyCommand.execute({
        url: searchUrl,
        method: 'GET',
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
          byteSize: item.image?.byteSize || 0,
          thumbnailWidth: item.image?.thumbnailWidth || 0,
          thumbnailHeight: item.image?.thumbnailHeight || 0,
          mime: item.mime || '',
          fileFormat: item.fileFormat || '',
          displayLink: item.displayLink || '',
          snippet: item.snippet || '',
        })) || [];

      const totalResults = responseData.searchInformation?.totalResults || 0;
      const searchTime = responseData.searchInformation?.searchTime || 0;
      const formattedTotalResults =
        responseData.searchInformation?.formattedTotalResults || '';
      const formattedSearchTime =
        responseData.searchInformation?.formattedSearchTime || '';

      // Extract pagination information
      const nextPage = responseData.queries?.nextPage?.[0] || null;
      const hasNextPage = !!nextPage;

      return new SearchGoogleImagesResult({
        images,
        totalResults: parseInt(totalResults) || 0,
        searchTime: parseFloat(searchTime) || 0,
        formattedTotalResults,
        formattedSearchTime,
        hasNextPage,
        nextPageStartIndex: nextPage?.startIndex || null,
        currentStartIndex: startIndex,
      });
    } catch (error) {
      console.error('Google Image Search error:', error);
      throw error;
    }
  }
}
