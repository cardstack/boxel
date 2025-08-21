import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import { commandData } from 'https://cardstack.com/base/resources/command-data';
import {
  SearchGoogleImagesInput,
  SearchGoogleImagesResult,
} from 'https://cardstack.com/base/command';
import SearchGoogleImagesCommand from '@cardstack/boxel-host/commands/search-google-images';
import { Button, FieldContainer } from '@cardstack/boxel-ui/components';
import { IconSearchThick } from '@cardstack/boxel-ui/icons';
import ArrowRight from '@cardstack/boxel-icons/arrow-right';
import ArrowLeft from '@cardstack/boxel-icons/arrow-left';
import { or, not } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';

export class GoogleImageSearch extends CardDef {
  static displayName = 'Google Image Search';

  @field searchQuery = contains(StringField);
  @field maxResults = contains(NumberField);

  @tracked currentPage = 1;
  @tracked searchPerformed = false;

  static isolated = class Isolated extends Component<typeof this> {
    searchResource = commandData<
      typeof SearchGoogleImagesInput,
      typeof SearchGoogleImagesResult
    >(this, SearchGoogleImagesCommand, () => {
      return {
        query: this.args.model.searchQuery,
        maxResults: this.args.model.maxResults || 10,
        startIndex: this.args.model.currentPage,
      };
    });

    get searchResults() {
      const resource = this.searchResource;
      if (resource?.isSuccess && resource.value?.images) {
        return resource.value.images;
      }
      return [];
    }

    get searchInfo() {
      const resource = this.searchResource;
      console.log('resource', resource);
      if (resource?.isSuccess && resource.value) {
        return {
          totalResults: resource.value.totalResults,
          formattedTotalResults: resource.value.formattedTotalResults,
          formattedSearchTime: resource.value.formattedSearchTime,
          hasNextPage: resource.value.hasNextPage,
          nextPageStartIndex: resource.value.nextPageStartIndex,
          currentStartIndex: resource.value.currentStartIndex,
        };
      }
      return null;
    }

    get isLoading() {
      return this.searchResource.isLoading;
    }

    get isError() {
      return !!this.searchResource.error;
    }

    get errorMessage() {
      return (
        this.searchResource.error?.message ||
        'An error occurred while searching'
      );
    }

    get canGoNext() {
      return this.searchInfo?.hasNextPage && !this.isLoading;
    }

    get canGoPrevious() {
      return (
        this.args.model.currentPage &&
        this.args.model.currentPage > 1 &&
        !this.isLoading
      );
    }

    performSearch = () => {
      if (this.args.model.searchQuery) {
        this.args.model.searchPerformed = true;
        this.args.model.currentPage = 1;
      }
    };

    nextPage = () => {
      if (this.canGoNext && this.args.model.currentPage) {
        this.args.model.currentPage++;
      }
    };

    previousPage = () => {
      if (this.canGoPrevious && this.args.model.currentPage) {
        this.args.model.currentPage--;
      }
    };

    handleKeyPress = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        this.performSearch();
      }
    };

    openImageInNewTab = (imageUrl: string) => {
      window.open(imageUrl, '_blank');
    };

    setSearchQuery = (e: Event) => {
      this.args.model.searchQuery = (e.target as HTMLInputElement).value;
    };

    setMaxResults = (e: Event) => {
      this.args.model.maxResults = Number((e.target as HTMLInputElement).value);
    };

    <template>
      <div class='google-image-search'>
        <div class='search-form'>
          <FieldContainer @label='Search Query'>
            <input
              type='text'
              class='search-input'
              placeholder='Enter your search query...'
              value={{@model.searchQuery}}
              {{on 'input' this.setSearchQuery}}
              {{on 'keypress' this.handleKeyPress}}
              id='search-query-input'
            />
          </FieldContainer>

          <FieldContainer @label='Max Results (1-10)'>
            <input
              type='number'
              class='max-results-input'
              min='1'
              max='10'
              value={{@model.maxResults}}
              {{on 'input' this.setMaxResults}}
              id='max-results-input'
            />
          </FieldContainer>

          <Button
            @variant='primary'
            @size='medium'
            @disabled={{this.isLoading}}
            class='search-button'
            {{on 'click' this.performSearch}}
          >
            <IconSearchThick />
            Search Images
          </Button>
        </div>

        {{#if this.isLoading}}
          <div class='loading-state'>
            <div class='loading-spinner'></div>
            <p>Searching for images...</p>
          </div>
        {{/if}}

        {{#if this.isError}}
          <div class='error-state'>
            <p class='error-message'>{{this.errorMessage}}</p>
            <Button @variant='secondary' @onClick={{this.performSearch}}>
              Try Again
            </Button>
          </div>
        {{/if}}

        {{#if @model.searchPerformed}}
          {{#if this.searchInfo}}
            <div class='search-info'>
              <p>
                Found
                {{this.searchInfo.formattedTotalResults}}
                results
                {{#if this.searchInfo.formattedSearchTime}}
                  in
                  {{this.searchInfo.formattedSearchTime}}
                  seconds
                {{/if}}
              </p>
            </div>
          {{/if}}

          {{#if this.searchResults.length}}
            <div class='image-grid'>
              {{#each this.searchResults as |image|}}
                <div class='image-card'>
                  <div class='image-container'>
                    <img
                      src={{image.thumbnailUrl}}
                      alt={{image.title}}
                      class='image-thumbnail'
                      loading='lazy'
                    />
                  </div>
                  <div class='image-info'>
                    <h4 class='image-title'>{{image.title}}</h4>
                    <p class='image-snippet'>{{image.snippet}}</p>
                    <div class='image-meta'>
                      <span class='image-dimensions'>{{image.width}}
                        ×
                        {{image.height}}</span>
                      {{#if image.byteSize}}
                        <span class='image-size'>{{this.formatFileSize
                            image.byteSize
                          }}</span>
                      {{/if}}
                    </div>
                    <Button
                      @variant='secondary'
                      @size='small'
                      class='open-image-button'
                      {{on 'click' (fn this.openImageInNewTab image.imageUrl)}}
                    >
                      Open Image
                    </Button>
                  </div>
                </div>
              {{/each}}
            </div>

            {{#if (or this.canGoPrevious this.canGoNext)}}
              <div class='pagination'>
                <Button
                  @variant='secondary'
                  @onClick={{this.previousPage}}
                  @disabled={{not this.canGoPrevious}}
                  class='pagination-button'
                >
                  <ArrowLeft />
                  Previous
                </Button>

                <span class='page-info'>
                  Page
                  {{@model.currentPage}}
                  {{#if this.searchInfo}}
                    of
                    {{this.calculateTotalPages this.searchInfo.totalResults}}
                  {{/if}}
                </span>

                <Button
                  @variant='secondary'
                  @onClick={{this.nextPage}}
                  @disabled={{not this.canGoNext}}
                  class='pagination-button'
                >
                  Next
                  <ArrowRight />
                </Button>
              </div>
            {{/if}}
          {{else if (not this.isLoading)}}
            <div class='no-results'>
              <p>No images found for "{{@model.searchQuery}}"</p>
              <p>Try a different search term or check your spelling.</p>
            </div>
          {{/if}}
        {{/if}}
      </div>

      <style scoped>
        .google-image-search {
          padding: var(--boxel-sp-lg);
          max-width: 1200px;
          margin: 0 auto;
        }

        .search-form {
          display: flex;
          gap: var(--boxel-sp-md);
          align-items: end;
          margin-bottom: var(--boxel-sp-xl);
          flex-wrap: wrap;
        }

        .search-input {
          width: 300px;
          padding: var(--boxel-sp-sm) var(--boxel-sp-md);
          border: 1px solid var(--boxel-color-neutral-300);
          border-radius: var(--boxel-border-radius);
          font-size: var(--boxel-font-size-base);
        }

        .max-results-input {
          width: 120px;
          padding: var(--boxel-sp-sm) var(--boxel-sp-md);
          border: 1px solid var(--boxel-color-neutral-300);
          border-radius: var(--boxel-border-radius);
          font-size: var(--boxel-font-size-base);
        }

        .search-button {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }

        .loading-state {
          text-align: center;
          padding: var(--boxel-sp-xl);
        }

        .loading-spinner {
          width: 40px;
          height: 40px;
          border: 4px solid var(--boxel-color-neutral-200);
          border-top: 4px solid var(--boxel-color-primary-500);
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto var(--boxel-sp-md);
        }

        @keyframes spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }

        .error-state {
          text-align: center;
          padding: var(--boxel-sp-xl);
          background-color: var(--boxel-color-error-50);
          border: 1px solid var(--boxel-color-error-200);
          border-radius: var(--boxel-border-radius);
          margin-bottom: var(--boxel-sp-lg);
        }

        .error-message {
          color: var(--boxel-color-error-700);
          margin-bottom: var(--boxel-sp-md);
        }

        .search-info {
          margin-bottom: var(--boxel-sp-lg);
          padding: var(--boxel-sp-md);
          background-color: var(--boxel-color-neutral-50);
          border-radius: var(--boxel-border-radius);
        }

        .image-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: var(--boxel-sp-lg);
          margin-bottom: var(--boxel-sp-xl);
        }

        .image-card {
          border: 1px solid var(--boxel-color-neutral-200);
          border-radius: var(--boxel-border-radius);
          overflow: hidden;
          transition:
            transform 0.2s ease,
            box-shadow 0.2s ease;
          background: white;
        }

        .image-container {
          width: 100%;
          height: 200px;
          overflow: hidden;
          background-color: var(--boxel-color-neutral-100);
        }

        .image-thumbnail {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.2s ease;
        }

        .image-card:hover .image-thumbnail {
          transform: scale(1.05);
        }

        .image-info {
          padding: var(--boxel-sp-md);
        }

        .image-title {
          margin: 0 0 var(--boxel-sp-xs) 0;
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
          color: var(--boxel-color-neutral-900);
          line-height: 1.3;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .image-snippet {
          margin: 0 0 var(--boxel-sp-sm) 0;
          font-size: var(--boxel-font-size-xs);
          color: var(--boxel-color-neutral-600);
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .image-meta {
          display: flex;
          gap: var(--boxel-sp-sm);
          font-size: var(--boxel-font-size-xs);
          color: var(--boxel-color-neutral-500);
          margin-bottom: var(--boxel-sp-sm);
        }

        .open-image-button {
          width: 100%;
          margin-top: var(--boxel-sp-xs);
        }

        .pagination {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: var(--boxel-sp-md);
          margin-top: var(--boxel-sp-xl);
        }

        .pagination-button {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }

        .page-info {
          font-size: var(--boxel-font-size-sm);
          color: var(--boxel-color-neutral-600);
          min-width: 100px;
          text-align: center;
        }

        .no-results {
          text-align: center;
          padding: var(--boxel-sp-xl);
          color: var(--boxel-color-neutral-600);
        }

        @media (max-width: 768px) {
          .search-form {
            flex-direction: column;
            align-items: stretch;
          }

          .search-input,
          .max-results-input {
            width: 100%;
          }

          .image-grid {
            grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
            gap: var(--boxel-sp-md);
          }

          .pagination {
            flex-direction: column;
            gap: var(--boxel-sp-sm);
          }
        }
      </style>
    </template>

    formatFileSize = (bytes: number): string => {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    calculateTotalPages = (totalResults: number): number => {
      const maxResults = this.args.model.maxResults || 10;
      return Math.ceil(totalResults / maxResults);
    };
  };
}
