import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { eq, gt, and, not } from '@cardstack/boxel-ui/helpers';

import StringField from 'https://cardstack.com/base/string';
import DateField from '../fields/date';
import TimeField from '../fields/time';
import DatetimeField from '../fields/date-time';
import DatetimeStampField from '../fields/datetime-stamp';
import DayField from '../fields/date/day';
import DateRangeField from '../fields/date/date-range';
import TimeRangeField from '../fields/time/time-range';
import DurationField from '../fields/time/duration';
import RelativeTimeField from '../fields/time/relative-time';
import MonthDayField from '../fields/date/month-day';
import QuarterField from '../fields/date/quarter';
import RecurringPatternField from '../fields/recurring-pattern';
import TimePeriodField from '../fields/time-period';
import YearField from '../fields/date/year';
import MonthField from '../fields/date/month';
import MonthYearField from '../fields/date/month-year';
import WeekField from '../fields/date/week';
import NumberField from '../fields/number';
import RatingField from '../fields/rating';
import QuantityField from '../fields/quantity';
import ImageField from '../fields/image';
import MultipleImageField from '../fields/multiple-image';
import AudioField from '../fields/audio';
import ColorField from '../fields/color';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import ChevronRightIcon from '@cardstack/boxel-icons/chevron-right';
import ChevronLeftIcon from '@cardstack/boxel-icons/chevron-left';
import SearchIcon from '@cardstack/boxel-icons/search';
import ChevronDownIcon from '@cardstack/boxel-icons/chevron-down';
import CheckIcon from '@cardstack/boxel-icons/check';
import CopyIcon from '@cardstack/boxel-icons/copy';
import { BoxelInput, Button, Pill } from '@cardstack/boxel-ui/components';

import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

class FieldShowcaseIsolated extends Component<typeof FieldShowcase> {
  @tracked isSidebarCollapsed = false;
  @tracked searchQuery = '';
  @tracked expandedGroups = new Set(['Date & Time Fields']); // Sidebar groups expanded by default
  @tracked expandedSections = new Set(['configuration']); // Hero sections expanded by default
  @tracked selectedFormat: 'edit' | 'embedded' | 'atom' = 'edit'; // Format switcher

  @action
  toggleSidebar() {
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
  }

  @action
  toggleGroup(groupName: string) {
    const groups = new Set(this.expandedGroups);
    if (groups.has(groupName)) {
      groups.delete(groupName);
    } else {
      groups.add(groupName);
    }
    this.expandedGroups = groups;
  }

  @action
  toggleSection(sectionName: string) {
    const sections = new Set(this.expandedSections);
    if (sections.has(sectionName)) {
      sections.delete(sectionName);
    } else {
      sections.add(sectionName);
    }
    this.expandedSections = sections;
  }

  get isSectionExpanded() {
    return (sectionName: string): boolean => {
      return this.expandedSections?.has(sectionName) ?? false;
    };
  }

  @action
  copyCode() {
    navigator.clipboard.writeText(this.configCode);
  }

  @action
  copyVariantCode(code: string) {
    navigator.clipboard.writeText(code);
  }

  get colorFieldVariants() {
    return [
      {
        title: 'Standard',
        description: 'Default color picker',
        copyCode: `@field myColor = contains(ColorField);`,
        displayCode: `@field myColor = contains(ColorField);`,
        fieldName: 'playgroundColor',
      },
      {
        title: 'Wheel Picker',
        description: 'Color wheel variant',
        copyCode: `@field myColor = contains(ColorField, {
  configuration: { variant: 'wheel' }
});`,
        displayCode: `@field myColor = contains(ColorField, {
  configuration: { variant: 'wheel' }
});`,
        fieldName: 'colorWheel',
      },
      {
        title: 'Slider (RGB)',
        description: 'Slider with RGB format',
        copyCode: `@field myColor = contains(ColorField, {
  configuration: {
    variant: 'slider',
    options: { defaultFormat: 'rgb' }
  }
});`,
        displayCode: `@field myColor = contains(ColorField, {
  configuration: {
    variant: 'slider',
    options: { defaultFormat: 'rgb' }
  }
});`,
        fieldName: 'colorSliderRgb',
      },
      {
        title: 'Slider (HSL)',
        description: 'Slider with HSL format',
        copyCode: `@field myColor = contains(ColorField, {
  configuration: {
    variant: 'slider',
    options: { defaultFormat: 'hsl' }
  }
});`,
        displayCode: `@field myColor = contains(ColorField, {
  configuration: {
    variant: 'slider',
    options: { defaultFormat: 'hsl' }
  }
});`,
        fieldName: 'colorSliderHsl',
      },
      {
        title: 'Swatches Picker',
        description: 'Color swatches picker variant',
        copyCode: `@field myColor = contains(ColorField, {
  configuration: { variant: 'swatches-picker' }
});`,
        displayCode: `@field myColor = contains(ColorField, {
  configuration: { variant: 'swatches-picker' }
});`,
        fieldName: 'colorSwatchesPicker',
      },
      {
        title: 'Advanced',
        description: 'Advanced color picker with all format options',
        copyCode: `@field myColor = contains(ColorField, {
  configuration: { variant: 'advanced' }
});`,
        displayCode: `@field myColor = contains(ColorField, {
  configuration: { variant: 'advanced' }
});`,
        fieldName: 'colorAdvanced',
      },
      {
        title: 'with Recent Colors',
        description: 'Shows recent color history',
        copyCode: `@field myColor = contains(ColorField, {
  configuration: { options: { showRecent: true } }
});`,
        displayCode: `@field myColor = contains(ColorField, {
  configuration: { options: { showRecent: true } }
});`,
        fieldName: 'colorShowRecent',
      },
      {
        title: 'with Contrast Checker',
        description: 'Shows WCAG contrast checker',
        copyCode: `@field myColor = contains(ColorField, {
  configuration: { options: { showContrastChecker: true } }
});`,
        displayCode: `@field myColor = contains(ColorField, {
  configuration: { options: { showContrastChecker: true } }
});`,
        fieldName: 'colorShowContrast',
      },
    ];
  }

  get isGroupExpanded() {
    return (groupName: string): boolean => {
      return this.expandedGroups?.has(groupName) ?? false;
    };
  }

  @action
  updateSearch(value: string) {
    this.searchQuery = value.toLowerCase();
  }

  @action
  selectFieldType(value: string) {
    if (this.args.model) {
      this.args.model.playgroundFieldType = value;

      const currentPresentation =
        this.args.model.playgroundPresentation || 'standard';
      const compatiblePresentations = this.compatibilityMap[value] || [
        'standard',
      ];

      if (!compatiblePresentations.includes(currentPresentation)) {
        this.args.model.playgroundPresentation = 'standard';
      }
    }
  }

  get selectedFieldTypeLabel() {
    const fieldType = this.args.model?.playgroundFieldType || 'date';
    for (const group of this.fieldTypeOptions) {
      const found = group.options.find((opt: any) => opt.value === fieldType);
      if (found) return found.label;
    }
    return 'Select field type';
  }

  get filteredGroups() {
    if (!this.searchQuery) {
      return this.fieldTypeOptions;
    }

    return this.fieldTypeOptions
      .map((group) => ({
        ...group,
        options: group.options.filter((opt: any) =>
          opt.label.toLowerCase().includes(this.searchQuery),
        ),
      }))
      .filter((group) => group.options.length > 0);
  }

  compatibilityMap: Record<string, string[]> = {
    audio: [
      'inline-player',
      'waveform-player',
      'playlist-row',
      'mini-player',
      'album-cover',
      'volume-control',
      'trim-editor',
      'advanced-controls',
    ],
    date: ['standard', 'countdown', 'timeline', 'age'],
    time: ['standard', 'timeSlots'],
    datetime: [
      'standard',
      'countdown',
      'timeAgo',
      'timeline',
      'expirationWarning',
    ],
    datetimeStamp: ['standard'],
    day: ['standard'],
    dateRange: ['standard', 'businessDays'],
    year: ['standard'],
    month: ['standard'],
    monthYear: ['standard'],
    week: ['standard'],
    timeRange: ['standard'],
    duration: ['standard'],
    relativeTime: ['standard'],
    monthDay: ['standard'],
    quarter: ['standard'],
    recurringPattern: ['standard'],
    timePeriod: ['standard'],
    number: [
      'standard',
      'progress-bar',
      'progress-circle',
      'stat',
      'score',
      'badge-notification',
      'badge-metric',
      'badge-counter',
      'gauge',
    ],
    rating: ['standard'],
    quantity: ['standard'],
    image: ['standard', 'inline', 'card'],
    multipleImage: ['standard', 'grid', 'carousel'],
  };

  fieldTypeOptions = [
    {
      groupName: 'Date & Time Fields',
      options: [
        { value: 'date', label: 'DateField', fieldName: 'playgroundDate' },
        { value: 'time', label: 'TimeField', fieldName: 'playgroundTime' },
        {
          value: 'datetime',
          label: 'DatetimeField',
          fieldName: 'playgroundDatetime',
        },
        {
          value: 'datetimeStamp',
          label: 'DatetimeStampField',
          fieldName: 'playgroundDatetimeStamp',
        },
        {
          value: 'day',
          label: 'DayField',
          fieldName: 'playgroundDay',
        },
        { value: 'year', label: 'YearField', fieldName: 'playgroundYear' },
        { value: 'month', label: 'MonthField', fieldName: 'playgroundMonth' },
        {
          value: 'monthYear',
          label: 'MonthYearField',
          fieldName: 'playgroundMonthYear',
        },
        { value: 'week', label: 'WeekField', fieldName: 'playgroundWeek' },
        {
          value: 'dateRange',
          label: 'DateRangeField',
          fieldName: 'playgroundDateRange',
        },
        {
          value: 'timeRange',
          label: 'TimeRangeField',
          fieldName: 'playgroundTimeRange',
        },
        {
          value: 'duration',
          label: 'DurationField',
          fieldName: 'playgroundDuration',
        },
        {
          value: 'relativeTime',
          label: 'RelativeTimeField',
          fieldName: 'playgroundRelativeTime',
        },
        {
          value: 'monthDay',
          label: 'MonthDayField',
          fieldName: 'playgroundMonthDay',
        },
        {
          value: 'quarter',
          label: 'QuarterField',
          fieldName: 'playgroundQuarter',
        },
        {
          value: 'recurringPattern',
          label: 'RecurringPatternField',
          fieldName: 'playgroundRecurringPattern',
        },
        {
          value: 'timePeriod',
          label: 'TimePeriodField',
          fieldName: 'playgroundTimePeriod',
        },
      ],
    },
    {
      groupName: 'Number Fields',
      options: [
        {
          value: 'number',
          label: 'NumberField',
          fieldName: 'playgroundNumber',
        },
        {
          value: 'rating',
          label: 'RatingField',
          fieldName: 'playgroundRating',
        },
        {
          value: 'quantity',
          label: 'QuantityField',
          fieldName: 'playgroundQuantity',
        },
      ],
    },
    {
      groupName: 'Image Fields',
      options: [
        {
          value: 'image',
          label: 'ImageField',
          fieldName: 'playgroundImage',
        },
        {
          value: 'multipleImage',
          label: 'MultipleImageField',
          fieldName: 'playgroundMultipleImage',
        },
      ],
    },
    {
      groupName: 'Media Fields',
      options: [
        { value: 'audio', label: 'AudioField', fieldName: 'playgroundAudio' },
      ],
    },
    {
      groupName: 'Color Fields',
      options: [
        {
          value: 'color',
          label: 'ColorField',
          fieldName: 'playgroundColor',
        },
      ],
    },
  ];

  allPresentationOptions = [
    { value: 'standard', label: 'Standard' },
    { value: 'inline-player', label: 'Inline Player' },
    { value: 'waveform-player', label: 'Waveform (SoundCloud)' },
    { value: 'playlist-row', label: 'Playlist Row (Spotify)' },
    { value: 'mini-player', label: 'Mini Player (Podcast)' },
    { value: 'album-cover', label: 'Album Cover' },
    { value: 'volume-control', label: 'With Volume' },
    { value: 'trim-editor', label: 'Trim Editor' },
    { value: 'advanced-controls', label: 'Advanced Controls' },
    { value: 'countdown', label: 'Countdown Timer' },
    { value: 'timeAgo', label: 'Time Ago' },
    { value: 'age', label: 'Age Calculator' },
    { value: 'businessDays', label: 'Business Days' },
    { value: 'timeline', label: 'Timeline Event' },
    { value: 'timeSlots', label: 'Time Slots' },
    { value: 'expirationWarning', label: 'Expiration Warning' },
    // NumberField presentation modes
    { value: 'progress-bar', label: 'Progress Bar' },
    { value: 'progress-circle', label: 'Progress Circle' },
    { value: 'stat', label: 'Stat' },
    { value: 'score', label: 'Score' },
    { value: 'badge-notification', label: 'Badge Notification' },
    { value: 'badge-metric', label: 'Badge Metric' },
    { value: 'badge-counter', label: 'Badge Counter' },
    { value: 'gauge', label: 'Gauge' },
    // ImageField presentation modes
    { value: 'inline', label: 'Inline' },
    { value: 'card', label: 'Card' },
    // MultipleImageField presentation modes
    { value: 'grid', label: 'Grid' },
    { value: 'carousel', label: 'Carousel' },
    // ColorField variants
    { value: 'wheel', label: 'Wheel' },
    { value: 'slider', label: 'Slider' },
    { value: 'swatches-picker', label: 'Swatches Picker' },
    { value: 'advanced', label: 'Advanced' },
  ];

  get selectedPresentation() {
    const value = this.args.model?.playgroundPresentation || 'standard';
    return (
      this.availablePresentationOptions.find((opt) => opt.value === value) ||
      this.availablePresentationOptions[0]
    );
  }

  get availablePresentationOptions() {
    const fieldType = this.args.model?.playgroundFieldType || 'date';
    const compatiblePresentations = this.compatibilityMap[fieldType] || [
      'standard',
    ];

    const filtered = this.allPresentationOptions.filter((option) =>
      compatiblePresentations.includes(option.value),
    );

    // For image fields, return the filtered options (no 'standard' fallback)
    if (fieldType === 'image' || fieldType === 'multipleImage') {
      return filtered.length > 0 ? filtered : [];
    }

    // Always return at least the standard option for other fields
    return filtered.length > 0
      ? filtered
      : [{ value: 'standard', label: 'Standard' }];
  }

  get examplesForCurrentField() {
    const fieldType = this.args.model?.playgroundFieldType || 'date';

    const examplesMap: Record<
      string,
      Array<{
        name: string;
        description: string;
        config: string;
        fieldName: string;
      }>
    > = {
      audio: [],
      color: [],
      date: [
        {
          name: 'Compact Date',
          description: 'Tiny preset for space-saving',
          config:
            '@field appointmentDateCompact = contains(DateField, { configuration: { preset: "tiny" } });',
          fieldName: 'appointmentDateCompact',
        },
        {
          name: 'Custom Format',
          description: 'Custom date formatting',
          config:
            '@field appointmentDateCustom = contains(DateField, { configuration: { format: "MMM D, YYYY" } });',
          fieldName: 'appointmentDateCustom',
        },
      ],
      time: [
        {
          name: '24-Hour Format',
          description: '24-hour time display',
          config:
            '@field meetingTime24Hour = contains(TimeField, { configuration: { hourCycle: "h23" } });',
          fieldName: 'meetingTime24Hour',
        },
        {
          name: 'Long Style',
          description: 'Includes timezone information',
          config:
            '@field meetingTimeLong = contains(TimeField, { configuration: { timeStyle: "long" } });',
          fieldName: 'meetingTimeLong',
        },
      ],
      datetime: [
        {
          name: 'Short Format',
          description: 'Compact datetime display',
          config:
            '@field eventDateTimeShort = contains(DatetimeField, { configuration: { preset: "short" } });',
          fieldName: 'eventDateTimeShort',
        },
        {
          name: 'Custom Format',
          description: 'Custom datetime formatting',
          config:
            '@field eventDateTimeCustom = contains(DatetimeField, { configuration: { format: "ddd, MMM D [at] h:mm A" } });',
          fieldName: 'eventDateTimeCustom',
        },
      ],
      duration: [
        {
          name: 'General Duration',
          description:
            'All time units (years, months, days, hours, minutes, seconds)',
          config:
            '@field projectDuration = contains(DurationField, { configuration: { includeYears: true, includeMonths: true, includeDays: true, includeHours: true, includeMinutes: true, includeSeconds: true } });',
          fieldName: 'projectDurationFull',
        },
        {
          name: 'Day-Time Duration',
          description: 'No years/months (avoids month-length ambiguity)',
          config:
            '@field taskDuration = contains(DurationField, { configuration: { includeDays: true, includeHours: true, includeMinutes: true, includeSeconds: true } });',
          fieldName: 'taskDurationDayTime',
        },
        {
          name: 'Year-Month Duration',
          description: 'Calendar-based periods (contracts, subscriptions)',
          config:
            '@field contractDuration = contains(DurationField, { configuration: { includeYears: true, includeMonths: true } });',
          fieldName: 'contractDurationYearMonth',
        },
      ],
      image: [
        {
          name: 'Browse Variant',
          description: 'Default browse variant for general image uploads',
          config:
            '@field myImage = contains(ImageField, { configuration: { variant: "browse" } });',
          fieldName: 'imageBrowse',
        },
        {
          name: 'Avatar Variant',
          description: 'Circular image upload for profile pictures',
          config:
            '@field myAvatar = contains(ImageField, { configuration: { variant: "avatar", presentation: "card" } });',
          fieldName: 'imageAvatar',
        },
        {
          name: 'Dropzone Variant',
          description: 'Drag and drop interface with modal preview',
          config:
            '@field myDropzone = contains(ImageField, { configuration: { variant: "dropzone", presentation: "inline" } });',
          fieldName: 'imageDropzone',
        },
      ],
      multipleImage: [
        {
          name: 'List Variant',
          description: 'Standard list view with grid display',
          config:
            '@field myImages = contains(MultipleImageField, { configuration: { variant: "list", presentation: "grid" } });',
          fieldName: 'multipleImageList',
        },
        {
          name: 'Gallery Variant',
          description: 'Grid edit with carousel display and reordering',
          config:
            '@field myGallery = contains(MultipleImageField, { configuration: { variant: "gallery", presentation: "carousel" } });',
          fieldName: 'multipleImageGallery',
        },
        {
          name: 'Dropzone Variant',
          description: 'Drag and drop multiple images with carousel',
          config:
            '@field myDropzoneImages = contains(MultipleImageField, { configuration: { variant: "dropzone", presentation: "carousel" } });',
          fieldName: 'multipleImageDropzone',
        },
      ],
    };

    return examplesMap[fieldType] || [];
  }

  get currentPlaygroundField() {
    const fieldType = this.args.model?.playgroundFieldType || 'date';
    for (const group of this.fieldTypeOptions) {
      const found = group.options.find((opt: any) => opt.value === fieldType);
      if (found) return found.fieldName;
    }
    return 'playgroundDate';
  }

  @action
  updatePresentation(option: { value: string; label: string } | null) {
    if (option && this.args.model) {
      this.args.model.playgroundPresentation = option.value;

      // Auto-switch to embedded format when selecting a presentation mode
      // For image fields, always switch to embedded since they don't have 'standard'
      const fieldType = this.args.model?.playgroundFieldType || 'date';
      if (
        fieldType === 'image' ||
        fieldType === 'multipleImage' ||
        option.value !== 'standard'
      ) {
        this.selectedFormat = 'embedded';
      }
    }
  }

  @action
  selectFormat(format: string) {
    this.selectedFormat = format as 'edit' | 'embedded' | 'atom';
  }

  get hasAvailableOptions() {
    return !!this.args.model && (this.availableOptions?.length ?? 0) > 0;
  }

  get availableOptions() {
    // Early return if model is not available (during prerender)
    if (!this.args.model) {
      return [];
    }

    const fieldType = this.args.model.playgroundFieldType || 'date';
    const presentation = this.args.model.playgroundPresentation || 'standard';

    // Define options for each field type and presentation with descriptions
    const optionsMap: Record<
      string,
      Record<
        string,
        Array<{
          key: string;
          label: string;
          type: 'number' | 'text' | 'boolean';
          description: string;
          default?: any;
        }>
      >
    > = {
      number: {
        'progress-bar': [
          {
            key: 'min',
            label: 'Min',
            type: 'number',
            description: 'Minimum value for the progress bar range',
            default: '(uses component default: 0)',
          },
          {
            key: 'max',
            label: 'Max',
            type: 'number',
            description: 'Maximum value for the progress bar range',
            default: '(uses component default: 100)',
          },
          {
            key: 'decimals',
            label: 'Decimals',
            type: 'number',
            description: 'Number of decimal places to display',
            default: '(none)',
          },
          {
            key: 'prefix',
            label: 'Prefix',
            type: 'text',
            description: 'Text displayed before the number value',
            default: '(none)',
          },
          {
            key: 'suffix',
            label: 'Suffix',
            type: 'text',
            description:
              'Text displayed after the number value (e.g., "%" for percentage)',
            default: '(none)',
          },
          {
            key: 'label',
            label: 'Label',
            type: 'text',
            description:
              'Custom label text displayed on the progress bar (overrides value display)',
            default: '(none)',
          },
          {
            key: 'useGradient',
            label: 'Use Gradient',
            type: 'boolean',
            description:
              'Whether to use gradient colors (red → orange → yellow → green) based on percentage',
            default: '(uses component default: true)',
          },
          {
            key: 'showValue',
            label: 'Show Value',
            type: 'boolean',
            description:
              'Whether to display the current value on the progress bar',
            default: '(uses component default: true)',
          },
          {
            key: 'valueFormat',
            label: 'Value Format',
            type: 'text',
            description:
              'Format for displaying the value: "percentage" or "fraction"',
            default: '(uses component default: "percentage")',
          },
        ],
        'progress-circle': [
          {
            key: 'min',
            label: 'Min',
            type: 'number',
            description: 'Minimum value for the progress circle range',
            default: '(uses component default: 0)',
          },
          {
            key: 'max',
            label: 'Max',
            type: 'number',
            description: 'Maximum value for the progress circle range',
            default: '(uses component default: 100)',
          },
          {
            key: 'decimals',
            label: 'Decimals',
            type: 'number',
            description: 'Number of decimal places to display',
            default: '(none)',
          },
          {
            key: 'prefix',
            label: 'Prefix',
            type: 'text',
            description: 'Text displayed before the number value',
            default: '(none)',
          },
          {
            key: 'suffix',
            label: 'Suffix',
            type: 'text',
            description:
              'Text displayed after the number value (e.g., "%" for percentage)',
            default: '(none)',
          },
          {
            key: 'useGradient',
            label: 'Use Gradient',
            type: 'boolean',
            description:
              'Whether to use gradient colors (red → orange → yellow → green) based on percentage',
            default: '(uses component default: true)',
          },
          {
            key: 'showValue',
            label: 'Show Value',
            type: 'boolean',
            description:
              'Whether to display the current value in the center of the circle',
            default: '(uses component default: true)',
          },
          {
            key: 'valueFormat',
            label: 'Value Format',
            type: 'text',
            description:
              'Format for displaying the value: "percentage" or "fraction"',
            default: '(uses component default: "percentage")',
          },
        ],
        stat: [
          {
            key: 'decimals',
            label: 'Decimals',
            type: 'number',
            description: 'Number of decimal places to display',
            default: '(uses default formatting)',
          },
          {
            key: 'prefix',
            label: 'Prefix',
            type: 'text',
            description: 'Text displayed before the number value',
            default: '(none)',
          },
          {
            key: 'suffix',
            label: 'Suffix',
            type: 'text',
            description: 'Text displayed after the number value',
            default: '(none)',
          },
          {
            key: 'min',
            label: 'Min',
            type: 'number',
            description: 'Minimum value for the stat range (shown in footer)',
            default: '(none, hides range)',
          },
          {
            key: 'max',
            label: 'Max',
            type: 'number',
            description: 'Maximum value for the stat range (shown in footer)',
            default: '(none, hides range)',
          },
          {
            key: 'label',
            label: 'Label',
            type: 'text',
            description: 'Main label text displayed above the stat value',
            default: 'Key metric',
          },
          {
            key: 'subtitle',
            label: 'Subtitle',
            type: 'text',
            description:
              'Subtitle text displayed below the value (e.g., comparison text)',
            default: '(none)',
          },
          {
            key: 'placeholder',
            label: 'Placeholder',
            type: 'text',
            description: 'Text to show when value is null or undefined',
            default: '—',
          },
          {
            key: 'icon',
            label: 'Icon',
            type: 'text',
            description:
              'Icon component to display (imported from @cardstack/boxel-icons)',
            default: '(none)',
          },
        ],
        score: [
          {
            key: 'decimals',
            label: 'Decimals',
            type: 'number',
            description: 'Number of decimal places to display',
            default: '(none)',
          },
          {
            key: 'prefix',
            label: 'Prefix',
            type: 'text',
            description: 'Text displayed before the number value',
            default: '(none)',
          },
          {
            key: 'suffix',
            label: 'Suffix',
            type: 'text',
            description: 'Text displayed after the number value',
            default: '(none)',
          },
          {
            key: 'min',
            label: 'Min',
            type: 'number',
            description: 'Minimum value for the score range',
            default: '(uses component default: 0)',
          },
          {
            key: 'max',
            label: 'Max',
            type: 'number',
            description: 'Maximum value for the score range',
            default: '(uses component default: 100)',
          },
        ],
        'badge-notification': [
          {
            key: 'decimals',
            label: 'Decimals',
            type: 'number',
            description: 'Number of decimal places to display',
            default: '(uses default formatting)',
          },
          {
            key: 'prefix',
            label: 'Prefix',
            type: 'text',
            description: 'Text displayed before the number value',
            default: '(none)',
          },
          {
            key: 'suffix',
            label: 'Suffix',
            type: 'text',
            description: 'Text displayed after the number value',
            default: '(none)',
          },
          {
            key: 'min',
            label: 'Min',
            type: 'number',
            description: 'Minimum value for the notification range',
            default: '(none)',
          },
          {
            key: 'max',
            label: 'Max',
            type: 'number',
            description:
              'Maximum value before showing "+" indicator (e.g., 99+)',
            default: '(uses component default: 99)',
          },
          {
            key: 'label',
            label: 'Label',
            type: 'text',
            description: 'Label text displayed below the badge icon',
            default: 'Notifications',
          },
          {
            key: 'placeholder',
            label: 'Placeholder',
            type: 'text',
            description: 'Text to show when value is null or undefined',
            default: '(none)',
          },
          {
            key: 'icon',
            label: 'Icon',
            type: 'text',
            description:
              'Icon component to display (imported from @cardstack/boxel-icons)',
            default: '(none)',
          },
        ],
        'badge-metric': [
          {
            key: 'decimals',
            label: 'Decimals',
            type: 'number',
            description: 'Number of decimal places to display',
            default: '(uses default formatting)',
          },
          {
            key: 'prefix',
            label: 'Prefix',
            type: 'text',
            description: 'Text displayed before the number value',
            default: '(none)',
          },
          {
            key: 'suffix',
            label: 'Suffix',
            type: 'text',
            description: 'Text displayed after the number value',
            default: '(none)',
          },
          {
            key: 'min',
            label: 'Min',
            type: 'number',
            description: 'Minimum value for the metric range',
            default: '(none)',
          },
          {
            key: 'max',
            label: 'Max',
            type: 'number',
            description: 'Maximum value for the metric range',
            default: '(none)',
          },
          {
            key: 'label',
            label: 'Label',
            type: 'text',
            description: 'Label text displayed on the right side of the badge',
            default: '(empty string)',
          },
          {
            key: 'placeholder',
            label: 'Placeholder',
            type: 'text',
            description: 'Text to show when value is null or undefined',
            default: '(none)',
          },
          {
            key: 'icon',
            label: 'Icon',
            type: 'text',
            description:
              'Icon component to display (imported from @cardstack/boxel-icons)',
            default: '(none)',
          },
        ],
        'badge-counter': [
          {
            key: 'decimals',
            label: 'Decimals',
            type: 'number',
            description: 'Number of decimal places to display',
            default: '(uses default formatting)',
          },
          {
            key: 'prefix',
            label: 'Prefix',
            type: 'text',
            description: 'Text displayed before the number value',
            default: '(none)',
          },
          {
            key: 'suffix',
            label: 'Suffix',
            type: 'text',
            description: 'Text displayed after the number value',
            default: '(none)',
          },
          {
            key: 'min',
            label: 'Min',
            type: 'number',
            description: 'Minimum value for the counter range',
            default: '(none)',
          },
          {
            key: 'max',
            label: 'Max',
            type: 'number',
            description: 'Maximum value before showing "+" indicator',
            default: '(none)',
          },
          {
            key: 'label',
            label: 'Label',
            type: 'text',
            description: 'Label text displayed on the left side',
            default: '(empty string)',
          },
          {
            key: 'placeholder',
            label: 'Placeholder',
            type: 'text',
            description: 'Text to show when value is null or undefined',
            default: '(none)',
          },
          {
            key: 'icon',
            label: 'Icon',
            type: 'text',
            description:
              'Icon component to display (imported from @cardstack/boxel-icons)',
            default: '(none)',
          },
        ],
        gauge: [
          {
            key: 'decimals',
            label: 'Decimals',
            type: 'number',
            description: 'Number of decimal places to display',
            default: '(uses default formatting)',
          },
          {
            key: 'prefix',
            label: 'Prefix',
            type: 'text',
            description: 'Text displayed before the number value',
            default: '(none)',
          },
          {
            key: 'suffix',
            label: 'Suffix',
            type: 'text',
            description: 'Text displayed after the number value',
            default: '(none)',
          },
          {
            key: 'min',
            label: 'Min',
            type: 'number',
            description: 'Minimum value for the gauge range',
            default: '(uses component default: 0)',
          },
          {
            key: 'max',
            label: 'Max',
            type: 'number',
            description: 'Maximum value for the gauge range',
            default: '(uses component default: 100)',
          },
          {
            key: 'label',
            label: 'Label',
            type: 'text',
            description: 'Label text displayed above the gauge',
            default: '(none)',
          },
          {
            key: 'showValue',
            label: 'Show Value',
            type: 'boolean',
            description: 'Whether to display the current value below the gauge',
            default: '(uses component default: true)',
          },
          {
            key: 'warningThreshold',
            label: 'Warning Threshold',
            type: 'number',
            description:
              'Value at which the gauge changes to warning color (orange)',
            default: '(none)',
          },
          {
            key: 'dangerThreshold',
            label: 'Danger Threshold',
            type: 'number',
            description:
              'Value at which the gauge changes to danger color (red)',
            default: '(none)',
          },
        ],
      },
      rating: {
        standard: [
          {
            key: 'maxStars',
            label: 'Max Stars',
            type: 'number',
            description:
              'Maximum number of stars in the rating (e.g., 5 for 5-star rating)',
            default: '(uses component default: 5)',
          },
        ],
      },
      quantity: {
        standard: [
          {
            key: 'min',
            label: 'Min',
            type: 'number',
            description: 'Minimum value for the quantity range',
            default: '(uses component default: 0)',
          },
          {
            key: 'max',
            label: 'Max',
            type: 'number',
            description: 'Maximum value for the quantity range',
            default: '(none)',
          },
        ],
      },
      image: {
        standard: [
          {
            key: 'autoUpload',
            label: 'Auto Upload',
            type: 'boolean',
            description:
              'Automatically upload image after file selection (default: true)',
            default: '(uses component default: true)',
          },
          {
            key: 'showProgress',
            label: 'Show Progress',
            type: 'boolean',
            description:
              'Show progress indicator during file reading (default: true)',
            default: '(uses component default: true)',
          },
          {
            key: 'showImageModal',
            label: 'Show Image Modal',
            type: 'boolean',
            description:
              'Show zoom/modal button on image preview (browse/dropzone only, default: false)',
            default: '(uses component default: false)',
          },
          {
            key: 'previewImageFit',
            label: 'Preview Image Fit',
            type: 'text',
            description:
              'How the preview image fits: "contain" (show full) or "cover" (fill container, browse/dropzone only, default: "contain")',
            default: '(uses component default: "contain")',
          },
        ],
        image: [
          {
            key: 'autoUpload',
            label: 'Auto Upload',
            type: 'boolean',
            description:
              'Automatically upload image after file selection (default: true)',
            default: '(uses component default: true)',
          },
          {
            key: 'showProgress',
            label: 'Show Progress',
            type: 'boolean',
            description:
              'Show progress indicator during file reading (default: true)',
            default: '(uses component default: true)',
          },
          {
            key: 'showImageModal',
            label: 'Show Image Modal',
            type: 'boolean',
            description:
              'Show zoom/modal button on image preview (browse/dropzone only, default: false)',
            default: '(uses component default: false)',
          },
          {
            key: 'previewImageFit',
            label: 'Preview Image Fit',
            type: 'text',
            description:
              'How the preview image fits: "contain" (show full) or "cover" (fill container, browse/dropzone only, default: "contain")',
            default: '(uses component default: "contain")',
          },
        ],
        inline: [
          {
            key: 'autoUpload',
            label: 'Auto Upload',
            type: 'boolean',
            description:
              'Automatically upload image after file selection (default: true)',
            default: '(uses component default: true)',
          },
          {
            key: 'showProgress',
            label: 'Show Progress',
            type: 'boolean',
            description:
              'Show progress indicator during file reading (default: true)',
            default: '(uses component default: true)',
          },
          {
            key: 'showImageModal',
            label: 'Show Image Modal',
            type: 'boolean',
            description:
              'Show zoom/modal button on image preview (browse/dropzone only, default: false)',
            default: '(uses component default: false)',
          },
          {
            key: 'previewImageFit',
            label: 'Preview Image Fit',
            type: 'text',
            description:
              'How the preview image fits: "contain" (show full) or "cover" (fill container, browse/dropzone only, default: "contain")',
            default: '(uses component default: "contain")',
          },
        ],
        card: [
          {
            key: 'autoUpload',
            label: 'Auto Upload',
            type: 'boolean',
            description:
              'Automatically upload image after file selection (default: true)',
            default: '(uses component default: true)',
          },
          {
            key: 'showProgress',
            label: 'Show Progress',
            type: 'boolean',
            description:
              'Show progress indicator during file reading (default: true)',
            default: '(uses component default: true)',
          },
        ],
      },
      color: {
        standard: [
          {
            key: 'showRecent',
            label: 'Show Recent',
            type: 'boolean',
            description: 'Display recent color history grid below the picker',
            default: '(uses component default: false)',
          },
          {
            key: 'showContrastChecker',
            label: 'Show Contrast Checker',
            type: 'boolean',
            description: 'Display WCAG contrast checker for accessibility',
            default: '(uses component default: false)',
          },
          {
            key: 'maxRecentHistory',
            label: 'Max Recent History',
            type: 'number',
            description: 'Maximum number of recent colors to display',
            default: '(uses component default: 8)',
          },
        ],
        wheel: [
          {
            key: 'defaultFormat',
            label: 'Default Format (Wheel)',
            type: 'text',
            description: 'Color format to use: "hex", "rgb", or "hsl"',
            default: '(uses component default: "hex")',
          },
          {
            key: 'showRecent',
            label: 'Show Recent',
            type: 'boolean',
            description:
              'Display recent color history grid below the picker (Wheel variant)',
            default: '(uses component default: false)',
          },
          {
            key: 'showContrastChecker',
            label: 'Show Contrast Checker',
            type: 'boolean',
            description:
              'Display WCAG contrast checker for accessibility (Wheel variant)',
            default: '(uses component default: false)',
          },
          {
            key: 'maxRecentHistory',
            label: 'Max Recent History',
            type: 'number',
            description:
              'Maximum number of recent colors to display (Wheel variant)',
            default: '(uses component default: 8)',
          },
        ],
        slider: [
          {
            key: 'defaultFormat',
            label: 'Default Format (Slider)',
            type: 'text',
            description: 'Slider format to use: "rgb" or "hsl"',
            default: '(uses component default: "rgb")',
          },
          {
            key: 'showRecent',
            label: 'Show Recent',
            type: 'boolean',
            description:
              'Display recent color history grid below the picker (Slider variant)',
            default: '(uses component default: false)',
          },
          {
            key: 'showContrastChecker',
            label: 'Show Contrast Checker',
            type: 'boolean',
            description:
              'Display WCAG contrast checker for accessibility (Slider variant)',
            default: '(uses component default: false)',
          },
          {
            key: 'maxRecentHistory',
            label: 'Max Recent History',
            type: 'number',
            description:
              'Maximum number of recent colors to display (Slider variant)',
            default: '(uses component default: 8)',
          },
        ],
        'swatches-picker': [
          {
            key: 'paletteColors',
            label: 'Palette Colors (Swatches-picker)',
            type: 'text',
            description:
              'Array of predefined color swatches to display (e.g., ["#FF0000", "#00FF00"])',
            default: '(uses component default palette)',
          },
          {
            key: 'showRecent',
            label: 'Show Recent',
            type: 'boolean',
            description:
              'Display recent color history grid below the picker (Swatches-picker variant)',
            default: '(uses component default: false)',
          },
          {
            key: 'showContrastChecker',
            label: 'Show Contrast Checker',
            type: 'boolean',
            description:
              'Display WCAG contrast checker for accessibility (Swatches-picker variant)',
            default: '(uses component default: false)',
          },
          {
            key: 'maxRecentHistory',
            label: 'Max Recent History',
            type: 'number',
            description:
              'Maximum number of recent colors to display (Swatches-picker variant)',
            default: '(uses component default: 8)',
          },
        ],
        advanced: [
          {
            key: 'defaultFormat',
            label: 'Default Format (Advanced)',
            type: 'text',
            description:
              'Advanced format to use: "hex", "rgb", "hsl", "hsb", or "css"',
            default: '(uses component default: "hex")',
          },
        ],
      },
      multipleImage: {
        standard: [
          {
            key: 'autoUpload',
            label: 'Auto Upload',
            type: 'boolean',
            description:
              'Automatically upload images after file selection (default: true)',
            default: '(uses component default: true)',
          },
          {
            key: 'allowReorder',
            label: 'Allow Reorder',
            type: 'boolean',
            description: 'Allow drag-drop reordering of images (default: true)',
            default: '(uses component default: true)',
          },
          {
            key: 'allowBatchSelect',
            label: 'Allow Batch Select',
            type: 'boolean',
            description: 'Allow batch selection and delete (default: true)',
            default: '(uses component default: true)',
          },
          {
            key: 'maxFiles',
            label: 'Max Files',
            type: 'number',
            description: 'Maximum number of files allowed (default: 10)',
            default: '(uses component default: 10)',
          },
          {
            key: 'showProgress',
            label: 'Show Progress',
            type: 'boolean',
            description:
              'Show progress indicator during file reading (default: true)',
            default: '(uses component default: true)',
          },
        ],
        grid: [
          {
            key: 'autoUpload',
            label: 'Auto Upload',
            type: 'boolean',
            description:
              'Automatically upload images after file selection (default: true)',
            default: '(uses component default: true)',
          },
          {
            key: 'allowReorder',
            label: 'Allow Reorder',
            type: 'boolean',
            description: 'Allow drag-drop reordering of images (default: true)',
            default: '(uses component default: true)',
          },
          {
            key: 'allowBatchSelect',
            label: 'Allow Batch Select',
            type: 'boolean',
            description: 'Allow batch selection and delete (default: true)',
            default: '(uses component default: true)',
          },
          {
            key: 'maxFiles',
            label: 'Max Files',
            type: 'number',
            description: 'Maximum number of files allowed (default: 10)',
            default: '(uses component default: 10)',
          },
          {
            key: 'showProgress',
            label: 'Show Progress',
            type: 'boolean',
            description:
              'Show progress indicator during file reading (default: true)',
            default: '(uses component default: true)',
          },
        ],
        carousel: [
          {
            key: 'autoUpload',
            label: 'Auto Upload',
            type: 'boolean',
            description:
              'Automatically upload images after file selection (default: true)',
            default: '(uses component default: true)',
          },
          {
            key: 'allowReorder',
            label: 'Allow Reorder',
            type: 'boolean',
            description: 'Allow drag-drop reordering of images (default: true)',
            default: '(uses component default: true)',
          },
          {
            key: 'allowBatchSelect',
            label: 'Allow Batch Select',
            type: 'boolean',
            description: 'Allow batch selection and delete (default: true)',
            default: '(uses component default: true)',
          },
          {
            key: 'maxFiles',
            label: 'Max Files',
            type: 'number',
            description: 'Maximum number of files allowed (default: 10)',
            default: '(uses component default: 10)',
          },
          {
            key: 'showProgress',
            label: 'Show Progress',
            type: 'boolean',
            description:
              'Show progress indicator during file reading (default: true)',
            default: '(uses component default: true)',
          },
        ],
      },
    };

    return optionsMap[fieldType]?.[presentation] || [];
  }

  get formatOptions() {
    return [
      { value: 'edit', label: 'Edit' },
      { value: 'embedded', label: 'Embedded' },
      { value: 'atom', label: 'Atom' },
    ];
  }

  get selectedFormatOption() {
    return (
      this.formatOptions.find((opt) => opt.value === this.selectedFormat) ||
      this.formatOptions[0]
    );
  }

  get configCode() {
    const fieldType = this.args.model?.playgroundFieldType || 'date';
    const presentation = this.args.model?.playgroundPresentation || 'standard';

    let option: any = null;
    for (const group of this.fieldTypeOptions) {
      const found = group.options.find((opt: any) => opt.value === fieldType);
      if (found) {
        option = found;
        break;
      }
    }

    const fieldTypeName = option?.label || 'DateField';

    // ColorField - handle all variants
    if (fieldType === 'color') {
      if (presentation === 'standard') {
        return `@field myColor = contains(ColorField);`;
      }
      if (presentation === 'wheel') {
        return `@field myColor = contains(ColorField, {
  configuration: { variant: 'wheel' }
});`;
      }
      if (presentation === 'slider') {
        return `@field myColor = contains(ColorField, {
  configuration: { 
    variant: 'slider',
    options: { defaultFormat: 'rgb' }
  }
});`;
      }
      if (presentation === 'swatches-picker') {
        return `@field myColor = contains(ColorField, {
  configuration: { variant: 'swatches-picker' }
});`;
      }
      if (presentation === 'advanced') {
        return `@field myColor = contains(ColorField, {
  configuration: { variant: 'advanced' }
});`;
      }
      return `@field myColor = contains(ColorField);`;
    }

    // Number fields, rating, quantity - just show presentation without options
    if (fieldType === 'number') {
      if (presentation === 'standard') {
        return `@field myField = contains(NumberField);`;
      }
    }

    if (fieldType === 'audio') {
      if (presentation === 'inline-player') {
        return `@field myAudio = contains(AudioField);`;
      }
      if (presentation === 'volume-control') {
        return `@field myAudio = contains(AudioField, {
  configuration: {
    options: { showVolume: true }
  }
});`;
      }
      if (presentation === 'advanced-controls') {
        return `@field myAudio = contains(AudioField, {
  configuration: {
    options: {
      showVolume: true,
      showSpeedControl: true,
      showLoopControl: true
    }
  }
});`;
      }
      return `@field myAudio = contains(AudioField, {
  configuration: {
    presentation: '${presentation}'
  }
});`;
    }

    if (fieldType === 'rating') {
      return `@field myField = contains(RatingField);`;
    }

    if (fieldType === 'quantity') {
      return `@field myField = contains(QuantityField);`;
    }

    const simpleFields = [
      'image',
      'multipleImage',
      'year',
      'month',
      'monthYear',
      'week',
      'timeRange',
      'duration',
      'relativeTime',
      'monthDay',
      'quarter',
      'recurringPattern',
    ];

    if (simpleFields.includes(fieldType)) {
      return `@field myField = contains(${fieldTypeName});`;
    }

    if (presentation === 'standard') {
      return `@field myField = contains(${fieldTypeName});`;
    }

    return `@field myField = contains(${fieldTypeName}, {
  configuration: {
    presentation: '${presentation}'
  }
});`;
  }

  <template>
    <div
      class='showcase-container
        {{if this.isSidebarCollapsed "sidebar-collapsed"}}'
    >
      {{! Persistent Sidebar }}
      <aside class='sidebar'>
        <div class='sidebar-header'>
          <h3>Field Library</h3>
          <Button
            @kind='text-only'
            @size='small'
            class='sidebar-toggle'
            {{on 'click' this.toggleSidebar}}
            title='{{if
              this.isSidebarCollapsed
              "Expand sidebar"
              "Collapse sidebar"
            }}'
          >
            {{#if this.isSidebarCollapsed}}
              <ChevronRightIcon width='20' height='20' />
            {{else}}
              <ChevronLeftIcon width='20' height='20' />
            {{/if}}
          </Button>
        </div>

        {{#unless this.isSidebarCollapsed}}
          <div class='sidebar-search'>
            <label for='sidebar-search-input' class='sr-only'>
              Search fields
            </label>
            <BoxelInput
              id='sidebar-search-input'
              @value={{this.searchQuery}}
              @onInput={{this.updateSearch}}
              @placeholder='Search fields...'
              aria-label='Search fields'
            />
          </div>

          <div class='sidebar-content'>
            {{#if (gt this.filteredGroups.length 0)}}
              {{#each this.filteredGroups as |group|}}
                <div class='sidebar-group'>
                  <Button
                    @kind='text-only'
                    class='sidebar-group-header'
                    {{on 'click' (fn this.toggleGroup group.groupName)}}
                  >
                    <ChevronDownIcon
                      class='chevron
                        {{if
                          (this.isGroupExpanded group.groupName)
                          "expanded"
                        }}'
                      width='14'
                      height='14'
                    />
                    <span class='group-name'>{{group.groupName}}</span>
                    <span class='group-count'>{{group.options.length}}</span>
                  </Button>

                  {{#if (this.isGroupExpanded group.groupName)}}
                    <div class='sidebar-group-items'>
                      {{#each group.options as |option|}}
                        <button
                          type='button'
                          class='sidebar-item
                            {{if
                              (eq @model.playgroundFieldType option.value)
                              "selected"
                            }}'
                          {{on 'click' (fn this.selectFieldType option.value)}}
                        >
                          <span class='item-label'>{{option.label}}</span>
                          {{#if (eq @model.playgroundFieldType option.value)}}
                            <CheckIcon
                              class='check-mark'
                              width='14'
                              height='14'
                            />
                          {{/if}}
                        </button>
                      {{/each}}
                    </div>
                  {{/if}}
                </div>
              {{/each}}
            {{else}}
              <div class='sidebar-empty'>
                <SearchIcon class='empty-icon' width='32' height='32' />
                <p>No fields found</p>
                <span>Try a different search term</span>
              </div>
            {{/if}}
          </div>
        {{/unless}}
      </aside>

      {{! Main Content Area }}
      <div class='showcase'>
        {{! Hero Demo Section }}
        <section class='hero-section'>
          <div class='hero-header'>
            <div class='hero-title-row'>
              <h1>{{this.selectedFieldTypeLabel}}</h1>
            </div>
            <p class='hero-description'>
              {{#if (eq this.currentPlaygroundField 'playgroundAudio')}}
                Audio playback with 8 presentation styles: waveform
                visualization, podcast player, album covers, and more
              {{else if (eq this.currentPlaygroundField 'playgroundDate')}}
                Single date selection for appointments, deadlines, and events
              {{else if (eq this.currentPlaygroundField 'playgroundTime')}}
                Time input for meetings, reminders, and schedules
              {{else if (eq this.currentPlaygroundField 'playgroundDatetime')}}
                Combined date and time for events, bookings, and timestamps
              {{else if (eq this.currentPlaygroundField 'playgroundImage')}}
                Single image upload field with multiple presentation modes
              {{else if
                (eq this.currentPlaygroundField 'playgroundMultipleImage')
              }}
                Multiple image upload field with grid and carousel presentations
              {{else}}
                Explore the interactive demo below
              {{/if}}
            </p>
          </div>

          {{! Controls Bar }}
          <div class='controls-bar'>
            <div class='quick-format-buttons'>
              {{#each this.formatOptions as |format|}}
                <Pill
                  @kind='button'
                  @variant={{if
                    (eq this.selectedFormat format.value)
                    'primary'
                    'default'
                  }}
                  {{on 'click' (fn this.selectFormat format.value)}}
                >
                  {{format.label}}
                </Pill>
              {{/each}}
            </div>

            <div class='control-group-inline theme-placeholder'>
              <label class='control-label-inline'>Theme:</label>
              <@fields.cardInfo.theme @format='edit' />
            </div>
          </div>

          <div class='hero-demo-card'>
            <div class='demo-single'>
              <div class='demo-label'>
                {{#if (eq this.selectedFormat 'edit')}}
                  Edit Format
                {{else if (eq this.selectedFormat 'embedded')}}
                  Embedded Format
                {{else}}
                  Atom Format
                {{/if}}
              </div>
              <div
                class='demo-display-large
                  {{if
                    (and
                      (eq this.currentPlaygroundField "playgroundAudio")
                      (not (eq @model.playgroundPresentation "album-cover"))
                    )
                    "full-width-field"
                  }}'
              >
                {{#if (eq this.currentPlaygroundField 'playgroundAudio')}}
                  <@fields.playgroundAudio @format={{this.selectedFormat}} />
                {{else if (eq this.currentPlaygroundField 'playgroundDate')}}
                  <@fields.playgroundDate @format={{this.selectedFormat}} />
                {{else if (eq this.currentPlaygroundField 'playgroundTime')}}
                  <@fields.playgroundTime @format={{this.selectedFormat}} />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundDatetime')
                }}
                  <@fields.playgroundDatetime @format={{this.selectedFormat}} />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundDatetimeStamp')
                }}
                  <@fields.playgroundDatetimeStamp
                    @format={{this.selectedFormat}}
                  />
                {{else if (eq this.currentPlaygroundField 'playgroundDay')}}
                  <@fields.playgroundDay @format={{this.selectedFormat}} />
                {{else if (eq this.currentPlaygroundField 'playgroundYear')}}
                  <@fields.playgroundYear @format={{this.selectedFormat}} />
                {{else if (eq this.currentPlaygroundField 'playgroundMonth')}}
                  <@fields.playgroundMonth @format={{this.selectedFormat}} />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundMonthYear')
                }}
                  <@fields.playgroundMonthYear
                    @format={{this.selectedFormat}}
                  />
                {{else if (eq this.currentPlaygroundField 'playgroundWeek')}}
                  <@fields.playgroundWeek @format={{this.selectedFormat}} />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundDateRange')
                }}
                  <@fields.playgroundDateRange
                    @format={{this.selectedFormat}}
                  />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundTimeRange')
                }}
                  <@fields.playgroundTimeRange
                    @format={{this.selectedFormat}}
                  />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundDuration')
                }}
                  <@fields.playgroundDuration @format={{this.selectedFormat}} />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundRelativeTime')
                }}
                  <@fields.playgroundRelativeTime
                    @format={{this.selectedFormat}}
                  />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundMonthDay')
                }}
                  <@fields.playgroundMonthDay @format={{this.selectedFormat}} />
                {{else if (eq this.currentPlaygroundField 'playgroundQuarter')}}
                  <@fields.playgroundQuarter @format={{this.selectedFormat}} />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundRecurringPattern')
                }}
                  <@fields.playgroundRecurringPattern
                    @format={{this.selectedFormat}}
                  />
                {{else if (eq this.currentPlaygroundField 'playgroundNumber')}}
                  <@fields.playgroundNumber @format={{this.selectedFormat}} />
                {{else if (eq this.currentPlaygroundField 'playgroundRating')}}
                  <@fields.playgroundRating @format={{this.selectedFormat}} />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundTimePeriod')
                }}
                  <@fields.playgroundTimePeriod
                    @format={{this.selectedFormat}}
                  />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundQuantity')
                }}
                  <@fields.playgroundQuantity @format={{this.selectedFormat}} />
                {{else if (eq this.currentPlaygroundField 'playgroundImage')}}
                  <@fields.playgroundImage @format={{this.selectedFormat}} />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundMultipleImage')
                }}
                  <@fields.playgroundMultipleImage
                    @format={{this.selectedFormat}}
                  />
                {{else if (eq this.currentPlaygroundField 'playgroundColor')}}
                  <@fields.playgroundColor @format={{this.selectedFormat}} />
                {{/if}}
              </div>
            </div>
          </div>
        </section>

        {{! Collapsible Configuration Section }}
        <section class='collapsible-section'>
          <Button
            @kind='text-only'
            class='section-toggle'
            {{on 'click' (fn this.toggleSection 'configuration')}}
          >
            <ChevronDownIcon
              class='section-chevron
                {{if (this.isSectionExpanded "configuration") "expanded"}}'
              width='20'
              height='20'
            />
            <span class='section-title'>Configuration</span>
          </Button>

          {{#if (this.isSectionExpanded 'configuration')}}
            <div class='section-content'>
              <div class='code-wrapper'>
                <div class='code-header-bar'>
                  <span class='code-title'>Field Definition</span>
                  <Button
                    @kind='secondary-light'
                    @size='extra-small'
                    class='copy-button'
                    {{on 'click' this.copyCode}}
                    title='Copy to clipboard'
                  >
                    <CopyIcon width='14' height='14' />
                    Copy
                  </Button>
                </div>
                <pre class='code-content'><code>{{this.configCode}}</code></pre>
              </div>
            </div>
          {{/if}}
        </section>

        {{! Collapsible Presentation Modes Section }}
        {{#if (gt this.availablePresentationOptions.length 1)}}
          <section class='collapsible-section'>
            <Button
              @kind='text-only'
              class='section-toggle'
              {{on 'click' (fn this.toggleSection 'variants')}}
            >
              <ChevronDownIcon
                class='section-chevron
                  {{if (this.isSectionExpanded "variants") "expanded"}}'
                width='20'
                height='20'
              />
              <span class='section-title'>
                Presentation Modes
                <span
                  class='count-badge'
                >{{this.availablePresentationOptions.length}}</span>
              </span>
            </Button>

            {{#if (this.isSectionExpanded 'variants')}}
              <div class='section-content'>
                <div class='variants-grid'>
                  {{#each this.availablePresentationOptions as |option|}}
                    <Pill
                      @kind='button'
                      @variant={{if
                        (eq @model.playgroundPresentation option.value)
                        'primary'
                        'default'
                      }}
                      {{on 'click' (fn this.updatePresentation option)}}
                    >
                      {{option.label}}
                    </Pill>
                  {{/each}}
                </div>
              </div>
            {{/if}}
          </section>
        {{/if}}

        {{! Collapsible Examples & Variants Section }}
        {{#if (gt this.examplesForCurrentField.length 0)}}
          <section class='collapsible-section'>
            <Button
              @kind='text-only'
              class='section-toggle'
              {{on 'click' (fn this.toggleSection 'examples')}}
            >
              <ChevronDownIcon
                class='section-chevron
                  {{if (this.isSectionExpanded "examples") "expanded"}}'
                width='20'
                height='20'
              />
              <span class='section-title'>
                Examples & Variants
                <span
                  class='count-badge'
                >{{this.examplesForCurrentField.length}}</span>
              </span>
            </Button>

            {{#if (this.isSectionExpanded 'examples')}}
              <div class='section-content'>
                <div class='examples-list'>
                  {{#each this.examplesForCurrentField as |example|}}
                    <div class='example-item'>
                      <div class='example-header'>
                        <h4 class='example-name'>{{example.name}}</h4>
                        <p
                          class='example-description'
                        >{{example.description}}</p>
                      </div>

                      <div class='example-code'>
                        <pre><code>{{example.config}}</code></pre>
                      </div>

                      <div class='example-demo'>
                        {{#if (eq example.fieldName 'appointmentDateCompact')}}
                          <@fields.appointmentDateCompact
                            @format={{this.selectedFormat}}
                          />
                        {{else if
                          (eq example.fieldName 'appointmentDateCustom')
                        }}
                          <@fields.appointmentDateCustom
                            @format={{this.selectedFormat}}
                          />
                        {{else if (eq example.fieldName 'meetingTime24Hour')}}
                          <@fields.meetingTime24Hour
                            @format={{this.selectedFormat}}
                          />
                        {{else if (eq example.fieldName 'meetingTimeLong')}}
                          <@fields.meetingTimeLong
                            @format={{this.selectedFormat}}
                          />
                        {{else if (eq example.fieldName 'eventDateTimeShort')}}
                          <@fields.eventDateTimeShort
                            @format={{this.selectedFormat}}
                          />
                        {{else if (eq example.fieldName 'eventDateTimeCustom')}}
                          <@fields.eventDateTimeCustom
                            @format={{this.selectedFormat}}
                          />
                        {{else if (eq example.fieldName 'projectDurationFull')}}
                          <@fields.projectDurationFull
                            @format={{this.selectedFormat}}
                          />
                        {{else if (eq example.fieldName 'taskDurationDayTime')}}
                          <@fields.taskDurationDayTime
                            @format={{this.selectedFormat}}
                          />
                        {{else if
                          (eq example.fieldName 'contractDurationYearMonth')
                        }}
                          <@fields.contractDurationYearMonth
                            @format={{this.selectedFormat}}
                          />
                        {{else if (eq example.fieldName 'imageBrowse')}}
                          <@fields.imageBrowse
                            @format={{this.selectedFormat}}
                          />
                        {{else if (eq example.fieldName 'imageAvatar')}}
                          <@fields.imageAvatar
                            @format={{this.selectedFormat}}
                          />
                        {{else if (eq example.fieldName 'imageDropzone')}}
                          <@fields.imageDropzone
                            @format={{this.selectedFormat}}
                          />
                        {{else if (eq example.fieldName 'multipleImageList')}}
                          <@fields.multipleImageList
                            @format={{this.selectedFormat}}
                          />
                        {{else if
                          (eq example.fieldName 'multipleImageGallery')
                        }}
                          <@fields.multipleImageGallery
                            @format={{this.selectedFormat}}
                          />
                        {{else if
                          (eq example.fieldName 'multipleImageDropzone')
                        }}
                          <@fields.multipleImageDropzone
                            @format={{this.selectedFormat}}
                          />
                        {{/if}}
                      </div>
                    </div>
                  {{/each}}
                </div>
              </div>
            {{/if}}
          </section>
        {{/if}}

        {{! Collapsible Available Options Section }}
        {{#if this.hasAvailableOptions}}
          <section class='collapsible-section'>
            <Button
              @kind='text-only'
              class='section-toggle'
              {{on 'click' (fn this.toggleSection 'options')}}
            >
              <ChevronDownIcon
                class='section-chevron
                  {{if (this.isSectionExpanded "options") "expanded"}}'
                width='20'
                height='20'
              />
              <span class='section-title'>
                Available Options
                <span
                  class='count-badge'
                >{{this.availableOptions.length}}</span>
              </span>
            </Button>

            {{#if (this.isSectionExpanded 'options')}}
              <div class='section-content'>
                <div class='options-table-wrapper'>
                  <table class='options-table'>
                    <thead>
                      <tr>
                        <th>Option</th>
                        <th>Type</th>
                        <th>Description</th>
                        <th>Default</th>
                      </tr>
                    </thead>
                    <tbody>
                      {{#each this.availableOptions as |option|}}
                        <tr>
                          <td class='option-key'>
                            <code>{{option.key}}</code>
                          </td>
                          <td class='option-type'>{{option.type}}</td>
                          <td
                            class='option-description'
                          >{{option.description}}</td>
                          <td class='option-default'>
                            {{#if (eq option.type 'boolean')}}
                              {{if option.default 'true' 'false'}}
                            {{else if option.default}}
                              <code>{{option.default}}</code>
                            {{else}}
                              <span class='muted'>—</span>
                            {{/if}}
                          </td>
                        </tr>
                      {{/each}}
                    </tbody>
                  </table>
                </div>
              </div>
            {{/if}}
          </section>
        {{/if}}

        {{! Variants Display Section - Only for ColorField }}
        {{#if (eq @model.playgroundFieldType 'color')}}
          <section class='variants-display-section'>
            <h2 class='variants-section-title'>Variants Demo</h2>

            {{#each this.colorFieldVariants as |variant|}}
              <div class='variant-block'>
                <div class='variant-block-header'>
                  <h3>{{variant.title}}</h3>
                  <p>{{variant.description}}</p>
                </div>
                <div class='code-wrapper'>
                  <div class='code-header-bar'>
                    <span class='code-title'>Field Definition</span>
                    <Button
                      @kind='secondary-light'
                      @size='extra-small'
                      class='copy-button'
                      {{on 'click' (fn this.copyVariantCode variant.copyCode)}}
                      title='Copy to clipboard'
                    >
                      <CopyIcon width='14' height='14' />
                      Copy
                    </Button>
                  </div>
                  <pre class='code-content'><code
                    >{{variant.displayCode}}</code></pre>
                </div>
                <div class='variant-demo'>
                  {{#if (eq variant.fieldName 'playgroundColor')}}
                    <@fields.playgroundColor @format='edit' />
                  {{else if (eq variant.fieldName 'colorWheel')}}
                    <@fields.colorWheel @format='edit' />
                  {{else if (eq variant.fieldName 'colorSliderRgb')}}
                    <@fields.colorSliderRgb @format='edit' />
                  {{else if (eq variant.fieldName 'colorSliderHsl')}}
                    <@fields.colorSliderHsl @format='edit' />
                  {{else if (eq variant.fieldName 'colorSwatchesPicker')}}
                    <@fields.colorSwatchesPicker @format='edit' />
                  {{else if (eq variant.fieldName 'colorAdvanced')}}
                    <@fields.colorAdvanced @format='edit' />
                  {{else if (eq variant.fieldName 'colorShowRecent')}}
                    <@fields.colorShowRecent @format='edit' />
                  {{else if (eq variant.fieldName 'colorShowContrast')}}
                    <@fields.colorShowContrast @format='edit' />
                  {{/if}}
                </div>
              </div>
            {{/each}}
          </section>
        {{/if}}

      </div>
    </div>

    <style scoped>
      /* Controls Bar Styles */
      .controls-bar {
        display: flex;
        align-items: center;
        gap: 1.5rem;
        padding: 1rem 1.25rem;
        background: var(--card, #ffffff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.5rem);
        margin-bottom: 1rem;
        flex-wrap: wrap;
      }

      .control-group-inline {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .control-label-inline {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #0f172a);
        white-space: nowrap;
      }

      .format-select {
        min-width: 140px;
      }

      .quick-format-buttons {
        display: flex;
        gap: 0.375rem;
        padding: 0.25rem;
        background: var(--muted, #f8fafc);
        border-radius: var(--radius, 0.375rem);
      }

      .theme-placeholder {
        margin-left: auto;
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border-width: 0;
      }

      /* Hero Section Styles */
      .hero-section {
        margin-bottom: 2rem;
      }

      .hero-header {
        margin-bottom: 1.5rem;
      }

      .hero-title-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
      }

      .hero-title-row h1 {
        font-size: 1.875rem;
        font-weight: 700;
        color: var(--foreground, #0f172a);
        margin: 0;
        letter-spacing: -0.03em;
      }

      .hero-description {
        font-size: 1rem;
        color: var(--muted-foreground, #64748b);
        margin: 0;
        line-height: 1.5;
      }

      .hero-demo-card {
        background: #ffffff;
        border: 1px solid var(--border, #e2e8f0);
        border-radius: 0;
        padding: 0;
        box-shadow: none;
      }

      .demo-single {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }

      .demo-label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--muted-foreground, #64748b);
        padding: 0.5rem 1rem;
        background: var(--muted, #f8fafc);
        border-bottom: 1px solid var(--border, #e2e8f0);
      }

      .demo-display-large {
        min-height: 200px;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem;
        background: #ffffff;
        border: 1px solid var(--border, #e2e8f0);
        border-radius: 0;
      }

      /* Make audio fields full-width and taller */
      .demo-display-large.full-width-field {
        min-height: 400px;
        align-items: stretch;
      }

      .demo-display-large > :first-child {
        width: 100%;
      }

      /* Collapsible Section Styles */
      .collapsible-section {
        margin-bottom: 1rem;
        background: var(--card, #ffffff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.5rem);
        overflow: hidden;
        transition: all 0.2s ease;
      }

      .collapsible-section:hover {
        border-color: var(--ring, #cbd5e1);
      }

      .section-toggle {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 1rem 1.25rem;
        text-align: left;
      }

      .section-chevron {
        width: 1.25rem;
        height: 1.25rem;
        color: var(--muted-foreground, #64748b);
        transform: rotate(-90deg);
        transition: transform 0.2s ease;
        flex-shrink: 0;
      }

      .section-chevron.expanded {
        transform: rotate(0deg);
      }

      .section-title {
        flex: 1;
        font-size: 1rem;
        font-weight: 600;
        color: var(--foreground, #0f172a);
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .count-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 1.5rem;
        height: 1.25rem;
        padding: 0 0.375rem;
        background: var(--muted, #e2e8f0);
        border-radius: 0.375rem;
        font-size: 0.6875rem;
        font-weight: 600;
        color: var(--muted-foreground, #64748b);
      }

      .section-content {
        padding: 0 1.25rem 1.25rem;
      }

      /* Code Wrapper Styles */
      .code-wrapper {
        background: var(--muted, #f8fafc);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.5rem);
        overflow: hidden;
      }

      .code-header-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem 1rem;
        background: var(--card, #ffffff);
        border-bottom: 1px solid var(--border, #e2e8f0);
      }

      .code-title {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--foreground, #0f172a);
      }

      .code-content {
        margin: 0;
        padding: 1rem;
        overflow-x: auto;
      }

      .code-content code {
        font-family: var(--font-mono, 'Courier New', monospace);
        font-size: 0.8125rem;
        line-height: 1.6;
        color: var(--foreground, #1e293b);
        white-space: pre;
      }

      /* Options Table Styles */
      .options-table-wrapper {
        overflow-x: auto;
        padding: calc(var(--spacing, 0.25rem) * 2) 0;
      }

      .options-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.875rem;
      }

      .options-table thead {
        background: var(--muted, #f1f5f9);
        border-bottom: 2px solid var(--border, #e2e8f0);
      }

      .options-table th {
        padding: calc(var(--spacing, 0.25rem) * 3)
          calc(var(--spacing, 0.25rem) * 4);
        text-align: left;
        font-weight: 600;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--muted-foreground, #64748b);
      }

      .options-table tbody tr {
        border-bottom: 1px solid var(--border, #e2e8f0);
        transition: background-color 0.2s ease;
      }

      .options-table tbody tr:hover {
        background: var(--muted, #f8fafc);
      }

      .options-table td {
        padding: calc(var(--spacing, 0.25rem) * 3)
          calc(var(--spacing, 0.25rem) * 4);
        vertical-align: top;
      }

      .options-table .option-key {
        font-weight: 600;
      }

      .options-table .option-key code {
        font-family: var(--font-mono, 'Courier New', monospace);
        font-size: 0.8125rem;
        background: var(--muted, #f1f5f9);
        color: var(--boxel-dark);
        padding: 0.125rem 0.375rem;
        border-radius: 0.25rem;
      }

      .options-table .option-type {
        color: var(--muted-foreground, #64748b);
        font-size: 0.8125rem;
      }

      .options-table .option-description {
        color: var(--foreground, #0f172a);
        line-height: 1.5;
      }

      .options-table .option-default {
        color: var(--muted-foreground, #64748b);
        font-size: 0.8125rem;
      }

      .options-table .option-default code {
        font-family: var(--font-mono, 'Courier New', monospace);
        font-size: 0.75rem;
        background: var(--muted, #f1f5f9);
        color: var(--foreground, #0f172a);
        padding: 0.125rem 0.375rem;
        border-radius: 0.25rem;
      }

      .options-table .option-default .muted {
        color: var(--muted-foreground, #94a3b8);
        font-style: italic;
      }

      /* Variants Grid Styles */
      .variants-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      /* Examples List Styles */
      .examples-list {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }

      .example-item {
        background: var(--muted, #f8fafc);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.5rem);
        padding: 1rem;
        transition: all 0.2s ease;
      }

      .example-item:hover {
        border-color: var(--ring, #cbd5e1);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
      }

      .example-header {
        margin-bottom: 0.75rem;
      }

      .example-name {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #0f172a);
        margin: 0 0 0.25rem;
      }

      .example-description {
        font-size: 0.75rem;
        color: var(--muted-foreground, #64748b);
        margin: 0;
      }

      .example-code {
        margin-bottom: 0.75rem;
        background: var(--card, #ffffff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.375rem);
        overflow-x: auto;
      }

      .example-code pre {
        margin: 0;
        padding: 0.5rem 0.75rem;
      }

      .example-code code {
        font-family: var(--font-mono, 'Courier New', monospace);
        font-size: 0.6875rem;
        line-height: 1.5;
        color: var(--foreground, #1e293b);
        white-space: pre-wrap;
        word-break: break-all;
      }

      .example-demo {
        padding: 1rem;
        background: var(--card, #ffffff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.375rem);
        min-height: 60px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .example-demo > :first-child {
        width: 100%;
      }

      /* Variants Display Section */
      .variants-display-section {
        container-type: inline-size;
        display: grid;
        grid-template-columns: 1fr;
        gap: 1.5rem;
        margin-top: 2rem;
        padding-top: 1.5rem;
        border-top: 1px solid var(--border, #e2e8f0);
      }

      .variants-section-title {
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--foreground, #0f172a);
        letter-spacing: -0.02em;
      }

      /* ColorField Variants Display - Nested Structure */
      .variant-block {
        background: var(--card, #ffffff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.5rem);
        overflow: hidden;
        box-shadow:
          0 4px 6px -1px rgba(0, 0, 0, 0.05),
          0 2px 4px -1px rgba(0, 0, 0, 0.03);
      }

      .variant-block .variant-block-header {
        padding: 1rem 1.25rem;
        background: var(--muted, #f8fafc);
        border-bottom: 1px solid var(--border, #e2e8f0);
      }

      .variant-block .variant-block-header h3 {
        font-size: 1rem;
        font-weight: 600;
        color: var(--foreground, #0f172a);
        margin: 0 0 0.25rem;
      }

      .variant-block .variant-block-header p {
        font-size: 0.875rem;
        color: var(--muted-foreground, #64748b);
        margin: 0;
      }

      .variant-block .variant-demo {
        padding: 2rem 1.25rem;
        min-height: 300px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--background, #ffffff);
      }

      .variant-block .variant-demo > :first-child {
        width: 100%;
        max-width: 400px;
      }

      /* Responsive adjustments for hero */
      @media (max-width: 768px) {
        .hero-title-row h1 {
          font-size: 1.5rem;
        }

        .hero-demo-card {
          padding: 1.5rem;
        }

        .controls-bar {
          flex-direction: column;
          align-items: stretch;
          gap: 1rem;
        }

        .theme-placeholder {
          margin-left: 0;
        }

        .quick-format-buttons {
          width: 100%;
          justify-content: stretch;
        }

        .format-button {
          flex: 1;
        }
      }

      /* Showcase Container - Flexbox layout for sidebar + content */
      .showcase-container {
        display: flex;
        width: 100%;
        max-width: 1200px;
        margin: 0 auto;
        background: var(--background, #ffffff);
        min-height: 100vh;
      }

      /* Sidebar */
      .sidebar {
        width: 280px;
        flex-shrink: 0;
        background: var(--muted, #f8fafc);
        border-right: 1px solid var(--border, #e2e8f0);
        display: flex;
        flex-direction: column;
        transition: width 0.3s ease;
      }

      .sidebar-collapsed .sidebar {
        width: 48px;
      }

      .sidebar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem;
        border-bottom: 1px solid var(--border, #e2e8f0);
        background: var(--card, #ffffff);
        min-height: 56px;
      }

      .sidebar-collapsed .sidebar-header {
        justify-content: center;
        padding: 1rem 0.5rem;
      }

      .sidebar-header h3 {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #0f172a);
        margin: 0;
      }

      .sidebar-collapsed .sidebar-header h3 {
        display: none;
      }

      .sidebar-toggle {
        width: 2rem;
        height: 2rem;
      }

      /* Sidebar Search */
      .sidebar-search {
        padding: 0.75rem;
        border-bottom: 1px solid var(--border, #e2e8f0);
      }

      .sidebar-search-input {
        width: 100%;
      }

      /* Sidebar Content */
      .sidebar-content {
        flex: 1;
        overflow-y: auto;
        padding: 0.25rem 0;
      }

      /* Sidebar Groups */
      .sidebar-group {
        margin-bottom: 0.125rem;
      }

      .sidebar-group-header {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        text-align: left;
      }

      .sidebar-group-header .chevron {
        width: 0.875rem;
        height: 0.875rem;
        color: var(--muted-foreground, #64748b);
        transform: rotate(-90deg);
        transition: transform 0.2s ease;
        flex-shrink: 0;
      }

      .sidebar-group-header .chevron.expanded {
        transform: rotate(0deg);
      }

      .group-name {
        flex: 1;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--foreground, #0f172a);
        text-transform: uppercase;
        letter-spacing: 0.025em;
      }

      .group-count {
        font-size: 0.625rem;
        color: var(--muted-foreground, #94a3b8);
        background: var(--muted, #e2e8f0);
        padding: 0.125rem 0.375rem;
        border-radius: 0.25rem;
      }

      /* Sidebar Items */
      .sidebar-group-items {
        padding: 0.125rem 0;
      }

      .sidebar-item {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.375rem 0.75rem 0.375rem 2rem;
        background: transparent;
        border: none;
        cursor: pointer;
        transition: all 0.15s ease;
        text-align: left;
      }

      .sidebar-item:hover {
        background: var(--accent, #e2e8f0);
      }

      .sidebar-item.selected {
        background: var(--boxel-light);
      }

      .sidebar-item.selected .item-label {
        font-weight: 600;
        color: var(--foreground, #0f172a);
      }

      .item-label {
        font-size: 0.8125rem;
        color: var(--foreground, #0f172a);
      }

      .check-mark {
        width: 0.875rem;
        height: 0.875rem;
        color: var(--primary, #3b82f6);
        flex-shrink: 0;
      }

      /* Sidebar Empty State */
      .sidebar-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 2rem 1rem;
        text-align: center;
      }

      .empty-icon {
        width: 2rem;
        height: 2rem;
        color: var(--muted-foreground, #cbd5e1);
        margin-bottom: 0.75rem;
      }

      .sidebar-empty p {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--foreground, #0f172a);
        margin: 0 0 0.125rem;
      }

      .sidebar-empty span {
        font-size: 0.6875rem;
        color: var(--muted-foreground, #94a3b8);
      }

      /* Main Showcase Content */
      .showcase {
        flex: 1;
        padding: 2rem 1.5rem;
        overflow-y: auto;
      }

      /* Hero Section */
      .hero-section {
        margin-bottom: 2rem;
      }

      .hero-header {
        margin-bottom: 1.5rem;
      }

      .hero-title-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
      }

      .hero-title-row h1 {
        font-size: 1.875rem;
        font-weight: 700;
        color: var(--foreground, #0f172a);
        margin: 0;
        letter-spacing: -0.03em;
      }

      .hero-description {
        font-size: 1rem;
        color: var(--muted-foreground, #64748b);
        margin: 0;
        line-height: 1.5;
      }

      .hero-demo-card {
        background: var(--card, #ffffff);
        border: 2px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.75rem);
        padding: 2rem;
        box-shadow:
          0 4px 6px -1px rgba(0, 0, 0, 0.05),
          0 2px 4px -1px rgba(0, 0, 0, 0.03);
      }

      .demo-label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #0f172a);
        padding-bottom: 0.5rem;
        border-bottom: 2px solid var(--border, #e2e8f0);
      }

      .demo-display {
        min-height: 120px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
        background: var(--muted, #f8fafc);
        border: 1px dashed var(--border, #cbd5e1);
        border-radius: var(--radius, 0.5rem);
      }

      .demo-divider {
        width: 2px;
        background: linear-gradient(
          to bottom,
          transparent,
          var(--border, #e2e8f0) 10%,
          var(--border, #e2e8f0) 90%,
          transparent
        );
      }

      /* Collapsible Sections */
      .collapsible-section {
        margin-bottom: 1rem;
        background: var(--card, #ffffff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.5rem);
        overflow: hidden;
        transition: all 0.2s ease;
      }

      .collapsible-section:hover {
        border-color: var(--ring, #cbd5e1);
      }

      .section-toggle {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 1rem 1.25rem;
        background: transparent;
        border: none;
        cursor: pointer;
        transition: all 0.15s ease;
        text-align: left;
      }

      .section-toggle:hover {
        background: var(--accent, #f8fafc);
      }

      .section-chevron {
        width: 1.25rem;
        height: 1.25rem;
        color: var(--muted-foreground, #64748b);
        transform: rotate(-90deg);
        transition: transform 0.2s ease;
        flex-shrink: 0;
      }

      .section-chevron.expanded {
        transform: rotate(0deg);
      }

      .section-title {
        flex: 1;
        font-size: 1rem;
        font-weight: 600;
        color: var(--foreground, #0f172a);
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .count-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 1.5rem;
        height: 1.25rem;
        padding: 0 0.375rem;
        background: var(--muted, #e2e8f0);
        border-radius: 0.375rem;
        font-size: 0.6875rem;
        font-weight: 600;
        color: var(--muted-foreground, #64748b);
      }

      .section-content {
        padding: 0 1.25rem 1.25rem;
      }

      /* Code Wrapper */
      .code-wrapper {
        background: var(--muted, #f8fafc);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.5rem);
        overflow: hidden;
      }

      .code-header-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.75rem 1rem;
        background: var(--card, #ffffff);
        border-bottom: 1px solid var(--border, #e2e8f0);
      }

      .code-title {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--foreground, #0f172a);
      }

      .copy-button {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.25rem 0.625rem;
        background: transparent;
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.375rem);
        font-size: 0.6875rem;
        font-weight: 500;
        color: var(--foreground, #0f172a);
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .copy-button:hover {
        background: var(--accent, #f1f5f9);
        border-color: var(--ring, #94a3b8);
      }

      .copy-button:active {
        transform: scale(0.98);
      }

      .copy-button svg {
        width: 0.875rem;
        height: 0.875rem;
      }

      .code-content {
        margin: 0;
        padding: 1rem;
        overflow-x: auto;
      }

      .code-content code {
        font-family: var(--font-mono, 'Courier New', monospace);
        font-size: 0.8125rem;
        line-height: 1.6;
        color: var(--foreground, #1e293b);
        white-space: pre;
      }

      /* Responsive adjustments for hero */
      @media (max-width: 768px) {
        .hero-title-row h1 {
          font-size: 1.5rem;
        }

        .hero-demo-card {
          padding: 1.5rem;
        }

        .demo-split {
          grid-template-columns: 1fr;
          gap: 1.5rem;
        }

        .demo-divider {
          display: none;
        }

        .variants-grid {
          grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        }
      }

      .showcase-header {
        text-align: center;
        margin-bottom: 2rem;
      }

      .showcase-header h1 {
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--foreground, #0f172a);
        margin: 0 0 0.5rem;
        letter-spacing: -0.02em;
      }

      .showcase-header p {
        font-size: 0.875rem;
        color: var(--muted-foreground, #64748b);
        margin: 0 0 1rem;
      }

      .header-highlight {
        display: inline-block;
        padding: 0.5rem 0.75rem;
        background: linear-gradient(
          135deg,
          rgba(59, 130, 246, 0.1),
          rgba(147, 51, 234, 0.1)
        );
        border: 1px solid rgba(59, 130, 246, 0.2);
        border-radius: var(--radius, 0.5rem);
        font-size: 0.75rem;
        color: var(--foreground, #0f172a);
      }

      .header-highlight code {
        background: rgba(59, 130, 246, 0.1);
        padding: 0.125rem 0.375rem;
        border-radius: 0.25rem;
        font-family: var(--font-mono, monospace);
        font-size: 0.8125rem;
        color: var(--primary, #3b82f6);
      }

      .playground-section {
        margin-bottom: 3rem;
        padding: 1.5rem;
        background: linear-gradient(
          135deg,
          rgba(59, 130, 246, 0.05),
          rgba(147, 51, 234, 0.05)
        );
        border: 2px solid var(--primary, #3b82f6);
        border-radius: var(--radius, 0.75rem);
      }

      .playground-header {
        text-align: center;
        margin-bottom: 1.5rem;
      }

      .playground-header h2 {
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--foreground, #0f172a);
        margin: 0 0 0.5rem;
      }

      .playground-header p {
        font-size: 0.875rem;
        color: var(--muted-foreground, #64748b);
        margin: 0;
      }

      .playground-controls {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
        margin-bottom: 1.5rem;
      }

      .control-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .control-label {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #0f172a);
      }

      .config-select {
        width: 100%;
      }

      /* Current Field Display */
      .current-field-display {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        background: var(--muted, #f8fafc);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.375rem);
        font-size: 0.875rem;
        color: var(--foreground, #0f172a);
      }

      .field-icon {
        width: 1rem;
        height: 1rem;
        color: var(--primary, #3b82f6);
        flex-shrink: 0;
      }

      .selected-label {
        flex: 1;
        font-weight: 500;
      }

      .playground-card {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        gap: 1.5rem;
        background: var(--card, #ffffff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.5rem);
        padding: 1.5rem;
        margin-bottom: 1rem;
      }

      .playground-column {
        display: flex;
        flex-direction: column;
      }

      .playground-column h3 {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #0f172a);
        margin: 0 0 0.25rem;
      }

      .playground-hint {
        font-size: 0.75rem;
        color: var(--muted-foreground, #94a3b8);
        margin: 0 0 1rem;
      }

      .playground-demo {
        flex: 1;
        display: flex;
        align-items: center;
      }

      .playground-divider {
        width: 1px;
        background: linear-gradient(
          to bottom,
          transparent,
          var(--border, #e2e8f0) 20%,
          var(--border, #e2e8f0) 80%,
          transparent
        );
      }

      .playground-info {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1rem;
        background: rgba(59, 130, 246, 0.05);
        border: 1px solid rgba(59, 130, 246, 0.2);
        border-radius: var(--radius, 0.375rem);
        font-size: 0.75rem;
        color: var(--muted-foreground, #64748b);
        transition: all 0.3s ease;
      }

      .playground-info.warning {
        background: rgba(251, 146, 60, 0.1);
        border-color: rgba(251, 146, 60, 0.3);
      }

      .playground-info.warning .info-icon {
        color: var(--chart3, #fb923c);
      }

      .info-icon {
        width: 1rem;
        height: 1rem;
        flex-shrink: 0;
        color: var(--primary, #3b82f6);
      }

      .playground-info code {
        background: rgba(59, 130, 246, 0.1);
        padding: 0.125rem 0.375rem;
        border-radius: 0.25rem;
        font-family: var(--font-mono, monospace);
        font-size: 0.6875rem;
        color: var(--primary, #3b82f6);
      }

      .playground-code {
        margin-bottom: 1rem;
        background: var(--muted, #f8fafc);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.5rem);
        overflow: hidden;
      }

      .code-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1rem;
        background: var(--card, #ffffff);
        border-bottom: 1px solid var(--border, #e2e8f0);
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--foreground, #0f172a);
      }

      .code-icon {
        width: 1rem;
        height: 1rem;
        color: var(--primary, #3b82f6);
      }

      .code-block {
        margin: 0;
        padding: 1rem;
        overflow-x: auto;
      }

      .code-block code {
        font-family: var(--font-mono, 'Courier New', monospace);
        font-size: 0.75rem;
        line-height: 1.6;
        color: var(--foreground, #1e293b);
        white-space: pre;
      }

      .input-section {
        margin-bottom: 2rem;
      }

      .section-header-inline {
        margin-bottom: 1rem;
      }

      .section-header-inline h2 {
        font-size: 1.125rem;
        font-weight: 700;
        color: var(--foreground, #0f172a);
        margin: 0 0 0.25rem;
      }

      .section-header-inline p {
        font-size: 0.875rem;
        color: var(--muted-foreground, #64748b);
        margin: 0;
      }

      .section-header {
        text-align: center;
        margin: 2.5rem 0 2rem;
        padding-top: 2rem;
        border-top: 2px solid var(--border, #e2e8f0);
      }

      .section-header h2 {
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--foreground, #0f172a);
        margin: 0 0 0.5rem;
        letter-spacing: -0.02em;
      }

      .section-header p {
        font-size: 0.8125rem;
        color: var(--muted-foreground, #64748b);
        margin: 0;
      }

      .components-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 1rem;
      }

      .components-grid-half {
        display: grid;
        grid-template-columns: 1fr;
        gap: 1rem;
      }

      .components-grid-single {
        display: grid;
        grid-template-columns: 1fr;
      }

      .component-card.full-width {
        grid-column: 1 / -1;
      }

      .component-card {
        background: var(--card, #ffffff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: var(--radius, 0.5rem);
        padding: 1rem;
        transition: all 0.2s ease;
      }

      .component-card:hover {
        border-color: var(--ring, #3b82f6);
        box-shadow: var(--shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.1));
      }

      .component-info {
        margin-bottom: 0.75rem;
        padding-bottom: 0.75rem;
        border-bottom: 1px solid var(--border, #e2e8f0);
      }

      .component-info h3 {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--foreground, #0f172a);
        margin: 0 0 0.25rem;
      }

      .component-info p {
        font-size: 0.875rem;
        color: var(--muted-foreground, #64748b);
        margin: 0 0 0.5rem;
      }

      .component-info code.config {
        display: inline-block;
        font-size: 0.6875rem;
        font-family: var(--font-mono, monospace);
        background: rgba(59, 130, 246, 0.1);
        color: var(--primary, #3b82f6);
        padding: 0.125rem 0.375rem;
        border-radius: 0.25rem;
        margin-top: 0.25rem;
      }

      .component-info .use-case {
        display: block;
        font-size: 0.6875rem;
        color: var(--muted-foreground, #94a3b8);
        margin-top: 0.5rem;
        font-style: italic;
      }

      .component-demo {
        min-height: 3rem;
      }

      @media (max-width: 768px) {
        .showcase {
          padding: 2rem 1rem;
        }

        .showcase-header h1 {
          font-size: 1.75rem;
        }

        .showcase-header p {
          font-size: 1rem;
        }

        .playground-section {
          padding: 1rem;
        }

        .playground-card {
          grid-template-columns: 1fr;
          gap: 1rem;
          padding: 1rem;
        }

        .playground-divider {
          display: none;
        }

        .playground-controls {
          grid-template-columns: 1fr;
        }

        .components-grid,
        .components-grid-half {
          grid-template-columns: 1fr;
          gap: 1rem;
        }

        .component-card {
          padding: 1.25rem;
        }
      }
    </style>
  </template>
}

export class FieldShowcase extends CardDef {
  // ³ Field showcase card definition
  static displayName = 'Field Showcase';
  static icon = CalendarIcon;
  static prefersWideFormat = true;

  @field title = contains(StringField, {
    // ⁴ Card title
    computeVia: function () {
      return 'Field Showcase';
    },
  });

  // ¹⁶ Playground control fields
  @field playgroundFieldType = contains(StringField);
  @field playgroundPresentation = contains(StringField);

  // ¹⁷ Playground fields - one for each field type
  @field playgroundAudio = contains(AudioField, {
    configuration: function (this: FieldShowcase) {
      const presentation = this.playgroundPresentation || 'inline-player';

      if (presentation === 'waveform-player') {
        return { presentation: 'waveform-player' };
      }
      if (presentation === 'playlist-row') {
        return { presentation: 'playlist-row' };
      }
      if (presentation === 'mini-player') {
        return { presentation: 'mini-player' };
      }
      if (presentation === 'album-cover') {
        return { presentation: 'album-cover' };
      }
      if (presentation === 'volume-control') {
        return { options: { showVolume: true } };
      }
      if (presentation === 'trim-editor') {
        return { presentation: 'trim-editor' };
      }
      if (presentation === 'advanced-controls') {
        return {
          options: {
            showVolume: true,
            showSpeedControl: true,
            showLoopControl: true,
          },
        };
      }

      return {}; // Default presentation
    },
  });

  @field playgroundDate = contains(DateField, {
    configuration: function (this: FieldShowcase) {
      return {
        presentation: this.playgroundPresentation || 'standard',
      };
    },
  });

  @field playgroundTime = contains(TimeField, {
    configuration: function (this: FieldShowcase) {
      return {
        presentation: this.playgroundPresentation || 'standard',
      };
    },
  });

  @field playgroundDatetime = contains(DatetimeField, {
    configuration: function (this: FieldShowcase) {
      return {
        presentation: this.playgroundPresentation || 'standard',
      };
    },
  });

  @field playgroundDatetimeStamp = contains(DatetimeStampField);
  @field playgroundDay = contains(DayField);

  @field playgroundYear = contains(YearField);
  @field playgroundMonth = contains(MonthField);
  @field playgroundMonthYear = contains(MonthYearField);
  @field playgroundWeek = contains(WeekField);
  @field playgroundDateRange = contains(DateRangeField, {
    configuration: function (this: FieldShowcase) {
      return {
        presentation: this.playgroundPresentation || 'standard',
      };
    },
  });
  @field playgroundTimeRange = contains(TimeRangeField);
  @field playgroundDuration = contains(DurationField);
  @field playgroundRelativeTime = contains(RelativeTimeField);
  @field playgroundMonthDay = contains(MonthDayField);
  @field playgroundQuarter = contains(QuarterField);
  @field playgroundRecurringPattern = contains(RecurringPatternField);
  @field playgroundTimePeriod = contains(TimePeriodField);

  // Playground number fields - 4 fields total
  @field playgroundNumber = contains(NumberField, {
    configuration: function (this: FieldShowcase) {
      const presentation = this.playgroundPresentation || 'standard';

      if (presentation === 'standard') {
        return {};
      }

      // Get default values - only presentation-specific defaults that make sense
      const getDefaultOptions = (pres: string): Record<string, any> => {
        const defaults: Record<string, Record<string, any>> = {
          // Only keep presentation-specific defaults that are meaningful
          // Most options (prefix, suffix, decimals, min, max) should default to empty/none
          stat: {
            label: 'Total Revenue',
            subtitle: '↑ 12.5% vs last month',
          },
          'badge-notification': {
            label: 'Notifications',
          },
          'badge-metric': {
            label: 'Items',
          },
          'badge-counter': {
            label: 'Stocks',
          },
          gauge: {
            label: 'CPU Usage',
            warningThreshold: 70,
            dangerThreshold: 90,
          },
        };
        return defaults[pres] || {};
      };

      const finalOptions = getDefaultOptions(presentation);

      // Remove undefined values
      Object.keys(finalOptions).forEach((key) => {
        if (finalOptions[key] === undefined) {
          delete finalOptions[key];
        }
      });

      return {
        presentation,
        options: finalOptions,
      };
    },
  });
  @field playgroundRating = contains(RatingField);
  @field playgroundQuantity = contains(QuantityField, {
    configuration: {
      options: {
        min: 0, // Presentation-specific default for quantity
      },
    },
  });

  // Playground color field - responds to variant and options
  @field playgroundColor = contains(ColorField);

  // Playground image fields
  @field playgroundImage = contains(ImageField, {
    configuration: function (this: FieldShowcase) {
      const presentation = this.playgroundPresentation || 'standard';
      return {
        variant: 'browse',
        presentation: presentation === 'standard' ? undefined : presentation,
      };
    },
  });
  @field playgroundMultipleImage = contains(MultipleImageField, {
    configuration: function (this: FieldShowcase) {
      const presentation = this.playgroundPresentation || 'standard';
      return {
        variant: 'list',
        presentation: presentation === 'standard' ? undefined : presentation,
        options: {
          allowReorder: true,
        },
      };
    },
  });

  // DateField examples - configuration only (standard shown in hero demo)
  @field appointmentDateCompact = contains(DateField, {
    configuration: { preset: 'tiny' },
  });
  @field appointmentDateCustom = contains(DateField, {
    configuration: { format: 'MMM D, YYYY' },
  });

  // TimeField examples - configuration only (standard shown in hero demo)
  @field meetingTime24Hour = contains(TimeField, {
    configuration: { hourCycle: 'h23' },
  });
  @field meetingTimeLong = contains(TimeField, {
    configuration: { timeStyle: 'long' },
  });

  // DatetimeField examples - configuration only (standard shown in hero demo)
  @field eventDateTimeShort = contains(DatetimeField, {
    configuration: { preset: 'short' },
  });
  @field eventDateTimeCustom = contains(DatetimeField, {
    configuration: { format: 'ddd, MMM D [at] h:mm A' },
  });

  // ImageField examples - variant configurations
  @field imageBrowse = contains(ImageField, {
    configuration: { variant: 'browse' },
  });
  @field imageAvatar = contains(ImageField, {
    configuration: {
      variant: 'avatar',
      presentation: 'card',
      options: {
        showProgress: true,
      },
    },
  });
  @field imageDropzone = contains(ImageField, {
    configuration: {
      variant: 'dropzone',
      presentation: 'inline',
      options: {
        showImageModal: true,
        showProgress: true,
      },
    },
  });

  // MultipleImageField examples - variant configurations
  @field multipleImageList = contains(MultipleImageField, {
    configuration: {
      variant: 'list',
      presentation: 'grid',
    },
  });
  @field multipleImageGallery = contains(MultipleImageField, {
    configuration: {
      variant: 'gallery',
      presentation: 'carousel',
      options: {
        allowBatchSelect: true,
        allowReorder: true,
        maxFiles: 4,
        showProgress: true,
      },
    },
  });
  @field multipleImageDropzone = contains(MultipleImageField, {
    configuration: {
      variant: 'dropzone',
      presentation: 'carousel',
      options: {
        allowBatchSelect: true,
        showProgress: true,
        maxFiles: 10,
      },
    },
  });

  // DurationField examples - showing different duration types
  @field projectDurationFull = contains(DurationField, {
    configuration: {
      includeYears: true,
      includeMonths: true,
      includeDays: true,
      includeHours: true,
      includeMinutes: true,
      includeSeconds: true,
    },
  });
  @field taskDurationDayTime = contains(DurationField, {
    configuration: {
      includeYears: false,
      includeMonths: false,
      includeDays: true,
      includeHours: true,
      includeMinutes: true,
      includeSeconds: true,
    },
  });
  @field contractDurationYearMonth = contains(DurationField, {
    configuration: {
      includeYears: true,
      includeMonths: true,
      includeDays: false,
      includeHours: false,
      includeMinutes: false,
      includeSeconds: false,
    },
  });

  // ColorField examples - all variants with proper configurations
  @field colorWheel = contains(ColorField, {
    configuration: {
      variant: 'wheel',
       options: {
        defaultFormat: 'rgb',
      },
    },
  });
  @field colorSliderRgb = contains(ColorField, {
    configuration: {
      variant: 'slider',
      options: {
        defaultFormat: 'rgb',
      },
    },
  });
  @field colorSliderHsl = contains(ColorField, {
    configuration: {
      variant: 'slider',
      options: {
        defaultFormat: 'hsl',
      },
    },
  });
  @field colorSwatchesPicker = contains(ColorField, {
    configuration: {
      variant: 'swatches-picker',
    },
  });
  @field colorAdvanced = contains(ColorField, {
    configuration: {
      variant: 'advanced',
    },
  });
  @field colorShowRecent = contains(ColorField, {
    configuration: {
      options: {
        showRecent: true,
      },
    },
  });
  @field colorShowContrast = contains(ColorField, {
    configuration: {
      options: {
        showContrastChecker: true,
      },
    },
  });

  static isolated = FieldShowcaseIsolated;
}
