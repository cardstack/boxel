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
import { IconButton } from '@cardstack/pretui/components/icon-button';
import { Input as TextInput } from '@cardstack/pretui/components/input';
import { VisuallyHidden } from '@cardstack/pretui/components/visually-hidden';
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
import MapPinIcon from '@cardstack/boxel-icons/map-pin';
import PlusIcon from '@cardstack/boxel-icons/plus';
import MoonIcon from '@cardstack/boxel-icons/moon';
import RefreshIcon from '@cardstack/boxel-icons/refresh-cw';
import SunIcon from '@cardstack/boxel-icons/sun';
import SunriseIcon from '@cardstack/boxel-icons/sunrise';
import SunsetIcon from '@cardstack/boxel-icons/sunset';
import TrashIcon from '@cardstack/boxel-icons/trash-2';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { htmlSafe } from '@ember/template';
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
// `credential-rejected`. Every endpoint the app calls is on the free plan:
// current conditions, the 5-day forecast in 3-hour steps and air quality
// under `/data/2.5/`, and city search under `/geo/1.0/`, so each key is
// approved for those two destinations.

type Units = 'metric' | 'imperial';
type KeySource = 'shared' | 'own';
type Family = 'current' | 'forecast' | 'airQuality' | 'findCity';

const OPERATION: Record<Family, Record<KeySource, string>> = {
  current: { shared: 'currentShared', own: 'currentOwn' },
  forecast: { shared: 'forecastShared', own: 'forecastOwn' },
  airQuality: { shared: 'airQualityShared', own: 'airQualityOwn' },
  findCity: { shared: 'findCityShared', own: 'findCityOwn' },
};

const FAMILIES: Family[] = ['current', 'forecast', 'airQuality', 'findCity'];

const SHARED_OPERATIONS = FAMILIES.map((f) => OPERATION[f].shared);

// What a key needs before the app can call with it: a readiness answer, or
// `not-allowed` where the realm's policy doesn't let the caller invoke the
// operation at all (readiness is never answered for one of those).
type Need = KeyReadiness | 'not-allowed';

// Which of several operations' needs decides what the app shows: the one
// furthest from being fixed by the caller comes first, the way readiness
// itself ranks a request's slots.
const NEED_ORDER: Need[] = [
  'not-allowed',
  'needs-admin',
  'credential-rejected',
  'over-budget',
  'rate-limited',
  'needs-sign-in',
  'needs-connect',
  'needs-reapproval',
  'needs-approval',
];

// What the app does with a key, as the secure window tells the person
// approving it. The window shows at most 200 characters of a reason.
const OWN_KEY_USE =
  'Weather uses your OpenWeatherMap key to get the current conditions, 5-day forecast and air quality for your saved places, and to find cities you add.';
const SHARED_KEY_USE =
  'Weather uses the shared key to get the current conditions, 5-day forecast and air quality for saved places, and to find cities, for everyone in this workspace.';

const KEY_NOTE =
  'Any OpenWeatherMap key works, including one on the free plan. A new key can take a couple of hours to start working.';

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
  static icon = SunIcon;

  // `metric` or `imperial`: what the app shows first. A reader can switch
  // for themselves without changing the card.
  @field units = contains(StringField);
  @field locations = containsMany(WeatherLocation);

  @operation static currentShared = {
    base: 'callApi',
    label: 'Get the current weather for a place, with the workspace’s key',
    params: { lat: NumberField, lon: NumberField, units: StringField },
    url: 'https://api.openweathermap.org/data/2.5/weather',
    query: {
      lat: params('lat'),
      lon: params('lon'),
      units: params('units'),
      appid: '{{apiKey}}',
    },
  } satisfies OperationDeclaration;

  @operation static currentOwn = {
    base: 'callApi',
    label: 'Get the current weather for a place, with your own key',
    params: { lat: NumberField, lon: NumberField, units: StringField },
    url: 'https://api.openweathermap.org/data/2.5/weather',
    query: {
      lat: params('lat'),
      lon: params('lon'),
      units: params('units'),
      appid: '{{userKey}}',
    },
  } satisfies OperationDeclaration;

  @operation static forecastShared = {
    base: 'callApi',
    label: 'Get the 5-day forecast for a place, with the workspace’s key',
    params: { lat: NumberField, lon: NumberField, units: StringField },
    url: 'https://api.openweathermap.org/data/2.5/forecast',
    query: {
      lat: params('lat'),
      lon: params('lon'),
      units: params('units'),
      appid: '{{apiKey}}',
    },
  } satisfies OperationDeclaration;

  @operation static forecastOwn = {
    base: 'callApi',
    label: 'Get the 5-day forecast for a place, with your own key',
    params: { lat: NumberField, lon: NumberField, units: StringField },
    url: 'https://api.openweathermap.org/data/2.5/forecast',
    query: {
      lat: params('lat'),
      lon: params('lon'),
      units: params('units'),
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
        <h3>{{@model.cardTitle}}</h3>
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
        <SunIcon
          class='fitted-icon'
          width='32'
          height='32'
          aria-hidden='true'
        />
        <div>
          <strong>{{@model.cardTitle}}</strong>
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

// `/data/2.5/weather`
interface CurrentResponse {
  dt: number;
  timezone: number;
  weather: Condition[];
  main: {
    temp: number;
    feels_like: number;
    temp_min: number;
    temp_max: number;
    pressure: number;
    humidity: number;
  };
  visibility?: number;
  wind: { speed: number; deg: number; gust?: number };
  clouds: { all: number };
  sys: { sunrise?: number; sunset?: number };
}

// `/data/2.5/forecast`: five days in 3-hour steps.
interface ForecastResponse {
  list: {
    dt: number;
    main: { temp: number; temp_min: number; temp_max: number };
    weather: Condition[];
    pop?: number;
  }[];
  city: { timezone: number };
}

// One place's weather as the app shows it, read from both responses.
interface Weather {
  // The place's offset from UTC, in seconds.
  offset: number;
  current: CurrentResponse;
  steps: { dt: number; temp: number; pop: number; condition?: Condition }[];
  days: {
    dt: number;
    min: number;
    max: number;
    pop: number;
    condition?: Condition;
  }[];
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
  // The operation the refused call invoked.
  operation?: string;
  message: string;
  retryAfterSeconds?: number;
}

// Each place's answers, by the place's position in the list.
interface PlaceWeather {
  weather?: Weather;
  airQuality?: AirQuality;
}

// A secure window request that would let the app call, with what the
// app's prompt says about it.
interface KeyRequest {
  mode: 'approve' | 'review-changes';
  operation: string;
  reason: string;
  title: string;
  message: string;
  action: string;
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
  // Whether the signed-in writer has an active share in this realm that
  // isn't approved for the app yet: a share names no service until its owner
  // approves it for an operation, so this is the share they might mean.
  @tracked hasUnboundShare = false;
  @tracked adding = false;
  @tracked query = '';
  @tracked matches: CityMatch[] = [];
  @tracked searchMessage: string | undefined;
  places = new TrackedMap<number, PlaceWeather>();
  #openedWindow = false;
  // The key the app last started loading with, kept out of tracking: the
  // modifier that starts a load must not re-run because the load changed
  // state it read, or every load would start another.
  #requestedFrom: KeySource | undefined;
  // The operation each refused call invoked, so a fix opens the secure window
  // for the call that needs it.
  #failedOperation = new WeakMap<object, string>();
  // The key requests already opened in the secure window by themselves.
  #asked = new Set<string>();

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

  need(name: string): Need | undefined {
    let context = this.args.context;
    if (context?.canInvoke?.(name, this.args.model) === false) {
      return 'not-allowed';
    }
    return context?.keyReadiness?.(name, this.args.model);
  }

  // What one key needs across every operation the app calls with it, and the
  // operation that needs it, which is the one the secure window is opened
  // for. Each operation has its own binding, so one can need re-approval or
  // be unapproved while the others are ready. Undefined until every answer is
  // in.
  needOf(source: KeySource): { need: Need | undefined; operation: string } {
    let answers = FAMILIES.map((family) => {
      let operation = OPERATION[family][source];
      return { operation, need: this.need(operation) };
    });
    let first = { operation: OPERATION.current[source], need: undefined };
    if (answers.some((a) => a.need === undefined)) {
      return first;
    }
    let pending = answers
      .filter((a) => a.need !== 'ready')
      .sort(
        (a, b) =>
          NEED_ORDER.indexOf(a.need as Need) -
          NEED_ORDER.indexOf(b.need as Need),
      );
    return (
      pending[0] ?? { operation: OPERATION.current[source], need: 'ready' }
    );
  }

  get sharedReadiness(): Need | undefined {
    return this.needOf('shared').need;
  }

  get ownReadiness(): Need | undefined {
    return this.needOf('own').need;
  }

  get sharedOperation(): string {
    return this.needOf('shared').operation;
  }

  get ownOperation(): string {
    return this.needOf('own').operation;
  }

  // Which key the app calls with: the workspace's when every operation it
  // calls with that key is ready, otherwise the reader's own when theirs are.
  // Undefined while neither is ready, which is what the key panel explains.
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
      let weather = this.places.get(index)?.weather;
      let today = weather?.days[0];
      return {
        index,
        location,
        removeLabel: `Remove ${location.name}`,
        temp: weather ? `${Math.round(weather.current.main.temp)}°` : '—',
        condition: weather?.current.weather[0]?.description,
        range: today
          ? `H:${Math.round(today.max)}° L:${Math.round(today.min)}°`
          : undefined,
        time: weather ? timeIn(weather.offset, weather.current.dt) : undefined,
        icon: weather ? iconFor(weather.current.weather[0]) : undefined,
        tone: weather
          ? temperatureTone(weather.current.main.temp, this.units)
          : 'unknown',
        season: weather
          ? seasonAt(location.latitude, weather.offset, weather.current.dt)
          : 'none',
      };
    });
  }

  // Fetches once a key is ready, and again whenever the key in use changes:
  // the reader coming back from the secure window with their own key, say.
  // It reads nothing tracked but its arguments, so only a change of key or
  // of problem re-runs it, and it starts a load only for a key it hasn't
  // already started one for. A problem stops it until the reader refreshes
  // or comes back from the secure window. A modifier runs after render, so
  // no call is made while rendering.
  loadWhenReady = modifier(
    (
      _element: Element,
      [source, problem]: [KeySource | undefined, Problem | undefined],
    ) => {
      if (source && !problem && source !== this.#requestedFrom) {
        this.#requestedFrom = source;
        queueMicrotask(() => this.load.perform(source));
      }
    },
  );

  // Who the reader is to this realm. Asked when the app opens and when the
  // reader comes back from the secure window.
  watchShares = modifier(() => {
    if (!this.isLive) {
      return;
    }
    queueMicrotask(() => this.loadShares.perform());
    let back = () => {
      if (this.#openedWindow) {
        this.#openedWindow = false;
        this.#requestedFrom = undefined;
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
      this.hasUnboundShare = (result.shares ?? []).some(
        (s: RealmKeyShareField) =>
          s.own && s.state === 'active' && (s.operations ?? []).length === 0,
      );
    } catch {
      // Someone who isn't signed in, or isn't a direct writer, is never
      // shown the realm's shares.
      this.isWriter = false;
      this.share = undefined;
      this.hasUnboundShare = false;
    }
  });

  load = restartableTask(async (source: KeySource) => {
    let locations = this.args.model.locations;
    try {
      await Promise.all(
        locations.map(async (location, index) => {
          let at = {
            lat: location.latitude,
            lon: location.longitude,
            units: this.units,
          };
          let [current, forecast] = await Promise.all([
            this.call<CurrentResponse>('current', source, at),
            this.call<ForecastResponse>('forecast', source, at),
          ]);
          let weather = toWeather(current, forecast);
          this.places.set(index, { ...this.places.get(index), weather });
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
    let name = OPERATION[family][source];
    let answer: {
      status: number;
      body: unknown;
      callApi?: { status: number; body: unknown };
    };
    try {
      answer = (await bucket[name](payload)) as typeof answer;
    } catch (err) {
      if (err && typeof err === 'object') {
        this.#failedOperation.set(err, name);
      }
      throw err;
    }
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
        operation: this.#failedOperation.get(err),
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
    let source = this.source;
    this.#requestedFrom = source;
    this.problem = undefined;
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
    this.stopAdding();
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
            mode: 'approve' | 'review-changes' | 'replace-key';
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

  replaceKey = () =>
    this.openWindow.perform({
      mode: 'replace-key',
      operation:
        this.problem?.operation ??
        (this.problem?.source === 'shared'
          ? this.sharedOperation
          : this.ownOperation),
      reason:
        'OpenWeatherMap turned down the key Weather uses to get the weather here. Replace it with one that works.',
    });

  shareKey = () =>
    this.openWindow.perform({
      mode: 'share-key',
      reason:
        'Share an OpenWeatherMap key so everyone in this workspace sees the weather for its saved places without a key of their own.',
    });

  // ---- asking for a key ---------------------------------------------------

  // The one thing that would let the app call when no key it may use is
  // ready, as the secure window request that does it: approving the share a
  // writer made, or reviewing what changed in its calls; otherwise approving
  // the reader's own key, where the approve page lets them pick one of their
  // keys or add one and grants it the places the app sends it. Undefined
  // while a key is ready, while readiness is still being asked, or when no
  // request the reader can make would help.
  get keyRequest(): KeyRequest | undefined {
    if (!this.isLive || this.problem || this.source === 'shared') {
      return undefined;
    }
    let shared = this.sharedReadiness;
    let own = this.ownReadiness;
    if (shared === undefined || own === undefined) {
      return undefined;
    }
    // Asked even while the app runs on the writer's own key: until the share
    // is approved, nobody else here can use it.
    if (this.sharedNeedsApproval) {
      return {
        mode: 'approve',
        operation: this.sharedOperation,
        reason: SHARED_KEY_USE,
        title: 'Approve the key you shared',
        message:
          'Approve it for this app so everyone in this workspace sees the weather.',
        action: 'Approve',
      };
    }
    if (this.source) {
      return undefined;
    }
    if (shared === 'needs-reapproval') {
      return {
        mode: 'review-changes',
        operation: this.sharedOperation,
        reason:
          'Weather changed what it sends with the shared key to get the weather for this workspace. Review the changes.',
        title: 'The app’s calls changed',
        message: 'Review what it sends with the workspace’s key.',
        action: 'Review the changes',
      };
    }
    if (own === 'needs-connect' || own === 'needs-approval') {
      return {
        mode: 'approve',
        operation: this.ownOperation,
        reason: `${OWN_KEY_USE} Any OpenWeatherMap key works, even a free one.`,
        title: 'Weather needs an OpenWeatherMap key',
        message:
          'Add your key to see the weather here. Any OpenWeatherMap key works, even a free one.',
        action: 'Add a key',
      };
    }
    if (own === 'needs-reapproval') {
      return {
        mode: 'review-changes',
        operation: this.ownOperation,
        reason:
          'Weather changed what it sends with your key to get the weather for your saved places. Review the changes.',
        title: 'The app’s calls changed',
        message: 'Review what it sends with your key.',
        action: 'Review the changes',
      };
    }
    return undefined;
  }

  // Opens the secure window for the key request as soon as the card sees
  // one, once per request: a reader who closes the window gets the prompt's
  // button instead of another window. A browser that blocks the popup gets
  // the host's button that opens it.
  askForKey = modifier(
    (_element: Element, [request]: [KeyRequest | undefined]) => {
      if (!request) {
        return;
      }
      let key = `${request.mode}|${request.operation}`;
      if (this.#asked.has(key)) {
        return;
      }
      this.#asked.add(key);
      queueMicrotask(() => this.openKeyRequest());
    },
  );

  openKeyRequest = () => {
    let request = this.keyRequest;
    if (!request) {
      return;
    }
    this.openWindow.perform({
      mode: request.mode,
      operation: request.operation,
      reason: request.reason,
    });
  };

  // ---- what the app says ---------------------------------------------------

  get signedOut(): boolean {
    return this.ownReadiness === 'needs-sign-in';
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
      case 'binding-not-approved':
      case 'interactive-use-not-approved':
        return 'One of the app’s calls isn’t approved';
      case 'binding-needs-reapproval':
        return 'One of the app’s calls changed since it was approved';
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
        return `It may have expired or been revoked. ${KEY_NOTE}`;
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

  // A refusal the approve page fixes: an operation whose binding is missing,
  // approved for pipelines only, or changed since it was approved. The page
  // gathers every other operation on the card that needs the same.
  get problemNeedsApproval(): boolean {
    let code = this.problem?.code;
    return (
      code === 'binding-not-approved' ||
      code === 'interactive-use-not-approved' ||
      code === 'binding-needs-reapproval'
    );
  }

  approveProblem = () => {
    let problem = this.problem;
    if (!problem?.operation) {
      return;
    }
    this.openWindow.perform({
      mode:
        problem.code === 'binding-needs-reapproval'
          ? 'review-changes'
          : 'approve',
      operation: problem.operation,
      reason: problem.source === 'shared' ? SHARED_KEY_USE : OWN_KEY_USE,
    });
  };

  get notAllowed(): boolean {
    return (
      this.sharedReadiness === 'not-allowed' &&
      this.ownReadiness === 'not-allowed'
    );
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
    return (
      own !== undefined && own !== 'needs-sign-in' && own !== 'not-allowed'
    );
  }

  get blockedRateLimited(): boolean {
    let limited = (r: Need | undefined) =>
      r === 'rate-limited' || r === 'over-budget';
    return (
      limited(this.sharedReadiness) &&
      (limited(this.ownReadiness) || !this.canUseOwn)
    );
  }

  get ownRejected() {
    return this.ownReadiness === 'credential-rejected';
  }
  // The key's owner approves a share for the app: at `needs-approval`, or a
  // writer whose own share isn't approved for any operation yet, which
  // readiness can't tell from a realm with no share.
  get sharedNeedsApproval() {
    return (
      this.sharedReadiness === 'needs-approval' ||
      (this.sharedReadiness === 'needs-admin' &&
        !this.share &&
        this.hasUnboundShare)
    );
  }
  get offerShare() {
    return (
      this.isWriter &&
      !this.share &&
      !this.hasUnboundShare &&
      this.sharedReadiness === 'needs-admin'
    );
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
      {{this.loadWhenReady this.source this.problem}}
      {{this.askForKey this.keyRequest}}
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
          <h1>{{@model.cardTitle}}</h1>
        {{/if}}
        <div class='app-bar-tools'>
          {{#if this.canAddCity}}
            <Button
              @size='sm'
              @tone='primary'
              @icon={{PlusIcon}}
              {{on 'click' this.startAdding}}
              data-test-weather-add-city-button
            >
              Add a city
            </Button>
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
            @icon={{RefreshIcon}}
            {{on 'click' this.refresh}}
            data-test-weather-refresh
          >
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
          <:default>
            {{this.problemMessage}}
          </:default>
          <:action>
            {{#if this.problemIsRejection}}
              <Button
                @size='sm'
                @tone='primary'
                {{on 'click' this.replaceKey}}
                data-test-weather-replace-key
              >Replace the key</Button>
            {{else if this.problemNeedsApproval}}
              <Button
                @size='sm'
                @tone='primary'
                {{on 'click' this.approveProblem}}
                data-test-weather-approve-problem
              >Review the calls</Button>
            {{else}}
              <Button @size='sm' {{on 'click' this.refresh}}>Try again</Button>
            {{/if}}
          </:action>
        </Alert>
      {{else if this.source}}
        {{! The weather shows; nothing to say about keys but a share to approve. }}
        {{#if this.keyRequest}}
          <Alert
            @tone='info'
            @title={{this.keyRequest.title}}
            data-test-weather-state='needs-key'
          >
            <:default>
              {{this.keyRequest.message}}
            </:default>
            <:action>
              <Button
                @size='sm'
                @tone='primary'
                {{on 'click' this.openKeyRequest}}
                data-test-weather-open-key-request
              >{{this.keyRequest.action}}</Button>
            </:action>
          </Alert>
        {{/if}}
      {{else if this.checking}}
        <div class='checking'><Skeleton @height='1.5rem' /></div>
      {{else if this.isLive}}
        <section class='key-panel' data-test-weather-key-panel>
          {{#if this.notAllowed}}
            <Alert
              @tone='info'
              @title='The weather isn’t available to you here'
              data-test-weather-state='not-allowed'
            >
              This workspace doesn’t let you get the weather here. Whoever
              manages it can allow it.
            </Alert>
          {{else if this.blockedRateLimited}}
            <Alert
              @tone='warning'
              @title='Too many requests'
              data-test-weather-state='rate-limited'
            >
              Try again shortly.
            </Alert>
          {{else if this.signedOut}}
            <Alert
              @tone='info'
              @title='The weather isn’t available here'
              data-test-weather-state='signed-out'
            >
              Sign in to use your own OpenWeatherMap key.
            </Alert>
          {{else if this.ownRejected}}
            <Alert
              @tone='danger'
              @title='OpenWeatherMap rejected your key'
              data-test-weather-state='rejected'
            >
              <:default>
                It may have expired or been revoked.
              </:default>
              <:action>
                <Button
                  @size='sm'
                  @tone='primary'
                  {{on 'click' this.replaceOwnKey}}
                  data-test-weather-replace-key
                >Replace the key</Button>
              </:action>
            </Alert>
          {{else if this.keyRequest}}
            <Alert
              @tone='info'
              @title={{this.keyRequest.title}}
              data-test-weather-state='needs-key'
            >
              <:default>
                {{this.keyRequest.message}}
              </:default>
              <:action>
                <Button
                  @size='sm'
                  @tone='primary'
                  {{on 'click' this.openKeyRequest}}
                  data-test-weather-open-key-request
                >{{this.keyRequest.action}}</Button>
                {{#if this.offerShare}}
                  <Button
                    @size='sm'
                    @appearance='outlined'
                    {{on 'click' this.shareKey}}
                    data-test-weather-share-key
                  >Share a key with this workspace</Button>
                {{/if}}
              </:action>
            </Alert>
          {{else}}
            <Alert
              @tone='info'
              @title='The weather isn’t available here'
              data-test-weather-state='unavailable'
            >
              This workspace has no weather key you can use.
            </Alert>
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
        {{#if this.adding}}
          <section class='add-city-panel' data-test-weather-add-city>
            <form class='add-city' {{on 'submit' this.search}}>
              <label for={{this.cityInputId}}>Add a city</label>
              <div class='add-city-row'>
                <TextInput
                  @controlId={{this.cityInputId}}
                  @value={{this.query}}
                  @onInput={{this.setQuery}}
                  placeholder='Lisbon, Austin TX…'
                  data-test-weather-city-query
                />
                <Button
                  @busy={{this.findCity.isRunning}}
                  @disabled={{this.searchDisabled}}
                  type='submit'
                  data-test-weather-city-search
                >Search</Button>
                <Button
                  @appearance='plain'
                  {{on 'click' this.stopAdding}}
                >Done</Button>
              </div>
            </form>
            {{#if this.searchDisabled}}
              <p class='search-message'>Weather needs a key to find cities. Use
                your own key, or ask whoever manages this workspace to share
                one.</p>
            {{/if}}
            {{#if this.searchMessage}}
              <p class='search-message'>{{this.searchMessage}}</p>
            {{/if}}
            {{#if this.matches.length}}
              <ul class='matches'>
                {{#each this.matches as |match|}}
                  <li>
                    <Button
                      @appearance='outlined'
                      @size='sm'
                      @icon={{MapPinIcon}}
                      {{on 'click' (fn this.addCity match)}}
                      data-test-weather-city-match={{match.name}}
                    >
                      {{match.name}}{{#if match.state}}, {{match.state}}{{/if}},
                      {{match.country}}
                    </Button>
                  </li>
                {{/each}}
              </ul>
            {{/if}}
          </section>
        {{/if}}
        <ul class='places' data-test-weather-places>
          {{#each this.rows as |row|}}
            <li>
              {{! A native button: the tile is a temperature-colored panel with its own
                layout, which none of Button's appearances draws. }}
              <button
                type='button'
                class='place temp-{{row.tone}} season-{{row.season}}'
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
                    <row.icon width='24' height='24' aria-hidden='true' />
                  {{/if}}
                  <span class='place-temp'>{{row.temp}}</span>
                  {{#if row.range}}
                    <span class='place-range'>{{row.range}}</span>
                  {{/if}}
                </span>
              </button>
              {{#if @canEdit}}
                <IconButton
                  @label={{row.removeLabel}}
                  @icon={{TrashIcon}}
                  @appearance='plain'
                  @size='sm'
                  {{on 'click' (fn this.removeCity row.index)}}
                  data-test-weather-remove={{row.location.name}}
                />
              {{/if}}
            </li>
          {{else}}
            <li class='empty'>No places yet.</li>
          {{/each}}
        </ul>

      {{/if}}

      <footer class='app-footer'>
        <span>Weather data from OpenWeatherMap.</span>
        {{#if this.updatedText}}<span>{{this.updatedText}}</span>{{/if}}
      </footer>
    </div>
    <style scoped>
      .weather-app {
        /* Each place is colored by its temperature now, from deep blue for
           frigid to red for hot: fixed colors rather than theme tokens, since
           they stand for the temperature, each dark enough for white text at
           4.5:1. */
        --_weather-temp-frigid: #312e81;
        --_weather-temp-frigid-end: #3f3cbb;
        --_weather-temp-freezing: #1e40af;
        --_weather-temp-freezing-end: #2556c4;
        --_weather-temp-cold: #1d5f8a;
        --_weather-temp-cold-end: #0e6f9e;
        --_weather-temp-cool: #0f6e6e;
        --_weather-temp-cool-end: #127a72;
        --_weather-temp-mild: #3f6b1a;
        --_weather-temp-mild-end: #4b7a17;
        --_weather-temp-warm: #9a4a0c;
        --_weather-temp-warm-end: #a8560d;
        --_weather-temp-hot: #9f1d1d;
        --_weather-temp-hot-end: #b42318;
        --_weather-temp-unknown: #4b5866;
        --_weather-temp-unknown-end: #5c6978;
        --_weather-on-tone: #ffffff;
        /* A motif for the season where each place is, laid over its
           temperature color: blossom, sun rays, falling leaves or snow, and
           a lush glow near the equator or an aurora near the poles. Kept
           faint, so white text keeps its contrast. */
        --_weather-season-spring:
          radial-gradient(
            circle at 88% 12%,
            rgb(255 160 200 / 0.26),
            transparent 45%
          ),
          radial-gradient(
            circle at 6% 105%,
            rgb(255 214 236 / 0.2),
            transparent 50%
          );
        --_weather-season-summer:
          radial-gradient(
            circle at 90% 8%,
            rgb(255 214 102 / 0.3),
            transparent 42%
          ),
          repeating-conic-gradient(
            from 200deg at 90% 8%,
            rgb(255 235 170 / 0.1) 0deg 6deg,
            transparent 6deg 18deg
          );
        --_weather-season-autumn:
          radial-gradient(
            circle at 86% 14%,
            rgb(255 140 50 / 0.32),
            transparent 45%
          ),
          repeating-linear-gradient(
            120deg,
            rgb(255 200 120 / 0.08) 0 0.625rem,
            transparent 0.625rem 1.625rem
          );
        --_weather-season-winter:
          radial-gradient(
            circle at 86% 10%,
            rgb(220 240 255 / 0.3),
            transparent 45%
          ),
          radial-gradient(rgb(255 255 255 / 0.22) 1px, transparent 1.5px) 0 0 /
            0.875rem 0.875rem,
          radial-gradient(rgb(255 255 255 / 0.14) 1px, transparent 1.5px)
            0.4375rem 0.4375rem / 0.875rem 0.875rem;
        --_weather-season-tropical:
          radial-gradient(
            circle at 86% 14%,
            rgb(120 255 200 / 0.26),
            transparent 45%
          ),
          repeating-radial-gradient(
            circle at 50% 170%,
            rgb(255 255 255 / 0.07) 0 0.375rem,
            transparent 0.375rem 1.375rem
          );
        --_weather-season-polar: linear-gradient(
          170deg,
          transparent 8%,
          rgb(110 255 190 / 0.26) 28%,
          transparent 44%,
          rgb(190 120 255 / 0.22) 60%,
          transparent 76%
        );
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
        font-size: var(--boxel-font-size-xl);
      }
      .app-bar-tools {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .search-message {
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-sm);
      }
      .key-panel {
        display: grid;
        gap: var(--boxel-sp-sm);
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
        color: var(--_weather-on-tone);
        text-align: left;
        cursor: pointer;
        background:
          var(--_season, linear-gradient(transparent, transparent)),
          linear-gradient(135deg, var(--_tone), var(--_tone-end));
      }
      .place:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }
      .temp-frigid {
        --_tone: var(--_weather-temp-frigid);
        --_tone-end: var(--_weather-temp-frigid-end);
      }
      .temp-freezing {
        --_tone: var(--_weather-temp-freezing);
        --_tone-end: var(--_weather-temp-freezing-end);
      }
      .temp-cold {
        --_tone: var(--_weather-temp-cold);
        --_tone-end: var(--_weather-temp-cold-end);
      }
      .temp-cool {
        --_tone: var(--_weather-temp-cool);
        --_tone-end: var(--_weather-temp-cool-end);
      }
      .temp-mild {
        --_tone: var(--_weather-temp-mild);
        --_tone-end: var(--_weather-temp-mild-end);
      }
      .temp-warm {
        --_tone: var(--_weather-temp-warm);
        --_tone-end: var(--_weather-temp-warm-end);
      }
      .temp-hot {
        --_tone: var(--_weather-temp-hot);
        --_tone-end: var(--_weather-temp-hot-end);
      }
      .temp-unknown {
        --_tone: var(--_weather-temp-unknown);
        --_tone-end: var(--_weather-temp-unknown-end);
      }
      .season-spring {
        --_season: var(--_weather-season-spring);
      }
      .season-summer {
        --_season: var(--_weather-season-summer);
      }
      .season-autumn {
        --_season: var(--_weather-season-autumn);
      }
      .season-winter {
        --_season: var(--_weather-season-winter);
      }
      .season-tropical {
        --_season: var(--_weather-season-tropical);
      }
      .season-polar {
        --_season: var(--_weather-season-polar);
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
      }
      .place-condition::first-letter {
        text-transform: uppercase;
      }
      .place-temp {
        font-size: 2.5rem;
        font-weight: 300;
        line-height: 1;
      }
      .empty {
        color: var(--muted-foreground);
      }
      .add-city-panel {
        display: grid;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-sm);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius-lg);
        background: var(--card);
        color: var(--card-foreground);
      }
      .add-city {
        display: grid;
        gap: var(--boxel-sp-4xs);
      }
      .add-city label {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
      }
      .add-city-row {
        display: flex;
        gap: var(--boxel-sp-xs);
      }
      .add-city-row > :first-child {
        flex: 1;
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

  cityInputId = `${guidFor(this)}-city`;

  get refreshDisabled(): boolean {
    return !this.source;
  }

  // Anyone who can edit the card adds places to it. Finding a city is a call
  // to the service too, so it waits for a key.
  get canAddCity(): boolean {
    return Boolean(this.args.canEdit && this.selected === undefined);
  }

  get searchDisabled(): boolean {
    return !(this.loadedFrom ?? this.source);
  }

  startAdding = () => {
    this.adding = true;
  };

  stopAdding = () => {
    this.adding = false;
    this.matches = [];
    this.query = '';
    this.searchMessage = undefined;
  };

  replaceOwnKey = () =>
    this.openWindow.perform({
      mode: 'replace-key',
      operation: this.ownOperation,
      reason:
        'OpenWeatherMap turned down your key, which Weather uses to get the weather for your saved places. Replace it with one that works.',
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
  get weather() {
    return this.args.weather?.weather;
  }

  get current() {
    return this.weather?.current;
  }

  get offset() {
    return this.weather?.offset ?? 0;
  }

  get condition() {
    return this.current?.weather[0];
  }

  get icon() {
    return iconFor(this.condition);
  }

  get season() {
    return this.current
      ? seasonAt(this.args.location.latitude, this.offset, this.current.dt)
      : 'none';
  }

  get tone() {
    return this.current
      ? temperatureTone(this.current.main.temp, this.args.units)
      : 'unknown';
  }

  get today() {
    return this.weather?.days[0];
  }

  get temp() {
    return this.current ? Math.round(this.current.main.temp) : undefined;
  }

  get range() {
    let today = this.today;
    return today
      ? `H:${Math.round(today.max)}° L:${Math.round(today.min)}°`
      : undefined;
  }

  // The next day or so, in the forecast's 3-hour steps.
  get hourly() {
    let offset = this.offset;
    let current = this.current;
    let now = current
      ? [
          {
            label: 'Now',
            temp: Math.round(current.main.temp),
            pop: undefined,
            icon: iconFor(current.weather[0]),
            condition: current.weather[0]?.description,
          },
        ]
      : [];
    return [
      ...now,
      ...(this.weather?.steps ?? []).slice(0, 9).map((step) => ({
        label: hourIn(offset, step.dt),
        temp: Math.round(step.temp),
        pop: step.pop >= 0.2 ? `${Math.round(step.pop * 100)}%` : undefined,
        icon: iconFor(step.condition),
        condition: step.condition?.description,
      })),
    ];
  }

  get week() {
    let days = this.weather?.days ?? [];
    if (days.length === 0) {
      return [];
    }
    let low = Math.min(...days.map((d) => d.min));
    let high = Math.max(...days.map((d) => d.max));
    let span = Math.max(high - low, 1);
    let offset = this.offset;
    return days.map((day, i) => ({
      label: i === 0 ? 'Today' : dayIn(offset, day.dt),
      icon: iconFor(day.condition),
      condition: day.condition?.description,
      pop: day.pop >= 0.2 ? `${Math.round(day.pop * 100)}%` : undefined,
      low: Math.round(day.min),
      high: Math.round(day.max),
      // Where this day's range sits within the week's, as percentages.
      // The values are numbers computed here, so the string is safe as a style.
      barStyle: htmlSafe(
        `left: ${(((day.min - low) / span) * 100).toFixed(1)}%; right: ${(((high - day.max) / span) * 100).toFixed(1)}%;`,
      ),
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
      { label: 'Feels like', value: `${Math.round(c.main.feels_like)}°` },
      { label: 'Humidity', value: `${c.main.humidity}%` },
      {
        label: 'Wind',
        value: `${Math.round(c.wind.speed)} ${speed} ${compass(c.wind.deg)}`,
        hint:
          c.wind.gust !== undefined
            ? `Gusts ${Math.round(c.wind.gust)} ${speed}`
            : undefined,
      },
      { label: 'Pressure', value: `${c.main.pressure} hPa` },
      { label: 'Visibility', value: visibility },
      { label: 'Cloud cover', value: `${c.clouds.all}%` },
      {
        label: 'Air quality',
        value: aqi ? `${aqi}` : '—',
        hint: aqi ? AQI_LABELS[aqi - 1] : undefined,
      },
    ];
  }

  get sunrise() {
    return this.current?.sys.sunrise
      ? timeIn(this.offset, this.current.sys.sunrise)
      : undefined;
  }

  get sunset() {
    return this.current?.sys.sunset
      ? timeIn(this.offset, this.current.sys.sunset)
      : undefined;
  }

  <template>
    <article class='place-view' data-test-weather-place-view>
      <section class='hero temp-{{this.tone}} season-{{this.season}}'>
        <h2>{{@location.name}}</h2>
        {{#if this.current}}
          <div class='hero-temp' data-test-weather-current-temp>
            {{this.temp}}°
          </div>
          <div class='hero-condition'>
            <this.icon width='24' height='24' aria-hidden='true' />
            <span>{{this.condition.description}}</span>
          </div>
          {{#if this.range}}
            <div class='hero-range'>{{this.range}}</div>
          {{/if}}
        {{else}}
          <Skeleton @height='4rem' @width='8rem' />
        {{/if}}
      </section>

      {{#if this.current}}
        <section class='panel' aria-label='Hourly forecast'>
          <h3>Hourly</h3>
          <ol class='hourly' data-test-weather-hourly>
            {{#each this.hourly as |hour|}}
              <li>
                <span class='hour-label'>{{hour.label}}</span>
                <hour.icon width='24' height='24' aria-hidden='true' />
                <VisuallyHidden>{{hour.condition}}</VisuallyHidden>
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
                    <day.icon width='20' height='20' aria-hidden='true' />
                    <VisuallyHidden>{{day.condition}}</VisuallyHidden>
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
              <SunriseIcon
                width='16'
                height='16'
                aria-hidden='true'
              />{{this.sunrise}}
            </span>
            <span class='tile-hint sun'>
              <SunsetIcon
                width='16'
                height='16'
                aria-hidden='true'
              />{{this.sunset}}
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
        color: var(--_weather-on-tone);
        background:
          var(--_season, linear-gradient(transparent, transparent)),
          linear-gradient(180deg, var(--_tone), var(--_tone-end));
      }
      .temp-frigid {
        --_tone: var(--_weather-temp-frigid);
        --_tone-end: var(--_weather-temp-frigid-end);
      }
      .temp-freezing {
        --_tone: var(--_weather-temp-freezing);
        --_tone-end: var(--_weather-temp-freezing-end);
      }
      .temp-cold {
        --_tone: var(--_weather-temp-cold);
        --_tone-end: var(--_weather-temp-cold-end);
      }
      .temp-cool {
        --_tone: var(--_weather-temp-cool);
        --_tone-end: var(--_weather-temp-cool-end);
      }
      .temp-mild {
        --_tone: var(--_weather-temp-mild);
        --_tone-end: var(--_weather-temp-mild-end);
      }
      .temp-warm {
        --_tone: var(--_weather-temp-warm);
        --_tone-end: var(--_weather-temp-warm-end);
      }
      .temp-hot {
        --_tone: var(--_weather-temp-hot);
        --_tone-end: var(--_weather-temp-hot-end);
      }
      .temp-unknown {
        --_tone: var(--_weather-temp-unknown);
        --_tone-end: var(--_weather-temp-unknown-end);
      }
      .season-spring {
        --_season: var(--_weather-season-spring);
      }
      .season-summer {
        --_season: var(--_weather-season-summer);
      }
      .season-autumn {
        --_season: var(--_weather-season-autumn);
      }
      .season-winter {
        --_season: var(--_weather-season-winter);
      }
      .season-tropical {
        --_season: var(--_weather-season-tropical);
      }
      .season-polar {
        --_season: var(--_weather-season-polar);
      }
      h2 {
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
        font-family: var(--boxel-eyebrow-font-family);
        font-size: var(--boxel-eyebrow-font-size);
        font-weight: var(--boxel-eyebrow-font-weight);
        line-height: var(--boxel-eyebrow-line-height);
        letter-spacing: var(--boxel-eyebrow-letter-spacing);
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
      .hour-temp {
        font-weight: 600;
      }
      .pop {
        font-size: var(--boxel-font-size-xs);
        color: var(--info-ink);
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
        background: linear-gradient(90deg, var(--info), var(--warning));
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
        font-family: var(--boxel-eyebrow-font-family);
        font-size: var(--boxel-eyebrow-font-size);
        font-weight: var(--boxel-eyebrow-font-weight);
        letter-spacing: var(--boxel-eyebrow-letter-spacing);
        text-transform: uppercase;
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
    </style>
  </template>
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
      return htmlSafe('');
    }
    let half = Math.floor(MAP_TILES / 2);
    let left = ((center.x - Math.floor(center.x) + half) / MAP_TILES) * 100;
    let top = ((center.y - Math.floor(center.y) + half) / MAP_TILES) * 100;
    // Numbers computed here, so the string is safe as a style.
    return htmlSafe(`left: ${left.toFixed(2)}%; top: ${top.toFixed(2)}%;`);
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
          <MapPinIcon width='28' height='28' aria-hidden='true' />
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
        color: var(--destructive-ink);
      }
      .pin svg {
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

// Which temperature band a place's tile is painted with, by the temperature
// now in degrees Celsius.
function temperatureTone(temp: number, units: Units): string {
  let celsius = units === 'imperial' ? ((temp - 32) * 5) / 9 : temp;
  if (celsius < -10) return 'frigid';
  if (celsius < 0) return 'freezing';
  if (celsius < 8) return 'cold';
  if (celsius < 15) return 'cool';
  if (celsius < 22) return 'mild';
  if (celsius < 30) return 'warm';
  return 'hot';
}

// The season where a place is, on its own calendar date: by hemisphere in
// the temperate bands, and as its climate band near the equator and the
// poles, where the four seasons don't describe the year.
function seasonAt(
  latitude: number | undefined,
  offset: number,
  seconds: number,
): string {
  if (latitude === undefined) {
    return 'none';
  }
  if (Math.abs(latitude) < 23.5) {
    return 'tropical';
  }
  if (Math.abs(latitude) > 66.5) {
    return 'polar';
  }
  let month = atOffset(offset, seconds).getUTCMonth();
  let northern = [
    'winter',
    'winter',
    'spring',
    'spring',
    'spring',
    'summer',
    'summer',
    'summer',
    'autumn',
    'autumn',
    'autumn',
    'winter',
  ];
  let season = northern[month];
  if (latitude < 0) {
    season =
      {
        winter: 'summer',
        summer: 'winter',
        spring: 'autumn',
        autumn: 'spring',
      }[season] ?? season;
  }
  return season;
}

// The service gives each place's offset from UTC rather than its time zone,
// so a time is shifted by the offset and then read as UTC.
function atOffset(offset: number, seconds: number): Date {
  return new Date((seconds + offset) * 1000);
}

function timeIn(offset: number, seconds: number): string {
  return atOffset(offset, seconds).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

function hourIn(offset: number, seconds: number): string {
  return atOffset(offset, seconds).toLocaleTimeString([], {
    hour: 'numeric',
    timeZone: 'UTC',
  });
}

function dayIn(offset: number, seconds: number): string {
  return atOffset(offset, seconds).toLocaleDateString([], {
    weekday: 'short',
    timeZone: 'UTC',
  });
}

// One place's weather from its current conditions and its 3-hourly forecast.
// Each day is the place's own calendar day: its low and high are the lowest
// and highest of its steps (today's including the temperature now), its
// chance of precipitation is its wettest step's, and its condition is the one
// nearest midday (today's is the condition now).
function toWeather(
  current: CurrentResponse,
  forecast: ForecastResponse,
): Weather {
  let offset = current.timezone ?? forecast.city?.timezone ?? 0;
  let steps = (forecast.list ?? []).map((step) => ({
    dt: step.dt,
    temp: step.main.temp,
    min: step.main.temp_min,
    max: step.main.temp_max,
    pop: step.pop ?? 0,
    condition: step.weather[0],
  }));
  let byDay = new Map<string, typeof steps>();
  let dayOf = (dt: number) => atOffset(offset, dt).toISOString().slice(0, 10);
  for (let step of steps) {
    let day = dayOf(step.dt);
    byDay.set(day, [...(byDay.get(day) ?? []), step]);
  }
  let today = dayOf(current.dt);
  if (!byDay.has(today)) {
    byDay.set(today, []);
  }
  // The forecast runs 120 hours from now, so the last day it reaches is
  // usually only a few morning steps; a day with no step from noon on would
  // show a morning temperature as its high, so it is left out.
  let reachesAfternoon = (daySteps: typeof steps) =>
    daySteps.some((s) => atOffset(offset, s.dt).getUTCHours() >= 12);
  let days = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([day, daySteps]) => day === today || reachesAfternoon(daySteps))
    .map(([day, daySteps]) => {
      let temps = daySteps.flatMap((s) => [s.min, s.max]);
      if (day === today) {
        temps.push(current.main.temp);
      }
      let midday = [...daySteps].sort(
        (a, b) =>
          Math.abs(atOffset(offset, a.dt).getUTCHours() - 12) -
          Math.abs(atOffset(offset, b.dt).getUTCHours() - 12),
      )[0];
      return {
        dt: daySteps[0]?.dt ?? current.dt,
        min: Math.min(...temps),
        max: Math.max(...temps),
        pop: Math.max(0, ...daySteps.map((s) => s.pop)),
        condition: day === today ? current.weather[0] : midday?.condition,
      };
    });
  return { offset, current, steps, days };
}

function compass(degrees: number): string {
  let points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return points[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}
