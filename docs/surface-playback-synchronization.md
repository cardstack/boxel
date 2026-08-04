# Surface Coordination: Playback and Viewport Synchronization

Playback is a Surface runtime concern. A card may describe media and render a
player, but it should not coordinate clocks, reach into sibling media elements,
or know whether another surface is running in SES or an iframe.

The reusable primitive is a **Surface coordination fabric**, with playback and
viewport as typed profiles on top. This follows the useful part of MIDI 2.0:
one transport-independent packet and discovery layer, then standard Profiles
that define how implementations respond for a particular purpose. We should
not make a single untyped synchronization service where a pan gesture, a seek,
and an audio-focus change are interchangeable.

```ts
type SurfaceProfile = 'playback/1' | 'viewport/1';

interface SurfaceParticipantHello {
  protocol: 'boxel-surface-coordination/1';
  participantId: string;
  profiles: readonly SurfaceProfile[];
  capabilitiesByProfile: Readonly<Record<string, unknown>>;
}
```

Unknown profiles are ignored. A future profile is additive, and a vendor
extension must use a namespaced identifier such as
`vendor.example.transport/1`. Core playback and viewport convergence may never
depend on an unrecognized vendor extension. This gives us MIDI-style gradual
enhancement and backward compatibility across Surface implementations.

## Boundary rule

`@tracked` does not cross a sandbox boundary.

- In an SES render island, a tracked property invalidates consumers that share
  that in-process object graph.
- In an iframe, the tracked property and its consumers are frame-local. The
  parent Host cannot observe it, and another iframe cannot share it.
- A value crosses an iframe boundary only when the renderer protocol validates
  and transfers a serializable message. The receiver may copy that value into a
  local tracked mirror, but the mirror is not the source of truth.

Pan and zoom follow the same rule. Today a Surface `viewport` object can flow
through dynamic context inside one renderer. If a whole canvas lives in an
iframe, its tracked pan/zoom works locally. Cross-frame coordination requires a
`viewport-intent` / `viewport-snapshot` protocol analogous to playback; passing
an `@tracked` object is not itself a transport.

## One semantic contract, two adapters

The Environment owns one `SurfacePlaybackCoordinator`. Media surfaces join a
named group through dynamic Surface context.

```ts
type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'seeking' | 'ended';

interface PlaybackSnapshot {
  groupId: string;
  epoch: number;
  sequence: number;
  status: PlaybackStatus;
  leaderId: string | null;
  positionMs: number;
  durationMs: number | null;
  rate: number;
  observedAtMs: number;
}

interface SurfacePlayback {
  readonly snapshot: PlaybackSnapshot;
  register(source: PlaybackSourceRegistration): () => void;
  dispatch(intent: PlaybackIntent): void;
  subscribe(callback: (snapshot: PlaybackSnapshot) => void): () => void;
}
```

The SES adapter provides the coordinator object directly through
`SurfacePlaybackContextName`. The iframe adapter provides the same interface as
a proxy: `dispatch()` posts a bounded intent through the iframe's existing
`MessageChannel`, while incoming snapshots update a frame-local tracked mirror.

Card and Surface code use the same API in both cases:

```ts
this.playback.dispatch({
  type: 'seek',
  groupId: this.playbackGroup,
  sourceId: this.id,
  positionMs: 12_500,
});
```

The card never receives a `MessagePort`, iframe reference, `document`, or raw
media element owned by another surface.

## Authority and clock model

The Host-side coordinator is authoritative for group state. It assigns an
`epoch` when a group is created and a monotonically increasing `sequence` to
every accepted intent. Receivers ignore snapshots from older epochs or lower
sequences. This prevents delayed `timeupdate`, reload, or reconnect messages
from rewinding playback.

While playing, position is derived from an anchor rather than broadcasting on
every animation frame:

```ts
positionNow =
  anchorPositionMs + (performance.now() - anchorObservedAtMs) * playbackRate;
```

Messages are sent for semantic discontinuities—play, pause, seek, rate change,
leader change, ended—and for low-frequency drift observations. Native players
may use `requestVideoFrameCallback` locally for smooth UI without turning every
frame into a cross-boundary message.

## Multi-vendor synchronization semantics

The contract deliberately borrows interoperability ideas from Bluetooth LE
Audio and OS media-session APIs instead of assuming every renderer behaves like
one browser media element.

### Keep discovery, configuration, control, and status separate

Bluetooth LE Audio does not use one catch-all object. Its Published Audio
Capabilities, Audio Stream Control, Media Control, and Coordinated Set services
divide the protocol into distinct planes. Boxel should preserve that split:

| Plane         | Question                                            | Boxel message family        |
| ------------- | --------------------------------------------------- | --------------------------- |
| Discovery     | What profiles and operations do you support?        | `hello`, `capabilities`     |
| Configuration | Which group, role, clock, and latency policy apply? | `configure`, `configured`   |
| Control       | What should happen?                                 | `intent`, `intent-accepted` |
| Status        | What is actually happening?                         | `observation`, `snapshot`   |

The iframe bridge exposes only these bounded messages. It does not tunnel a
Surface instance, Ember service, tracked object, DOM node, media element, or
arbitrary RPC method. SES uses the same semantic messages through an in-process
adapter so behavior does not fork by sandbox tier.

### Discover capabilities before selecting a role

Bluetooth LE Audio separates published capabilities, stream configuration, and
media control. Surface playback should do the same. A registration advertises
facts rather than a class identity:

```ts
interface PlaybackCapabilities {
  mediaKinds: readonly ('audio' | 'video' | 'timeline' | '3d')[];
  commands: readonly ('play' | 'pause' | 'seek' | 'rate')[];
  seekResolutionMs?: number;
  rates?: readonly number[];
  presentationDelayRangeMs?: { min: number; max: number };
  canLeadClock: boolean;
}
```

The coordinator chooses a leader only after capability discovery. Like a
coordinated Bluetooth device set, group membership is granted explicitly and
does not imply that members share an implementation or vendor.

### Separate requested state from effective state

Android distinguishes a user's `playWhenReady` intent from whether playback is
actually active, ready, buffering, or suppressed. Surface snapshots therefore
need both:

```ts
requested: 'play' | 'pause';
effective: 'idle' | 'connecting' | 'buffering' | 'playing' | 'paused' | 'ended' | 'error';
suppressionReason?: 'not-visible' | 'resource-policy' | 'audio-focus' | 'leader-wait';
```

A successful `play` command is an accepted intent, not proof that every member
is already rendering. Each participant reports its observed effective state.

### Use position + rate + monotonic observation time

Android media sessions describe playback using position, speed, and the
monotonic time at which that position was observed. Apple media players use a
timebase tied to a host clock and may compensate for output-hardware drift.
The Surface snapshot follows that model rather than streaming the playhead:

```ts
positionMs: number;
rate: number;
observedAtMs: number; // coordinator monotonic clock domain
```

An iframe cannot safely contribute its own `performance.now()` value directly
because its clock origin may differ. During connection, the parent estimates
clock offset with a small request/response exchange and translates observation
times into the coordinator clock domain. Re-estimate after reconnect or a large
drift discontinuity.

### Negotiate presentation delay

Bluetooth LE Audio uses a presentation delay so different devices with
different decoding and output latency present the same sample together. Each
Surface participant similarly reports a supported delay range and an observed
pipeline latency. The coordinator selects a group `presentationAtMs` far enough
in the future for every required participant:

```ts
applyAt = max(member.readyAtMs + member.pipelineDelayMs);
```

Members acknowledge `prepared` before the coordinator commits the scheduled
play/seek. Slow optional followers may join on the next synchronization point;
required followers may keep the group in `buffering`.

### Make control idempotent and reconnectable

Every command carries `groupId`, `epoch`, `sequence`, and `commandId`. Applying
the same command twice is harmless. A reconnect creates a new member lease and
receives a full snapshot before it can emit intents. Messages from an expired
lease, older epoch, or lower sequence are ignored. This is the playback
equivalent of reconfiguring a Bluetooth stream after a device reconnects.

### Treat group membership as a granted lease

Bluetooth Coordinated Set Identification distinguishes discovering a device
from treating it as a member of a coordinated set. Likewise, advertising
`playback/1` or `viewport/1` does not grant a renderer access to a group. The
Host issues a short-lived membership lease scoped to:

```ts
interface SurfaceGroupLease {
  groupId: string;
  participantId: string;
  profile: SurfaceProfile;
  role: 'leader' | 'required-follower' | 'optional-follower' | 'observer';
  epoch: number;
  leaseId: string;
  expiresAtMs: number;
}
```

The iframe capability is the authority to use that lease, not to select an
arbitrary group name. Reconnect, HMR, or iframe replacement invalidates the old
lease. This is the security boundary that prevents one child card from joining
or controlling another card's playback or viewport group by guessing an ID.

### Add focus and suspension policy above transport control

Android audio focus and Apple coordinated playback both model legitimate
reasons a participant cannot currently follow the requested state. Boxel needs
the same policy layer instead of converting every interruption into `pause`:

```ts
type SurfaceSuspension =
  | { reason: 'audio-focus-transient'; response: 'duck' | 'pause' }
  | { reason: 'not-visible'; response: 'pause' | 'keep-clock' }
  | { reason: 'resource-policy'; response: 'pause' }
  | { reason: 'participant-disconnected'; response: 'wait' | 'continue' };
```

Requested state remains `play`; effective state may be `suppressed`. A transient
focus loss can resume automatically, while a permanent loss requires a new user
intent. The coordinator's group policy decides whether to wait for a suspended
required participant, continue without an optional participant, or duck an
audio leader. This mirrors OS behavior and avoids vendor-specific pause/resume
loops fighting each other.

### Pair media time with one coordinator clock

RTP/RTCP synchronizes independently clocked media by periodically pairing each
stream timestamp with a shared reference-clock timestamp rather than forcing
all streams to use the same native units. Boxel should do the same. Every
observation is a pair:

```ts
interface TimelineObservation {
  mediaPositionMs: number;
  coordinatorObservedAtMs: number;
  uncertaintyMs: number;
}
```

The participant may internally count audio samples, video frames, CSS timeline
progress, or Three.js animation time. Its adapter translates to milliseconds
and reports uncertainty. This lets the coordinator choose tolerances honestly:
an audio clock may be precise to a few milliseconds, while a background CSS
timeline may be allowed much more drift.

### Correct drift gradually, jump only at discontinuities

Participants report periodic `{ positionMs, observedAtMs, effective }`
observations. Small drift is corrected by a bounded temporary rate adjustment;
large drift, explicit seeks, or media discontinuities use an exact scheduled
seek. The tolerance is media-kind dependent: audio should lead the user-visible
clock, video and 3D may correct toward it, and non-audible decorative timelines
can use a looser threshold.

## Renderer protocol additions

The iframe protocol needs two bounded message families:

```ts
type PlaybackIntentMessage = {
  type: 'playback-intent';
  groupId: string;
  sourceId: string;
  sequenceHint: number;
  intent: PlaybackIntent;
};

type PlaybackSnapshotMessage = {
  type: 'playback-snapshot';
  snapshot: PlaybackSnapshot;
};
```

The existing per-render `MessageChannel` is the capability. Validation must
bound identifiers and numbers, reject non-finite positions/rates, and only
allow intents for source registrations belonging to that render. A frame can
control its joined playback group; it cannot name an arbitrary card or inspect
another frame.

The transport envelope is shared by playback and viewport profiles:

```ts
interface SurfaceProtocolEnvelope<T> {
  protocol: 'boxel-surface-coordination/1';
  profile: SurfaceProfile;
  groupId: string;
  participantId: string;
  leaseId: string;
  epoch: number;
  sequence: number;
  messageId: string;
  payload: T;
}
```

`messageId` makes retries idempotent. `epoch` rejects messages from an old
session. `sequence` orders accepted changes within the current session. A
snapshot includes the highest applied sequence so an origin can treat a later
SSE/index echo as acknowledgement, not as a reason to rebuild the renderer.

## Media binding

Trusted Surface implementation code owns the element binding:

```hbs
<Media
  @source={{@model.audioUrl}}
  @playbackGroup='launch-night'
  @role='leader'
/>
```

Internally, a trusted `surfacePlaybackBinding` modifier may attach listeners to
its own `<audio>` or `<video>` element and apply coordinator snapshots. This is
safe to run in SES because authored code receives semantic playback state, not
DOM authority. It should:

1. register capabilities (`audio`, `video`, seekable, duration, rate range);
2. turn native events into semantic observations;
3. apply remote play/pause/seek/rate snapshots;
4. suppress the echo generated by applying a snapshot;
5. unregister and release listeners on teardown.

3D timelines can implement the same `PlaybackSourceRegistration` without a
media element. A Three.js scene maps `positionMs` to animation time inside its
iframe, so an audio Surface in SES can remain synchronized with a 3D Surface in
an iframe.

## Viewport follows the same architecture

For pan/zoom, expose semantic intents rather than the tracked object:

```ts
type ViewportIntent =
  | { type: 'pan-by'; dx: number; dy: number }
  | { type: 'zoom-at'; scale: number; x: number; y: number }
  | { type: 'fit'; targetId?: string };
```

`SurfaceRuntimeViewport` remains the authoritative snapshot. SES consumers read
the in-process context; iframe consumers read a local tracked proxy populated
by `viewport-snapshot` messages. Coalesce pointer-driven updates to one message
per animation frame and send a final exact snapshot on gesture end.

Viewport has different coordination policy from playback:

- a pointer owner gets a short gesture lease so two vendors cannot alternately
  overwrite pan on every frame;
- followers may interpolate intermediate snapshots, but the gesture-end
  snapshot is exact and authoritative;
- `fit` is an intent whose effective bounds are reported by the renderer,
  because different surfaces may have different intrinsic geometry;
- viewport state is ephemeral runtime state by default and is written to card
  data only through a separate, permission-checked persistence command;
- an iframe receives only its current viewport profile and lease, never the
  parent card's state or sibling surface geometry.

This means `@tracked pan` and `@tracked zoom` remain excellent implementation
details inside SES or an iframe. The synchronization boundary is the
profile-shaped intent/snapshot stream, not the tracked properties themselves.

## Acceptance cases

- SES audio leader + SES video follower.
- SES audio leader + iframe Three.js follower.
- Two iframe players cannot address each other except through a group granted
  by the Host coordinator.
- Play, pause, seek, rate change, ended, reconnect, and stale message rejection.
- A 30-second drift test stays within a defined tolerance.
- Pan/zoom gesture coalescing and final-state convergence across iframe.
- Two simultaneous pan origins prove the gesture lease prevents oscillation.
- Transient audio focus loss suppresses and resumes; permanent loss does not
  resume without a new intent.
- Unknown profile and namespaced vendor-extension messages are ignored without
  breaking playback/1 or viewport/1.
- Unloading one card releases registrations and does not stop unrelated groups.

## Primary references

- [Bluetooth LE Audio specifications](https://www.bluetooth.com/learn-about-bluetooth/feature-enhancements/le-audio/le-audio-specifications/): capability publication, stream control, media control, and coordinated device sets.
- [Bluetooth LE Audio introduction](https://www.bluetooth.com/wp-content/uploads/2022/01/Introducing-Bluetooth-LE-Audio-book.pdf): presentation delay across devices with different processing latency.
- [Bluetooth Coordinated Set Identification Service](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/28085-CSIS-html5/out/en/index-en.html): discovery and treatment of devices as an explicitly coordinated set.
- [Bluetooth Media Control Service](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/35697-MCS-html5/out/en/index-en.html): interoperable media state and control independent of vendor implementation.
- [Android PlaybackState](https://developer.android.com/reference/android/media/session/PlaybackState.Builder): position, speed, effective state, supported actions, and monotonic update time.
- [Android audio focus](https://developer.android.com/media/optimize/audio-focus): permanent and transient ownership, pause, duck, and resume semantics.
- [Apple AVPlayerItem timebase](https://developer.apple.com/documentation/avfoundation/avplayeritem/timebase): host-clock synchronization and drift compensation.
- [Apple AVPlaybackCoordinator](https://developer.apple.com/documentation/avfoundation/avplaybackcoordinator): group playback, participant suspension, and custom-player delegation.
- [RTP/RTCP RFC 3550](https://www.rfc-editor.org/rfc/rfc3550): synchronization-source identity and pairing independent media timestamps with a shared reference clock.
- [MIDI 2.0 and MIDI-CI](https://midi.org/midi-2-0): capability inquiry, standard Profiles, namespaced extension, and backward-compatible multi-vendor evolution.
