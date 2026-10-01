/**
 * TOWERS, AS A GRAPH — a sketch, not a build.
 *
 * The same film as test-app/app/components/tower-film.gts on origin/main
 * (26 shots, 5 chapters, four photographs, five marks in the world, five
 * traces, a six-keep comparison), in the syntax proposed in "Film as a
 * Graph" (2026-09-03). Generated from the beat table by tograph.mjs; every
 * value is the film's own. None of `f.*` exists yet.
 *
 * Two things to read it for that Sagrada does not show: an attached
 * photograph (`f.Attach` + `<Insert>`) under a shot, and the comparison
 * chapter, where six shots said the same mix, cut and hand until the
 * group under `hikaku` said it once for them.
 */
import Component from '@glimmer/component';
import { Film, Insert, Gate, EndCard, Player } from 'glimmer-motion/film';
import { TowersPage } from './towers-page';

// Unchanged from tower-film.gts: the traces sampled off the keep, the
// measured reads, the world type. BEATS and CHAPTERS are gone (they are
// the template); the moods and the night look are <TowersPage>'s presets.
import * as D from './towers-data';
const { STANDING, VO_SECS, VO_GAIN, WORLD_TYPE, BUILD } = D;

export default class TowerFilm extends Component<{ Args: { embed?: boolean } }> {
  get src() { return `${this.assets}/index.html`; }
  get assets() { return `${window.location.origin}/towers`; }
  get seek(): 'cut' | 'exact' { return /[?&]seek=exact\b/.test(window.location.search) ? 'exact' : 'cut'; }

  <template>
    <Film
      @name="towers"
      @title="Towers"
      @build={{BUILD}}
      @seek={{this.seek}}
      @worldType={{WORLD_TYPE}}
      @voGain={{VO_GAIN}}
      @embed={{@embed}}
    >
      <:picture>
        <TowersPage
          @src={{this.src}}
          @assets={{this.assets}}
          @standing={{STANDING}}
          @rigMid={{7.065}}
          @cloudHaze={{0.17}}
          @lutAmount={{0.4}}
        />
      </:picture>

      <:default as |f|>
      {{! the keep's seam is the wipe; a shot that wants a blend, a melt,
          a flash or a dip says so as a sibling before it }}
      <f.Spine @join="wipe">

      {{! 01 — CONTEXT: what the thing in front of you actually is }}
      <f.Chapter @n="01" @title="CONTEXT" @grade="amber" @lut="sandstone">
        <f.Shot
          @name="title"
          @ticks={{4}}
          @dolly={{0.5}}
          @lookY={{-1.2}}
          @ox={{0.3}}
          @pitch={{12}}
          @yaw={{-46}}
        >
          <f.To @dolly={{0.98}} @lookY={{-0.3}} @ox={{0.2}} @pitch={{13}} @yaw={{-26}} />
          <f.Type
            @mode="title"
            @kicker="A CONSTRUCTION STUDY"
            @word="天守"
            @reading="TENSHU"
            @gloss="the keep"
            @says={{array "Sixteenth-century Japan" "Stone, timber, tile" "And a roof you can see for miles"}}
          />
          <f.Voice
            @line="Tenshu. You know the shape. Almost nobody knows what is holding it up. So let us take one apart."
            @read={{VO_SECS.title}}
          />
          <f.picture.Weather @theme={{0}} />
          <f.picture.Build @clock={{4.4}} />
          <f.Sky
            @az={{16}}
            @dist={{26}}
            @lines={{array "普請"}}
            @opacity={{0.4}}
            @size={{4.2}}
            @track={{0.2}}
            @y={{7.5}}
          />
        </f.Shot>
        <f.Shot
          @name="shiro"
          @ticks={{5}}
          @cut={{true}}
          @dolly={{2.2}}
          @lookY={{5.2}}
          @ox={{-0.1}}
          @pitch={{-3}}
          @yaw={{-18}}
        >
          <f.To @dolly={{1.2}} @lookY={{4.2}} @ox={{-0.1}} @pitch={{6}} @yaw={{2}} />
          <f.Type
            @mode="lower"
            @kicker="WHAT A CASTLE IS"
            @word="城"
            @reading="SHIRO"
            @gloss="castle"
            @says={{array "Not the tower." "The ground." "Ditches, banks, terraces."}}
          />
          <f.Voice
            @line="The castle is not the tower. The castle is the ground. Ditches, banks, a hill cut into shelves."
            @read={{VO_SECS.shiro}}
          />
        </f.Shot>
        <f.Join @presentation="melt" />
        <f.Shot
          @name="what"
          @ticks={{4}}
          @cut={{true}}
          @dolly={{0.72}}
          @lookY={{1.0}}
          @ox={{0.16}}
          @pitch={{8}}
          @yaw={{2}}
        >
          <f.To @dolly={{0.44}} @lookY={{0.2}} @ox={{0.16}} @pitch={{11}} @yaw={{13}} />
          <f.Type
            @mode="plate"
            @kicker="ONE BUILDING, THREE JOBS"
            @word="天守閣"
            @reading="TENSHUKAKU"
            @gloss="keep · watchtower"
            @says={{array "A lookout." "A strongroom." "An argument."}}
          />
          <f.Voice
            @line="A lookout. A strongroom. An advert. You can guess which one got the money."
            @read={{VO_SECS.what}}
          />
        </f.Shot>
      </f.Chapter>

      {{! 02 — HISTORY: where the form comes from, and why it stopped }}
      <f.Chapter @n="02" @title="HISTORY" @grade="iron" @lut="iron">
        <f.Shot
          @name="azuchi"
          @ticks={{5}}
          @lead={{2}}
          @dolly={{0.9}}
          @lookY={{1.4}}
          @ox={{0.14}}
          @pitch={{6}}
          @yaw={{18}}
        >
          <f.To @dolly={{0.82}} @lookY={{1.9}} @ox={{0.14}} @pitch={{8}} @yaw={{31}} />
          <f.Type
            @mode="plate"
            @kicker="THE FIRST OF ITS KIND"
            @word="安土城"
            @reading="AZUCHI-JŌ"
            @gloss="Azuchi, 1576"
            @says={{array "1576" "Seven storeys. Gilded." "Gone in six years."}}
          />
          <f.Voice
            @line="Fifteen seventy-six. Seven gilded storeys over Lake Biwa. It burned in six years. Everything after it is a reply."
            @read={{VO_SECS.azuchi}}
          />
          <f.picture.Weather @theme={{2}} />
          <f.Sky
            @az={{-14}}
            @dist={{28}}
            @lines={{array "安土"}}
            @opacity={{0.34}}
            @size={{3.6}}
            @track={{0.18}}
            @y={{11}}
          />
          <f.Attach @lane={{1}}>
            <Insert @src="azuchi.webp" @caption="Azuchi, Shiga — the keep’s stone platform" @credit="photograph" />
          </f.Attach>
        </f.Shot>
        <f.Join @presentation="flash" />
        <f.Shot
          @name="teppo"
          @ticks={{5}}
          @cut={{true}}
          @dolly={{1.15}}
          @lookY={{-2.6}}
          @ox={{-0.1}}
          @pitch={{1}}
          @yaw={{34}}
        >
          <f.To @dolly={{1.05}} @lookY={{-1.4}} @ox={{-0.1}} @pitch={{4}} @yaw={{44}} />
          <f.Type
            @mode="lower"
            @kicker="WHY THE SHAPE CHANGED"
            @word="鉄砲"
            @reading="TEPPŌ"
            @gloss="the matchlock gun"
            @says={{array "1543 — the gun lands" "Walls get lower, thicker" "Height becomes address"}}
          />
          <f.Voice
            @line="Then the guns arrive. Walls get lower, thicker, stonier. Height stops being armour and turns into an address."
            @read={{VO_SECS.teppo}}
          />
        </f.Shot>
        <f.Shot
          @name="ikkoku"
          @ticks={{5}}
          @dolly={{0.74}}
          @lookY={{1.8}}
          @ox={{0.16}}
          @pitch={{13}}
          @yaw={{56}}
        >
          <f.To @dolly={{0.8}} @lookY={{1.4}} @ox={{0.16}} @pitch={{10}} @yaw={{65}} />
          <f.Type
            @mode="plate"
            @kicker="AND WHY IT STOPPED"
            @word="一国一城令"
            @reading="IKKOKU-ICHIJŌ-REI"
            @gloss="one domain, one castle"
            @says={{array "1615" "One castle per province" "Twelve keeps survive"}}
          />
          <f.Voice
            @line="Sixteen fifteen. One castle per province. The rest come down. Twelve original keeps are still standing."
            @read={{VO_SECS.ikkoku}}
          />
          <f.picture.Look @grade="night" @lut="floodlit" />
          <f.picture.Weather @theme={{3}} />
          <f.picture.Light @rim={{1.7}} />
          <f.Attach @lane={{1}}>
            <Insert @src="himeji.webp" @caption="Himeji Castle, Hyōgo — one of the twelve originals" @credit="photograph" />
          </f.Attach>
        </f.Shot>
      </f.Chapter>

      {{! 03 — CONSTRUCTION: the tower comes apart, bottom to top }}
      <f.Chapter @n="03" @title="CONSTRUCTION" @grade="chalk" @lut="chalk">
        <f.Join @presentation="dip" />
        <f.Shot
          @name="ishigaki"
          @ticks={{7}}
          @cut={{true}}
          @to={{array 2.8 1.6 0.6}}
          @dolly={{1.24}}
          @lookY={{-4.4}}
          @ox={{-0.12}}
          @pitch={{-1}}
          @yaw={{72}}
        >
          <f.To @dolly={{1.12}} @lookY={{-3.2}} @ox={{-0.12}} @pitch={{1}} @yaw={{84}} />
          <f.Type
            @mode="lower"
            @kicker="STAGE ONE"
            @word="石垣"
            @reading="ISHIGAKI"
            @gloss="the stone base"
            @says={{array "No mortar. None." "扇の勾配 — the fan’s incline" "The wall sheds the shock"}}
          />
          <f.Voice
            @line="Ishigaki. Dry stone, no mortar, stacked into a curve. A straight wall argues with an earthquake. This one passes it into the hill."
            @read={{VO_SECS.ishigaki}}
          />
          <f.picture.Weather @theme={{0}} @haze={{0.42}} />
          <f.picture.Sun @az={{-70}} @el={{36}} />
          <f.picture.Build @clock={{array 0 1.07}} />
          <f.Mark
            @at={{0.42}}
            @bearing={{120}}
            @hold={{0.2}}
            @lines={{array "石垣"}}
            @r={{7}}
            @size={{1.5}}
            @to={{3.3}}
          />
          <f.Attach @lane={{1}}>
            <Insert @src="ishigaki.webp" @caption="Dry-laid ishigaki, Kumamoto" @credit="photograph" />
          </f.Attach>
        </f.Shot>
        <f.Shot
          @name="timber"
          @ticks={{7}}
          @dolly={{1.05}}
          @lookY={{-2.2}}
          @ox={{-0.12}}
          @pitch={{2}}
          @yaw={{90}}
        >
          <f.To @dolly={{1.0}} @lookY={{-0.9}} @ox={{-0.12}} @pitch={{4}} @yaw={{102}} />
          <f.Type
            @mode="lower"
            @kicker="STAGE TWO"
            @word="柱梁"
            @reading="CHŪRYŌ"
            @gloss="post and beam"
            @says={{array "A timber cage" "Posts stand ON stone" "The joints do the work"}}
          />
          <f.Voice
            @line="Chūryō. Above the stone, a timber cage. Posts sit on footing stones, not in the ground. Nothing is bolted. The joints do the work."
            @read={{VO_SECS.timber}}
          />
          <f.picture.Weather @haze={{0.2}} />
          <f.picture.Sun @az={{-30}} @el={{62}} />
          <f.picture.Build @clock={{array 1.07 1.92}} />
          <f.Mark @bearing={{138}} @lines={{array "柱梁"}} @r={{7}} @size={{1.5}} @to={{6.2}} />
        </f.Shot>
        <f.Shot
          @name="plaster"
          @ticks={{4}}
          @dolly={{1.02}}
          @lookY={{-0.4}}
          @ox={{-0.12}}
          @pitch={{5}}
          @yaw={{108}}
        >
          <f.To @dolly={{1.0}} @lookY={{0.8}} @ox={{-0.12}} @pitch={{7}} @yaw={{118}} />
          <f.Type
            @mode="lower"
            @kicker="STAGE THREE"
            @word="白壁"
            @reading="SHIRAKABE"
            @gloss="the white wall"
            @says={{array "Lime over bamboo lath" "塗籠 — wrapped up" "White because white will not burn"}}
          />
          <f.Voice
            @line="Shirakabe. Lime plaster, thick enough to be armour. White, because white does not burn."
            @read={{VO_SECS.plaster}}
          />
          <f.picture.Sun @az={{-8}} @el={{78}} />
          <f.picture.Build @clock={{array 1.92 2.79}} />
          <f.Mark @bearing={{155}} @lines={{array "白壁"}} @r={{7}} @size={{1.5}} @to={{8.8}} />
        </f.Shot>
        <f.Shot
          @name="boro"
          @ticks={{5}}
          @dolly={{1.0}}
          @lookY={{2.0}}
          @ox={{-0.12}}
          @pitch={{10}}
          @yaw={{124}}
        >
          <f.To @dolly={{0.94}} @lookY={{2.8}} @ox={{-0.12}} @pitch={{13}} @yaw={{133}} />
          <f.Type
            @mode="lower"
            @kicker="STAGE FOUR"
            @word="望楼"
            @reading="BŌRŌ"
            @gloss="the watch storey"
            @says={{array "A room to see from" "The reason for all the rest"}}
          />
          <f.Voice
            @line="Bōrō. At the top, one room you can see out of. Everything below it is how you get that room into the air."
            @read={{VO_SECS.boro}}
          />
          <f.picture.Weather @haze={{0.38}} />
          <f.picture.Build @clock={{array 2.79 3.64}} />
          <f.Mark @bearing={{170}} @lines={{array "望楼"}} @r={{7}} @size={{1.5}} @to={{11.2}} />
        </f.Shot>
        <f.Shot
          @name="kawara"
          @ticks={{6}}
          @dolly={{0.88}}
          @lookY={{3.0}}
          @ox={{-0.12}}
          @pitch={{15}}
          @yaw={{138}}
        >
          <f.To @dolly={{0.72}} @lookY={{2.2}} @ox={{-0.1}} @pitch={{12}} @yaw={{148}} />
          <f.Type
            @mode="lower"
            @kicker="STAGE FIVE"
            @word="瓦"
            @reading="KAWARA"
            @gloss="the clay tile"
            @says={{array "Hung, not nailed" "The heaviest thing here" "And that weight is what steadies it"}}
          />
          <f.Voice
            @line="Kawara. Fired clay, hung, never nailed. The heaviest thing in the building, and that weight is what holds it still. The roof is ballast."
            @read={{VO_SECS.kawara}}
          />
          <f.picture.Weather @theme={{1}} />
          <f.picture.Build @clock={{array 3.64 4.4}} />
          <f.Mark
            @bearing={{185}}
            @hold={{0.5}}
            @lines={{array "瓦"}}
            @r={{7}}
            @size={{1.5}}
            @to={{13.5}}
          />
        </f.Shot>
        <f.Join @presentation="blend" />
        <f.Shot
          @name="muneage"
          @ticks={{2}}
          @cut={{true}}
          @dolly={{0.54}}
          @lookY={{0.9}}
          @ox={{0}}
          @pitch={{12}}
          @yaw={{149}}
        >
          <f.To @dolly={{0.5}} @lookY={{0.9}} @ox={{0}} @pitch={{13}} @yaw={{152}} />
          <f.Type @mode="clear" />
          <f.Voice
            @line="Muneage. The ridge goes on, and the carpenters stop for the day."
            @read={{VO_SECS.muneage}}
          />
          <f.picture.Look @grade="ink" />
          <f.picture.Build @clock={{4.4}} />
        </f.Shot>
      </f.Chapter>

      {{! 04 — DETAIL: cut in hard, hold, trace it, cut again }}
      <f.Chapter @n="04" @title="DETAIL" @grade="ink" @lut="ink">
        <f.Shot
          @name="detail"
          @ticks={{3}}
          @lead={{2}}
          @dolly={{0.8}}
          @lookY={{1.4}}
          @ox={{0.18}}
          @pitch={{12}}
          @yaw={{152}}
        >
          <f.To @dolly={{1.55}} @lookY={{4.6}} @ox={{0.12}} @pitch={{15}} @yaw={{158}} />
          <f.Type
            @mode="plate"
            @kicker="LOOK CLOSER"
            @word="細部"
            @reading="SAIBU"
            @gloss="four things worth naming"
            @says={{array "One building." "One moment." "Only the lens moves."}}
          />
          <f.Voice
            @line="Same building. Same afternoon. From here, only the lens moves."
            @read={{VO_SECS.detail}}
          />
          <f.picture.Build @clock={{4.4}} />
          <f.Trace @pts={{RING_EAVE1}} @wide={{true}} />
          <f.Trace @pts={{RING_EAVE2}} />
          <f.Trace @pts={{BATTER_L}} />
          <f.Trace @pts={{BATTER_R}} />
        </f.Shot>
        <f.Join @presentation="blend" />
        <f.Shot
          @name="shachi"
          @ticks={{6}}
          @cut={{true}}
          @to={{array -0.51 13.85 -0.51}}
          @dolly={{3.6}}
          @lookY={{6.8}}
          @ox={{-0.18}}
          @pitch={{4}}
          @yaw={{156}}
        >
          <f.To @dolly={{4.75}} @lookY={{6.85}} @ox={{-0.18}} @pitch={{7}} @yaw={{164}} />
          <f.Type
            @mode="point"
            @kicker="ON THE RIDGE"
            @word="鯱"
            @reading="SHACHIHOKO"
            @gloss="the roof-ridge fish"
            @says={{array "Tiger’s head, fish’s body" "Bronze, at both ends of the ridge" "A charm against fire"}}
          />
          <f.Voice
            @line="Shachihoko. Tiger's head, fish's body, cast in bronze. It swallows water and spits it on the roof. That was the fire plan."
            @read={{VO_SECS.shachi}}
          />
          <f.picture.Weather @theme={{2}} @haze={{0.34}} />
          <f.picture.Sun @az={{120}} @el={{26}} />
          <f.picture.Build @clock={{4.4}} />
          <f.Trace @pts={{RIDGE}} @wide={{true}} />
          <f.Attach @lane={{1}}>
            <Insert @src="shachihoko.webp" @caption="Shachihoko, Nagoya Castle" @credit="photograph" />
          </f.Attach>
        </f.Shot>
        <f.Join @presentation="blend" />
        <f.Shot
          @name="hafu"
          @ticks={{6}}
          @cut={{true}}
          @to={{array 1.59 5.5 -1.59}}
          @dolly={{3.9}}
          @lookY={{-1.4}}
          @ox={{-0.18}}
          @pitch={{1}}
          @yaw={{166}}
        >
          <f.To @dolly={{3.7}} @lookY={{-1.2}} @ox={{-0.18}} @pitch={{4}} @yaw={{174}} />
          <f.Type
            @mode="point"
            @kicker="IN THE ROOF SLOPE"
            @word="千鳥破風"
            @reading="CHIDORI-HAFU"
            @gloss="the plover gable"
            @says={{array "A dormer named for a plover" "Light and air into a deep floor" "And a place to look down from"}}
          />
          <f.Voice
            @line="Chidori-hafu. Named after a plover. Light and air for a deep floor. Also somewhere to stand and look down at you."
            @read={{VO_SECS.hafu}}
          />
          <f.picture.Weather @haze={{0.45}} />
          <f.picture.Build @clock={{4.4}} />
          <f.Trace @pts={{RING_EAVE1}} @wide={{true}} />
        </f.Shot>
        <f.Join @presentation="blend" />
        <f.Shot
          @name="koran"
          @ticks={{4}}
          @cut={{true}}
          @to={{array 0.13 11.3 -1.84}}
          @dolly={{4.2}}
          @lookY={{4.25}}
          @ox={{-0.18}}
          @pitch={{5}}
          @yaw={{176}}
        >
          <f.To @dolly={{4.0}} @lookY={{4.3}} @ox={{-0.18}} @pitch={{8}} @yaw={{184}} />
          <f.Type
            @mode="point"
            @kicker="AROUND THE TOP"
            @word="高欄"
            @reading="KŌRAN"
            @gloss="the balcony rail"
            @says={{array "A rail on a ledge" "Too narrow to walk" "Meant to be seen, not used"}}
          />
          <f.Voice
            @line="Kōran. A rail on a ledge too narrow to walk. Built to be seen, not used."
            @read={{VO_SECS.koran}}
          />
          <f.picture.Weather @theme={{0}} />
          <f.picture.Build @clock={{4.4}} />
          <f.Trace @pts={{RAIL}} @wide={{true}} />
        </f.Shot>
        <f.Join @presentation="blend" />
        <f.Shot
          @name="ishi2"
          @ticks={{5}}
          @cut={{true}}
          @to={{array 2.8 1.6 0.6}}
          @dolly={{3.4}}
          @lookY={{-5.2}}
          @ox={{-0.18}}
          @pitch={{-1}}
          @yaw={{184}}
        >
          <f.To @dolly={{3.2}} @lookY={{-5.0}} @ox={{-0.18}} @pitch={{2}} @yaw={{192}} />
          <f.Type
            @mode="point"
            @kicker="AT THE FOOT"
            @word="扇の勾配"
            @reading="ŌGI-NO-KŌBAI"
            @gloss="the fan’s incline"
            @says={{array "Vertical at the top" "Flaring at the foot" "The shock runs into the hill"}}
          />
          <f.Voice
            @line="Vertical at the top. Flaring at the foot. The shock does not stop at this wall. It runs into the hill."
            @read={{VO_SECS.ishi2}}
          />
          <f.picture.Weather @haze={{0.3}} />
          <f.picture.Sun @az={{250}} @el={{9}} />
          <f.picture.Build @clock={{4.4}} />
          <f.Trace @pts={{BATTER_L}} @wide={{true}} />
          <f.Trace @pts={{BATTER_R}} @wide={{true}} />
        </f.Shot>
        <f.Join @presentation="blend" />
        <f.Shot
          @name="noki"
          @ticks={{6}}
          @cut={{true}}
          @to={{array -0.46 4.98 -3.29}}
          @dolly={{1.9}}
          @lookY={{-1.9}}
          @ox={{-0.12}}
          @pitch={{0}}
          @yaw={{190}}
        >
          <f.To @dolly={{1.6}} @lookY={{-1.2}} @ox={{-0.12}} @pitch={{3}} @yaw={{200}} />
          <f.Type
            @mode="lower"
            @kicker="AND THE REASON FOR ALL OF IT"
            @word="軒"
            @reading="NOKI"
            @gloss="the eave"
            @says={{array "A metre of overhang" "It keeps water off the wall" "Style is drainage, first"}}
          />
          <f.Voice
            @line="Noki. A metre of overhang. Every line you have admired is a way of keeping rain off earth and wood. Wait for weather; the styling explains itself."
            @read={{VO_SECS.noki}}
          />
          <f.picture.Look @grade="wet" />
          <f.picture.Weather @haze={{0.62}} @rain={{1.15}} @wx={{1}} />
          <f.picture.Build @clock={{4.4}} />
          <f.Trace @pts={{RING_EAVE1}} @wide={{true}} />
          <f.Trace @pts={{RING_EAVE2}} />
          <f.Trace @pts={{RING_EAVE3}} />
        </f.Shot>
      </f.Chapter>

      {{! 05 — COMPARISON: the same lens, six answers }}
      <f.Chapter @n="05" @title="COMPARISON" @grade="plate" @lut="plate">
        <f.Shot
          @name="hikaku"
          @ticks={{4}}
          @lead={{2}}
          @dolly={{0.66}}
          @lookY={{1.8}}
          @ox={{0.16}}
          @pitch={{10}}
          @yaw={{206}}
        >
          <f.To @dolly={{0.66}} @lookY={{1.8}} @ox={{0.02}} @pitch={{10}} @yaw={{211}} />
          <f.Type
            @mode="plate"
            @kicker="ONE PROBLEM"
            @word="比較"
            @reading="HIKAKU"
            @gloss="comparison"
            @says={{array "Six towers" "One problem" "Height, from what you have"}}
          />
          <f.Voice
            @line="Six towers. Same lens, same distance. One question. Height, out of whatever you have."
            @read={{VO_SECS.hikaku}}
          />
          <f.picture.Weather @theme={{0}} @haze={{0.12}} @wx={{0}} @wxCut={{true}} />
          <f.picture.Sun @az={{-35}} @el={{58}} />
          <f.Sky
            @az={{-14}}
            @dist={{28}}
            @lines={{array "比較"}}
            @opacity={{0.32}}
            @size={{3.4}}
            @track={{0.2}}
            @y={{11}}
          />
        </f.Shot>
        {{! THE SIX, as a group. What every one of them said — cut to it,
            hold the aim, the same hand, a lower third, weather muted, a
            blend between — is said once here and inherited. A shot that
            says otherwise wins (c-kh's steadier hand, the melt into
            Thailand). Inheritance is resolved when the score compiles:
            every shot still asserts its complete state at run time, so
            the fold rule of exact mode is untouched. }}
        <f.Sequence @name="six" @join="blend" @cut={{true}} @hold={{true}} @bob={{0.85}}>
          <f.Type @mode="lower" />
          <f.sound.Mix @wx={{0}} />
          <f.Shot
            @name="c-jp"
            @ticks={{4}}
            @dolly={{0.64}}
            @lookY={{-3.6}}
            @ox={{-0.2}}
            @pitch={{2}}
            @yaw={{210}}
          >
            <f.To @dolly={{1.05}} @lookY={{4.4}} @ox={{-0.16}} @pitch={{15}} @yaw={{238}} />
            <f.Type
              @kicker="JAPAN"
              @word="天守"
              @reading="TENSHU"
              @gloss="Japan · the keep"
              @says={{array "Timber frame, stone skirt" "Height by stacking roofs"}}
            />
            <f.Voice
              @line="Japan. A timber frame in a stone skirt. Height by stacking roofs."
              @read={{VO_SECS.c_jp}}
            />
            <f.picture.Look @grade="c-jp" />
            <f.picture.Weather @wx={{0}} />
            <f.picture.Build @subject={{0}} />
          </f.Shot>
          <f.Shot
            @name="c-cn"
            @ticks={{5}}
            @dolly={{1.05}}
            @lookY={{4.6}}
            @ox={{-0.16}}
            @pitch={{16}}
            @yaw={{238}}
          >
            <f.To @dolly={{0.689}} @lookY={{-2.8}} @ox={{-0.22}} @pitch={{3}} @yaw={{214}} />
            <f.Type
              @kicker="CHINA"
              @word="寶塔"
              @reading="BǍOTǍ"
              @gloss="China · the pagoda"
              @says={{array "斗栱 — bracket sets" "Eaves far past the wall"}}
            />
            <f.Voice
              @line="China. Tiers round a core, brackets stepping the eaves past the wall. The same timber thinking, pointed up."
              @read={{VO_SECS.c_cn}}
            />
            <f.picture.Look @grade="c-cn" />
            <f.picture.Weather @wx={{3}} />
            <f.picture.Winter @gust={{0.55}} @pack={{1}} />
            <f.picture.Build @subject={{1}} />
          </f.Shot>
          <f.Shot
            @name="c-vn"
            @ticks={{5}}
            @dolly={{1.05}}
            @lookY={{5.2}}
            @ox={{-0.16}}
            @pitch={{15}}
            @yaw={{250}}
          >
            <f.To @dolly={{0.672}} @lookY={{-3.2}} @ox={{-0.22}} @pitch={{2}} @yaw={{276}} />
            <f.Type
              @kicker="VIETNAM"
              @word="佛塔"
              @reading="THÁP"
              @gloss="Vietnam · the tower"
              @says={{array "A masonry body" "A reliquary, not a lookout"}}
            />
            <f.Voice
              @line="Vietnam. A masonry body, thin tiled eaves. You are not meant to climb it. A reliquary that reads as a tower."
              @read={{VO_SECS.c_vn}}
            />
            <f.picture.Look @grade="c-vn" />
            <f.picture.Weather @wx={{0}} />
            <f.picture.Winter @off={{true}} />
            <f.picture.Build @subject={{2}} />
          </f.Shot>
          <f.Join @presentation="melt" />
          <f.Shot
            @name="c-th"
            @ticks={{4}}
            @dolly={{0.754}}
            @lookY={{-5.4}}
            @ox={{-0.22}}
            @pitch={{-6}}
            @yaw={{276}}
          >
            <f.To @dolly={{1.05}} @lookY={{3.6}} @ox={{-0.15}} @pitch={{14}} @yaw={{300}} />
            <f.Type
              @kicker="THAILAND"
              @word="ปรางค์"
              @reading="PRANG"
              @gloss="Thailand · the prang"
              @says={{array "Tapering the whole way" "The shape is a mountain"}}
            />
            <f.Voice
              @line="Thailand. Tapering the whole way up. That shape is not ambition. It is a mountain."
              @read={{VO_SECS.c_th}}
            />
            <f.picture.Look @grade="c-th" />
            <f.picture.Build @subject={{3}} />
          </f.Shot>
          <f.Shot
            @name="c-kh"
            @ticks={{5}}
            @bob={{0.5}}
            @dolly={{0.74}}
            @lookY={{-3.4}}
            @ox={{-0.21}}
            @pitch={{-4}}
            @yaw={{278}}
          >
            <f.To @dolly={{0.8}} @lookY={{-1.6}} @ox={{-0.17}} @pitch={{-1}} @yaw={{326}} />
            <f.Type
              @kicker="CAMBODIA"
              @word="ប្រាសាទ"
              @reading="PRASAT"
              @gloss="Cambodia · the sanctuary"
              @says={{array "Corbelled, never arched" "So it must narrow to close"}}
            />
            <f.Voice
              @line="Cambodia. Corbelled stone, never arched. With no arch, the only way to close a tower is to keep narrowing it."
              @read={{VO_SECS.c_kh}}
            />
            <f.picture.Look @grade="c-kh" />
            <f.picture.Build @subject={{4}} />
          </f.Shot>
          <f.Shot
            @name="c-tr"
            @ticks={{5}}
            @dolly={{1.05}}
            @lookY={{5.6}}
            @ox={{-0.16}}
            @pitch={{17}}
            @yaw={{278}}
          >
            <f.To @dolly={{0.738}} @lookY={{-4.6}} @ox={{-0.22}} @pitch={{1}} @yaw={{306}} />
            <f.Type
              @kicker="TÜRKIYE"
              @word="CAMİ"
              @reading="CAMİ"
              @gloss="Türkiye · the mosque"
              @says={{array "Mass in compression" "A dome on an octagon" "The height goes to the minaret"}}
            />
            <f.Voice
              @line="Türkiye answers backwards. Mass in compression, a dome on an octagon, and the height handed to a minaret."
              @read={{VO_SECS.c_tr}}
            />
            <f.picture.Look @grade="c-tr" />
            <f.picture.Build @subject={{5}} />
          </f.Shot>
        </f.Sequence>
        <f.Join @presentation="blend" />
        <f.Shot
          @name="kaitai"
          @ticks={{10}}
          @cut={{true}}
          @hold="top"
          @dolly={{0.95}}
          @lookY={{1.8}}
          @ox={{-0.04}}
          @pitch={{8}}
          @yaw={{300}}
        >
          <f.To @dolly={{0.4}} @lookY={{-0.6}} @ox={{-0.02}} @pitch={{12}} @yaw={{336}} />
          <f.Type
            @mode="lower"
            @kicker="AND BACK DOWN"
            @word="解体"
            @reading="KAITAI"
            @gloss="in the order it went up"
            @says={{array "Tile, plaster, timber" "Stone last" "A hill with a shape in it" "Enough to see from the fields"}}
            @bare={{true}}
          />
          <f.Voice
            @line="Take it down in the order it went up. Tile, plaster, timber. Stone last — the stone was never the building. It was the ground, raised. What is left is a hill with a shape in it. And the shape is enough to see from the fields."
            @read={{VO_SECS.kaitai}}
          />
          <f.picture.Look @grade="ink" />
          <f.picture.Weather @theme={{0}} @hours={{array 0 1 2 3}} @over={{0.72}} />
          <f.picture.Build @clock={{array 4.4 0}} @settle={{1}} />
        </f.Shot>
      </f.Chapter>
      </f.Spine>

      <f.Attach @to={{f.head}} @lane={{9}}>
        <Gate>
          <span class="cf-gate-vert" aria-hidden="true">天守 — 構造の研究</span>
          <div class="cf-gate-in cf-matter">
            <i class="cf-mg-rule" aria-hidden="true"></i>
            <p class="cf-gate-k">
              <span class="cf-gate-ghost" aria-hidden="true">天守</span>
              <span class="cf-mg-g1">天</span><span class="cf-mg-g2">守</span></p>
            <p class="cf-gate-t cf-mg-mark">TOWERS</p>
            <p class="cf-gate-s cf-mg-sub">A construction study · {{f.runtime}}</p>
            <p class="cf-gate-live">Live composite: a three.js scene, motion graphics and a mixed score, rendered in the browser at the moment of viewing. No video file exists.</p>
            <p class="cf-gate-live-k">Generated with AI · Directed by Chris Tse · 2026</p>
            <span class="cf-mg-seal" aria-hidden="true">普請</span>
            <div class="cf-gate-row cf-mg-row">
              <button type="button" class="cf-go" {{on "click" (fn f.begin true)}}>▶ Begin with sound</button>
              <button type="button" class="cf-go is-quiet" {{on "click" (fn f.begin false)}}>Begin muted</button>
            </div>
          </div>
          <p class="cf-gate-index" aria-hidden="true">
            <span>壱 — CONTEXT</span><span>弐 — HISTORY</span><span>参 — CONSTRUCTION</span><span>肆 — DETAIL</span><span>伍 — COMPARISON</span>
          </p>
        </Gate>
      </f.Attach>

      <f.Attach @to={{f.tail}} @lane={{9}}>
        <EndCard>
          <i class="cf-mg-rule" aria-hidden="true"></i>
          <p class="cf-end-k"><span class="cf-mg-g1">終</span></p>
          <p class="cf-end-t cf-mg-mark">TOWERS</p>
          <p class="cf-end-s cf-mg-sub">A construction study</p>
          <span class="cf-mg-seal" aria-hidden="true">天守</span>
          <p class="cf-mg-credits">
            <span>Picture — rendered live in your browser · no video file</span>
            <span>Made entirely with AI · directed by a human</span>
            <span>Director — Chris Tse</span>
            <span>Motion engine — Choreo by Cardstack</span>
            <span>Scene — threeui · Meng To</span>
            <span>Voice — Calvin · ElevenLabs</span>
          </p>
          <div class="cf-gate-row cf-mg-row">
            <button type="button" class="cf-go" {{on "click" f.restart}}>↺ Watch again</button>
            <button type="button" class="cf-go is-quiet" {{on "click" f.toc}}>☰ Chapters</button>
          </div>
        </EndCard>
      </f.Attach>

      {{! Towers keeps its own floating bar and no rail on the picture }}
      <Player @film={{f}} @rail={{false}} @title="TOWERS" @sub="A construction study · chapters" />
      </:default>
    </Film>

    {{! THE IDENTITY: the ~140 lines of serif, hanko and cue overrides, unchanged }}
  </template>
}
