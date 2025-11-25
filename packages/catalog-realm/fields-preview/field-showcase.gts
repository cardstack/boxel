import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { eq, gt } from '@cardstack/boxel-ui/helpers';

import StringField from 'https://cardstack.com/base/string';
import DateField from '../fields/date';
import TimeField from '../fields/time';
import DatetimeField from '../fields/date-time';
import DateRangeField from '../fields/date/date-range';
import TimeRangeField from '../fields/time/time-range';
import DurationField from '../fields/time/duration';
import RelativeTimeField from '../fields/time/relative-time';
import MonthDayField from '../fields/date/month-day';
import QuarterField from '../fields/date/quarter';
import RecurringPatternField from '../fields/recurring-pattern';
import YearField from '../fields/date/year';
import MonthField from '../fields/date/month';
import MonthYearField from '../fields/date/month-year';
import WeekField from '../fields/date/week';
import NumberField from '../fields/number';
import ImageField from '../fields/image-field';
import MultipleImageField from '../fields/multiple-image-field';
import TrendingUpIcon from '@cardstack/boxel-icons/trending-up';
import CubeIcon from '@cardstack/boxel-icons/cube';
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
  @tracked expandedSections = new Set(['configuration', 'variants']); // Hero sections expanded by default
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
    date: ['standard', 'countdown', 'timeline', 'age'],
    time: ['standard', 'timeSlots'],
    datetime: [
      'standard',
      'countdown',
      'timeAgo',
      'timeline',
      'expirationWarning',
    ],
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
    'number-basic': ['standard'],
    'number-slider': ['standard'],
    'number-rating': ['standard'],
    'number-progress': ['standard'],
    'number-gauge': ['standard'],
    'number-quantity': ['standard'],
    'number-percentage': ['standard'],
    'number-stat': ['standard'],
    'number-badge-notification': ['standard'],
    'number-badge-metric': ['standard'],
    'number-badge-counter': ['standard'],
    'number-score': ['standard'],
    'number-progress-circle': ['standard'],
    image: ['standard', 'image', 'inline', 'card'],
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
      ],
    },
    {
      groupName: 'Number Fields',
      options: [
        {
          value: 'number-basic',
          label: 'Number (Basic)',
          fieldName: 'playgroundNumberBasic',
        },
        {
          value: 'number-slider',
          label: 'Slider',
          fieldName: 'playgroundNumberSlider',
        },
        {
          value: 'number-rating',
          label: 'Rating',
          fieldName: 'playgroundNumberRating',
        },
        {
          value: 'number-progress',
          label: 'Progress Bar',
          fieldName: 'playgroundNumberProgress',
        },
        {
          value: 'number-gauge',
          label: 'Gauge',
          fieldName: 'playgroundNumberGauge',
        },
        {
          value: 'number-quantity',
          label: 'Quantity',
          fieldName: 'playgroundNumberQuantity',
        },
        {
          value: 'number-percentage',
          label: 'Percentage',
          fieldName: 'playgroundNumberPercentage',
        },
        {
          value: 'number-stat',
          label: 'Stat',
          fieldName: 'playgroundNumberStat',
        },
        {
          value: 'number-badge-notification',
          label: 'Badge Notification',
          fieldName: 'playgroundNumberBadgeNotification',
        },
        {
          value: 'number-badge-metric',
          label: 'Badge Metric',
          fieldName: 'playgroundNumberBadgeMetric',
        },
        {
          value: 'number-badge-counter',
          label: 'Badge Counter',
          fieldName: 'playgroundNumberBadgeCounter',
        },
        {
          value: 'number-score',
          label: 'Score',
          fieldName: 'playgroundNumberScore',
        },
        {
          value: 'number-progress-circle',
          label: 'Progress Circle',
          fieldName: 'playgroundNumberProgressCircle',
        },
      ],
    },
    {
      groupName: 'Image Fields',
      options: [
        { value: 'image', label: 'ImageField', fieldName: 'playgroundImage' },
        {
          value: 'multipleImage',
          label: 'MultipleImageField',
          fieldName: 'playgroundMultipleImage',
        },
      ],
    },
  ];

  allPresentationOptions = [
    { value: 'standard', label: 'Standard' },
    { value: 'countdown', label: 'Countdown Timer' },
    { value: 'timeAgo', label: 'Time Ago' },
    { value: 'age', label: 'Age Calculator' },
    { value: 'businessDays', label: 'Business Days' },
    { value: 'timeline', label: 'Timeline Event' },
    { value: 'timeSlots', label: 'Time Slots' },
    { value: 'expirationWarning', label: 'Expiration Warning' },
    { value: 'image', label: 'Image' },
    { value: 'inline', label: 'Inline' },
    { value: 'card', label: 'Card' },
    { value: 'grid', label: 'Grid' },
    { value: 'carousel', label: 'Carousel' },
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
            '@field myGallery = contains(MultipleImageField, { configuration: { variant: "gallery", presentation: "carousel", options: { allowReorder: true, maxFiles: 4 } } });',
          fieldName: 'multipleImageGallery',
        },
        {
          name: 'Dropzone Variant',
          description: 'Drag and drop multiple images with carousel',
          config:
            '@field myDropzoneImages = contains(MultipleImageField, { configuration: { variant: "dropzone", presentation: "carousel", maxFiles: 10 } });',
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

    if (fieldType === 'number-slider') {
      return `@field myField = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'slider',
      min: 0,
      max: 100,
      suffix: '%',
      showValue: true
    }
  }
});`;
    }

    if (fieldType === 'number-rating') {
      return `@field myField = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'rating',
      maxStars: 5
    }
  }
});`;
    }

    if (fieldType === 'number-progress') {
      return `@field myField = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'progress-bar',
      min: 0,
      max: 100,
      label: 'Progress'
    }
  }
});`;
    }

    if (fieldType === 'number-gauge') {
      return `@field myField = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'gauge',
      min: 0,
      max: 100,
      suffix: '%',
      label: 'CPU Usage',
      warningThreshold: 70,
      dangerThreshold: 90
    }
  }
});`;
    }

    if (fieldType === 'number-quantity') {
      return `@field myField = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'quantity',
      min: 0,
      max: 999
    }
  }
});`;
    }

    if (fieldType === 'number-percentage') {
      return `@field myField = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'percentage',
      min: 0,
      max: 200
    }
  }
});`;
    }

    if (fieldType === 'number-stat') {
      return `@field myField = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'stat',
      label: 'Total Revenue',
      subtitle: '↑ 12.5% vs last month'
    }
  }
});`;
    }

    if (fieldType === 'number-badge-notification') {
      return `@field myField = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'badge-notification',
      label: 'Notifications',
      max: 99
    }
  }
});`;
    }

    if (fieldType === 'number-badge-metric') {
      return `@field myField = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'badge-metric',
      label: 'Items',
      decimals: 2
    }
  }
});`;
    }

    if (fieldType === 'number-badge-counter') {
      return `@field myField = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'badge-counter',
      label: 'Stocks',
      max: 9999
    }
  }
});`;
    }

    if (fieldType === 'number-score') {
      return `@field myField = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'score',
      min: 0,
      max: 1000
    }
  }
});`;
    }

    if (fieldType === 'number-progress-circle') {
      return `@field myField = contains(NumberField, {
  configuration: {
    presentation: {
      type: 'progress-circle',
      min: 0,
      max: 100
    }
  }
});`;
    }

    if (fieldType === 'number-basic') {
      return `@field myField = contains(NumberField);`;
    }

    if (fieldType === 'image') {
      const presentation =
        this.args.model?.playgroundPresentation || 'standard';
      if (presentation === 'standard') {
        return `@field myField = contains(ImageField);`;
      }
      return `@field myField = contains(ImageField, {
  configuration: {
    presentation: '${presentation}'
  }
});`;
    }

    if (fieldType === 'multipleImage') {
      const presentation =
        this.args.model?.playgroundPresentation || 'standard';
      if (presentation === 'standard') {
        return `@field myField = contains(MultipleImageField);`;
      }
      return `@field myField = contains(MultipleImageField, {
  configuration: {
    presentation: '${presentation}'
  }
});`;
    }

    const simpleFields = [
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
              {{#if (eq this.currentPlaygroundField 'playgroundDate')}}
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
              <div class='demo-display-large'>
                {{#if (eq this.currentPlaygroundField 'playgroundDate')}}
                  <@fields.playgroundDate @format={{this.selectedFormat}} />
                {{else if (eq this.currentPlaygroundField 'playgroundTime')}}
                  <@fields.playgroundTime @format={{this.selectedFormat}} />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundDatetime')
                }}
                  <@fields.playgroundDatetime @format={{this.selectedFormat}} />
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
                {{else if
                  (eq this.currentPlaygroundField 'playgroundNumberBasic')
                }}
                  <@fields.playgroundNumberBasic
                    @format={{this.selectedFormat}}
                  />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundNumberSlider')
                }}
                  <@fields.playgroundNumberSlider
                    @format={{this.selectedFormat}}
                  />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundNumberRating')
                }}
                  <@fields.playgroundNumberRating
                    @format={{this.selectedFormat}}
                  />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundNumberProgress')
                }}
                  <@fields.playgroundNumberProgress
                    @format={{this.selectedFormat}}
                  />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundNumberGauge')
                }}
                  <@fields.playgroundNumberGauge
                    @format={{this.selectedFormat}}
                  />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundNumberQuantity')
                }}
                  <@fields.playgroundNumberQuantity
                    @format={{this.selectedFormat}}
                  />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundNumberPercentage')
                }}
                  <@fields.playgroundNumberPercentage
                    @format={{this.selectedFormat}}
                  />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundNumberStat')
                }}
                  <@fields.playgroundNumberStat
                    @format={{this.selectedFormat}}
                  />
                {{else if
                  (eq
                    this.currentPlaygroundField
                    'playgroundNumberBadgeNotification'
                  )
                }}
                  <@fields.playgroundNumberBadgeNotification
                    @format={{this.selectedFormat}}
                  />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundNumberBadgeMetric')
                }}
                  <@fields.playgroundNumberBadgeMetric
                    @format={{this.selectedFormat}}
                  />
                {{else if
                  (eq
                    this.currentPlaygroundField 'playgroundNumberBadgeCounter'
                  )
                }}
                  <@fields.playgroundNumberBadgeCounter
                    @format={{this.selectedFormat}}
                  />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundNumberScore')
                }}
                  <@fields.playgroundNumberScore
                    @format={{this.selectedFormat}}
                  />
                {{else if
                  (eq
                    this.currentPlaygroundField 'playgroundNumberProgressCircle'
                  )
                }}
                  <@fields.playgroundNumberProgressCircle
                    @format={{this.selectedFormat}}
                  />
                {{else if (eq this.currentPlaygroundField 'playgroundImage')}}
                  <@fields.playgroundImage @format={{this.selectedFormat}} />
                {{else if
                  (eq this.currentPlaygroundField 'playgroundMultipleImage')
                }}
                  <@fields.playgroundMultipleImage
                    @format={{this.selectedFormat}}
                  />
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
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem;
        background: #ffffff;
        border: 1px solid var(--border, #e2e8f0);
        border-radius: 0;
      }

      .demo-display-large > :first-child {
        width: 100%;
        max-width: 100%;
        flex: 1;
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
        max-width: 100%;
        flex: 1;
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

  // Playground number fields
  @field playgroundNumberBasic = contains(NumberField);
  @field playgroundNumberSlider = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'slider',
        min: 0,
        max: 100,
        suffix: '%',
        showValue: true,
      },
    },
  });
  @field playgroundNumberRating = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'rating',
        maxStars: 5,
      },
    },
  });
  @field playgroundNumberProgress = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'progress-bar',
        min: 0,
        max: 100,
        label: 'Progress',
      },
    },
  });
  @field playgroundNumberGauge = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'gauge',
        min: 0,
        max: 100,
        suffix: '%',
        label: 'CPU Usage',
        warningThreshold: 70,
        dangerThreshold: 90,
      },
    },
  });
  @field playgroundNumberQuantity = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'quantity',
        min: 0,
        max: 999,
      },
    },
  });
  @field playgroundNumberPercentage = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'percentage',
        min: 0,
        max: 200,
      },
    },
  });
  @field playgroundNumberStat = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'stat',
        prefix: '+',
        suffix: '',
        min: 0,
        max: 100,
        label: 'Total Revenue',
        subtitle: '↑ 12.5% vs last month',
        placeholder: '$0.00',
        icon: TrendingUpIcon,
      },
    },
  });
  @field playgroundNumberBadgeNotification = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'badge-notification',
        decimals: 0,
        min: 0,
        max: 99,
        label: 'Notifications',
        icon: CubeIcon,
      },
    },
  });
  @field playgroundNumberBadgeMetric = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'badge-metric',
        decimals: 2,
        min: 0,
        max: 1000,
        label: 'Items',
        icon: TrendingUpIcon,
      },
    },
  });
  @field playgroundNumberBadgeCounter = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'badge-counter',
        decimals: 0,
        min: 0,
        max: 9999,
        label: 'Stocks',
        icon: CubeIcon,
      },
    },
  });
  @field playgroundNumberScore = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'score',
        decimals: 0,
        min: 0,
        max: 1000,
      },
    },
  });
  @field playgroundNumberProgressCircle = contains(NumberField, {
    configuration: {
      presentation: {
        type: 'progress-circle',
        min: 0,
        max: 100,
      },
    },
  });

  // ImageField playground field
  @field playgroundImage = contains(ImageField, {
    configuration: function (this: FieldShowcase) {
      const presentation = this.playgroundPresentation || 'standard';
      return {
        presentation: presentation === 'standard' ? undefined : presentation,
      };
    },
  });

  // MultipleImageField playground field
  @field playgroundMultipleImage = contains(MultipleImageField, {
    configuration: function (this: FieldShowcase) {
      const presentation = this.playgroundPresentation || 'standard';
      return {
        presentation: presentation === 'standard' ? undefined : presentation,
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
        autoUpload: false,
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
        autoUpload: false,
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
        autoUpload: false,
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
        autoUpload: false,
        allowBatchSelect: true,
        showProgress: true,
        maxFiles: 10,
      },
    },
  });

  static isolated = FieldShowcaseIsolated;
}
