import {
  CardDef,
  Component,
  FieldDef,
  contains,
  containsMany,
  field,
  type CardContext,
} from '@cardstack/base/card-api';
import type {
  RealmKeyShareField,
  RealmKeyShareOperationField,
} from '@cardstack/base/command';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';
import {
  operation,
  operations,
  OperationsError,
  params,
  type OperationDeclaration,
} from '@cardstack/base/operations';
import { realmURL, type KeyReadiness } from '@cardstack/runtime-common';
import { Alert } from '@cardstack/pretui/components/alert';
import { Button } from '@cardstack/pretui/components/button';
import { Chip } from '@cardstack/pretui/components/chip';
import { Input as TextInput } from '@cardstack/pretui/components/input';
import { SegmentedControl } from '@cardstack/pretui/components/segmented-control';
import { Skeleton } from '@cardstack/pretui/components/skeleton';
import ListRealmKeySharesTool from '@cardstack/boxel-host/tools/list-realm-key-shares';
import OpenSecureWindowTool from '@cardstack/boxel-host/tools/open-secure-window';
import CloudIcon from '@cardstack/boxel-icons/cloud';
import CloudDrizzleIcon from '@cardstack/boxel-icons/cloud-drizzle';
import CloudFogIcon from '@cardstack/boxel-icons/cloud-fog';
import CloudLightningIcon from '@cardstack/boxel-icons/cloud-lightning';
import CloudMoonIcon from '@cardstack/boxel-icons/cloud-moon';
import CloudRainIcon from '@cardstack/boxel-icons/cloud-rain';
import CloudSnowIcon from '@cardstack/boxel-icons/cloud-snow';
import CloudSunIcon from '@cardstack/boxel-icons/cloud-sun';
import CloudyIcon from '@cardstack/boxel-icons/cloudy';
import KeyIcon from '@cardstack/boxel-icons/key';
import MapPinIcon from '@cardstack/boxel-icons/map-pin';
import MoonIcon from '@cardstack/boxel-icons/moon';
import RefreshIcon from '@cardstack/boxel-icons/refresh-cw';
import SunIcon from '@cardstack/boxel-icons/sun';
import SunriseIcon from '@cardstack/boxel-icons/sunrise';
import SunsetIcon from '@cardstack/boxel-icons/sunset';
import TrashIcon from '@cardstack/boxel-icons/trash-2';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { restartableTask, task } from 'ember-concurrency';
import { modifier } from 'ember-modifier';
import { TrackedMap } from 'tracked-built-ins';

// A weather app that works with the workspace's key or with the reader's own.
//
// Every request is declared twice, once per credential slot: the `Shared`
// operation sends `{{apiKey}}`, a key someone shared into the realm, and the
// `Own` one sends `{{userKey}}`, the caller's own key. Each slot is approved on
// its own terms (a share serves every caller in the realm, a user's key serves
// only them), and the key-use log records which one paid. The app asks
// `@context.keyReadiness` about both and calls the shared operation when it is
// ready, otherwise the caller's own, and says which key it is using. It never
// falls back from one to the other inside a single operation, so a share that
// stops working never quietly moves calls onto a reader's key.
//
// OpenWeatherMap takes the key in the `appid` query parameter and answers 401
// for a key it doesn't accept, which the realm reports as
// `credential-rejected`. The forecast is One Call 3.0, which needs the "One
// Call by Call" subscription on whichever account the key belongs to.

type Units = 'metric' | 'imperial';
type KeySource = 'shared' | 'own';
type Family = 'forecast' | 'airQuality' | 'findCity';

const OPERATION: Record<Family, Record<KeySource, string>> = {
  forecast: { shared: 'forecastShared', own: 'forecastOwn' },
  airQuality: { shared: 'airQualityShared', own: 'airQualityOwn' },
  findCity: { shared: 'findCityShared', own: 'findCityOwn' },
};

const SHARED_OPERATIONS = Object.values(OPERATION).map((o) => o.shared);

const SUBSCRIPTION_NOTE =
  'The key needs OpenWeatherMap’s “One Call by Call” subscription (the first 1,000 calls a day are free, with a payment card on file); a key without it is rejected.';

export class WeatherLocation extends FieldDef {
  static displayName = 'Weather Location';
  @field name = contains(StringField);
  @field region = contains(StringField);
  @field country = contains(StringField);
  @field latitude = contains(NumberField);
  @field longitude = contains(NumberField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <span class='weather-location'>
        <@fields.name />{{#if @model.country}}, {{@model.country}}{{/if}}
      </span>
    </template>
  };
}

export class WeatherApp extends CardDef {
  static displayName = 'Weather';

  @field cardTitle = contains(StringField);
  // `metric` or `imperial`: what the app shows first. A reader can switch
  // for themselves without changing the card.
  @field units = contains(StringField);
  @field locations = containsMany(WeatherLocation);

  @operation static forecastShared = {
    base: 'callApi',
    label: 'Get the weather for a place, with the workspace’s key',
    params: { lat: NumberField, lon: NumberField, units: StringField },
    url: 'https://api.openweathermap.org/data/3.0/onecall',
    query: {
      lat: params('lat'),
      lon: params('lon'),
      units: params('units'),
      exclude: 'minutely',
      appid: '{{apiKey}}',
    },
  } satisfies OperationDeclaration;

  @operation static forecastOwn = {
    base: 'callApi',
    label: 'Get the weather for a place, with your own key',
    params: { lat: NumberField, lon: NumberField, units: StringField },
    url: 'https://api.openweathermap.org/data/3.0/onecall',
    query: {
      lat: params('lat'),
      lon: params('lon'),
      units: params('units'),
      exclude: 'minutely',
      appid: '{{userKey}}',
    },
  } satisfies OperationDeclaration;

  @operation static airQualityShared = {
    base: 'callApi',
    label: 'Get the air quality for a place, with the workspace’s key',
    params: { lat: NumberField, lon: NumberField },
    url: 'https://api.openweathermap.org/data/2.5/air_pollution',
    query: { lat: params('lat'), lon: params('lon'), appid: '{{apiKey}}' },
  } satisfies OperationDeclaration;

  @operation static airQualityOwn = {
    base: 'callApi',
    label: 'Get the air quality for a place, with your own key',
    params: { lat: NumberField, lon: NumberField },
    url: 'https://api.openweathermap.org/data/2.5/air_pollution',
    query: { lat: params('lat'), lon: params('lon'), appid: '{{userKey}}' },
  } satisfies OperationDeclaration;

  @operation static findCityShared = {
    base: 'callApi',
    label: 'Find a city by name, with the workspace’s key',
    params: { q: StringField },
    url: 'https://api.openweathermap.org/geo/1.0/direct',
    query: { q: params('q'), limit: '5', appid: '{{apiKey}}' },
  } satisfies OperationDeclaration;

  @operation static findCityOwn = {
    base: 'callApi',
    label: 'Find a city by name, with your own key',
    params: { q: StringField },
    url: 'https://api.openweathermap.org/geo/1.0/direct',
    query: { q: params('q'), limit: '5', appid: '{{userKey}}' },
  } satisfies OperationDeclaration;

  static isolated = class Isolated extends Component<typeof this> {
    get app() {
      return this.args.model as WeatherApp;
    }
    <template>
      <WeatherAppView
        @model={{this.app}}
        @context={{@context}}
        @canEdit={{@canEdit}}
      />
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='weather-embedded'>
        <h3>{{if @model.cardTitle @model.cardTitle 'Weather'}}</h3>
        <ul>
          {{#each @model.locations as |location|}}
            <li>{{location.name}}</li>
          {{/each}}
        </ul>
      </div>
      <style scoped>
        .weather-embedded {
          padding: var(--boxel-sp);
        }
        h3 {
          margin: 0 0 var(--boxel-sp-xs);
        }
        ul {
          margin: 0;
          padding-left: var(--boxel-sp);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='weather-fitted'>
        <SunIcon class='fitted-icon' />
        <div>
          <strong>{{if @model.cardTitle @model.cardTitle 'Weather'}}</strong>
          <span>{{@model.locations.length}} places</span>
        </div>
      </div>
      <style scoped>
        .weather-fitted {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xs);
          height: 100%;
          overflow: hidden;
        }
        .fitted-icon {
          width: 2rem;
          height: 2rem;
          flex-shrink: 0;
        }
        .weather-fitted div {
          display: grid;
        }
        span {
          color: var(--muted-foreground);
          font-size: var(--boxel-font-size-sm);
        }
      </style>
    </template>
  };
}

// ---------------------------------------------------------------------------
// What the service answers, as far as the app reads it
// ---------------------------------------------------------------------------

interface Condition {
  id: number;
  main: string;
  description: string;
  icon: string;
}

interface CurrentWeather {
  dt: number;
  sunrise?: number;
  sunset?: number;
  temp: number;
  feels_like: number;
  pressure: number;
  humidity: number;
  uvi: number;
  clouds: number;
  visibility?: number;
  wind_speed: number;
  wind_gust?: number;
  wind_deg: number;
  weather: Condition[];
}

interface HourlyWeather {
  dt: number;
  temp: number;
  pop: number;
  weather: Condition[];
}

interface DailyWeather {
  dt: number;
  temp: { min: number; max: number };
  pop: number;
  weather: Condition[];
}

interface Forecast {
  timezone: string;
  current: CurrentWeather;
  hourly: HourlyWeather[];
  daily: DailyWeather[];
  alerts?: { event: string; sender_name: string; description: string }[];
}

interface AirQuality {
  list: { main: { aqi: number } }[];
}

interface CityMatch {
  name: string;
  state?: string;
  country: string;
  lat: number;
  lon: number;
}

// A refusal or failure a call came back with, kept until the reader refreshes.
interface Problem {
  code: string;
  source: KeySource;
  message: string;
  retryAfterSeconds?: number;
}

// Each place's answers, by the place's position in the list.
interface PlaceWeather {
  forecast?: Forecast;
  airQuality?: AirQuality;
}

interface ShareInfo {
  shareId?: string;
  label?: string;
  state?: string;
  suspensionReason?: string;
}

// ---------------------------------------------------------------------------
// The app
// ---------------------------------------------------------------------------

interface ViewSignature {
  Args: {
    model: WeatherApp;
    context?: CardContext;
    canEdit?: boolean;
  };
}

class WeatherAppView extends GlimmerComponent<ViewSignature> {
  @tracked selected: number | undefined;
  @tracked unitsOverride: Units | undefined;
  @tracked problem: Problem | undefined;
  @tracked loadedFrom: KeySource | undefined;
  @tracked loadedAt: Date | undefined;
  // Whether the signed-in user is one of the realm's direct writers, who
  // alone may share a key into it or swap one into a stopped share. Only they
  // see the realm's shares, so for anyone else this stays false.
  @tracked isWriter = false;
  @tracked share: ShareInfo | undefined;
  @tracked query = '';
  @tracked matches: CityMatch[] = [];
  @tracked searchMessage: string | undefined;
  places = new TrackedMap<number, PlaceWeather>();
  #openedWindow = false;

  get units(): Units {
    return (
      this.unitsOverride ??
      (this.args.model.units === 'imperial' ? 'imperial' : 'metric')
    );
  }

  get unitOptions() {
    return [
      { value: 'metric', label: '°C' },
      { value: 'imperial', label: '°F' },
    ];
  }

  get realm(): string | undefined {
    return this.args.model[realmURL]?.href;
  }

  // Absent outside a live app (a prerender, a freestyle), where nothing may
  // be fetched and nothing about keys is known.
  get isLive(): boolean {
    return Boolean(this.args.context?.keyReadiness);
  }

  readiness(name: string): KeyReadiness | undefined {
    return this.args.context?.keyReadiness?.(name, this.args.model);
  }

  get sharedReadiness() {
    return this.readiness(OPERATION.forecast.shared);
  }

  get ownReadiness() {
    return this.readiness(OPERATION.forecast.own);
  }

  // Which key the app calls with: the workspace's when its operation is
  // ready, otherwise the reader's own when theirs is. Undefined while neither
  // is ready, which is what the key panel explains.
  get source(): KeySource | undefined {
    if (this.sharedReadiness === 'ready') {
      return 'shared';
    }
    if (this.ownReadiness === 'ready') {
      return 'own';
    }
    return undefined;
  }

  get checking(): boolean {
    return (
      this.isLive &&
      this.sharedReadiness === undefined &&
      this.ownReadiness === undefined
    );
  }

  get sourceLabel(): string | undefined {
    let source = this.problem?.source ?? this.loadedFrom ?? this.source;
    if (!source) {
      return undefined;
    }
    return source === 'shared' ? 'Using the workspace’s key' : 'Using your key';
  }

  get selectedLocation() {
    return this.selected === undefined
      ? undefined
      : this.args.model.locations[this.selected];
  }

  get selectedWeather(): PlaceWeather | undefined {
    return this.selected === undefined
      ? undefined
      : this.places.get(this.selected);
  }

  get rows() {
    return this.args.model.locations.map((location, index) => {
      let forecast = this.places.get(index)?.forecast;
      return {
        index,
        location,
        temp: forecast ? `${Math.round(forecast.current.temp)}°` : '—',
        condition: forecast?.current.weather[0]?.description,
        range: forecast
          ? `H:${Math.round(forecast.daily[0].temp.max)}° L:${Math.round(forecast.daily[0].temp.min)}°`
          : undefined,
        time: forecast
          ? timeIn(forecast.timezone, forecast.current.dt)
          : undefined,
        icon: forecast ? iconFor(forecast.current.weather[0]) : undefined,
        tone: forecast ? skyFor(forecast.current) : 'unknown',
      };
    });
  }

  // Fetches once a key is ready, and again whenever the key in use changes:
  // the reader coming back from the secure window with their own key, say.
  // A modifier runs after render, so no call is made while rendering.
  loadWhenReady = modifier(
    (_element: Element, [source]: [KeySource | undefined]) => {
      if (source && source !== this.loadedFrom && !this.problem) {
        this.load.perform(source);
      }
    },
  );

  // Who the reader is to this realm. Asked when the app opens and when the
  // reader comes back from the secure window.
  watchShares = modifier(() => {
    if (!this.isLive) {
      return;
    }
    this.loadShares.perform();
    let back = () => {
      if (this.#openedWindow) {
        this.#openedWindow = false;
        this.problem = undefined;
        this.loadShares.perform();
      }
    };
    window.addEventListener('focus', back);
    return () => window.removeEventListener('focus', back);
  });

  loadShares = restartableTask(async () => {
    let toolContext = this.args.context?.toolContext;
    let realm = this.realm;
    if (!toolContext || !realm) {
      return;
    }
    try {
      let result = await new ListRealmKeySharesTool(toolContext).execute({
        realm,
      });
      this.isWriter = Boolean(result.visible);
      let share = (result.shares ?? []).find((s: RealmKeyShareField) =>
        (s.operations ?? []).some(
          (o: RealmKeyShareOperationField) =>
            o.operation && SHARED_OPERATIONS.includes(o.operation),
        ),
      );
      this.share = share
        ? {
            shareId: share.shareId,
            label: share.label,
            state: share.state,
            suspensionReason: share.suspensionReason,
          }
        : undefined;
    } catch {
      // Someone who isn't signed in, or isn't a direct writer, is never
      // shown the realm's shares.
      this.isWriter = false;
      this.share = undefined;
    }
  });

  load = restartableTask(async (source: KeySource) => {
    this.problem = undefined;
    let locations = this.args.model.locations;
    try {
      await Promise.all(
        locations.map(async (location, index) => {
          let forecast = await this.call<Forecast>('forecast', source, {
            lat: location.latitude,
            lon: location.longitude,
            units: this.units,
          });
          this.places.set(index, { ...this.places.get(index), forecast });
        }),
      );
      this.loadedFrom = source;
      this.loadedAt = new Date();
      if (this.selected !== undefined) {
        await this.loadDetail.perform(this.selected);
      }
    } catch (err) {
      this.fail(err, source);
    }
  });

  // What only the full view shows: the air quality and the radar frames.
  loadDetail = restartableTask(async (index: number) => {
    let source = this.loadedFrom ?? this.source;
    let location = this.args.model.locations[index];
    if (!source || !location) {
      return;
    }
    try {
      let airQuality = await this.call<AirQuality>('airQuality', source, {
        lat: location.latitude,
        lon: location.longitude,
      });
      this.places.set(index, { ...this.places.get(index), airQuality });
    } catch (err) {
      this.fail(err, source);
    }
  });

  findCity = restartableTask(async () => {
    let source = this.loadedFrom ?? this.source;
    let q = this.query.trim();
    if (!source || !q) {
      return;
    }
    this.searchMessage = undefined;
    try {
      let matches = await this.call<CityMatch[]>('findCity', source, { q });
      this.matches = Array.isArray(matches) ? matches : [];
      if (this.matches.length === 0) {
        this.searchMessage = `No place called “${q}” was found.`;
      }
    } catch (err) {
      this.fail(err, source);
    }
  });

  // One call to the service. A response that isn't a success is reported as
  // the problem it is; a refusal from the realm is thrown as it came.
  async call<T>(
    family: Family,
    source: KeySource,
    payload: Record<string, unknown>,
  ): Promise<T> {
    let bucket = operations(this.args.model) as unknown as Record<
      string,
      (payload: Record<string, unknown>) => Promise<unknown>
    >;
    let answer = (await bucket[OPERATION[family][source]](payload)) as {
      status: number;
      body: unknown;
      callApi?: { status: number; body: unknown };
    };
    let response = answer.callApi ?? answer;
    if (response.status < 200 || response.status >= 300) {
      throw new ServiceError(response.status, response.body);
    }
    return response.body as T;
  }

  fail(err: unknown, source: KeySource) {
    if (err instanceof OperationsError) {
      this.problem = {
        code: err.code ?? 'refused',
        source,
        message: err.detail ?? err.title ?? err.message,
        retryAfterSeconds: err.retryAfterSeconds,
      };
    } else if (err instanceof ServiceError) {
      this.problem = {
        code: err.status === 429 ? 'rate-limited' : 'service-error',
        source,
        message: err.message,
      };
    } else {
      this.problem = {
        code: 'failed',
        source,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  refresh = () => {
    this.problem = undefined;
    let source = this.source;
    if (source) {
      this.load.perform(source);
    }
  };

  select = (index: number) => {
    this.selected = index;
    if (!this.places.get(index)?.airQuality) {
      this.loadDetail.perform(index);
    }
  };

  back = () => {
    this.selected = undefined;
  };

  setUnits = (value: string) => {
    this.unitsOverride = value === 'imperial' ? 'imperial' : 'metric';
    if (this.loadedFrom) {
      this.load.perform(this.loadedFrom);
    }
  };

  setQuery = (value: string) => {
    this.query = value;
  };

  search = (event: Event) => {
    event.preventDefault();
    this.findCity.perform();
  };

  addCity = (match: CityMatch) => {
    let location = new WeatherLocation({
      name: match.name,
      region: match.state,
      country: match.country,
      latitude: match.lat,
      longitude: match.lon,
    });
    this.args.model.locations = [...this.args.model.locations, location];
    this.matches = [];
    this.query = '';
    let source = this.loadedFrom ?? this.source;
    if (source) {
      this.load.perform(source);
    }
  };

  removeCity = (index: number, event: Event) => {
    event.stopPropagation();
    this.args.model.locations = this.args.model.locations.filter(
      (_l, i) => i !== index,
    );
    this.places.clear();
    if (this.loadedFrom) {
      this.load.perform(this.loadedFrom);
    }
  };

  // ---- the secure window ---------------------------------------------------

  openWindow = task(
    async (
      request:
        | {
            mode: 'enter-key' | 'approve' | 'review-changes' | 'replace-key';
            operation: string;
            reason: string;
          }
        | { mode: 'share-key'; reason: string }
        | { mode: 'swap-key'; share: string; reason: string },
    ) => {
      let toolContext = this.args.context?.toolContext;
      if (!toolContext) {
        return;
      }
      let input =
        request.mode === 'share-key' || request.mode === 'swap-key'
          ? { ...request, realm: this.realm }
          : { ...request, cardId: this.args.model.id };
      this.#openedWindow = true;
      await new OpenSecureWindowTool(toolContext).execute(input);
    },
  );

  useOwnKey = () =>
    this.openWindow.perform({
      mode: 'enter-key',
      operation: OPERATION.forecast.own,
      reason: `Weather needs your OpenWeatherMap key. ${SUBSCRIPTION_NOTE}`,
    });

  approveOwn = () =>
    this.openWindow.perform({
      mode: 'approve',
      operation: OPERATION.forecast.own,
      reason: 'Let Weather use your OpenWeatherMap key',
    });

  reviewOwn = () =>
    this.openWindow.perform({
      mode: 'review-changes',
      operation: OPERATION.forecast.own,
      reason: 'What Weather sends with your key has changed',
    });

  approveShared = () =>
    this.openWindow.perform({
      mode: 'approve',
      operation: OPERATION.forecast.shared,
      reason: 'Let Weather use the key you shared with this workspace',
    });

  reviewShared = () =>
    this.openWindow.perform({
      mode: 'review-changes',
      operation: OPERATION.forecast.shared,
      reason: 'What Weather sends with the shared key has changed',
    });

  replaceKey = () =>
    this.openWindow.perform({
      mode: 'replace-key',
      operation:
        this.problem?.source === 'shared'
          ? OPERATION.forecast.shared
          : OPERATION.forecast.own,
      reason: `OpenWeatherMap rejected the key. ${SUBSCRIPTION_NOTE}`,
    });

  shareKey = () =>
    this.openWindow.perform({
      mode: 'share-key',
      reason: `Share an OpenWeatherMap key so everyone here sees the weather. ${SUBSCRIPTION_NOTE}`,
    });

  swapKey = () => {
    if (!this.share?.shareId) {
      return;
    }
    this.openWindow.perform({
      mode: 'swap-key',
      share: this.share.shareId,
      reason: `Swap one of your OpenWeatherMap keys into “${this.share.label}”. ${SUBSCRIPTION_NOTE}`,
    });
  };

  // ---- what the key panel says ---------------------------------------------

  get signedOut(): boolean {
    return this.ownReadiness === 'needs-sign-in';
  }

  get sharedStopped(): boolean {
    return this.share?.state === 'suspended';
  }

  get stoppedReason(): string {
    switch (this.share?.suspensionReason) {
      case 'key-deleted':
        return 'Its owner deleted the key.';
      case 'suspended-by-writer':
        return 'Someone who manages this workspace suspended it.';
      case 'owner-lost-write':
        return 'Its owner no longer manages this workspace.';
      default:
        return '';
    }
  }

  // What the workspace's key can't do, in a sentence, for a reader whose app
  // isn't using it.
  get sharedMessage(): string | undefined {
    switch (this.sharedReadiness) {
      case 'ready':
      case undefined:
        return undefined;
      case 'needs-admin':
        if (this.sharedStopped) {
          return `The workspace’s weather key is unavailable. ${this.stoppedReason}`;
        }
        if (this.isWriter && !this.share) {
          return 'This workspace has no weather key.';
        }
        if (this.isWriter) {
          return 'The workspace’s weather key isn’t approved for this app yet.';
        }
        return 'This workspace has no weather key you can use.';
      case 'needs-approval':
        return 'You shared a weather key here; approve it for this app so everyone here can use it.';
      case 'needs-reapproval':
        return 'What this app sends with the workspace’s key changed since it was approved.';
      case 'needs-sign-in':
        return 'The workspace’s weather key is only for people who are signed in.';
      case 'rate-limited':
      case 'over-budget':
        return 'The workspace’s key has had too many requests. Try again shortly.';
      case 'credential-rejected':
        return 'OpenWeatherMap rejected the workspace’s key.';
      default:
        return 'The workspace’s weather key isn’t available.';
    }
  }

  get ownMessage(): string | undefined {
    switch (this.ownReadiness) {
      case 'ready':
      case undefined:
        return undefined;
      case 'needs-connect':
        return 'You can use your own OpenWeatherMap key instead.';
      case 'needs-approval':
        return 'You have an OpenWeatherMap key; approve it for this app to use it here.';
      case 'needs-reapproval':
        return 'What this app sends with your key changed since you approved it.';
      case 'rate-limited':
      case 'over-budget':
        return 'Your key has had too many requests. Try again shortly.';
      case 'credential-rejected':
        return 'OpenWeatherMap rejected your key.';
      default:
        return undefined;
    }
  }

  get problemTitle(): string {
    switch (this.problem?.code) {
      case 'credential-rejected':
        return this.problem.source === 'shared'
          ? 'OpenWeatherMap rejected the workspace’s key'
          : 'OpenWeatherMap rejected your key';
      case 'rate-limited':
      case 'over-budget':
      case 'rate-limit-unavailable':
        return 'Too many requests';
      case 'share-suspended':
        return 'The workspace’s weather key is unavailable';
      default:
        return 'The weather couldn’t be loaded';
    }
  }

  get problemMessage(): string {
    let problem = this.problem;
    if (!problem) {
      return '';
    }
    switch (problem.code) {
      case 'credential-rejected':
        return `It may have expired, been revoked, or lack the One Call 3.0 subscription. ${SUBSCRIPTION_NOTE}`;
      case 'rate-limited':
      case 'over-budget':
      case 'rate-limit-unavailable':
        return problem.retryAfterSeconds
          ? `Try again in ${problem.retryAfterSeconds} seconds.`
          : 'Try again shortly.';
      default:
        return problem.message;
    }
  }

  get problemIsRejection(): boolean {
    return this.problem?.code === 'credential-rejected';
  }

  get problemIsRateLimit(): boolean {
    let code = this.problem?.code;
    return (
      code === 'rate-limited' ||
      code === 'over-budget' ||
      code === 'rate-limit-unavailable'
    );
  }

  get problemTone(): 'warning' | 'danger' {
    return this.problemIsRateLimit ? 'warning' : 'danger';
  }

  get canUseOwn(): boolean {
    let own = this.ownReadiness;
    return own !== undefined && own !== 'needs-sign-in';
  }

  get blockedRateLimited(): boolean {
    let limited = (r: KeyReadiness | undefined) =>
      r === 'rate-limited' || r === 'over-budget';
    return (
      limited(this.sharedReadiness) &&
      (limited(this.ownReadiness) || !this.canUseOwn)
    );
  }

  get ownNeedsConnect() {
    return this.ownReadiness === 'needs-connect';
  }
  get ownNeedsApproval() {
    return this.ownReadiness === 'needs-approval';
  }
  get ownNeedsReapproval() {
    return this.ownReadiness === 'needs-reapproval';
  }
  get ownRejected() {
    return this.ownReadiness === 'credential-rejected';
  }
  get sharedNeedsApproval() {
    return this.sharedReadiness === 'needs-approval';
  }
  get sharedNeedsReapproval() {
    return this.sharedReadiness === 'needs-reapproval';
  }
  get offerShare() {
    return (
      this.isWriter && !this.share && this.sharedReadiness === 'needs-admin'
    );
  }
  get offerSwap() {
    return this.isWriter && this.sharedStopped && Boolean(this.share?.shareId);
  }

  get updatedText(): string | undefined {
    return this.loadedAt
      ? `Updated ${this.loadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : undefined;
  }

  <template>
    <div
      class='weather-app'
      data-test-weather-app
      {{this.watchShares}}
      {{this.loadWhenReady this.source}}
    >
      <header class='app-bar'>
        {{#if this.selectedLocation}}
          <Button
            @appearance='outlined'
            @size='sm'
            {{on 'click' this.back}}
            data-test-weather-back
          >‹ Places</Button>
        {{else}}
          <h1>{{if @model.cardTitle @model.cardTitle 'Weather'}}</h1>
        {{/if}}
        <div class='app-bar-tools'>
          {{#if this.sourceLabel}}
            <Chip @tone='info' data-test-weather-key-source>
              <KeyIcon class='chip-icon' />
              {{this.sourceLabel}}
            </Chip>
          {{/if}}
          <SegmentedControl
            @options={{this.unitOptions}}
            @value={{this.units}}
            @onValueChange={{this.setUnits}}
            @label='Units'
          />
          <Button
            @appearance='outlined'
            @size='sm'
            @busy={{this.load.isRunning}}
            @disabled={{this.refreshDisabled}}
            {{on 'click' this.refresh}}
            data-test-weather-refresh
          >
            <RefreshIcon class='button-icon' />
            Refresh
          </Button>
        </div>
      </header>

      {{#if this.problem}}
        <Alert
          @tone={{this.problemTone}}
          @title={{this.problemTitle}}
          data-test-weather-problem={{this.problem.code}}
        >
          {{this.problemMessage}}
          <:action>
            {{#if this.problemIsRejection}}
              <Button
                @size='sm'
                @tone='primary'
                {{on 'click' this.replaceKey}}
                data-test-weather-replace-key
              >Replace the key</Button>
            {{else}}
              <Button @size='sm' {{on 'click' this.refresh}}>Try again</Button>
            {{/if}}
          </:action>
        </Alert>
      {{else if this.source}}
        {{#if this.sharedFallbackNote}}
          <p class='fallback-note' data-test-weather-fallback>
            {{this.sharedFallbackNote}}
          </p>
        {{/if}}
      {{else if this.checking}}
        <div class='checking'><Skeleton @height='1.5rem' /></div>
      {{else if this.isLive}}
        {{! No key the app may use: say whose key would serve, and what fixes it }}
        <section class='key-panel' data-test-weather-key-panel>
          {{#if this.blockedRateLimited}}
            <Alert
              @tone='warning'
              @title='Too many requests'
              data-test-weather-state='rate-limited'
            >
              The workspace’s weather key has had too many requests. Try again
              shortly.
            </Alert>
          {{else if this.signedOut}}
            <Alert
              @tone='info'
              @title='The weather isn’t available here'
              data-test-weather-state='signed-out'
            >
              {{#if this.sharedMessage}}{{this.sharedMessage}}{{/if}}
              Sign in to use your own OpenWeatherMap key.
            </Alert>
          {{else}}
            <Alert
              @tone={{if this.sharedStopped 'warning' 'info'}}
              @title={{if
                this.sharedStopped
                'The workspace’s key is unavailable'
                'The workspace’s key'
              }}
              data-test-weather-state={{if
                this.sharedStopped
                'share-stopped'
                'no-share'
              }}
            >
              {{this.sharedMessage}}
              <:action>
                {{#if this.offerShare}}
                  <Button
                    @size='sm'
                    {{on 'click' this.shareKey}}
                    data-test-weather-share-key
                  >Share a key with this workspace</Button>
                {{/if}}
                {{#if this.offerSwap}}
                  <Button
                    @size='sm'
                    {{on 'click' this.swapKey}}
                    data-test-weather-swap-key
                  >Swap in one of my keys</Button>
                {{/if}}
                {{#if this.sharedNeedsApproval}}
                  <Button
                    @size='sm'
                    @tone='primary'
                    {{on 'click' this.approveShared}}
                    data-test-weather-approve-shared
                  >Approve</Button>
                {{/if}}
                {{#if this.sharedNeedsReapproval}}
                  <Button @size='sm' {{on 'click' this.reviewShared}}>Review the
                    changes</Button>
                {{/if}}
              </:action>
            </Alert>
            {{#if this.ownMessage}}
              <Alert
                @tone={{if this.ownRejected 'danger' 'info'}}
                @title='Your own key'
                data-test-weather-own={{this.ownReadiness}}
              >
                {{this.ownMessage}}
                {{#if this.ownNeedsConnect}}
                  <span
                    class='subscription-note'
                  >{{this.subscriptionNote}}</span>
                {{/if}}
                <:action>
                  {{#if this.ownNeedsConnect}}
                    <Button
                      @size='sm'
                      @tone='primary'
                      {{on 'click' this.useOwnKey}}
                      data-test-weather-use-own-key
                    >Use my own key</Button>
                  {{else if this.ownNeedsApproval}}
                    <Button
                      @size='sm'
                      @tone='primary'
                      {{on 'click' this.approveOwn}}
                      data-test-weather-approve-own
                    >Approve</Button>
                  {{else if this.ownNeedsReapproval}}
                    <Button @size='sm' {{on 'click' this.reviewOwn}}>Review the
                      changes</Button>
                  {{else if this.ownRejected}}
                    <Button @size='sm' {{on 'click' this.replaceOwnKey}}>Replace
                      my key</Button>
                  {{/if}}
                </:action>
              </Alert>
            {{/if}}
          {{/if}}
        </section>
      {{/if}}

      {{#if this.selectedLocation}}
        <PlaceView
          @location={{this.selectedLocation}}
          @weather={{this.selectedWeather}}
          @units={{this.units}}
        />
      {{else}}
        <ul class='places' data-test-weather-places>
          {{#each this.rows as |row|}}
            <li>
              <button
                type='button'
                class='place sky-{{row.tone}}'
                {{on 'click' (fn this.select row.index)}}
                data-test-weather-place={{row.location.name}}
              >
                <span class='place-main'>
                  <span class='place-name'>{{row.location.name}}</span>
                  <span class='place-sub'>
                    {{#if row.time}}{{row.time}}{{else}}{{row.location.region}}
                      {{row.location.country}}{{/if}}
                  </span>
                  <span class='place-condition'>{{row.condition}}</span>
                </span>
                <span class='place-side'>
                  {{#if row.icon}}
                    <row.icon class='place-icon' />
                  {{/if}}
                  <span class='place-temp'>{{row.temp}}</span>
                  {{#if row.range}}
                    <span class='place-range'>{{row.range}}</span>
                  {{/if}}
                </span>
              </button>
              {{#if @canEdit}}
                <button
                  type='button'
                  class='remove'
                  aria-label='Remove {{row.location.name}}'
                  {{on 'click' (fn this.removeCity row.index)}}
                  data-test-weather-remove={{row.location.name}}
                >
                  <TrashIcon />
                </button>
              {{/if}}
            </li>
          {{else}}
            <li class='empty'>No places yet.</li>
          {{/each}}
        </ul>

        {{#if this.canAddCity}}
          <form class='add-city' {{on 'submit' this.search}}>
            <TextInput
              @value={{this.query}}
              @onInput={{this.setQuery}}
              placeholder='Add a city: Lisbon, Austin TX…'
              data-test-weather-city-query
            />
            <Button
              @busy={{this.findCity.isRunning}}
              type='submit'
              data-test-weather-city-search
            >Search</Button>
          </form>
          {{#if this.searchMessage}}
            <p class='search-message'>{{this.searchMessage}}</p>
          {{/if}}
          {{#if this.matches.length}}
            <ul class='matches'>
              {{#each this.matches as |match|}}
                <li>
                  <button
                    type='button'
                    {{on 'click' (fn this.addCity match)}}
                    data-test-weather-city-match={{match.name}}
                  >
                    <MapPinIcon class='button-icon' />
                    {{match.name}}{{#if match.state}}, {{match.state}}{{/if}},
                    {{match.country}}
                  </button>
                </li>
              {{/each}}
            </ul>
          {{/if}}
        {{/if}}
      {{/if}}

      <footer class='app-footer'>
        <span>Weather data from OpenWeatherMap.</span>
        {{#if this.updatedText}}<span>{{this.updatedText}}</span>{{/if}}
      </footer>
    </div>
    <style scoped>
      .weather-app {
        --weather-sky-day: #4a90d9;
        --weather-sky-day-end: #7fb5ea;
        --weather-sky-night: #1d2b4f;
        --weather-sky-night-end: #3a4a72;
        --weather-sky-cloud: #6f8094;
        --weather-sky-cloud-end: #9aa8b8;
        --weather-sky-rain: #4d5d70;
        --weather-sky-rain-end: #6e7f92;
        --weather-on-sky: #ffffff;
        display: grid;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-lg);
        container-type: inline-size;
      }
      .app-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-sm);
      }
      h1 {
        margin: 0;
        font-size: var(--boxel-font-size-xl);
      }
      .app-bar-tools {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .chip-icon,
      .button-icon {
        width: 1rem;
        height: 1rem;
        vertical-align: middle;
      }
      .fallback-note,
      .search-message {
        margin: 0;
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-sm);
      }
      .key-panel {
        display: grid;
        gap: var(--boxel-sp-sm);
      }
      .subscription-note {
        display: block;
        margin-top: var(--boxel-sp-4xs);
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-sm);
      }
      .places,
      .matches {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--boxel-sp-sm);
      }
      .places li {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .place {
        flex: 1;
        min-width: 0;
        display: flex;
        justify-content: space-between;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        border: none;
        border-radius: var(--boxel-border-radius-xl);
        color: var(--weather-on-sky);
        text-align: left;
        cursor: pointer;
        background: linear-gradient(
          135deg,
          var(--weather-sky-cloud),
          var(--weather-sky-cloud-end)
        );
      }
      .place:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
      .sky-day {
        background: linear-gradient(
          135deg,
          var(--weather-sky-day),
          var(--weather-sky-day-end)
        );
      }
      .sky-night {
        background: linear-gradient(
          135deg,
          var(--weather-sky-night),
          var(--weather-sky-night-end)
        );
      }
      .sky-rain {
        background: linear-gradient(
          135deg,
          var(--weather-sky-rain),
          var(--weather-sky-rain-end)
        );
      }
      .place-main,
      .place-side {
        display: grid;
        align-content: space-between;
        gap: var(--boxel-sp-4xs);
      }
      .place-side {
        justify-items: end;
      }
      .place-name {
        font-size: var(--boxel-font-size-lg);
        font-weight: 700;
      }
      .place-sub,
      .place-condition,
      .place-range {
        font-size: var(--boxel-font-size-sm);
        opacity: 0.9;
      }
      .place-condition::first-letter {
        text-transform: uppercase;
      }
      .place-icon {
        width: 1.5rem;
        height: 1.5rem;
      }
      .place-temp {
        font-size: 2.5rem;
        font-weight: 300;
        line-height: 1;
      }
      .remove {
        flex-shrink: 0;
        padding: var(--boxel-sp-xs);
        border: none;
        background: none;
        color: var(--muted-foreground);
        cursor: pointer;
      }
      .remove:hover,
      .remove:focus-visible {
        color: var(--destructive, var(--foreground));
      }
      .remove svg {
        width: 1rem;
        height: 1rem;
      }
      .empty {
        color: var(--muted-foreground);
      }
      .add-city {
        display: flex;
        gap: var(--boxel-sp-xs);
      }
      .add-city > :first-child {
        flex: 1;
      }
      .matches button {
        width: 100%;
        text-align: left;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius);
        background: var(--card);
        color: var(--card-foreground);
        cursor: pointer;
      }
      .checking {
        max-width: 20rem;
      }
      .app-footer {
        display: flex;
        justify-content: space-between;
        gap: var(--boxel-sp);
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-xs);
      }
    </style>
  </template>

  subscriptionNote = SUBSCRIPTION_NOTE;

  get refreshDisabled(): boolean {
    return !this.source;
  }

  get canAddCity(): boolean {
    return Boolean(this.args.canEdit && (this.loadedFrom ?? this.source));
  }

  // Said when the app is on the reader's own key because the workspace's
  // isn't ready, so whose key pays is never a surprise.
  get sharedFallbackNote(): string | undefined {
    if (this.source !== 'own') {
      return undefined;
    }
    let message = this.sharedMessage;
    return message ? `${message} Using your own key instead.` : undefined;
  }

  replaceOwnKey = () =>
    this.openWindow.perform({
      mode: 'replace-key',
      operation: OPERATION.forecast.own,
      reason: `OpenWeatherMap rejected your key. ${SUBSCRIPTION_NOTE}`,
    });
}

class ServiceError extends Error {
  status: number;
  constructor(status: number, body: unknown) {
    let detail =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : `status ${status}`;
    super(`OpenWeatherMap answered ${detail}.`);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// One place, in full
// ---------------------------------------------------------------------------

interface PlaceSignature {
  Args: {
    location: WeatherLocation;
    weather: PlaceWeather | undefined;
    units: Units;
  };
}

class PlaceView extends GlimmerComponent<PlaceSignature> {
  get forecast() {
    return this.args.weather?.forecast;
  }

  get current() {
    return this.forecast?.current;
  }

  get tz() {
    return this.forecast?.timezone ?? 'UTC';
  }

  get tempUnit() {
    return this.args.units === 'imperial' ? '°F' : '°C';
  }

  get condition() {
    return this.current?.weather[0];
  }

  get icon() {
    return iconFor(this.condition);
  }

  get sky() {
    return this.current ? skyFor(this.current) : 'unknown';
  }

  get today() {
    return this.forecast?.daily[0];
  }

  get hourly() {
    let tz = this.tz;
    return (this.forecast?.hourly ?? []).slice(0, 25).map((hour, i) => ({
      label: i === 0 ? 'Now' : hourIn(tz, hour.dt),
      temp: Math.round(hour.temp),
      pop: hour.pop >= 0.2 ? `${Math.round(hour.pop * 100)}%` : undefined,
      icon: iconFor(hour.weather[0]),
    }));
  }

  get week() {
    let days = this.forecast?.daily ?? [];
    if (days.length === 0) {
      return [];
    }
    let low = Math.min(...days.map((d) => d.temp.min));
    let high = Math.max(...days.map((d) => d.temp.max));
    let span = Math.max(high - low, 1);
    let tz = this.tz;
    return days.map((day, i) => ({
      label: i === 0 ? 'Today' : dayIn(tz, day.dt),
      icon: iconFor(day.weather[0]),
      pop: day.pop >= 0.2 ? `${Math.round(day.pop * 100)}%` : undefined,
      low: Math.round(day.temp.min),
      high: Math.round(day.temp.max),
      // Where this day's range sits within the week's, as percentages.
      barStyle: `left: ${(((day.temp.min - low) / span) * 100).toFixed(1)}%; right: ${(((high - day.temp.max) / span) * 100).toFixed(1)}%;`,
    }));
  }

  get details() {
    let c = this.current;
    if (!c) {
      return [];
    }
    let imperial = this.args.units === 'imperial';
    let speed = imperial ? 'mph' : 'm/s';
    let visibility =
      c.visibility === undefined
        ? '—'
        : imperial
          ? `${(c.visibility / 1609.344).toFixed(1)} mi`
          : `${(c.visibility / 1000).toFixed(1)} km`;
    let aqi = this.args.weather?.airQuality?.list?.[0]?.main.aqi;
    return [
      {
        label: 'Feels like',
        value: `${Math.round(c.feels_like)}°`,
      },
      { label: 'Humidity', value: `${c.humidity}%` },
      {
        label: 'Wind',
        value: `${Math.round(c.wind_speed)} ${speed} ${compass(c.wind_deg)}`,
        hint:
          c.wind_gust !== undefined
            ? `Gusts ${Math.round(c.wind_gust)} ${speed}`
            : undefined,
      },
      { label: 'Pressure', value: `${c.pressure} hPa` },
      { label: 'Visibility', value: visibility },
      { label: 'Cloud cover', value: `${c.clouds}%` },
      {
        label: 'UV index',
        value: `${Math.round(c.uvi)}`,
        hint: uvLabel(c.uvi),
      },
      {
        label: 'Air quality',
        value: aqi ? `${aqi}` : '—',
        hint: aqi ? AQI_LABELS[aqi - 1] : undefined,
      },
    ];
  }

  get sunrise() {
    return this.current?.sunrise
      ? timeIn(this.tz, this.current.sunrise)
      : undefined;
  }

  get sunset() {
    return this.current?.sunset
      ? timeIn(this.tz, this.current.sunset)
      : undefined;
  }

  get alerts() {
    return this.forecast?.alerts ?? [];
  }

  <template>
    <article class='place-view' data-test-weather-place-view>
      <section class='hero sky-{{this.sky}}'>
        <h2>{{@location.name}}</h2>
        {{#if this.current}}
          <div class='hero-temp' data-test-weather-current-temp>
            {{this.round this.current.temp}}°
          </div>
          <div class='hero-condition'>
            <this.icon class='hero-icon' />
            <span>{{this.condition.description}}</span>
          </div>
          {{#if this.today}}
            <div class='hero-range'>H:{{this.round this.today.temp.max}}° L:{{this.round
                this.today.temp.min
              }}°</div>
          {{/if}}
        {{else}}
          <Skeleton @height='4rem' @width='8rem' />
        {{/if}}
      </section>

      {{#each this.alerts as |alert|}}
        <Alert @tone='warning' @title={{alert.event}}>
          {{alert.sender_name}}
        </Alert>
      {{/each}}

      {{#if this.current}}
        <section class='panel' aria-label='Hourly forecast'>
          <h3>Hourly</h3>
          <ol class='hourly' data-test-weather-hourly>
            {{#each this.hourly as |hour|}}
              <li>
                <span class='hour-label'>{{hour.label}}</span>
                <hour.icon class='hour-icon' />
                {{#if hour.pop}}<span class='pop'>{{hour.pop}}</span>{{/if}}
                <span class='hour-temp'>{{hour.temp}}°</span>
              </li>
            {{/each}}
          </ol>
        </section>

        <div class='columns'>
          <section class='panel' aria-label='This week'>
            <h3>{{this.week.length}}-day forecast</h3>
            <ol class='week' data-test-weather-week>
              {{#each this.week as |day|}}
                <li>
                  <span class='day-label'>{{day.label}}</span>
                  <span class='day-icon'>
                    <day.icon />
                    {{#if day.pop}}<span class='pop'>{{day.pop}}</span>{{/if}}
                  </span>
                  <span class='day-low'>{{day.low}}°</span>
                  <span class='range-track'>
                    <span class='range-fill' style={{day.barStyle}}></span>
                  </span>
                  <span class='day-high'>{{day.high}}°</span>
                </li>
              {{/each}}
            </ol>
          </section>

          <section class='panel' aria-label='Precipitation'>
            <h3>Precipitation</h3>
            <RadarMap
              @latitude={{@location.latitude}}
              @longitude={{@location.longitude}}
            />
          </section>
        </div>

        <section class='tiles' data-test-weather-details>
          {{#each this.details as |detail|}}
            <div class='tile'>
              <span class='tile-label'>{{detail.label}}</span>
              <span class='tile-value'>{{detail.value}}</span>
              {{#if detail.hint}}
                <span class='tile-hint'>{{detail.hint}}</span>
              {{/if}}
            </div>
          {{/each}}
          <div class='tile'>
            <span class='tile-label'>Sunrise &amp; sunset</span>
            <span class='tile-value sun'>
              <SunriseIcon class='sun-icon' />{{this.sunrise}}
            </span>
            <span class='tile-hint sun'>
              <SunsetIcon class='sun-icon' />{{this.sunset}}
            </span>
          </div>
        </section>
      {{/if}}
    </article>
    <style scoped>
      .place-view {
        display: grid;
        gap: var(--boxel-sp);
      }
      .hero {
        display: grid;
        justify-items: center;
        gap: var(--boxel-sp-4xs);
        padding: var(--boxel-sp-xl) var(--boxel-sp);
        border-radius: var(--boxel-border-radius-xl);
        color: var(--weather-on-sky);
        background: linear-gradient(
          180deg,
          var(--weather-sky-cloud),
          var(--weather-sky-cloud-end)
        );
      }
      .sky-day {
        background: linear-gradient(
          180deg,
          var(--weather-sky-day),
          var(--weather-sky-day-end)
        );
      }
      .sky-night {
        background: linear-gradient(
          180deg,
          var(--weather-sky-night),
          var(--weather-sky-night-end)
        );
      }
      .sky-rain {
        background: linear-gradient(
          180deg,
          var(--weather-sky-rain),
          var(--weather-sky-rain-end)
        );
      }
      h2 {
        margin: 0;
        font-size: var(--boxel-font-size-xl);
        font-weight: 500;
      }
      .hero-temp {
        font-size: 5rem;
        font-weight: 200;
        line-height: 1;
      }
      .hero-condition {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        text-transform: capitalize;
      }
      .hero-icon {
        width: 1.5rem;
        height: 1.5rem;
      }
      .panel {
        padding: var(--boxel-sp);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius-xl);
        background: var(--card);
        color: var(--card-foreground);
        min-width: 0;
      }
      h3 {
        margin: 0 0 var(--boxel-sp-sm);
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .hourly {
        list-style: none;
        margin: 0;
        padding: 0 0 var(--boxel-sp-xs);
        display: flex;
        gap: var(--boxel-sp);
        overflow-x: auto;
      }
      .hourly li {
        display: grid;
        justify-items: center;
        gap: var(--boxel-sp-4xs);
        min-width: 2.75rem;
      }
      .hour-label {
        font-size: var(--boxel-font-size-sm);
      }
      .hour-icon {
        width: 1.5rem;
        height: 1.5rem;
      }
      .hour-temp {
        font-weight: 600;
      }
      .pop {
        font-size: var(--boxel-font-size-xs);
        color: var(--info, var(--primary));
        font-weight: 600;
      }
      .columns {
        display: grid;
        grid-template-columns: 1fr;
        gap: var(--boxel-sp);
      }
      @container (min-width: 44rem) {
        .columns {
          grid-template-columns: 1fr 1fr;
        }
      }
      .week {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
      }
      .week li {
        display: grid;
        grid-template-columns: 3.5rem 2.5rem 2.5rem 1fr 2.5rem;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) 0;
        border-top: 1px solid var(--border);
      }
      .week li:first-child {
        border-top: none;
      }
      .day-icon {
        display: grid;
        justify-items: center;
      }
      .day-icon svg {
        width: 1.25rem;
        height: 1.25rem;
      }
      .day-low {
        color: var(--muted-foreground);
        text-align: right;
      }
      .day-high {
        font-weight: 600;
      }
      .range-track {
        position: relative;
        height: 0.3125rem;
        border-radius: 999px;
        background: var(--muted);
      }
      .range-fill {
        position: absolute;
        top: 0;
        bottom: 0;
        border-radius: 999px;
        background: linear-gradient(
          90deg,
          var(--weather-range-cool, var(--info, var(--primary))),
          var(--weather-range-warm, var(--warning, var(--primary)))
        );
      }
      .tiles {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
        gap: var(--boxel-sp-sm);
      }
      .tile {
        display: grid;
        align-content: start;
        gap: var(--boxel-sp-4xs);
        padding: var(--boxel-sp-sm);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius-lg);
        background: var(--card);
        color: var(--card-foreground);
      }
      .tile-label {
        font-size: var(--boxel-font-size-xs);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--muted-foreground);
      }
      .tile-value {
        font-size: var(--boxel-font-size-lg);
        font-weight: 600;
      }
      .tile-hint {
        font-size: var(--boxel-font-size-sm);
        color: var(--muted-foreground);
      }
      .sun {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
      }
      .sun-icon {
        width: 1rem;
        height: 1rem;
      }
    </style>
  </template>

  round = (n: number) => Math.round(n);
}

// ---------------------------------------------------------------------------
// The precipitation map: RainViewer's latest radar frame over OpenStreetMap
// ---------------------------------------------------------------------------

const MAP_ZOOM = 6;
const MAP_TILES = 3;
const RAINVIEWER_FRAMES = 'https://api.rainviewer.com/public/weather-maps.json';

interface RadarSignature {
  Args: { latitude: number | undefined; longitude: number | undefined };
}

class RadarMap extends GlimmerComponent<RadarSignature> {
  @tracked radarPath: string | undefined;
  @tracked radarHost: string | undefined;
  @tracked radarTime: number | undefined;
  @tracked radarFailed = false;

  // RainViewer lists its frames; the app overlays the most recent past one.
  // Asked when the map is shown, never while rendering.
  loadFrames = modifier(() => {
    this.fetchFrames.perform();
  });

  fetchFrames = restartableTask(async () => {
    try {
      let response = await fetch(RAINVIEWER_FRAMES);
      let maps = (await response.json()) as {
        host: string;
        radar?: { past?: { time: number; path: string }[] };
      };
      let latest = maps.radar?.past?.at(-1);
      this.radarHost = maps.host;
      this.radarPath = latest?.path;
      this.radarTime = latest?.time;
    } catch {
      this.radarFailed = true;
    }
  });

  get center() {
    let { latitude, longitude } = this.args;
    if (latitude === undefined || longitude === undefined) {
      return undefined;
    }
    let n = 2 ** MAP_ZOOM;
    let rad = (latitude * Math.PI) / 180;
    let x = ((longitude + 180) / 360) * n;
    let y =
      ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
    return { x, y, n };
  }

  // The tiles around the place, and where the place sits among them.
  get tiles() {
    let center = this.center;
    if (!center) {
      return [];
    }
    let half = Math.floor(MAP_TILES / 2);
    let cx = Math.floor(center.x);
    let cy = Math.floor(center.y);
    let tiles = [];
    for (let row = -half; row <= half; row++) {
      for (let col = -half; col <= half; col++) {
        let x = (((cx + col) % center.n) + center.n) % center.n;
        let y = Math.min(Math.max(cy + row, 0), center.n - 1);
        tiles.push({
          base: `https://tile.openstreetmap.org/${MAP_ZOOM}/${x}/${y}.png`,
          radar:
            this.radarHost && this.radarPath
              ? `${this.radarHost}${this.radarPath}/256/${MAP_ZOOM}/${x}/${y}/2/1_1.png`
              : undefined,
        });
      }
    }
    return tiles;
  }

  get pinStyle() {
    let center = this.center;
    if (!center) {
      return '';
    }
    let half = Math.floor(MAP_TILES / 2);
    let left = ((center.x - Math.floor(center.x) + half) / MAP_TILES) * 100;
    let top = ((center.y - Math.floor(center.y) + half) / MAP_TILES) * 100;
    return `left: ${left.toFixed(2)}%; top: ${top.toFixed(2)}%;`;
  }

  get frameTime() {
    return this.radarTime
      ? new Date(this.radarTime * 1000).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        })
      : undefined;
  }

  <template>
    <figure class='radar' data-test-weather-radar {{this.loadFrames}}>
      <div class='map'>
        {{#each this.tiles as |tile|}}
          <div class='tile'>
            <img src={{tile.base}} alt='' loading='lazy' />
            {{#if tile.radar}}
              <img class='rain' src={{tile.radar}} alt='' loading='lazy' />
            {{/if}}
          </div>
        {{/each}}
        <span class='pin' style={{this.pinStyle}}>
          <MapPinIcon />
        </span>
      </div>
      <figcaption>
        {{#if this.frameTime}}Radar at {{this.frameTime}}.{{/if}}
        {{#if this.radarFailed}}Radar is unavailable right now.{{/if}}
        Radar
        <a
          href='https://www.rainviewer.com/'
          target='_blank'
          rel='noopener noreferrer'
        >RainViewer</a>; map ©
        <a
          href='https://www.openstreetmap.org/copyright'
          target='_blank'
          rel='noopener noreferrer'
        >OpenStreetMap</a>
        contributors.
      </figcaption>
    </figure>
    <style scoped>
      .radar {
        margin: 0;
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .map {
        position: relative;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        aspect-ratio: 1;
        overflow: hidden;
        border-radius: var(--boxel-border-radius-lg);
        background: var(--muted);
      }
      .tile {
        position: relative;
        aspect-ratio: 1;
      }
      .tile img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
      }
      .rain {
        opacity: 0.8;
      }
      .pin {
        position: absolute;
        transform: translate(-50%, -100%);
        color: var(--destructive, var(--primary));
      }
      .pin svg {
        width: 1.75rem;
        height: 1.75rem;
        fill: var(--background);
      }
      figcaption {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      figcaption a {
        color: inherit;
      }
    </style>
  </template>
}

// ---------------------------------------------------------------------------
// Reading the service's answers
// ---------------------------------------------------------------------------

const AQI_LABELS = ['Good', 'Fair', 'Moderate', 'Poor', 'Very poor'];

function iconFor(condition: Condition | undefined) {
  if (!condition) {
    return CloudIcon;
  }
  let night = condition.icon?.endsWith('n');
  let id = condition.id;
  if (id >= 200 && id < 300) return CloudLightningIcon;
  if (id >= 300 && id < 400) return CloudDrizzleIcon;
  if (id >= 500 && id < 600) return CloudRainIcon;
  if (id >= 600 && id < 700) return CloudSnowIcon;
  if (id >= 700 && id < 800) return CloudFogIcon;
  if (id === 800) return night ? MoonIcon : SunIcon;
  if (id === 801 || id === 802) return night ? CloudMoonIcon : CloudSunIcon;
  return CloudyIcon;
}

// Which sky the place's tile is painted with.
function skyFor(current: CurrentWeather): 'day' | 'night' | 'cloud' | 'rain' {
  let condition = current.weather[0];
  let id = condition?.id ?? 800;
  if (id < 700) {
    return 'rain';
  }
  if (condition?.icon?.endsWith('n')) {
    return 'night';
  }
  return id >= 803 ? 'cloud' : 'day';
}

function timeIn(timeZone: string, seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  });
}

function hourIn(timeZone: string, seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString([], {
    hour: 'numeric',
    timeZone,
  });
}

function dayIn(timeZone: string, seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString([], {
    weekday: 'short',
    timeZone,
  });
}

function compass(degrees: number): string {
  let points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return points[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

function uvLabel(uvi: number): string {
  if (uvi < 3) return 'Low';
  if (uvi < 6) return 'Moderate';
  if (uvi < 8) return 'High';
  if (uvi < 11) return 'Very high';
  return 'Extreme';
}
