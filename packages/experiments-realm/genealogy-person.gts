// ═══ [EDIT TRACKING: ON] Mark all changes with ⁽ⁿ⁾ 180 ═══
import {
  CardDef,
  FieldDef,
  field,
  contains,
  linksToMany,
  Component,
  realmURL,
} from 'https://cardstack.com/base/card-api'; // ⁽¹⁾ Core imports
import StringField from 'https://cardstack.com/base/string';
import DateField from 'https://cardstack.com/base/date';
import TextAreaField from 'https://cardstack.com/base/text-area';
import MarkdownField from 'https://cardstack.com/base/markdown';
import SearchIcon from '@cardstack/boxel-icons/search';
import UsersIcon from '@cardstack/boxel-icons/users'; // ⁽²⁾ Icon import
import { CardContainer } from '@cardstack/boxel-ui/components'; // ⁽³⁾ UI components
import { eq, gt, and, formatDateTime, cn } from '@cardstack/boxel-ui/helpers'; // ⁽⁴⁾ Helper imports
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { Query } from '@cardstack/runtime-common'; // ⁽¹⁸¹⁾ Query import for parent search

// ⁽⁶⁾ Embedded format for name display
class EmbeddedNameField extends Component<typeof NameField> {
  get fullName() {
    try {
      const parts = [];
      if (this.args?.model?.firstName) parts.push(this.args.model.firstName);
      if (this.args?.model?.middleName) parts.push(this.args.model.middleName);
      if (this.args?.model?.lastName) parts.push(this.args.model.lastName);

      const full = parts.join(' ').trim();
      if (!full && this.args?.model?.nickname) return this.args.model.nickname;
      return full || 'Unknown Name';
    } catch (e) {
      console.error('NameField: Error computing fullName', e);
      return 'Unknown Name';
    }
  }

  <template>
    <span class='person-name'>
      {{this.fullName}}
      {{#if @model.nickname}}
        <span class='nickname'>"{{@model.nickname}}"</span>
      {{/if}}
      {{#if
        (and
          @model.maidenName
          @model.lastName
          (eq @model.maidenName @model.lastName false)
        )
      }}
        <span class='maiden-name'>(née {{@model.maidenName}})</span>
      {{/if}}
    </span>

    <style scoped>
      /* ⁽⁷⁾ Name styling */
      .person-name {
        font-weight: 500;
        color: #1f2937;
      }

      .nickname {
        font-style: italic;
        color: #6b7280;
        margin-left: 0.25rem;
      }

      .maiden-name {
        font-size: 0.875em;
        color: #6b7280;
        margin-left: 0.25rem;
      }
    </style>
  </template>
}

// ⁽⁵⁾ Name field for genealogy
export class NameField extends FieldDef {
  static displayName = 'Name';

  @field firstName = contains(StringField);
  @field middleName = contains(StringField);
  @field lastName = contains(StringField);
  @field maidenName = contains(StringField);
  @field nickname = contains(StringField);

  static embedded = EmbeddedNameField;
}

// ⁽⁹⁾ Embedded format for place display
class EmbeddedPlaceField extends Component<typeof PlaceField> {
  get placeDisplay() {
    try {
      const parts = [];
      if (this.args?.model?.city) parts.push(this.args.model.city);
      if (this.args?.model?.state) parts.push(this.args.model.state);
      if (this.args?.model?.country) parts.push(this.args.model.country);
      return parts.join(', ') || 'Unknown location';
    } catch (e) {
      console.error('PlaceField: Error computing place', e);
      return 'Unknown location';
    }
  }

  <template>
    <span class='place-display'>{{this.placeDisplay}}</span>

    <style scoped>
      /* ⁽¹⁰⁾ Place styling */
      .place-display {
        color: #6b7280;
        font-size: 0.875rem;
      }
    </style>
  </template>
}

// ⁽⁸⁾ Place field for birth/death locations
export class PlaceField extends FieldDef {
  static displayName = 'Place';

  @field city = contains(StringField);
  @field state = contains(StringField);
  @field country = contains(StringField);

  static embedded = EmbeddedPlaceField;
}

// ⁽¹⁵⁾ Isolated format for detailed genealogy view
class IsolatedGenealogyPerson extends Component<typeof GenealogyPerson> {
  @tracked showFullBiography = false;

  // ⁽¹⁸²⁾ Dynamic query to find this person's parents -  module: new URL('./genealogy-person', import.meta.url).href,
  get parentsQuery(): Query {
    const personId = this.args?.model?.id;

    // We can use relative paths method:
    return {
      filter: {
        on: {
          module: 'http://localhost:4201/experiments/genealogy-person', //absolute path method
          name: 'GenealogyPerson',
        },
        any: [
          {
            eq: {
              'children.id': personId ?? '',
            },
          },
        ],
      },
    };
  }

  get lifespan() {
    try {
      const birthYear = this.args?.model?.birthDate
        ? new Date(this.args.model.birthDate).getFullYear()
        : null;
      const deathYear = this.args?.model?.deathDate
        ? new Date(this.args.model.deathDate).getFullYear()
        : null;

      if (birthYear && deathYear) {
        return `${birthYear} - ${deathYear}`;
      } else if (birthYear) {
        return `${birthYear} - present`;
      } else if (deathYear) {
        return `unknown - ${deathYear}`;
      }
      return 'Dates unknown';
    } catch (e) {
      console.error('GenealogyPerson: Error computing lifespan', e);
      return 'Dates unknown';
    }
  }

  get hasChildren() {
    try {
      return (
        Array.isArray(this.args?.model?.children) &&
        this.args.model.children.length > 0
      );
    } catch (e) {
      return false;
    }
  }

  get truncatedBiography() {
    try {
      const bio = this.args?.model?.biography;
      if (!bio || typeof bio !== 'string') return null;
      return bio.length > 200 ? bio.substring(0, 200) + '...' : bio;
    } catch (e) {
      return null;
    }
  }

  private get realms(): string[] {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  toggleBiography = () => {
    this.showFullBiography = !this.showFullBiography;
  };

  <template>
    <!-- ⁽¹⁶⁾ Responsive stage/mat pattern -->
    <div class='genealogy-stage'>
      <div class='genealogy-mat'>
        <!-- ⁽¹⁷⁾ Person header -->
        <header class='person-header'>
          <div class='name-section'>
            {{#if @model.name}}
              <h1><@fields.name /></h1>
            {{else}}
              <h1 class='unknown-name'>Unknown Person</h1>
            {{/if}}
            <div class='lifespan'>{{this.lifespan}}</div>
          </div>

          {{#if @model.occupation}}
            <div class='occupation'>
              <svg
                class='occupation-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <rect x='2' y='3' width='20' height='14' rx='2' ry='2' />
                <line x1='8' y1='21' x2='16' y2='21' />
                <line x1='12' y1='17' x2='12' y2='21' />
              </svg>
              <span>{{@model.occupation}}</span>
            </div>
          {{/if}}
        </header>

        <!-- ⁽¹⁸⁾ Life details section -->
        <section class='life-details'>
          {{#if @model.birthDate}}
            <div class='life-event'>
              <svg
                class='event-icon birth'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='10' />
                <line x1='12' y1='8' x2='12' y2='12' />
                <line x1='8' y1='12' x2='16' y2='12' />
              </svg>
              <div class='event-details'>
                <strong>Born:</strong>
                {{formatDateTime @model.birthDate 'MMMM D, YYYY'}}
                {{#if @model.birthPlace}}
                  in
                  <@fields.birthPlace />
                {{/if}}
              </div>
            </div>
          {{/if}}

          {{#if @model.deathDate}}
            <div class='life-event'>
              <svg
                class='event-icon death'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='10' />
                <line x1='8' y1='8' x2='16' y2='16' />
                <line x1='16' y1='8' x2='8' y2='16' />
              </svg>
              <div class='event-details'>
                <strong>Died:</strong>
                {{formatDateTime @model.deathDate 'MMMM D, YYYY'}}
                {{#if @model.deathPlace}}
                  in
                  <@fields.deathPlace />
                {{/if}}
              </div>
            </div>
          {{/if}}
        </section>

        <!-- ⁽¹⁹⁾ Family tree section -->
        <section class='family-tree'>
          <h2>
            <svg
              class='section-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path d='M12 2v6' />
              <path d='M12 8c0 4-2 6-6 6' />
              <path d='M12 8c0 4 2 6 6 6' />
              <circle cx='6' cy='14' r='2' />
              <circle cx='18' cy='14' r='2' />
              <circle cx='12' cy='5' r='3' />
            </svg>
            Family Tree
          </h2>

          <!-- ⁽¹⁸³⁾ Parents section with query -->
          <div class='family-section'>
            <h3>Parents</h3>
            {{#let
              (component @context.prerenderedCardSearchComponent)
              as |PrerenderedCardSearch|
            }}
              <PrerenderedCardSearch
                @query={{this.parentsQuery}}
                @format='embedded'
                @realms={{this.realms}}
                @isLive={{true}}
              >
                <:loading>
                  <div class='loading-state'>
                    <svg
                      class='loading-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <path
                        d='M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c1.47 0 2.85.36 4.07.99'
                      />
                    </svg>
                    Searching for parents...
                  </div>
                </:loading>

                <:response as |parents|>
                  {{#if (gt parents.length 0)}}
                    <div class='parents-grid'>
                      {{#each parents key='url' as |parent|}}
                        <CardContainer
                          {{@context.cardComponentModifier
                            cardId=parent.url
                            format='data'
                            fieldType=undefined
                            fieldName=undefined
                          }}
                          @displayBoundaries={{true}}
                          class='family-member parent'
                        >
                          <parent.component />
                        </CardContainer>
                      {{/each}}
                    </div>
                  {{else}}
                    <p class='no-family'>No parents found in family tree</p>
                  {{/if}}
                </:response>
              </PrerenderedCardSearch>
            {{/let}}
          </div>

          <!-- ⁽²⁰⁾ Children section -->
          {{#if this.hasChildren}}
            <div class='family-section'>
              <h3>Children</h3>
              <div class='children-grid'>
                {{#each @fields.children as |child|}}
                  <CardContainer
                    {{@context.cardComponentModifier
                      cardId=child.id
                      format='data'
                      fieldType=undefined
                      fieldName=undefined
                    }}
                    @displayBoundaries={{true}}
                    class='family-member child'
                  >
                    <child @format='embedded' />
                  </CardContainer>
                {{/each}}
              </div>
            </div>
          {{else}}
            <div class='family-section'>
              <h3>Children</h3>
              <p class='no-family'>No children recorded</p>
            </div>
          {{/if}}
        </section>

        <!-- ⁽²³⁾ Biography section -->
        {{#if @model.biography}}
          <section class='biography-section'>
            <h2>
              <svg
                class='section-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path
                  d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
                />
                <polyline points='14,2 14,8 20,8' />
                <line x1='16' y1='13' x2='8' y2='13' />
                <line x1='16' y1='17' x2='8' y2='17' />
                <polyline points='10,9 9,9 8,9' />
              </svg>
              Biography
            </h2>
            <div class='biography-content'>
              {{#if this.showFullBiography}}
                <@fields.biography />
                <button
                  class='toggle-biography'
                  {{on 'click' this.toggleBiography}}
                >
                  Show Less
                </button>
              {{else}}
                {{#if this.truncatedBiography}}
                  <p>{{this.truncatedBiography}}</p>
                  <button
                    class='toggle-biography'
                    {{on 'click' this.toggleBiography}}
                  >
                    Read More
                  </button>
                {{else}}
                  <@fields.biography />
                {{/if}}
              {{/if}}
            </div>
          </section>
        {{/if}}

        <!-- ⁽²⁴⁾ Notes section -->
        {{#if @model.notes}}
          <section class='notes-section'>
            <h2>
              <svg
                class='section-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path
                  d='M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'
                />
                <rect x='8' y='2' width='8' height='4' rx='1' ry='1' />
                <path d='M8 12h8' />
                <path d='M8 16h6' />
              </svg>
              Research Notes
            </h2>
            <div class='notes-content'>
              <@fields.notes />
            </div>
          </section>
        {{/if}}
      </div>
    </div>

    <style scoped>
      /* ⁽²⁵⁾ Complete genealogy styling */
      /* Responsive stage pattern */
      .genealogy-stage {
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
        padding: 1rem;
      }

      @media (max-width: 800px) {
        .genealogy-stage {
          padding: 0;
        }
      }

      /* Mat for scrollable content */
      .genealogy-mat {
        max-width: 64rem;
        width: 100%;
        background: white;
        border-radius: 0.75rem;
        box-shadow:
          0 10px 25px -3px rgba(0, 0, 0, 0.1),
          0 4px 6px -2px rgba(0, 0, 0, 0.05);
        padding: 2rem;
        overflow-y: auto;
        max-height: 100%;
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
      }

      @media (max-width: 800px) {
        .genealogy-mat {
          max-width: none;
          height: 100%;
          border-radius: 0;
          padding: 1.5rem;
        }
      }

      /* Person header styling */
      .person-header {
        border-bottom: 2px solid #e5e7eb;
        padding-bottom: 1.5rem;
        margin-bottom: 2rem;
      }

      .name-section h1 {
        font-size: 2rem;
        font-weight: 700;
        color: #111827;
        margin: 0 0 0.5rem 0;
        line-height: 1.2;
      }

      .unknown-name {
        color: #9ca3af;
        font-style: italic;
      }

      .lifespan {
        font-size: 1.125rem;
        color: #6b7280;
        font-weight: 500;
      }

      .occupation {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-top: 1rem;
        color: #4338ca;
        font-weight: 500;
      }

      .occupation-icon {
        width: 1.25rem;
        height: 1.25rem;
      }

      /* Life details styling */
      .life-details {
        margin-bottom: 2rem;
      }

      .life-event {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        margin-bottom: 1rem;
        padding: 0.75rem;
        background: #f9fafb;
        border-radius: 0.5rem;
      }

      .event-icon {
        width: 1.25rem;
        height: 1.25rem;
        margin-top: 0.125rem;
        flex-shrink: 0;
      }

      .event-icon.birth {
        color: #059669;
      }

      .event-icon.death {
        color: #dc2626;
      }

      .event-details {
        color: #374151;
        line-height: 1.4;
      }

      /* Family tree styling */
      .family-tree h2,
      .biography-section h2,
      .notes-section h2 {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 1.5rem;
        font-weight: 600;
        color: #111827;
        margin: 2rem 0 1rem 0;
        border-bottom: 1px solid #e5e7eb;
        padding-bottom: 0.5rem;
      }

      .section-icon {
        width: 1.5rem;
        height: 1.5rem;
        color: #6366f1;
      }

      .family-section {
        margin-bottom: 2rem;
      }

      .family-section h3 {
        font-size: 1.125rem;
        font-weight: 600;
        color: #374151;
        margin: 0 0 0.75rem 0;
      }

      /* Family grid layouts */
      .family-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
      }

      @media (max-width: 640px) {
        .family-grid {
          grid-template-columns: 1fr;
        }
      }

      .children-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 1rem;
      }

      .parents-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1rem;
        max-width: 600px; /* ⁽¹⁸⁴⁾ Limit to 2 parents typically */
      }

      /* ⁽¹⁸⁵⁾ Loading state styling */
      .loading-state {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 1rem;
        color: #6b7280;
        font-style: italic;
      }

      .loading-icon {
        width: 1rem;
        height: 1rem;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      /* Family member cards */
      .family-member {
        border-radius: 0.5rem;
        transition: all 0.2s ease;
        cursor: pointer;
      }

      .family-member:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }

      .family-placeholder {
        background: #f3f4f6;
        border: 2px dashed #d1d5db;
        border-radius: 0.5rem;
        padding: 1.5rem;
        text-align: center;
        color: #6b7280;
        font-style: italic;
      }

      .no-family {
        color: #6b7280;
        font-style: italic;
        margin: 0;
      }

      /* Biography and notes styling */
      .biography-content,
      .notes-content {
        color: #374151;
        line-height: 1.6;
      }

      .toggle-biography {
        background: #6366f1;
        color: white;
        border: none;
        border-radius: 0.375rem;
        padding: 0.5rem 1rem;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        margin-top: 0.75rem;
      }

      .toggle-biography:hover {
        background: #4f46e5;
        transform: translateY(-1px);
      }

      .toggle-biography:active {
        transform: translateY(0);
      }
    </style>
  </template>
}

// ⁽²⁶⁾ Embedded format for family member display
class EmbeddedGenealogyPerson extends Component<typeof GenealogyPerson> {
  get lifespan() {
    try {
      const birthYear = this.args?.model?.birthDate
        ? new Date(this.args.model.birthDate).getFullYear()
        : null;
      const deathYear = this.args?.model?.deathDate
        ? new Date(this.args.model.deathDate).getFullYear()
        : null;

      if (birthYear && deathYear) {
        return `(${birthYear} - ${deathYear})`;
      } else if (birthYear) {
        return `(b. ${birthYear})`;
      } else if (deathYear) {
        return `(d. ${deathYear})`;
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  <template>
    <div class='embedded-person'>
      <div class='person-info'>
        {{#if @model.name}}
          <div class='person-name'><@fields.name /></div>
        {{else}}
          <div class='person-name unknown'>Unknown Person</div>
        {{/if}}
        {{#if this.lifespan}}
          <div class='person-lifespan'>{{this.lifespan}}</div>
        {{/if}}
        {{#if @model.occupation}}
          <div class='person-occupation'>{{@model.occupation}}</div>
        {{/if}}
      </div>

      <svg
        class='navigation-arrow'
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        stroke-width='2'
      >
        <polyline points='9,18 15,12 9,6' />
      </svg>
    </div>

    <style scoped>
      /* ⁽²⁷⁾ Embedded person styling */
      .embedded-person {
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 0.5rem;
        padding: 1rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        transition: all 0.2s ease;
        cursor: pointer;
      }

      .embedded-person:hover {
        border-color: #6366f1;
        background: #f8fafc;
      }

      .person-info {
        flex: 1;
      }

      .person-name {
        font-weight: 600;
        color: #111827;
        margin-bottom: 0.25rem;
      }

      .person-name.unknown {
        color: #9ca3af;
        font-style: italic;
      }

      .person-lifespan {
        font-size: 0.875rem;
        color: #6b7280;
        margin-bottom: 0.25rem;
      }

      .person-occupation {
        font-size: 0.8125rem;
        color: #4338ca;
        font-weight: 500;
      }

      .navigation-arrow {
        width: 1.25rem;
        height: 1.25rem;
        color: #9ca3af;
        flex-shrink: 0;
        transition: color 0.2s ease;
      }

      .embedded-person:hover .navigation-arrow {
        color: #6366f1;
      }
    </style>
  </template>
}

// ⁽¹¹⁾ Main genealogy person card
export class GenealogyPerson extends CardDef {
  static displayName = 'Genealogy Person';
  static icon = UsersIcon;

  // ⁽¹²⁾ Personal information
  @field name = contains(NameField);
  @field birthDate = contains(DateField);
  @field birthPlace = contains(PlaceField);
  @field deathDate = contains(DateField);
  @field deathPlace = contains(PlaceField);
  @field occupation = contains(StringField);
  @field biography = contains(TextAreaField);
  @field notes = contains(TextAreaField);

  // ⁽¹³⁾ Family relationships - parent to child only
  @field children = linksToMany(() => GenealogyPerson);

  // ⁽¹⁴⁾ Computed title for card display
  @field title = contains(StringField, {
    computeVia: function (this: GenealogyPerson) {
      try {
        const name = this.name;
        if (!name) return 'Unknown Person';

        let fullName = '';
        if (name.firstName) fullName += name.firstName;
        if (name.middleName) fullName += ` ${name.middleName}`;
        if (name.lastName) fullName += ` ${name.lastName}`;
        fullName = fullName.trim();

        if (!fullName && name.nickname) fullName = name.nickname;
        if (!fullName) return 'Unknown Person';

        // Add birth year if available
        if (this.birthDate && typeof this.birthDate === 'string') {
          const year = new Date(this.birthDate).getFullYear();
          if (year && !isNaN(year)) {
            fullName += ` (b. ${year})`;
          }
        }

        return fullName;
      } catch (e) {
        console.error('GenealogyPerson: Error computing title', e);
        return 'Unknown Person';
      }
    },
  });

  static isolated = IsolatedGenealogyPerson;
  static embedded = EmbeddedGenealogyPerson;
}

// ⁽⁷⁾ Isolated format for genealogy search
class IsolatedGenealogyPersonsSearch extends Component<
  typeof GenealogyPersonsSearch
> {
  @tracked selectedView: 'grid' | 'list' = 'grid';
  @tracked showTooltip = false;

  // ⁽⁸⁾ Dynamic query based on search criteria
  get searchQuery(): Query {
    const searchText = this.args?.model?.searchCriteria;

    if (!searchText || searchText.trim().length === 0) {
      // Return all genealogy persons if no search criteria
      return {
        filter: {
          type: {
            module: 'http://localhost:4201/experiments/genealogy-person',
            name: 'GenealogyPerson',
          },
        },
      };
    }

    // Search across multiple fields for the text
    return JSON.parse(searchText);
  }

  private get realms(): string[] {
    return this.args.model[realmURL] ? [this.args.model[realmURL].href] : [];
  }

  get cardFormat() {
    return this.selectedView === 'list' ? 'embedded' : 'fitted';
  }

  onChangeView = (view: 'grid' | 'list') => {
    this.selectedView = view;
  };

  toggleTooltip = () => {
    this.showTooltip = !this.showTooltip;
  };

  <template>
    <!-- ⁽⁹⁾ Search stage/mat pattern -->
    <div class='search-stage'>
      <div class='search-mat'>
        <!-- ⁽¹⁰⁾ Header with title and view selector -->
        <header class='search-header'>
          <div class='title-section'>
            <h1>
              <SearchIcon class='title-icon' />
              {{if @model.title @model.title 'Genealogy Search'}}
            </h1>
            <p class='subtitle'>Search your family tree using names, places,
              occupations, or any text</p>
          </div>

          <div class='view-controls'>
            <button
              class='view-button
                {{if (eq this.selectedView "grid") "active" ""}}'
              {{on 'click' (fn this.onChangeView 'grid')}}
            >
              <svg
                class='view-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <rect x='3' y='3' width='7' height='7' />
                <rect x='14' y='3' width='7' height='7' />
                <rect x='14' y='14' width='7' height='7' />
                <rect x='3' y='14' width='7' height='7' />
              </svg>
              Grid
            </button>
            <button
              class='view-button
                {{if (eq this.selectedView "list") "active" ""}}'
              {{on 'click' (fn this.onChangeView 'list')}}
            >
              <svg
                class='view-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <line x1='8' y1='6' x2='21' y2='6' />
                <line x1='8' y1='12' x2='21' y2='12' />
                <line x1='8' y1='18' x2='21' y2='18' />
                <line x1='3' y1='6' x2='3.01' y2='6' />
                <line x1='3' y1='12' x2='3.01' y2='12' />
                <line x1='3' y1='18' x2='3.01' y2='18' />
              </svg>
              List
            </button>
          </div>
        </header>

        <!-- ⁽¹¹⁾ Search criteria section -->
        <section class='search-criteria'>
          <h2>Search Criteria & Notes</h2>
          <div class='criteria-editor'>
            <@fields.searchCriteria @format='edit' />
            <button class='help-button' {{on 'click' this.toggleTooltip}}>
              <svg
                class='help-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='10' />
                <path d='M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' />
                <line x1='12' y1='17' x2='12.01' y2='17' />
              </svg>
            </button>
            {{#if this.showTooltip}}
              <div class='criteria-tooltip'>
                <div class='tooltip-content'>
                  <p>Add search criteria to filter your family tree. You can
                    search for:</p>
                  <ul>
                    <li><strong>Names:</strong>
                      First name, last name, maiden name, or nickname</li>
                    <li><strong>Places:</strong>
                      Birth or death locations (city, state, country)</li>
                    <li><strong>Occupations:</strong>
                      Job titles or professions</li>
                    <li><strong>Biography text:</strong>
                      Any text from life stories</li>
                    <li><strong>Research notes:</strong>
                      Your genealogy research notes</li>
                  </ul>
                </div>
              </div>
            {{/if}}
          </div>
        </section>

        <!-- ⁽¹²⁾ Search results section -->
        <section class='search-results'>
          <h2>Search Results</h2>
          {{#let
            (component @context.prerenderedCardSearchComponent)
            as |PrerenderedCardSearch|
          }}
            <PrerenderedCardSearch
              @query={{this.searchQuery}}
              @format={{this.cardFormat}}
              @realms={{this.realms}}
              @isLive={{true}}
            >
              <:loading>
                <div class='loading-state'>
                  <svg
                    class='loading-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path
                      d='M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c1.47 0 2.85.36 4.07.99'
                    />
                  </svg>
                  Searching family tree...
                </div>
              </:loading>

              <:response as |persons|>
                {{#if (gt persons.length 0)}}
                  <div class='results-info'>
                    Found
                    {{persons.length}}
                    {{if (eq persons.length 1) 'person' 'people'}}
                    {{#if @model.searchCriteria}}
                      matching your search
                    {{else}}
                      in your family tree
                    {{/if}}
                  </div>

                  <div class='persons-container {{this.selectedView}}-view'>
                    {{#each persons key='url' as |person|}}
                      <CardContainer
                        {{@context.cardComponentModifier
                          cardId=person.url
                          format='data'
                          fieldType=undefined
                          fieldName=undefined
                        }}
                        @displayBoundaries={{true}}
                        class='search-result-card'
                      >
                        <person.component />
                      </CardContainer>
                    {{/each}}
                  </div>
                {{else}}
                  <div class='no-results'>
                    {{#if @model.searchCriteria}}
                      <svg
                        class='no-results-icon'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <circle cx='11' cy='11' r='8' />
                        <line x1='21' y1='21' x2='16.65' y2='16.65' />
                        <line x1='11' y1='8' x2='11' y2='14' />
                        <line x1='8' y1='11' x2='14' y2='11' />
                      </svg>
                      <h3>No matches found</h3>
                      <p>Try adjusting your search criteria or check spelling.
                        You can search across names, places, occupations, and
                        biography text.</p>
                    {{else}}
                      <svg
                        class='no-results-icon'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' />
                        <circle cx='9' cy='7' r='4' />
                        <line x1='22' y1='11' x2='16' y2='17' />
                        <line x1='16' y1='11' x2='22' y2='17' />
                      </svg>
                      <h3>No family members found</h3>
                      <p>Add genealogy persons to your family tree to see them
                        here.</p>
                    {{/if}}
                  </div>
                {{/if}}
              </:response>
            </PrerenderedCardSearch>
          {{/let}}
        </section>
      </div>
    </div>

    <style scoped>
      /* ⁽¹³⁾ Search styling */
      .search-stage {
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        background: linear-gradient(135deg, #f0f9ff 0%, #e0e7ff 100%);
        padding: 1rem;
      }

      .search-mat {
        max-width: 80rem;
        width: 100%;
        background: white;
        border-radius: 0.75rem;
        box-shadow:
          0 10px 25px -3px rgba(0, 0, 0, 0.1),
          0 4px 6px -2px rgba(0, 0, 0, 0.05);
        padding: 2rem;
        overflow-y: auto;
        max-height: 100%;
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
      }

      /* ⁽¹⁴⁾ Header styling */
      .search-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 2rem;
        border-bottom: 2px solid #e5e7eb;
        padding-bottom: 1.5rem;
      }

      .title-section h1 {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 2rem;
        font-weight: 700;
        color: #111827;
        margin: 0 0 0.5rem 0;
      }

      .title-icon {
        width: 2rem;
        height: 2rem;
        color: #6366f1;
      }

      .subtitle {
        color: #6b7280;
        margin: 0;
        font-size: 1rem;
      }

      .view-controls {
        display: flex;
        gap: 0.5rem;
        background: #f3f4f6;
        border-radius: 0.5rem;
        padding: 0.25rem;
      }

      .view-button {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        background: transparent;
        border: none;
        border-radius: 0.375rem;
        color: #6b7280;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .view-button:hover {
        color: #374151;
      }

      .view-button.active {
        background: white;
        color: #6366f1;
        box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
      }

      .view-icon {
        width: 1rem;
        height: 1rem;
      }

      /* ⁽¹⁵⁾ Search criteria section */
      .search-criteria {
        margin-bottom: 2rem;
      }

      .search-criteria h2 {
        font-size: 1.5rem;
        font-weight: 600;
        color: #111827;
        margin: 0 0 1rem 0;
      }

      .criteria-editor {
        margin-bottom: 1.5rem;
        border: 1px solid #e2e8f0;
        border-radius: 0.5rem;
        overflow: visible;
        position: relative;
      }

      .criteria-editor :global(.markdown-editor) {
        min-height: 120px;
        padding: 1rem;
        font-family:
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif;
      }

      .criteria-editor :global(.markdown-editor:focus) {
        outline: none;
        border-color: #6366f1;
        box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.1);
      }

      .help-button {
        position: absolute;
        top: 0.75rem;
        right: 0.75rem;
        background: transparent;
        border: none;
        padding: 0.25rem;
        cursor: pointer;
        color: #6b7280;
        transition: all 0.2s ease;
        border-radius: 0.375rem;
      }

      .help-button:hover {
        color: #6366f1;
        background: #f8fafc;
      }

      .help-icon {
        width: 1.25rem;
        height: 1.25rem;
      }

      .criteria-tooltip {
        position: absolute;
        top: calc(100% + 0.5rem);
        right: 0;
        width: 300px;
        background: white;
        border-radius: 0.5rem;
        box-shadow:
          0 4px 6px -1px rgba(0, 0, 0, 0.1),
          0 2px 4px -1px rgba(0, 0, 0, 0.06);
        border: 1px solid #e5e7eb;
        z-index: 10;
      }

      .tooltip-content {
        padding: 1rem;
        color: #374151;
      }

      .tooltip-content p {
        margin: 0 0 0.75rem 0;
        font-size: 0.875rem;
      }

      .tooltip-content ul {
        margin: 0;
        padding-left: 1.25rem;
        font-size: 0.875rem;
        line-height: 1.5;
      }

      .tooltip-content li {
        margin-bottom: 0.5rem;
      }

      .tooltip-content li:last-child {
        margin-bottom: 0;
      }

      .tooltip-content strong {
        color: #111827;
      }

      /* ⁽¹⁶⁾ Search results styling */
      .search-results h2 {
        font-size: 1.5rem;
        font-weight: 600;
        color: #111827;
        margin: 0 0 1rem 0;
      }

      .results-info {
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        border-radius: 0.5rem;
        padding: 0.75rem 1rem;
        color: #1e40af;
        font-weight: 500;
        margin-bottom: 1.5rem;
      }

      .loading-state {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        padding: 3rem;
        color: #6b7280;
        font-style: italic;
      }

      .loading-icon {
        width: 1.5rem;
        height: 1.5rem;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      /* ⁽¹⁷⁾ Results container layouts */
      .grid-view {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 1.5rem;
      }

      .list-view {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .search-result-card {
        transition: all 0.2s ease;
        border-radius: 0.5rem;
      }

      .search-result-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px -5px rgba(0, 0, 0, 0.1);
      }

      /* ⁽¹⁸⁾ No results styling */
      .no-results {
        text-align: center;
        padding: 3rem;
        color: #6b7280;
      }

      .no-results-icon {
        width: 3rem;
        height: 3rem;
        margin: 0 auto 1rem auto;
        color: #9ca3af;
      }

      .no-results h3 {
        font-size: 1.25rem;
        font-weight: 600;
        color: #374151;
        margin: 0 0 0.5rem 0;
      }

      .no-results p {
        margin: 0;
        line-height: 1.6;
        max-width: 28rem;
        margin: 0 auto;
      }

      /* ⁽¹⁹⁾ Responsive adjustments */
      @media (max-width: 800px) {
        .search-stage {
          padding: 0;
        }

        .search-mat {
          max-width: none;
          height: 100%;
          border-radius: 0;
          padding: 1.5rem;
        }

        .search-header {
          flex-direction: column;
          gap: 1rem;
          align-items: stretch;
        }

        .view-controls {
          align-self: center;
        }

        .grid-view {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}

// ⁽²⁰⁾ Embedded format for search preview
class EmbeddedGenealogyPersonsSearch extends Component<
  typeof GenealogyPersonsSearch
> {
  <template>
    <div class='embedded-search'>
      <div class='search-info'>
        <SearchIcon class='search-icon' />
        <div class='search-details'>
          <div class='search-title'>{{if
              @model.title
              @model.title
              'Genealogy Search'
            }}</div>
          {{#if @model.searchCriteria}}
            <div class='search-query'>Active search query</div>
          {{else}}
            <div class='search-query placeholder'>No search criteria set</div>
          {{/if}}
        </div>
      </div>

      <svg
        class='navigation-arrow'
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        stroke-width='2'
      >
        <polyline points='9,18 15,12 9,6' />
      </svg>
    </div>

    <style scoped>
      /* ⁽²¹⁾ Embedded search styling */
      .embedded-search {
        background: white;
        border: 1px solid #e5e7eb;
        border-radius: 0.5rem;
        padding: 1rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        transition: all 0.2s ease;
        cursor: pointer;
      }

      .embedded-search:hover {
        border-color: #6366f1;
        background: #f8fafc;
        transform: translateY(-1px);
      }

      .search-info {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex: 1;
      }

      .search-icon {
        width: 1.5rem;
        height: 1.5rem;
        color: #6366f1;
        flex-shrink: 0;
      }

      .search-title {
        font-weight: 600;
        color: #111827;
        margin-bottom: 0.25rem;
      }

      .search-query {
        font-size: 0.875rem;
        color: #059669;
        font-weight: 500;
      }

      .search-query.placeholder {
        color: #9ca3af;
        font-style: italic;
        font-weight: normal;
      }

      .navigation-arrow {
        width: 1.25rem;
        height: 1.25rem;
        color: #9ca3af;
        flex-shrink: 0;
        transition: color 0.2s ease;
      }

      .embedded-search:hover .navigation-arrow {
        color: #6366f1;
      }
    </style>
  </template>
}

// ⁽²²⁾ Main genealogy persons search card
export class GenealogyPersonsSearch extends CardDef {
  static displayName = 'Genealogy Persons Search';
  static icon = SearchIcon;
  static prefersWideFormat = true; // ⁽²³⁾ Use full width for search results

  // ⁽²⁴⁾ Search configuration
  @field searchCriteria = contains(MarkdownField);

  static isolated = IsolatedGenealogyPersonsSearch;
  static embedded = EmbeddedGenealogyPersonsSearch;
}
