import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import BooleanField from 'https://cardstack.com/base/boolean';
import UrlField from 'https://cardstack.com/base/url';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers';
import { Button } from '@cardstack/boxel-ui/components';

// Remove custom Event type
type BookFieldType = InstanceType<typeof BookField>;

// Book field definition
class BookField extends FieldDef {
  @field title = contains(StringField);
  @field author = contains(StringField);
  @field description = contains(MarkdownField);
  @field isFiction = contains(BooleanField);
  @field genre = contains(StringField); // For fiction: Fantasy, Science Fiction, Mystery, etc.
  @field category = contains(StringField); // For non-fiction: History, Self-Help, Science, etc.
  @field purchaseUrl = contains(UrlField);
}

class BookRecommenderIsolatedTemplate extends Component<
  typeof BookRecommender
> {
  @tracked step = 'preferences'; // 'preferences' or 'results'
  @tracked selectedBooks: BookFieldType[] = [];

  @action
  updatePrefersFiction(e: Event) {
    this.args.model.prefersFiction = (e.target as HTMLInputElement).checked;
  }

  @action
  updatePrefersNonFiction(e: Event) {
    this.args.model.prefersNonFiction = (e.target as HTMLInputElement).checked;
  }

  @action
  updateLikesFantasy(e: Event) {
    this.args.model.likesFantasy = (e.target as HTMLInputElement).checked;
  }

  @action
  updateLikesSciFi(e: Event) {
    this.args.model.likesSciFi = (e.target as HTMLInputElement).checked;
  }

  @action
  updateLikesMystery(e: Event) {
    this.args.model.likesMystery = (e.target as HTMLInputElement).checked;
  }

  @action
  updateLikesHistory(e: Event) {
    this.args.model.likesHistory = (e.target as HTMLInputElement).checked;
  }

  @action
  updateLikesSelfHelp(e: Event) {
    this.args.model.likesSelfHelp = (e.target as HTMLInputElement).checked;
  }

  @action
  updateLikesScience(e: Event) {
    this.args.model.likesScience = (e.target as HTMLInputElement).checked;
  }

  @action
  showResults() {
    this.step = 'results';
    this.selectedBooks = this.filterBooks();
  }

  @action
  resetPreferences() {
    this.args.model.prefersFiction = false;
    this.args.model.prefersNonFiction = false;
    this.args.model.likesFantasy = false;
    this.args.model.likesSciFi = false;
    this.args.model.likesMystery = false;
    this.args.model.likesHistory = false;
    this.args.model.likesSelfHelp = false;
    this.args.model.likesScience = false;
    this.step = 'preferences';
  }

  filterBooks() {
    try {
      const model = this.args.model;
      const books = model.books || [];
      const prefersFiction = model.prefersFiction;
      const prefersNonFiction = model.prefersNonFiction;
      const fictionGenres = [
        { key: 'likesFantasy', value: 'Fantasy' },
        { key: 'likesSciFi', value: 'Science Fiction' },
        { key: 'likesMystery', value: 'Mystery' },
      ];
      const nonFictionCategories = [
        { key: 'likesHistory', value: 'History' },
        { key: 'likesSelfHelp', value: 'Self-Help' },
        { key: 'likesScience', value: 'Science' },
      ];

      // If neither fiction nor non-fiction is selected, show all books
      if (!prefersFiction && !prefersNonFiction) {
        return books;
      }

      // Build filter criteria
      let filteredBooks = books.filter((book) => {
        // Filter by fiction/non-fiction
        if (prefersFiction && prefersNonFiction) {
          // Both selected, allow all
          return true;
        } else if (prefersFiction) {
          if (!book.isFiction) return false;
        } else if (prefersNonFiction) {
          if (book.isFiction) return false;
        }
        return true;
      });

      // Further filter by genres/categories if any are selected
      if (prefersFiction) {
        const selectedGenres = fictionGenres
          .filter((g) => model[g.key as keyof typeof model])
          .map((g) => g.value);
        if (selectedGenres.length > 0) {
          filteredBooks = filteredBooks.filter((book) => {
            if (book.isFiction) {
              return selectedGenres.includes(book.genre);
            }
            return true;
          });
        }
      }
      if (prefersNonFiction) {
        const selectedCategories = nonFictionCategories
          .filter((c) => model[c.key as keyof typeof model])
          .map((c) => c.value);
        if (selectedCategories.length > 0) {
          filteredBooks = filteredBooks.filter((book) => {
            if (!book.isFiction) {
              return selectedCategories.includes(book.category);
            }
            return true;
          });
        }
      }
      return filteredBooks;
    } catch (e) {
      console.error('Error filtering books:', e);
      return [];
    }
  }

  <template>
    <div class='book-recommender'>
      <h1>Book Recommender</h1>

      {{#if (eq this.step 'preferences')}}
        <div class='preferences'>
          <h2>What kinds of books do you enjoy?</h2>

          <div class='preference-section'>
            <h3>Book Type</h3>
            <div class='preference-options'>
              <label>
                <input
                  type='checkbox'
                  checked={{@model.prefersFiction}}
                  {{on 'change' this.updatePrefersFiction}}
                />
                Fiction
              </label>
              <label>
                <input
                  type='checkbox'
                  checked={{@model.prefersNonFiction}}
                  {{on 'change' this.updatePrefersNonFiction}}
                />
                Non-Fiction
              </label>
            </div>
          </div>

          {{#if @model.prefersFiction}}
            <div class='preference-section'>
              <h3>Fiction Genres</h3>
              <div class='preference-options'>
                <label>
                  <input
                    type='checkbox'
                    checked={{@model.likesFantasy}}
                    {{on 'change' this.updateLikesFantasy}}
                  />
                  Fantasy
                </label>
                <label>
                  <input
                    type='checkbox'
                    checked={{@model.likesSciFi}}
                    {{on 'change' this.updateLikesSciFi}}
                  />
                  Science Fiction
                </label>
                <label>
                  <input
                    type='checkbox'
                    checked={{@model.likesMystery}}
                    {{on 'change' this.updateLikesMystery}}
                  />
                  Mystery/Thriller
                </label>
              </div>
            </div>
          {{/if}}

          {{#if @model.prefersNonFiction}}
            <div class='preference-section'>
              <h3>Non-Fiction Categories</h3>
              <div class='preference-options'>
                <label>
                  <input
                    type='checkbox'
                    checked={{@model.likesHistory}}
                    {{on 'change' this.updateLikesHistory}}
                  />
                  History/Biography
                </label>
                <label>
                  <input
                    type='checkbox'
                    checked={{@model.likesSelfHelp}}
                    {{on 'change' this.updateLikesSelfHelp}}
                  />
                  Self-Help/Personal Development
                </label>
                <label>
                  <input
                    type='checkbox'
                    checked={{@model.likesScience}}
                    {{on 'change' this.updateLikesScience}}
                  />
                  Science/Technology
                </label>
              </div>
            </div>
          {{/if}}

          <div class='actions'>
            <Button {{on 'click' this.showResults}}>Find Books</Button>
          </div>
        </div>

      {{else}}
        <div class='results'>
          <h2>Recommended Books</h2>

          {{#if this.selectedBooks.length}}
            <div class='book-list'>
              {{#each this.selectedBooks as |book|}}
                <div class='book-card'>
                  <h3 class='book-title'>{{book.title}}</h3>
                  <div class='book-author'>by {{book.author}}</div>
                  <div class='book-details'>
                    <span class='book-tag'>{{if
                        book.isFiction
                        book.genre
                        book.category
                      }}</span>
                  </div>
                  <div class='book-description'>{{book.description}}</div>
                  {{#if book.purchaseUrl}}
                    <a
                      href={{book.purchaseUrl}}
                      target='_blank'
                      rel='noopener noreferrer'
                      class='book-link'
                    >
                      Find this book online
                    </a>
                  {{/if}}
                </div>
              {{/each}}
            </div>
          {{else}}
            <div class='no-results'>
              <p>No books match your preferences. Try selecting different
                preferences.</p>
            </div>
          {{/if}}

          <div class='actions'>
            <Button {{on 'click' this.resetPreferences}}>Change Preferences</Button>
          </div>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .book-recommender {
        max-width: 800px;
        margin: 0 auto;
        padding: 20px;
        font-family:
          system-ui,
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
      }

      h1 {
        color: #2c3e50;
        text-align: center;
        margin-bottom: 30px;
        font-size: 32px;
      }

      h2 {
        color: #3498db;
        margin-bottom: 20px;
        font-size: 24px;
      }

      h3 {
        color: #2c3e50;
        margin-bottom: 10px;
        font-size: 18px;
      }

      .preference-section {
        margin-bottom: 24px;
        padding: 15px;
        background-color: #f8f9fa;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .preference-options {
        display: flex;
        flex-wrap: wrap;
        gap: 15px;
      }

      label {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        padding: 8px 12px;
        border-radius: 4px;
        background-color: #fff;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        transition: all 0.2s;
      }

      label:hover {
        background-color: #e9f7fe;
      }

      .actions {
        margin-top: 24px;
        display: flex;
        justify-content: center;
      }

      .book-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 20px;
        margin-top: 20px;
      }

      .book-card {
        padding: 20px;
        border-radius: 8px;
        background-color: #f8f9fa;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        transition: transform 0.2s;
      }

      .book-card:hover {
        transform: translateY(-5px);
        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
      }

      .book-title {
        font-size: 18px;
        margin-top: 0;
        margin-bottom: 5px;
        color: #2c3e50;
      }

      .book-author {
        color: #7f8c8d;
        font-style: italic;
        margin-bottom: 10px;
      }

      .book-tag {
        display: inline-block;
        background-color: #3498db;
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        margin-bottom: 10px;
      }

      .book-description {
        font-size: 14px;
        line-height: 1.6;
        color: #34495e;
        margin-bottom: 15px;
      }

      .book-link {
        display: inline-block;
        background-color: #2ecc71;
        color: white;
        padding: 8px 12px;
        border-radius: 4px;
        text-decoration: none;
        font-weight: bold;
        transition: background-color 0.2s;
      }

      .book-link:hover {
        background-color: #27ae60;
      }

      .no-results {
        text-align: center;
        padding: 30px;
        background-color: #f8f9fa;
        border-radius: 8px;
        color: #7f8c8d;
      }
    </style>
  </template>
}

export class BookRecommender extends CardDef {
  static displayName = 'Book Recommender';

  // User preferences
  @field prefersFiction = contains(BooleanField);
  @field prefersNonFiction = contains(BooleanField);
  @field likesFantasy = contains(BooleanField);
  @field likesSciFi = contains(BooleanField);
  @field likesMystery = contains(BooleanField);
  @field likesHistory = contains(BooleanField);
  @field likesSelfHelp = contains(BooleanField);
  @field likesScience = contains(BooleanField);

  // Books data
  @field books = containsMany(BookField);

  static isolated = BookRecommenderIsolatedTemplate;
}
