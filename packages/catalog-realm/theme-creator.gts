import {
  CardDef,
  Component,
  contains,
  field,
  realmInfo,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import RealmField from 'https://cardstack.com/base/realm';
import MarkdownField from 'https://cardstack.com/base/markdown';
import NumberField from 'https://cardstack.com/base/number';
import { Button, RealmIcon } from '@cardstack/boxel-ui/components';
import { copyCardURLToClipboard } from '@cardstack/boxel-ui/helpers';
import StatusIndicator from './components/status-indicator';
import { Copy as CopyIcon } from '@cardstack/boxel-ui/icons';
import Wand from '@cardstack/boxel-icons/wand';
import { type Query } from '@cardstack/runtime-common';
import ThemeCodeRefField from './fields/theme-code-ref';
import PaginatedCards from './components/paginated-cards';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import {
  AskAiForCardJsonCommand,
  CreateExampleCardCommand,
} from '@cardstack/boxel-host/commands/generate-example-cards';
import NotificationBubble from './components/notification-bubble';
import { task } from 'ember-concurrency';
import type { TaskInstance } from 'ember-concurrency';
import { tracked } from '@glimmer/tracking';

const STRUCTURED_THEME_VARIABLES = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--destructive-foreground',
  '--border',
  '--input',
  '--ring',
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--sidebar',
  '--sidebar-foreground',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-accent',
  '--sidebar-accent-foreground',
  '--sidebar-border',
  '--sidebar-ring',
  '--font-sans',
  '--font-serif',
  '--font-mono',
  '--radius',
  '--spacing',
  '--tracking-normal',
] as const;

const BOXEL_THEME_VARIABLES = [
  '--color-background',
  '--color-foreground',
  '--color-card',
  '--color-card-foreground',
  '--color-popover',
  '--color-popover-foreground',
  '--color-primary',
  '--color-primary-foreground',
  '--color-secondary',
  '--color-secondary-foreground',
  '--color-muted',
  '--color-muted-foreground',
  '--color-accent',
  '--color-accent-foreground',
  '--color-destructive',
  '--color-destructive-foreground',
  '--color-border',
  '--color-input',
  '--color-ring',
  '--color-sidebar',
  '--color-sidebar-foreground',
  '--color-sidebar-primary',
  '--color-sidebar-primary-foreground',
  '--color-sidebar-accent',
  '--color-sidebar-accent-foreground',
  '--color-sidebar-border',
  '--color-sidebar-ring',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-xl',
  '--shadow-2xs',
  '--shadow-xs',
  '--shadow-sm',
  '--shadow',
  '--shadow-md',
  '--shadow-lg',
  '--shadow-xl',
  '--shadow-2xl',
] as const;

const STRUCTURED_THEME_VARIABLE_SUMMARY = STRUCTURED_THEME_VARIABLES.join(', ');
const BOXEL_THEME_VARIABLE_SUMMARY = BOXEL_THEME_VARIABLES.join(', ');

const STYLE_REFERENCE_CSS = String.raw`:root {
--typescale-body: 16px;
  /* == VINTAGE LUXURY THEME == */
  /* Sepia tones, serif heads, collage layout, gold-foil touches, patina textures */
  
  /* BASE PALETTE - Warm Heritage Tones */
  --background: oklch(0.98 0.01 85); /* Warm cream, not stark white */
  --foreground: oklch(0.25 0.02 45); /* Rich sepia brown */
  --card: oklch(0.985 0.008 80); /* Subtle warm card background */
  --card-foreground: oklch(0.25 0.02 45);
  --popover: oklch(0.985 0.008 80);
  --popover-foreground: oklch(0.25 0.02 45);
  
  /* PRIMARY - Heritage Gold Accent */
  --primary: oklch(0.45 0.08 70); /* Burnished gold/bronze */
  --primary-foreground: oklch(0.98 0.01 85); /* Cream on gold */
  
  /* SECONDARY - Aged Parchment */
  --secondary: oklch(0.94 0.015 75); /* Warm ivory */
  --secondary-foreground: oklch(0.35 0.02 50);
  
  /* MUTED - Vintage Paper */
  --muted: oklch(0.92 0.02 70); /* Aged paper tone */
  --muted-foreground: oklch(0.48 0.015 55); /* Faded ink */
  
  /* ACCENT - Antique Brass */
  --accent: oklch(0.52 0.06 65); /* Warm brass accent */
  --accent-foreground: oklch(0.98 0.01 85);
  
  /* DESTRUCTIVE - Vintage Burgundy */
  --destructive: oklch(0.42 0.15 25); /* Deep wine red */
  --destructive-foreground: oklch(0.98 0.01 85);
  
  /* BORDERS - Antique Patina */
  --border: oklch(0.85 0.02 60); /* Subtle warm gray */
  --input: oklch(0.82 0.025 65); /* Slightly deeper for inputs */
  --ring: oklch(0.45 0.08 70); /* Gold focus rings */
  
  /* CHARTS - Heritage Color Story */
  --chart-1: oklch(0.45 0.08 70); /* Burnished gold */
  --chart-2: oklch(0.52 0.12 45); /* Warm brown */
  --chart-3: oklch(0.42 0.15 25); /* Deep burgundy */
  --chart-4: oklch(0.38 0.04 80); /* Antique brass */
  --chart-5: oklch(0.65 0.06 65); /* Warm taupe */
  
  /* SIDEBAR - Library Study Aesthetic */
  --sidebar: oklch(0.96 0.012 80); /* Warm off-white */
  --sidebar-foreground: oklch(0.25 0.02 45);
  --sidebar-primary: oklch(0.45 0.08 70);
  --sidebar-primary-foreground: oklch(0.98 0.01 85);
  --sidebar-accent: oklch(0.94 0.015 75);
  --sidebar-accent-foreground: oklch(0.35 0.02 50);
  --sidebar-border: oklch(0.88 0.02 65);
  --sidebar-ring: oklch(0.45 0.08 70);
  
  /* TYPOGRAPHY - Classical Heritage Hierarchy */
  --font-sans: 'Inter', 'Segoe UI', 'Roboto', system-ui, sans-serif; /* Clean for body */
  --font-serif: 'Playfair Display', 'Georgia', 'Crimson Text', serif; /* Elegant for headlines */
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Monaco', monospace;
  
  /* GEOMETRY - Refined Luxury Curves */
  --radius: 0.75rem; /* More generous than standard */
  
  /* SPACING - Aristocratic Generosity */
  --spacing: 0.375rem; /* More spacious than standard */
  
  /* TEXT - Classical Letter Spacing */
  --tracking-normal: 0.01em; /* Subtle letterspacing for elegance */
  
  /* SHADOWS - Soft Luxury Depth */
  --shadow-2xs: 0 1px 3px 0px oklch(0.25 0.02 45 / 0.08);
  --shadow-xs: 0 2px 4px 0px oklch(0.25 0.02 45 / 0.08);
  --shadow-sm: 0 2px 6px 0px oklch(0.25 0.02 45 / 0.10), 0 1px 3px -1px oklch(0.25 0.02 45 / 0.08);
  --shadow: 0 3px 8px 0px oklch(0.25 0.02 45 / 0.10), 0 2px 4px -2px oklch(0.25 0.02 45 / 0.08);
  --shadow-md: 0 4px 12px 0px oklch(0.25 0.02 45 / 0.12), 0 2px 6px -2px oklch(0.25 0.02 45 / 0.08);
  --shadow-lg: 0 6px 16px 0px oklch(0.25 0.02 45 / 0.12), 0 4px 8px -2px oklch(0.25 0.02 45 / 0.08);
  --shadow-xl: 0 8px 24px 0px oklch(0.25 0.02 45 / 0.14), 0 6px 12px -2px oklch(0.25 0.02 45 / 0.08);
  --shadow-2xl: 0 12px 32px 0px oklch(0.25 0.02 45 / 0.16);
}

.dark {
  /* == DARK MODE VINTAGE LUXURY == */
  /* Evening library, candlelight, leather-bound volumes */
  
  /* BASE PALETTE - Rich Evening Tones */
  --background: oklch(0.12 0.015 35); /* Deep warm charcoal */
  --foreground: oklch(0.88 0.02 75); /* Warm ivory */
  --card: oklch(0.15 0.02 40); /* Slightly lighter charcoal */
  --card-foreground: oklch(0.88 0.02 75);
  --popover: oklch(0.18 0.02 45);
  --popover-foreground: oklch(0.88 0.02 75);
  
  /* PRIMARY - Candlelight Gold */
  --primary: oklch(0.68 0.12 75); /* Brighter gold for dark backgrounds */
  --primary-foreground: oklch(0.12 0.015 35);
  
  /* SECONDARY - Rich Velvet */
  --secondary: oklch(0.22 0.02 42); /* Deep warm gray */
  --secondary-foreground: oklch(0.85 0.02 75);
  
  /* MUTED - Aged Leather */
  --muted: oklch(0.25 0.025 45); /* Rich brown undertones */
  --muted-foreground: oklch(0.72 0.02 70);
  
  /* ACCENT - Amber Glow */
  --accent: oklch(0.58 0.08 65); /* Warm amber for dark mode */
  --accent-foreground: oklch(0.12 0.015 35);
  
  /* DESTRUCTIVE - Dark Wine */
  --destructive: oklch(0.55 0.18 25); /* Brighter wine for visibility */
  --destructive-foreground: oklch(0.88 0.02 75);
  
  /* BORDERS - Antique Bronze */
  --border: oklch(0.35 0.025 50); /* Warm dark borders */
  --input: oklch(0.38 0.03 52);
  --ring: oklch(0.68 0.12 75); /* Gold focus rings */
  
  /* CHARTS - Evening Heritage Palette */
  --chart-1: oklch(0.68 0.12 75); /* Candlelight gold */
  --chart-2: oklch(0.58 0.08 65); /* Warm amber */
  --chart-3: oklch(0.55 0.18 25); /* Dark wine */
  --chart-4: oklch(0.48 0.06 55); /* Antique bronze */
  --chart-5: oklch(0.42 0.04 48); /* Rich taupe */
  
  /* SIDEBAR - Evening Study */
  --sidebar: oklch(0.10 0.015 32); /* Deepest warm black */
  --sidebar-foreground: oklch(0.88 0.02 75);
  --sidebar-primary: oklch(0.68 0.12 75);
  --sidebar-primary-foreground: oklch(0.10 0.015 32);
  --sidebar-accent: oklch(0.22 0.02 42);
  --sidebar-accent-foreground: oklch(0.85 0.02 75);
  --sidebar-border: oklch(0.32 0.025 48);
  --sidebar-ring: oklch(0.68 0.12 75);
  
  /* TYPOGRAPHY - Same Classical Fonts */
  --font-sans: 'Inter', 'Segoe UI', 'Roboto', system-ui, sans-serif;
  --font-serif: 'Playfair Display', 'Georgia', 'Crimson Text', serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Monaco', monospace;
  
  /* GEOMETRY & SPACING - Consistent Luxury */
  --radius: 0.75rem;
  --spacing: 0.375rem;
  --tracking-normal: 0.01em;
  
  /* SHADOWS - Warm Candlelight Depth */
  --shadow-2xs: 0 1px 3px 0px oklch(0.05 0.01 30 / 0.15);
  --shadow-xs: 0 2px 4px 0px oklch(0.05 0.01 30 / 0.18);
  --shadow-sm: 0 2px 6px 0px oklch(0.05 0.01 30 / 0.20), 0 1px 3px -1px oklch(0.05 0.01 30 / 0.15);
  --shadow: 0 3px 8px 0px oklch(0.05 0.01 30 / 0.22), 0 2px 4px -2px oklch(0.05 0.01 30 / 0.15);
  --shadow-md: 0 4px 12px 0px oklch(0.05 0.01 30 / 0.24), 0 2px 6px -2px oklch(0.05 0.01 30 / 0.15);
  --shadow-lg: 0 6px 16px 0px oklch(0.05 0.01 30 / 0.26), 0 4px 8px -2px oklch(0.05 0.01 30 / 0.15);
  --shadow-xl: 0 8px 24px 0px oklch(0.05 0.01 30 / 0.28), 0 6px 12px -2px oklch(0.05 0.01 30 / 0.15);
  --shadow-2xl: 0 12px 32px 0px oklch(0.05 0.01 30 / 0.32);
}`;

const STRUCTURED_THEME_CSS = String.raw`:root {
  --background: #ffffff;
  --foreground: #111418;
  --card: #f8f9fb;
  --card-foreground: #111418;
  --popover: #ffffff;
  --popover-foreground: #111418;
  --primary: #5c6ac4;
  --primary-foreground: #ffffff;
  --secondary: #f3f6ff;
  --secondary-foreground: #1f2a48;
  --muted: #eef1f6;
  --muted-foreground: #4c5567;
  --accent: #f5eafb;
  --accent-foreground: #5f2861;
  --destructive: #e23e57;
  --destructive-foreground: #ffffff;
  --border: #e1e6ef;
  --input: #d8deea;
  --ring: #7f8cf1;
  --chart-1: #5c6ac4;
  --chart-2: #4dc9b1;
  --chart-3: #ffb347;
}

.dark {
  --background: #101322;
  --foreground: #f7f7fb;
  --card: #181b2e;
  --card-foreground: #f7f7fb;
  --popover: #181b2e;
  --popover-foreground: #f7f7fb;
  --primary: #99a5ff;
  --primary-foreground: #111418;
  --secondary: #23273c;
  --secondary-foreground: #f2f2fc;
  --muted: #23273c;
  --muted-foreground: #b7bdd5;
  --accent: #3a2f4e;
  --accent-foreground: #f2e8ff;
  --destructive: #ff6b81;
  --destructive-foreground: #1a1d2c;
  --border: #292e45;
  --input: #2f3450;
  --ring: #99a5ff;
  --chart-1: #99a5ff;
  --chart-2: #52d5bc;
  --chart-3: #ffc857;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-sidebar: var(--background);
  --color-sidebar-foreground: var(--foreground);
  --color-sidebar-primary: var(--primary);
  --color-sidebar-primary-foreground: var(--primary-foreground);
  --radius-sm: calc(var(--radius, 0.5rem) - 4px);
  --radius-md: var(--radius, 0.5rem);
  --radius-lg: calc(var(--radius, 0.5rem) + 4px);
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'SFMono-Regular', monospace;
}`;

const STRUCTURED_THEME_ROOT_VARIABLES = JSON.stringify(
  {
    background: '#ffffff',
    foreground: '#111418',
    card: '#f8f9fb',
    cardForeground: '#111418',
    popover: '#ffffff',
    popoverForeground: '#111418',
    primary: '#5c6ac4',
    primaryForeground: '#ffffff',
    secondary: '#f3f6ff',
    secondaryForeground: '#1f2a48',
    muted: '#eef1f6',
    mutedForeground: '#4c5567',
    accent: '#f5eafb',
    accentForeground: '#5f2861',
    destructive: '#e23e57',
    destructiveForeground: '#ffffff',
    border: '#e1e6ef',
    input: '#d8deea',
    ring: '#7f8cf1',
    chart1: '#5c6ac4',
    chart2: '#4dc9b1',
    chart3: '#ffb347',
    chart4: '#eef1f6',
    chart5: '#d5e1ff',
    sidebar: '#ffffff',
    sidebarForeground: '#111418',
    sidebarPrimary: '#5c6ac4',
    sidebarPrimaryForeground: '#ffffff',
    sidebarAccent: '#f3f6ff',
    sidebarAccentForeground: '#1f2a48',
    sidebarBorder: '#e1e6ef',
    sidebarRing: '#7f8cf1',
    fontSans: "'Inter', system-ui, sans-serif",
    fontSerif: "'Playfair Display', serif",
    fontMono: "'JetBrains Mono', 'SFMono-Regular', monospace",
    radius: '0.5rem',
    spacing: '0.25rem',
    trackingNormal: '0.02em',
    shadow2xs: '0 0.5px 1px rgba(17, 20, 24, 0.05)',
    shadowXs: '0 1px 2px rgba(17, 20, 24, 0.06)',
    shadowSm: '0 1px 3px rgba(17, 20, 24, 0.08)',
    shadow: '0 2px 6px rgba(17, 20, 24, 0.08)',
    shadowMd: '0 4px 10px rgba(17, 20, 24, 0.1)',
    shadowLg: '0 8px 16px rgba(17, 20, 24, 0.12)',
    shadowXl: '0 12px 24px rgba(17, 20, 24, 0.14)',
    shadow2xl: '0 18px 30px rgba(17, 20, 24, 0.18)',
  },
  null,
  2,
);

const STYLE_REFERENCE_SAMPLE_JSON = JSON.stringify(
  {
    data: {
      type: 'card',
      attributes: {
        styleName: 'Vintage Luxury',
        visualDNA:
          'Sepia tones, serif heads, collage layout, gold-foil touches, patina textures',
        cardInfo: {
          title: 'Vintage Luxury Style Reference',
          description:
            'A refined palette inspired by heritage leather, velvet lounges, and gilded accents.',
          thumbnailURL:
            'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=640&auto=format',
        },
        inspirations: ['Gucci Vault', 'Burberry Archive', 'Hermès Heritage'],
        wallpaperImages: [
          'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1920&auto=format',
          'https://images.pexels.com/photos/4792382/pexels-photo-4792382.jpeg?w=1920&auto=compress',
        ],
        cssImports: [
          'https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap',
          'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&display=swap',
          'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400&display=swap',
        ],
        rootVariables: JSON.parse(STRUCTURED_THEME_ROOT_VARIABLES),
        darkModeVariables: JSON.parse(STRUCTURED_THEME_ROOT_VARIABLES),
      },
    },
  },
  null,
  2,
);

const STRUCTURED_THEME_SAMPLE_JSON = JSON.stringify(
  {
    data: {
      type: 'card',
      attributes: {
        cardInfo: {
          title: 'Luminous Modern Structured Theme',
          description:
            'A flexible system blending crisp neutrals with lavender highlights for product-heavy dashboards.',
          thumbnailURL:
            'https://images.unsplash.com/photo-1529333166437-7750a6dd5a70?w=640&auto=format',
        },
        rootVariables: JSON.parse(STRUCTURED_THEME_ROOT_VARIABLES),
        darkModeVariables: JSON.parse(STRUCTURED_THEME_ROOT_VARIABLES),
        cssImports: [
          'https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap',
        ],
      },
    },
  },
  null,
  2,
);

const BRAND_GUIDE_ROOT_VARIABLES = JSON.stringify(
  {
    card: '#FFFFFF',
    ring: '#0051BA',
    input: '#DFDFDF',
    muted: null,
    accent: null,
    border: null,
    chart1: '#0051BA',
    chart2: '#FFDB00',
    chart3: '#484848',
    chart4: '#DFDFDF',
    chart5: '#F5F5F5',
    radius: '2px',
    shadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    popover: '#FFFFFF',
    primary: null,
    sidebar: '#F5F5F5',
    spacing: '4px',
    fontMono: "'Courier New', monospace",
    fontSans: "'Noto IKEA', 'Noto Sans', sans-serif",
    shadowLg: '0 10px 15px rgba(0, 0, 0, 0.1)',
    shadowMd: '0 4px 6px rgba(0, 0, 0, 0.1)',
    shadowSm: '0 1px 2px rgba(0, 0, 0, 0.05)',
    shadowXl: '0 20px 25px rgba(0, 0, 0, 0.15)',
    shadowXs: '0 1px 1.5px rgba(0, 0, 0, 0.04)',
    fontSerif: "Georgia, 'Times New Roman', serif",
    secondary: null,
    shadow2xl: '0 25px 50px rgba(0, 0, 0, 0.25)',
    shadow2xs: '0 0.5px 1px rgba(0, 0, 0, 0.03)',
    background: '#FFFFFF',
    foreground: null,
    destructive: '#DC2626',
    sidebarRing: '#0051BA',
    sidebarAccent: '#FFDB00',
    sidebarBorder: '#DFDFDF',
    cardForeground: '#111111',
    sidebarPrimary: '#0051BA',
    trackingNormal: '0',
    mutedForeground: null,
    accentForeground: null,
    popoverForeground: '#111111',
    primaryForeground: null,
    sidebarForeground: '#111111',
    secondaryForeground: null,
    destructiveForeground: '#FFFFFF',
    sidebarAccentForeground: '#111111',
    sidebarPrimaryForeground: '#FFFFFF',
  },
  null,
  2,
);

const BRAND_GUIDE_SAMPLE_JSON = JSON.stringify(
  {
    data: {
      type: 'card',
      attributes: {
        styleName: 'Democratic Design',
        visualDNA:
          "IKEA's design language combines bold primary colors with clear typography and generous white space.",
        inspirations: [
          'Scandinavian minimalism',
          'Functional simplicity',
          'Accessible modernism',
        ],
        markUsage: {
          primaryMark1:
            'https://cdn.brandfetch.io/idLsXYVLUs/theme/dark/logo.svg',
          primaryMarkMinHeight: '40px',
          primaryMarkClearanceRatio: '0.5',
          socialMediaProfileIcon:
            'https://cdn.brandfetch.io/idLsXYVLUs/theme/dark/logo.svg',
        },
        typography: {
          heading: {
            fontFamily: "'Noto Sans', sans-serif",
            fontWeight: '700',
            fontSize: '28px',
          },
          body: {
            fontFamily: "'Noto Sans', sans-serif",
            fontWeight: '400',
            fontSize: '14px',
          },
        },
        cardInfo: {
          title: 'IKEA Brand Guide',
          description:
            'A democratic design system built around bold blue/yellow contrasts.',
          thumbnailURL:
            'https://images.unsplash.com/photo-1503602642458-232111445657?w=640&auto=format',
        },
        rootVariables: JSON.parse(BRAND_GUIDE_ROOT_VARIABLES),
        darkModeVariables: JSON.parse(BRAND_GUIDE_ROOT_VARIABLES),
        brandColorPalette: [
          { name: 'IKEA Blue', value: '#0051BA' },
          { name: 'IKEA Yellow', value: '#FFDB00' },
          { name: 'Warm Grey', value: '#F5F5F5' },
          { name: 'Cool Grey', value: '#DFDFDF' },
          { name: 'Dark Grey', value: '#484848' },
        ],
        functionalPalette: {
          primary: '#0051BA',
          secondary: '#FFDB00',
          accent: '#F5F5F5',
          neutral: '#DFDFDF',
          light: '#FFFFFF',
          dark: '#111111',
          border: '#DFDFDF',
        },
        wallpaperImages: [
          'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=1920',
          'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1920',
        ],
      },
    },
  },
  null,
  2,
);

class Isolated extends Component<typeof ThemeCreator> {
  get canGenerate() {
    return Boolean(this.args.model.realm && this.args.model.codeRef);
  }

  get isGenerateDisabled() {
    return !this.canGenerate;
  }

  get selectedRealm(): string | null {
    let realm = this.args.model.realm;
    if (typeof realm !== 'string') {
      return null;
    }
    let trimmed = realm.trim();
    return trimmed.length ? trimmed : null;
  }

  get codeRefSelection() {
    let ref = this.args.model.codeRef;
    if (ref && ref.module && ref.name) {
      return ref;
    }
    return null;
  }

  get generatedCardsRealms(): string[] {
    return this.selectedRealm ? [this.selectedRealm] : [];
  }

  get generatedCardsQuery(): Query | undefined {
    let ref = this.codeRefSelection;
    if (!ref) {
      return undefined;
    }
    return {
      filter: {
        type: {
          module: ref.module,
          name: ref.name,
        },
      },
      sort: [
        {
          by: 'createdAt',
          direction: 'desc',
        },
      ],
    };
  }

  get canShowGeneratedCards(): boolean {
    return Boolean(
      this.generatedCardsQuery && this.generatedCardsRealms.length,
    );
  }

  get generatedCardsHint(): string {
    if (!this.selectedRealm && !this.codeRefSelection) {
      return 'Select a realm and theme type to preview matching cards.';
    }
    if (!this.selectedRealm) {
      return 'Select a realm to preview cards.';
    }
    if (!this.codeRefSelection) {
      return 'Select a theme type to preview cards.';
    }
    return 'Update the selections above to preview cards.';
  }

  private moduleMatches(
    codeRef: { module?: string | URL | null } | null,
    fragment: string,
  ): boolean {
    let moduleSpecifier = codeRef?.module;
    if (!moduleSpecifier) {
      return false;
    }
    let moduleString =
      typeof moduleSpecifier === 'string'
        ? moduleSpecifier
        : moduleSpecifier.toString();
    return moduleString.includes(fragment);
  }

  get structuredThemeGuidance(): string {
    return [
      'Structured Theme guidance: return JSON whose `cssVariables` field contains CSS defining both a light `:root` block and a `.dark` block so palettes work in light and dark contexts.',
      `Populate tokens such as ${STRUCTURED_THEME_VARIABLE_SUMMARY} with OKLCH or Hex values, and keep typography, spacing, radius, chart, sidebar, and shadow tokens cohesive.`,
      'Also include `rootVariables` and `darkModeVariables` objects mirroring those values so downstream tooling can diff individual tokens without parsing raw CSS.',
      'Append an `@theme inline` section that maps your structured variables to Boxel theme tokens so host apps can consume them consistently.',
      `Reference Boxel slots like ${BOXEL_THEME_VARIABLE_SUMMARY} and preserve AA-level contrast across states.`,
      'Add remote fonts to `cssImports` and always use `var(--token, fallback)` when referencing custom properties inside the CSS payload.',
      'Sample serialized JSON:',
      STRUCTURED_THEME_SAMPLE_JSON,
    ].join('\n');
  }

  get styleReferenceGuidance(): string {
    return [
      'Style Reference guidance: populate `styleName`, `visualDNA`, and `cardInfo.description` with short narratives, provide 4‑6 concise `inspirations`, and include at least two high-quality `wallpaperImages` URLs that reinforce the palette.',
      'Tie inspirations to materials, typography, or emotions so the assistant understands the desired mood.',
      'Return both `rootVariables`/`darkModeVariables` objects (token → value maps) and a `cssVariables` string that includes `:root`, `.dark`, and any `@theme inline` mappings so downstream tooling can diff tokens while still having raw CSS.',
      'Sample serialized JSON:',
      STYLE_REFERENCE_SAMPLE_JSON,
      this.structuredThemeGuidance,
    ].join('\n\n');
  }

  get brandGuideGuidance(): string {
    return [
      'Brand Guide guidance: capture the brand’s primary/secondary marks, clearance ratios, and social icons inside `markUsage`, describe the tone via `styleName`, `visualDNA`, and `brandColorPalette`, and provide wall imagery that reflects the system.',
      'Fill `typography` with heading/body stacks, `brandColorPalette` with named swatches, and `functionalPalette` with semantic colors (dark/light/primary/accent/border).',
      'Provide `rootVariables` and `darkModeVariables` objects along with a `cssVariables` string so editors can tweak individual tokens while previewing the compiled CSS.',
      'Sample serialized JSON:',
      BRAND_GUIDE_SAMPLE_JSON,
      this.structuredThemeGuidance,
    ].join('\n\n');
  }

  get themeGuidance(): string {
    return [
      'Theme guidance: return JSON whose `cssVariables` string declares a cohesive design system. Include a comprehensive `:root` block and, when appropriate, a `.dark` block to maintain parity across modes.',
      `Focus on the foundational tokens (${STRUCTURED_THEME_VARIABLE_SUMMARY}) and ensure every value has a coherent fallback.`,
      'Provide the same values inside both `rootVariables` and `darkModeVariables` objects so editors can surface and tweak individual tokens without parsing raw CSS.',
      'Append an `@theme inline` section if you map those tokens directly into Boxel theme slots; otherwise keep the CSS limited to the variables you introduced.',
      'List any required fonts or asset imports under `cssImports` and maintain accessible contrast throughout.',
      'Sample serialized JSON:',
      STRUCTURED_THEME_SAMPLE_JSON,
    ].join('\n');
  }

  promptGuidanceFor(codeRef: { module?: string | URL | null } | null): string {
    if (this.moduleMatches(codeRef, 'style-reference')) {
      return this.styleReferenceGuidance;
    }
    if (this.moduleMatches(codeRef, 'brand-guide')) {
      return this.brandGuideGuidance;
    }
    if (this.moduleMatches(codeRef, 'structured-theme')) {
      return this.structuredThemeGuidance;
    }
    if (this.moduleMatches(codeRef, '/theme')) {
      return this.themeGuidance;
    }
    return this.structuredThemeGuidance;
  }

  @tracked generationRuns: Array<{
    label: string;
    instance: TaskInstance<CardDef | undefined>;
  }> = [];

  realmInfoFor = (card?: CardDef | null) => {
    if (!card) {
      return null;
    }
    return card[realmInfo] ?? null;
  };

  realmURLFor = (card?: CardDef | null): URL | null => {
    if (!card) {
      return null;
    }
    let cardRealmURL = card[realmURL];
    if (!cardRealmURL) {
      return null;
    }
    if (cardRealmURL instanceof URL) {
      return cardRealmURL;
    }
    try {
      return new URL(cardRealmURL as unknown as string);
    } catch {
      return null;
    }
  };

  cardURLFrom = (card?: CardDef | null): string | null => {
    if (!card) {
      return null;
    }
    let cardId = card.id;
    return typeof cardId === 'string' ? cardId : null;
  };

  normalizedCardId = (card?: CardDef | null): string | null => {
    let urlString = this.cardURLFrom(card);
    if (!urlString) {
      return null;
    }
    try {
      let url = new URL(urlString);
      let path = url.pathname;
      let realmUrl = this.realmURLFor(card);
      if (realmUrl) {
        let realmPath = realmUrl.pathname.replace(/\/+$/, '');
        if (
          realmPath &&
          path.startsWith(realmPath) &&
          (path.length === realmPath.length ||
            path.charAt(realmPath.length) === '/')
        ) {
          path = path.slice(realmPath.length);
        }
      }
      let normalizedPath = path.replace(/^\/+/, '');
      if (!normalizedPath) {
        normalizedPath = '/';
      }
      return normalizedPath;
    } catch {
      return urlString;
    }
  };

  copyCardURL = async (card?: CardDef | null) => {
    let url = this.cardURLFrom(card);
    if (!url) {
      return;
    }
    try {
      await copyCardURLToClipboard(url);
    } catch (error) {
      console.error('Failed to copy card URL', error);
    }
  };

  errorMessageFor = (instance?: TaskInstance<CardDef | undefined> | null): string => {
    let error = instance?.error;
    if (!error) {
      return 'Theme generation failed. Try again.';
    }
    if (typeof error === 'string') {
      return error;
    }
    if (error instanceof Error && error.message) {
      return error.message;
    }
    if (typeof error === 'object') {
      try {
        return JSON.stringify(error);
      } catch {
        return '[unserializable error]';
      }
    }
    return String(error);
  };

  get variantCount(): number {
    let count = Number(this.args.model.numberOfVariants);
    if (!Number.isFinite(count) || count < 1) {
      return 1;
    }
    return Math.floor(count);
  }

  get generateButtonLabel(): string {
    return this.generateThemesTask.isRunning ? 'Generating…' : 'Generate';
  }

  get isGenerateButtonDisabled(): boolean {
    return this.isGenerateDisabled || this.generateThemesTask.isRunning;
  }

  generateThemeTask = task(async () => {
    if (!this.canGenerate) {
      return;
    }
    let commandContext = this.args.context?.commandContext;
    let codeRef = this.codeRefSelection;
    let realm = this.selectedRealm;
    if (!commandContext || !codeRef || !realm) {
      console.error(
        'Theme generation requires command context, realm, and codeRef.',
      );
      return;
    }

    let userPrompt =
      typeof this.args.model.prompt === 'string'
        ? this.args.model.prompt.trim()
        : null;
    let promptSections: string[] = [];
    if (userPrompt?.length) {
      promptSections.push(userPrompt);
    }
    let guidancePrompt = this.promptGuidanceFor(codeRef).trim();
    if (guidancePrompt.length) {
      promptSections.push(guidancePrompt);
    }
    let combinedPrompt = promptSections.join('\n\n');

    try {
      console.debug(
        'ThemeCreator payload prompt',
        JSON.stringify(
          {
            scope: 'ThemeCreator:AskPayload',
            guidance: guidancePrompt,
            prompt: combinedPrompt,
          },
          null,
          2,
        ),
      );
    } catch {
      // ignore logging issues
    }

    let askCommand = new AskAiForCardJsonCommand(commandContext);
    let payloadResult = await askCommand.execute({
      codeRef,
      realm,
      prompt: combinedPrompt || undefined,
    });

    let createCommand = new CreateExampleCardCommand(commandContext);
    let result = await createCommand.execute({
      codeRef,
      realm,
      payload: payloadResult.payload,
    });

    //returning id. Maybe we want to return card?
    return result.createdCard;
  });

  generateThemesTask = task(async () => {
    if (!this.canGenerate) {
      return;
    }

    let runs = Array.from({ length: this.variantCount }, (_, index) => {
      let instance = this.generateThemeTask.perform();
      return {
        label: `Variant ${index + 1}`,
        instance,
      };
    });
    this.generationRuns = runs;

    let results = await Promise.allSettled(runs.map((run) => run.instance));

    if (results.some((result) => result.status === 'rejected')) {
      console.error('One or more theme generations failed.');
    }
  });

  <template>
    <section class='theme-creator'>
      <header class='theme-creator__header'>
        <h2>Describe the theme you want to create</h2>
      </header>

      <div class='theme-creator__layout'>
        <div class='theme-creator__prompt-pane theme-creator__meta-field'>
          <label class='theme-creator__label'>Prompt</label>
          <p class='theme-creator__description'>
            Instruction to AI describing the type of theme (e.g., “a bold red
            festival kit”).
          </p>
          <@fields.prompt @format='edit' />
        </div>

        <aside class='theme-creator__meta-pane'>
          <div class='theme-creator__meta-field'>
            <label class='theme-creator__label'>Realm</label>
            <p class='theme-creator__description'>
              Where the generated theme card will be installed.
            </p>
            <@fields.realm @format='edit' />
          </div>

          <div class='theme-creator__meta-field'>
            <label class='theme-creator__label'>Code reference</label>
            <p class='theme-creator__description'>
              Choose the theme type you want to generate.
            </p>
            <@fields.codeRef @format='edit' />
          </div>

          <div class='theme-creator__meta-field'>
            <label class='theme-creator__label'>Number of variants</label>
            <p class='theme-creator__description'>
              How many different generations to produce in one run.
            </p>
            <@fields.numberOfVariants @format='edit' />
          </div>
        </aside>
      </div>

      <div class='theme-creator__actions'>
        <Button
          @kind='primary'
          disabled={{this.isGenerateButtonDisabled}}
          {{on 'click' this.generateThemesTask.perform}}
        >
          {{this.generateButtonLabel}}
        </Button>
      </div>

      {{#if this.generationRuns.length}}
        <div class='theme-creator__progress-list'>
          {{#each this.generationRuns as |run|}}
            <div class='theme-creator__progress-item'>
              <div class='theme-creator__progress-labels'>
                <div class='theme-creator__progress-id'>
                  {{#if run.instance.value.id}}
                    {{#let
                      (this.realmInfoFor run.instance.value)
                      as |runRealmInfo|
                    }}
                      {{#if runRealmInfo}}
                        <RealmIcon
                          class='theme-creator__progress-realm-icon'
                          @realmInfo={{runRealmInfo}}
                        />
                      {{/if}}
                    {{/let}}
                    <span class='theme-creator__progress-id-text'>
                      {{this.normalizedCardId run.instance.value}}
                    </span>
                    <Button
                      @kind='secondary-light'
                      @size='extra-small'
                      class='theme-creator__copy-button'
                      aria-label='Copy card URL'
                      {{on 'click' (fn this.copyCardURL run.instance.value)}}
                    >
                      <CopyIcon width='12' height='12' />
                    </Button>
                  {{else}}
                    <span class='theme-creator__progress-id-text'>
                      {{run.label}}
                    </span>
                  {{/if}}
                </div>
                <div class='theme-creator__progress-actions'>
                  {{#if run.instance.isError}}
                    <NotificationBubble
                      @type='error'
                      @message={{this.errorMessageFor run.instance}}
                    />
                  {{/if}}
                  <span class='theme-creator__progress-status'>
                    <StatusIndicator
                      @state={{if
                        run.instance.isRunning
                        'pending'
                        (if run.instance.isSuccessful 'success' 'error')
                      }}
                    />
                  </span>
                </div>
              </div>
            </div>
          {{/each}}
        </div>
      {{/if}}

      <section class='theme-creator__generated'>
        <div class='theme-creator__section-header'>
          <h2>Existing Theme Cards</h2>
          <p class='theme-creator__description'>
            Preview ALL theme cards in this realm.
          </p>
        </div>

        {{#if this.canShowGeneratedCards}}
          <PaginatedCards
            @query={{this.generatedCardsQuery}}
            @realms={{this.generatedCardsRealms}}
            @context={{@context}}
            as |card|
          >
            <div class='theme-creator__card-wrapper'>
              {{#if card.isError}}
                <NotificationBubble
                  @type='error'
                  @message='Failed to load this card preview.'
                />
              {{/if}}
              <card.component />
              <div class='theme-creator__card-actions'>
                <Button @kind='secondary-light' @size='small'>
                  <Wand width='14' height='14' />
                </Button>
              </div>
            </div>
          </PaginatedCards>
        {{else}}
          <p class='theme-creator__hint'>{{this.generatedCardsHint}}</p>
        {{/if}}
      </section>
    </section>

    <style scoped>
      .theme-creator {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
        background: var(--boxel-0);
      }

      .theme-creator__header {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }

      .theme-creator__layout {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
        gap: var(--boxel-sp-xl);
      }

      .theme-creator__prompt-pane {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
      }

      .theme-creator__meta-pane {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-md);
      }

      .theme-creator__meta-field {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
        padding: var(--boxel-sp-sm);
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
      }

      .theme-creator__label {
        font-size: var(--boxel-font-size);
        font-weight: 600;
      }

      .theme-creator__description {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-500);
      }

      .theme-creator__actions {
        display: flex;
        gap: var(--boxel-sp-sm);
        align-items: center;
      }

      .theme-creator__generated {
        margin-top: var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-md);
      }

      .theme-creator__progress-list {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        margin-top: var(--boxel-sp-md);
      }

      .theme-creator__progress-item {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-3xs);
        padding: var(--boxel-sp-sm);
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
        background: var(--boxel-0);
      }

      .theme-creator__progress-labels {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-600);
      }

      .theme-creator__progress-id {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
      }

      .theme-creator__progress-realm-icon {
        --boxel-realm-icon-size: var(--boxel-icon-xs);
        --boxel-realm-icon-border-color: var(--boxel-300);
        --boxel-realm-icon-background-color: var(--boxel-100);
      }

      .theme-creator__progress-id-text {
        display: inline-flex;
        align-items: center;
      }

      .theme-creator__progress-status {
        font-weight: 600;
      }

      .theme-creator__progress-actions {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }

      .theme-creator__copy-button {
        --boxel-button-min-width: auto;
        --boxel-button-padding: 0 var(--boxel-sp-xxs);
      }

      .theme-creator__section-header {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
        margin-bottom: var(--boxel-sp-lg);
      }

      .theme-creator__section-header h2 {
        margin: 0;
      }

      .theme-creator__section-header p,
      .theme-creator__hint {
        margin: 0;
        color: var(--boxel-600);
        font-size: var(--boxel-font-size-sm);
      }

      .theme-creator__card-wrapper {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        height: 100%;
        padding: var(--boxel-sp-sm);
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
      }

      .theme-creator__card-actions {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        justify-content: center;
        margin-top: auto;
      }
    </style>
  </template>
}

export class ThemeCreator extends CardDef {
  static displayName = 'Theme Creator';

  @field prompt = contains(MarkdownField);
  @field realm = contains(RealmField);
  @field codeRef = contains(ThemeCodeRefField);
  @field numberOfVariants = contains(NumberField);

  static isolated = Isolated;
}
