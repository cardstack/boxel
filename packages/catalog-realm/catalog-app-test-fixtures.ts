export const authorCardSource = `
  import { field, contains, linksTo, CardDef } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';


  export class AuthorCompany extends CardDef {
    static displayName = 'AuthorCompany';
    @field name = contains(StringField);
    @field address = contains(StringField);
    @field city = contains(StringField);
    @field state = contains(StringField);
    @field zip = contains(StringField);
  }

  export class Author extends CardDef {
    static displayName = 'Author';
    @field firstName = contains(StringField);
    @field lastName = contains(StringField);
    @field cardTitle = contains(StringField, {
      computeVia: function (this: Author) {
        return [this.firstName, this.lastName].filter(Boolean).join(' ');
      },
    });
    @field company = linksTo(AuthorCompany);
  }
`;

export const blogPostCardSource = `
  import { field, contains, CardDef, linksTo } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';
  import { Author } from '../author/author';

  export class BlogPost extends CardDef {
    static displayName = 'BlogPost';
    @field cardTitle = contains(StringField);
    @field content = contains(StringField);
    @field author = linksTo(Author);
  }
`;

export const contactLinkFieldSource = `
  import { field, contains, FieldDef } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class ContactLink extends FieldDef {
    static displayName = 'ContactLink';
    @field label = contains(StringField);
    @field url = contains(StringField);
    @field type = contains(StringField);
  }
`;

export const appCardSource = `
  import { CardDef } from 'https://cardstack.com/base/card-api';

  export class AppCard extends CardDef {
    static displayName = 'App Card';
    static prefersWideFormat = true;
  }
`;

export const blogAppCardSource = `
  import { field, contains, containsMany } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';
  import { AppCard } from '../app-card';
  import { BlogPost } from '../blog-post/blog-post';

  export class BlogApp extends AppCard {
    static displayName = 'Blog App';
    @field cardTitle = contains(StringField);
    @field posts = containsMany(BlogPost);
  }
`;

export const cardWithUnrecognisedImports = `
  import { field, CardDef, linksTo } from 'https://cardstack.com/base/card-api';
  // External import that should be ignored by sanitizeDeps
  import { Chess as _ChessJS } from 'https://cdn.jsdelivr.net/npm/chess.js/+esm';
  import { Author } from './author/author';

  export class UnrecognisedImports extends CardDef {
    static displayName = 'Unrecognised Imports';
    @field author = linksTo(Author);
  }
`;

export function makeMockCatalogContents(
  mockCatalogURL: string,
  catalogRealmURL: string,
): Record<string, unknown> {
  const authorCompanyExampleId = `${mockCatalogURL}author/AuthorCompany/example`;
  const authorSpecId = `${mockCatalogURL}Spec/author`;
  const authorExampleId = `${mockCatalogURL}author/Author/example`;
  const calculatorTagId = `${mockCatalogURL}Tag/c1fe433a-b3df-41f4-bdcf-d98686ee42d7`;
  const writingCategoryId = `${mockCatalogURL}Category/writing`;
  const mitLicenseId = `${mockCatalogURL}License/mit`;
  const publisherId = `${mockCatalogURL}Publisher/boxel-publisher`;
  const pirateSkillId = `${mockCatalogURL}Skill/pirate-speak`;
  const unknownSpecId = `${mockCatalogURL}Spec/unknown-no-type`;
  const stubTagId = `${mockCatalogURL}Tag/stub`;
  const authorListingId = `${mockCatalogURL}Listing/author`;

  return {
    'author/author.gts': authorCardSource,
    'blog-post/blog-post.gts': blogPostCardSource,
    'fields/contact-link.gts': contactLinkFieldSource,
    'app-card.gts': appCardSource,
    'blog-app/blog-app.gts': blogAppCardSource,
    'card-with-unrecognised-imports.gts': cardWithUnrecognisedImports,
    'theme/theme-example.json': {
      data: {
        type: 'card',
        attributes: {
          cssVariables:
            ':root { --background: #ffffff; } .dark { --background: #000000; }',
          cssImports: [],
          cardInfo: {
            cardTitle: 'Sample Theme',
            cardDescription: 'A sample theme for testing remix.',
            cardThumbnailURL: null,
            notes: null,
          },
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/card-api',
            name: 'Theme',
          },
        },
      },
    },
    'ThemeListing/cardstack-theme.json': {
      data: {
        meta: {
          adoptsFrom: {
            name: 'ThemeListing',
            module: `${catalogRealmURL}catalog-app/listing/listing`,
          },
        },
        type: 'card',
        attributes: {
          name: 'Cardstack Theme',
          images: [],
          summary: 'Cardstack base theme listing.',
        },
        relationships: {
          specs: {
            links: {
              self: null,
            },
          },
          skills: {
            links: {
              self: null,
            },
          },
          tags: {
            links: {
              self: null,
            },
          },
          license: {
            links: {
              self: null,
            },
          },
          publisher: {
            links: {
              self: null,
            },
          },
          'examples.0': {
            links: {
              self: '../theme/theme-example',
            },
          },
          categories: {
            links: {
              self: null,
            },
          },
        },
      },
    },
    'author/Author/example.json': {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Mike',
          lastName: 'Dane',
          summary: 'Author',
        },
        relationships: {
          company: {
            links: {
              self: authorCompanyExampleId,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${mockCatalogURL}author/author`,
            name: 'Author',
          },
        },
      },
    },
    'author/AuthorCompany/example.json': {
      data: {
        type: 'card',
        attributes: {
          name: 'Cardstack Labs',
          address: '123 Main St',
          city: 'Portland',
          state: 'OR',
          zip: '97205',
        },
        meta: {
          adoptsFrom: {
            module: `${mockCatalogURL}author/author`,
            name: 'AuthorCompany',
          },
        },
      },
    },
    'UnrecognisedImports/example.json': {
      data: {
        type: 'card',
        attributes: {},
        meta: {
          adoptsFrom: {
            module: `${mockCatalogURL}card-with-unrecognised-imports`,
            name: 'UnrecognisedImports',
          },
        },
      },
    },
    'blog-post/BlogPost/example.json': {
      data: {
        type: 'card',
        attributes: {
          cardTitle: 'Blog Post',
          content: 'Blog Post Content',
        },
        relationships: {
          author: {
            links: {
              self: authorExampleId,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${mockCatalogURL}blog-post/blog-post`,
            name: 'BlogPost',
          },
        },
      },
    },
    'blog-app/BlogApp/example.json': {
      data: {
        type: 'card',
        attributes: {
          cardTitle: 'My Blog App',
        },
        meta: {
          adoptsFrom: {
            module: `${mockCatalogURL}blog-app/blog-app`,
            name: 'BlogApp',
          },
        },
      },
    },
    'Spec/author.json': {
      data: {
        type: 'card',
        attributes: {
          readMe: 'This is the author spec readme',
          ref: {
            name: 'Author',
            module: `${mockCatalogURL}author/author`,
          },
        },
        specType: 'card',
        containedExamples: [],
        cardTitle: 'Author',
        cardDescription: 'Spec for Author card',
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/spec',
            name: 'Spec',
          },
        },
      },
    },
    'Spec/contact-link.json': {
      data: {
        type: 'card',
        attributes: {
          ref: {
            name: 'ContactLink',
            module: `${mockCatalogURL}fields/contact-link`,
          },
        },
        specType: 'field',
        containedExamples: [],
        cardTitle: 'ContactLink',
        cardDescription: 'Spec for ContactLink field',
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/spec',
            name: 'Spec',
          },
        },
      },
    },
    'Spec/unknown-no-type.json': {
      data: {
        type: 'card',
        attributes: {
          readMe: 'Spec without specType to trigger unknown grouping',
          ref: {
            name: 'UnknownNoType',
            module: `${mockCatalogURL}unknown/unknown-no-type`,
          },
        },
        // intentionally omitting specType so it falls into 'unknown'
        containedExamples: [],
        cardTitle: 'UnknownNoType',
        cardDescription: 'Spec lacking specType',
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/spec',
            name: 'Spec',
          },
        },
      },
    },
    'Listing/author.json': {
      data: {
        type: 'card',
        attributes: {
          name: 'Author',
          cardTitle: 'Author', // hardcoding title otherwise test will be flaky when waiting for a computed
          summary: 'A card for representing an author.',
        },
        relationships: {
          'specs.0': {
            links: {
              self: authorSpecId,
            },
          },
          'examples.0': {
            links: {
              self: authorExampleId,
            },
          },
          'tags.0': {
            links: {
              self: calculatorTagId,
            },
          },
          'categories.0': {
            links: {
              self: writingCategoryId,
            },
          },
          license: {
            links: {
              self: mitLicenseId,
            },
          },
          publisher: {
            links: {
              self: publisherId,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${catalogRealmURL}catalog-app/listing/listing`,
            name: 'CardListing',
          },
        },
      },
    },
    'Listing/blog-post.json': {
      data: {
        type: 'card',
        attributes: {
          name: 'Blog Post',
          cardTitle: 'Blog Post',
        },
        relationships: {
          'examples.0': {
            links: {
              self: `${mockCatalogURL}blog-post/BlogPost/example`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${catalogRealmURL}catalog-app/listing/listing`,
            name: 'CardListing',
          },
        },
      },
    },
    'Publisher/boxel-publisher.json': {
      data: {
        type: 'card',
        attributes: {
          name: 'Boxel Publishing',
        },
        meta: {
          adoptsFrom: {
            module: `${catalogRealmURL}catalog-app/listing/publisher`,
            name: 'Publisher',
          },
        },
      },
    },
    'License/mit.json': {
      data: {
        type: 'card',
        attributes: {
          name: 'MIT License',
          content: 'MIT License',
        },
        meta: {
          adoptsFrom: {
            module: `${catalogRealmURL}catalog-app/listing/license`,
            name: 'License',
          },
        },
      },
    },
    'Listing/person.json': {
      data: {
        type: 'card',
        attributes: {
          name: 'Person',
          cardTitle: 'Person', // hardcoding title otherwise test will be flaky when waiting for a computed
          images: [
            'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400',
            'https://images.unsplash.com/photo-1494790108755-2616b332db29?w=400',
            'https://images.unsplash.com/photo-1552374196-c4e7ffc6e126?w=400',
          ],
        },
        relationships: {
          'tags.0': {
            links: {
              self: calculatorTagId,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${catalogRealmURL}catalog-app/listing/listing`,
            name: 'CardListing',
          },
        },
      },
    },
    'Listing/unknown-only.json': {
      data: {
        type: 'card',
        attributes: {},
        relationships: {
          'specs.0': {
            links: {
              self: unknownSpecId,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${catalogRealmURL}catalog-app/listing/listing`,
            name: 'CardListing',
          },
        },
      },
    },
    'AppListing/blog-app.json': {
      data: {
        type: 'card',
        attributes: {
          name: 'Blog App',
          cardTitle: 'Blog App', // hardcoding title otherwise test will be flaky when waiting for a computed
        },
        meta: {
          adoptsFrom: {
            module: `${catalogRealmURL}catalog-app/listing/listing`,
            name: 'AppListing',
          },
        },
      },
    },
    'Listing/empty.json': {
      data: {
        type: 'card',
        attributes: {
          name: 'Empty',
          cardTitle: 'Empty', // hardcoding title otherwise test will be flaky when waiting for a computed
        },
        meta: {
          adoptsFrom: {
            module: `${catalogRealmURL}catalog-app/listing/listing`,
            name: 'CardListing',
          },
        },
      },
    },
    'SkillListing/pirate-skill.json': {
      data: {
        type: 'card',
        attributes: {
          name: 'Pirate Skill',
          cardTitle: 'Pirate Skill', // hardcoding title otherwise test will be flaky when waiting for a computed
        },
        relationships: {
          'skills.0': {
            links: {
              self: pirateSkillId,
            },
          },
        },
        'categories.0': {
          links: {
            self: writingCategoryId,
          },
        },
        meta: {
          adoptsFrom: {
            module: `${catalogRealmURL}catalog-app/listing/listing`,
            name: 'SkillListing',
          },
        },
      },
    },
    'Category/writing.json': {
      data: {
        type: 'card',
        attributes: {
          name: 'Writing',
        },
        meta: {
          adoptsFrom: {
            module: `${catalogRealmURL}catalog-app/listing/category`,
            name: 'Category',
          },
        },
      },
    },
    'Listing/incomplete-skill.json': {
      data: {
        type: 'card',
        attributes: {
          name: 'Incomplete Skill',
          cardTitle: 'Incomplete Skill', // hardcoding title otherwise test will be flaky when waiting for a computed
        },
        meta: {
          adoptsFrom: {
            module: `${catalogRealmURL}catalog-app/listing/listing`,
            name: 'SkillListing',
          },
        },
      },
    },
    'Skill/pirate-speak.json': {
      data: {
        type: 'card',
        attributes: {
          cardTitle: 'Talk Like a Pirate',
          name: 'Pirate Speak',
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/skill',
            name: 'Skill',
          },
        },
      },
    },
    'Tag/c1fe433a-b3df-41f4-bdcf-d98686ee42d7.json': {
      data: {
        type: 'card',
        attributes: {
          name: 'Calculator',
        },
        meta: {
          adoptsFrom: {
            module: `${catalogRealmURL}catalog-app/listing/tag`,
            name: 'Tag',
          },
        },
      },
    },
    'Tag/51de249c-516a-4c4d-bd88-76e88274c483.json': {
      data: {
        type: 'card',
        attributes: {
          name: 'Game',
        },
        meta: {
          adoptsFrom: {
            module: `${catalogRealmURL}catalog-app/listing/tag`,
            name: 'Tag',
          },
        },
      },
    },
    'Tag/stub.json': {
      data: {
        type: 'card',
        attributes: {
          name: 'Stub',
        },
        meta: {
          adoptsFrom: {
            module: `${catalogRealmURL}catalog-app/listing/tag`,
            name: 'Tag',
          },
        },
      },
    },
    'Listing/api-documentation-stub.json': {
      data: {
        type: 'card',
        attributes: {
          name: 'API Documentation',
          cardTitle: 'API Documentation', // hardcoding title otherwise test will be flaky when waiting for a computed
        },
        relationships: {
          'tags.0': {
            links: {
              self: stubTagId,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${catalogRealmURL}catalog-app/listing/listing`,
            name: 'Listing',
          },
        },
      },
    },
    'FieldListing/contact-link.json': {
      data: {
        type: 'card',
        attributes: {
          name: 'Contact Link',
          cardTitle: 'Contact Link', // hardcoding title otherwise test will be flaky when waiting for a computed
          summary:
            'A field for creating and managing contact links such as email, phone, or other web links.',
        },
        relationships: {
          'specs.0': {
            links: {
              self: `${mockCatalogURL}Spec/contact-link`,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${catalogRealmURL}catalog-app/listing/listing`,
            name: 'FieldListing',
          },
        },
      },
    },
    'index.json': {
      data: {
        type: 'card',
        attributes: {},
        relationships: {
          'startHere.0': {
            links: {
              self: authorListingId,
            },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${catalogRealmURL}catalog-app/catalog`,
            name: 'Catalog',
          },
        },
      },
    },
    '.realm.json': {
      name: 'Cardstack Catalog',
      backgroundURL:
        'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
      iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
    },
  };
}

export function makeDestinationRealmContents(): Record<string, unknown> {
  return {
    'index.json': {
      data: {
        type: 'card',
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/cards-grid',
            name: 'CardsGrid',
          },
        },
      },
    },
    '.realm.json': {
      name: 'Test Workspace B',
      backgroundURL:
        'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
      iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
    },
  };
}
