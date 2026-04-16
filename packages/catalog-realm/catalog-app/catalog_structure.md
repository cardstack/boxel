# Catalog Structure Reference

**For**: `catalog-app/listing` - Catalog listing organization and classification
**Location**: `catalog-realm/catalog-app/`

This document describes the foundational structure of the Boxel catalog-realm, including **Spheres**, **Categories**, and **Tags**. These components work together to organize and classify cards, apps, and other content in the catalog through the `catalog-app/listing` module.

---

## 📚 Table of Contents

1. [Overview](#overview)
2. [Catalog-App Listing](#catalog-app-listing)
3. [Spheres](#spheres)
4. [Categories](#categories)
5. [Tags](#tags)
6. [File Structure](#file-structure)
7. [Relationships](#relationships)
8. [Examples](#examples)

---

## 🎯 Overview

The catalog structure is implemented through the **`catalog-app/listing`** module, which defines the core components:
- `sphere.gts` - Sphere card definition
- `category.gts` - Category card definition
- `tag.gts` - Tag card definition
- `listing.gts` - Base listing structure used by all catalog items

All Spheres, Categories, and Tags use `adoptsFrom` to reference these core definitions, ensuring consistent structure and behavior across the catalog.

---

## 📱 Catalog-App Listing

The `catalog-app/listing` folder contains the core Glimmer TypeScript (GTS) components that define how catalog items are structured and displayed:

### Core Files

| File | Purpose |
|------|---------|
| `sphere.gts` | Defines the Sphere card type - top-level organizational structure |
| `category.gts` | Defines the Category card type - thematic groupings within spheres |
| `tag.gts` | Defines the Tag card type - flexible metadata labels |
| `listing.gts` | Base listing structure for cards, apps, fields, themes, and skills |

### Module References

All catalog components adopt from these modules:

```
adoptsFrom: {
  "module": "../catalog-app/listing/sphere",    // For Sphere cards
  "module": "../catalog-app/listing/category",  // For Category cards
  "module": "../catalog-app/listing/tag",       // For Tag cards
  "module": "../catalog-app/listing/listing"    // For Listings (CardListing, AppListing, etc.)
}
```

### Integration Points

The catalog-app listing module:
- Defines JSON schema for all catalog items
- Provides UI components for rendering catalogs
- Manages relationships between spheres, categories, tags, and listings
- Handles filtering and navigation by type, category, and tag
- Supports metadata display (cardInfo, color coding, themes)

---

## 🌍 Spheres

Spheres are the **top-level organizational structure** that group all activities and interests into five major life areas.

### Sphere Overview

| Sphere | File | Purpose | Categories | Count |
|--------|------|---------|-----------|-------|
| **WORK** | `Sphere/work.json` | Professional, business, and work-related activities | Accounting, Business Development, HR, Marketing, Project Management, etc. | 15 |
| **PLAY** | `Sphere/play.json` | Entertainment, leisure, and recreational activities | Entertainment, Gaming, Sports, Hobbies, Parties, etc. | 9 |
| **BUILD** | `Sphere/build.json` | Creation, development, and technical activities | Software Development, AI/Automation, Design, DevOps, Web Development, etc. | 15 |
| **LEARN** | `Sphere/learn.json` | Education, knowledge, and skill development | Education, Training, Research, Teaching, Technical Documentation, etc. | 11 |
| **LIFE** | `Sphere/life.json` | Personal, lifestyle, and everyday activities | Health, Family, Finance, Travel, Shopping, Events, etc. | 12 |

### Sphere JSON Structure

```json
{
  "data": {
    "type": "card",
    "attributes": {
      "name": "WORK"
    },
    "meta": {
      "adoptsFrom": {
        "module": "../catalog-app/listing/sphere",
        "name": "Sphere"
      }
    }
  }
}
```

### Key Points

- Each sphere represents a major life area
- All categories are linked to exactly one sphere
- Spheres serve as the primary organizational level for browsing and filtering
- Named in UPPERCASE for distinction
- **Adopts from** `catalog-app/listing/sphere.gts` - the core Sphere component definition
- Rendered by the Sphere component in `catalog-app/listing/`

---

## 📂 Categories

Categories are **thematic groupings of related content** that belong to a specific sphere. Each category focuses on a particular domain or topic.

### Category Overview

Categories organize content by topic within their assigned sphere. For example:

- **WORK Sphere** contains categories like: Accounting & Finance, Marketing & Growth, Project Management, HR & People Management
- **PLAY Sphere** contains categories like: Entertainment & Media, Sports & Fitness, Gaming, Hobbies & Crafts
- **BUILD Sphere** contains categories like: Software Development, AI & Automation, Design & Creative, DevOps & Infrastructure
- **LEARN Sphere** contains categories like: Education & Courses, Knowledge Management, Research & Knowledge
- **LIFE Sphere** contains categories like: Health & Wellness, Personal Finance, Travel & Lifestyle

### Category JSON Structure

```json
{
  "data": {
    "meta": {
      "adoptsFrom": {
        "name": "Category",
        "module": "../catalog-app/listing/category"
      }
    },
    "type": "card",
    "attributes": {
      "name": "Software Development",
      "cardInfo": {
        "notes": null,
        "name": "Software Development",
        "summary": "Application development, coding projects, software architecture, version control, and code review processes.",
        "cardThumbnailURL": null
      }
    },
    "relationships": {
      "sphere": {
        "links": {
          "self": "../Sphere/build"
        }
      },
      "cardInfo.theme": {
        "links": {
          "self": null
        }
      }
    }
  }
}
```

### Category File Naming Convention

- **Format**: `kebab-case.json`
- **Example**: `software-development.json`, `personal-finance.json`, `travel-lifestyle.json`
- **Location**: `Category/` directory

### Category Key Fields

| Field | Type | Purpose |
|-------|------|---------|
| `name` | string | Display name of the category (e.g., "Software Development") |
| `cardInfo.name` | string | Card info name (typically matches `name`) |
| `cardInfo.summary` | string | Description of what content is in this category |
| `sphere` (relationship) | link | Reference to parent sphere (`work`, `play`, `build`, `learn`, or `life`) |

### Key Points

- 58 total categories across all spheres
- Each category belongs to exactly one sphere
- Kebab-case filenames for consistency
- `cardInfo` contains display information used in UI
- All categories have descriptive summaries
- **Adopts from** `catalog-app/listing/category.gts` - the core Category component definition
- Rendered by the Category component in `catalog-app/listing/`

---

## 🏷️ Tags

Tags are **flexible metadata labels** that describe characteristics of cards and apps. They add additional context beyond category classification.

### Tag Purpose & Role

Tags serve as **flexible metadata filters** that enable discovery and organization beyond the rigid sphere-category hierarchy:

- **Functional Labeling**: Describe *what* a card/app does or *how* it's used (Content Type tags)
- **Contextual Metadata**: Add information about origin, quality, or special characteristics (Source/Origin tags)
- **Multi-Tagging**: A single card/app can have multiple tags, enabling cross-cutting categorization
- **Enhanced Discovery**: Users can filter by tags to find cards matching specific use cases or characteristics
- **Flexible Organization**: Unlike categories (fixed hierarchy), tags allow cards to be discovered through multiple dimensions

**Key Difference from Categories**: Categories are mutually exclusive and create hierarchy (one per card), while tags are additive and enable flexible cross-cutting organization.

### Tag Types

Tags are divided into two main types based on what they describe:

#### 1. Content Type Tags (Green - #10B981)

Describe **what the card/app does** or **its functional purpose**:

| Tag | Purpose |
|-----|---------|
| **app** | Full applications such as news readers, todo apps, CRMs, and other multi-feature tools |
| **card** | Simple single-purpose cards that display or capture one focused piece of information |
| **card-type** | Meta-category for organizing different card types |
| **dashboard** | Data overview and analytics views that summarise key metrics at a glance |
| **form** | Data entry forms, surveys, intake forms, and structured input collection cards |
| **game** | Cards and apps for gaming, game tracking, scoreboards, turn management |
| **planner** | Meal planners, project planners, schedule cards, and planning-focused tools |
| **poster** | Cards designed for creating posters, flyers, promotional visuals |
| **report** | Generated summaries, financial reports, audit reports, structured output documents |
| **template** | Reusable starting points and boilerplates ready to be customised |
| **theme** | Visual themes and styling cards that customize appearance and color scheme |
| **tracker** | Habit trackers, expense trackers, progress trackers, monitoring tools |
| **calculator** | Cards that perform numerical computations, financial calculations, unit conversions |
| **skill** | Cards and apps that teach, demonstrate, or practice specific AI skills, capabilities, and techniques |

#### 2. Source/Origin Tags (Orange - #F97316)

Describe **where it comes from or its status/quality**:

| Tag | Purpose |
|-----|---------|
| **ai** | Cards and apps that use artificial intelligence or machine learning, LLM-powered features |
| **bundled** | Cards or apps packaged together as a curated set, combining multiple components |
| **community** | Created and shared by the community (complementary to user-contributed) |
| **featured** | Curated and highlighted listings selected by the catalog team as top picks |
| **general** | Universal fallback tag for cards that don't fit specific types |
| **new** | Recently added listings in the catalog |
| **official** | Cards and apps officially created and maintained by Cardstack team |
| **user-contributed** | Content created and submitted by community members |

### Tag JSON Structure

```json
{
  "data": {
    "type": "card",
    "attributes": {
      "name": "dashboard",
      "color": "#10B981",
      "cardInfo": {
        "notes": null,
        "name": "dashboard",
        "summary": "Data overview and analytics views that summarise key metrics at a glance.",
        "cardThumbnailURL": null
      }
    },
    "meta": {
      "adoptsFrom": {
        "module": "../catalog-app/listing/tag",
        "name": "Tag"
      }
    },
    "relationships": {
      "cardInfo.theme": {
        "links": {
          "self": null
        }
      }
    }
  }
}
```

### Tag File Naming Convention

- **Format**: `kebab-case.json`
- **Example**: `dashboard.json`, `user-contributed.json`, `official.json`
- **Location**: `Tag/` directory

### Tag Color Coding

Tags use consistent colors based on their type for visual distinction:

- **🟢 Green (#10B981)** - Content Type tags (what it does)
- **🟠 Orange (#F97316)** - Source/Origin tags (where it comes from)

### Tag Key Fields

| Field | Type | Purpose |
|-------|------|---------|
| `name` | string | Display name of the tag |
| `color` | string | Hex color code (#10B981 for Content Type, #F97316 for Source/Origin) |
| `cardInfo.name` | string | Card info name (matches `name`) |
| `cardInfo.summary` | string | Description of what the tag represents |

### Key Points

- 22 total tags (14 Content Type + 8 Source/Origin)
- Multiple tags can be applied to a single card/app
- Color-coded by type for visual distinction
- Tags provide flexible metadata beyond category structure
- **Adopts from** `catalog-app/listing/tag.gts` - the core Tag component definition
- Rendered by the Tag component in `catalog-app/listing/`

---

## 📁 File Structure

```
catalog-realm/
├── Sphere/
│   ├── work.json              # WORK sphere (15 categories)
│   ├── play.json              # PLAY sphere (9 categories)
│   ├── build.json             # BUILD sphere (15 categories)
│   ├── learn.json             # LEARN sphere (11 categories)
│   └── life.json              # LIFE sphere (12 categories)
│
├── Category/
│   ├── software-development.json    # BUILD sphere
│   ├── personal-finance.json        # LIFE sphere
│   ├── project-management.json      # WORK sphere
│   ├── entertainment-media.json     # PLAY sphere
│   ├── education-courses.json       # LEARN sphere
│   └── ... (58 total categories)
│
├── Tag/
│   ├── dashboard.json               # Content Type - Green
│   ├── form.json                    # Content Type - Green
│   ├── app.json                     # Content Type - Green
│   ├── skill.json                   # Content Type - Green
│   ├── official.json                # Source/Origin - Orange
│   ├── user-contributed.json        # Source/Origin - Orange
│   ├── ai.json                      # Source/Origin - Orange
│   └── ... (22 total tags)
│
└── CATALOG_STRUCTURE.md             # This documentation
```

---

## 🔗 Relationships

The catalog structure creates a hierarchical relationship system:

### Sphere → Category → Tags

```
WORK Sphere
├── Accounting & Finance
│   ├── Tags: dashboard, report, tracker
│   └── Related Cards: Financial apps, calculators
├── Project Management
│   ├── Tags: app, dashboard, planner, tracker
│   └── Related Cards: Project tracking apps
└── HR & People Management
    ├── Tags: form, dashboard, tracker
    └── Related Cards: HR management tools

BUILD Sphere
├── Software Development
│   ├── Tags: app, official, ai
│   └── Related Cards: Development tools, IDE integrations
├── AI & Automation
│   ├── Tags: ai, official, template
│   └── Related Cards: AI-powered cards, automation tools
└── Design & Creative
    ├── Tags: template, poster, theme
    └── Related Cards: Design tools, templates
```

### Reference Links in JSON

**Category linking to Sphere:**
```json
"relationships": {
  "sphere": {
    "links": {
      "self": "../Sphere/work"  // References work.json
    }
  }
}
```

**CardListing linking to Categories and Tags:**
```json
"relationships": {
  "categories.0": {
    "links": {
      "self": "../Category/software-development"  // References Category
    }
  },
  "tags.0": {
    "links": {
      "self": "../Tag/app"  // References Tag
    }
  },
  "tags.1": {
    "links": {
      "self": "../Tag/official"  // References Tag
    }
  }
}
```

---

## 📋 Examples

### Example 1: Complete Category Definition

**File**: `Category/software-development.json`

```json
{
  "data": {
    "meta": {
      "adoptsFrom": {
        "name": "Category",
        "module": "../catalog-app/listing/category"
      }
    },
    "type": "card",
    "attributes": {
      "name": "Software Development",
      "cardInfo": {
        "notes": null,
        "name": "Software Development",
        "summary": "Application development, coding projects, software architecture, version control, and code review processes.",
        "cardThumbnailURL": null
      }
    },
    "relationships": {
      "sphere": {
        "links": {
          "self": "../Sphere/build"
        }
      },
      "cardInfo.theme": {
        "links": {
          "self": null
        }
      }
    }
  }
}
```

### Example 2: Card Using Multiple Tags and Categories

**File**: `CardListing/game-quiz.json`

```json
{
  "data": {
    "meta": {
      "adoptsFrom": {
        "name": "CardListing",
        "module": "../catalog-app/listing/listing"
      }
    },
    "type": "card",
    "attributes": {
      "name": "Game Quiz",
      "summary": "Interactive game-based quizzes framework",
      "cardInfo": {
        "name": "Game Quiz Listing",
        "summary": "Comprehensive framework for creating interactive game-based quizzes"
      }
    },
    "relationships": {
      "categories.0": {
        "links": {
          "self": "../Category/entertainment-media"
        }
      },
      "tags.0": {
        "links": {
          "self": "../Tag/game"  // Content Type - Green
        }
      },
      "tags.1": {
        "links": {
          "self": "../Tag/ai"    // Source/Origin - Orange
        }
      }
    }
  }
}
```

### Example 3: All Spheres at a Glance

| Sphere | Count | Sample Categories |
|--------|-------|-------------------|
| 🎯 **WORK** | 15 | Accounting & Finance, Project Management, HR & People Management, Marketing & Growth |
| 🎮 **PLAY** | 9 | Entertainment & Media, Gaming, Sports & Fitness, Hobbies & Crafts |
| 🔨 **BUILD** | 15 | Software Development, AI & Automation, Design & Creative, DevOps & Infrastructure |
| 📚 **LEARN** | 11 | Education & Courses, Knowledge Management, Research & Knowledge, Teaching & Instruction |
| 💚 **LIFE** | 12 | Health & Wellness, Personal Finance, Travel & Lifestyle, Family & Relationships |

---

## 🎯 Quick Reference

### Finding Content

1. **By Life Area**: Start with Spheres (Work, Play, Build, Learn, Life)
2. **By Topic**: Navigate to Categories within a Sphere
3. **By Characteristic**: Filter using Tags (Content Type or Source/Origin)

### Creating New Content

1. **Assign to Sphere**: Determine which life area it belongs to
2. **Assign to Category**: Choose the most relevant topic category
3. **Apply Tags**: Add Content Type tags (green) describing functionality
4. **Apply Tags**: Add Source/Origin tags (orange) describing source/status

### Best Practices

- ✅ Every category must have a sphere reference
- ✅ Content type and source/origin tags should both be used together
- ✅ Use kebab-case for all filenames
- ✅ Provide clear, descriptive summaries in cardInfo
- ✅ Keep color codes consistent (Green for content type, Orange for source/origin)

---

## 📊 Statistics

| Component | Count | Type |
|-----------|-------|------|
| **Spheres** | 5 | Top-level organizational structure |
| **Categories** | 58 | Thematic groupings within spheres |
| **Tags** | 21 | Flexible metadata (13 Content Type + 8 Source/Origin) |
| **Total Catalog Items** | 84 | Complete catalog organizational structure |

---

## 🔄 Hierarchy Overview

```
┌─────────────────────────────────────────┐
│         CATALOG-REALM STRUCTURE         │
├─────────────────────────────────────────┤
│  Spheres (5)                            │
│  ├─ WORK, PLAY, BUILD, LEARN, LIFE     │
│  └─ Each contains 9-15 categories       │
├─────────────────────────────────────────┤
│  Categories (58)                        │
│  ├─ Thematic topics within spheres      │
│  └─ Each links to exactly one sphere    │
├─────────────────────────────────────────┤
│  Tags (21)                              │
│  ├─ Content Type (Green): 13            │
│  ├─ Source/Origin (Orange): 8          │
│  └─ Multiple tags per card/app          │
└─────────────────────────────────────────┘
```

---

## 📝 Notes

- All filenames use kebab-case (lowercase with hyphens)
- All files are JSON format stored in `catalog-realm/`
- Color codes provide visual distinction for tag types
- Relationships are maintained through relative paths (`../Sphere/work`)
- The structure is designed to be flexible and scalable

---

## 📞 Related Files & Locations

### Catalog Components
- `../Sphere/` - Sphere instances (work, play, build, learn, life)
- `../Category/` - Category instances (58 total)
- `../Tag/` - Tag instances (21 total)

### Catalog-App Listing (Core Definitions)
- `listing/sphere.gts` - Sphere card component definition
- `listing/category.gts` - Category card component definition
- `listing/tag.gts` - Tag card component definition
- `listing/listing.gts` - Base listing component for all catalog items

### Related Directories
- `../CardListing/` - Card listings using catalog structure
- `../AppListing/` - App listings using catalog structure
- `../FieldListing/` - Field listings using catalog structure
- `../SkillListing/` - Skill listings using catalog structure
- `../ThemeListing/` - Theme listings using catalog structure

---

## 🔗 How It Works

1. **Core Definition**: `catalog-app/listing/` defines the structure
2. **Instances**: Spheres, Categories, and Tags are created as JSON instances
3. **Adoption**: All instances use `adoptsFrom` to reference core definitions
4. **Listings**: Cards, apps, and other content link to categories and tags
5. **UI Rendering**: Components in `catalog-app/listing/` handle display and interaction

---

**Last Updated**: 2024
**Version**: 1.1
**Scope**: Catalog-realm structure for catalog-app/listing module
