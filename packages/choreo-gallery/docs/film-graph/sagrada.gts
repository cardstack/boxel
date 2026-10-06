/**
 * SAGRADA FAMÍLIA, AS A GRAPH — a sketch, not a build.
 *
 * The same film as test-app/app/components/sagrada-film.gts on origin/main
 * (29 shots, 5 chapters, one freeze frame, eight stamps, four traces),
 * written in the syntax proposed in "Film as a Graph" (2026-09-03). Every
 * number, line and pose is the film's own; only the shape changed. The
 * spine below was generated from the beat table by tograph.mjs so the
 * translation is mechanical and honest. None of `f.*` exists yet.
 *
 * What to read it for: does a shot with its type, its voice, its air and
 * its subject attached UNDER it read better than a fifty-field row? Do
 * the joins read as edits? Does the door read as a region the film hangs
 * on its head rather than a named block the engine owns?
 */
import Component from '@glimmer/component';
import { Film, Insert, Freeze, Gate, EndCard, Player } from '@cardstack/choreo/film';
import { SagradaPage } from './sagrada-page';

// Unchanged from sagrada-film.gts: the geometry sampled off the model
// (APSE_WALL, NAT_TOWERS, MARY_STAR, JESUS_CROSS, APSE_Z, CRZ, NAT_X), the
// year clock (tAt, CLOCK, T_TODAY), the measured reads (VO_SECS, VO_GAIN),
// and `seat`. What is gone is BEATS and CHAPTERS — they are the template —
// and GRADES, LOOK_FX, LUT_AMOUNT, CITY_GLASS: those are the PAGE's own
// presets and knobs now, declared on <SagradaPage> with its filters.
import * as D from './sagrada-data';
const { APSE_WALL, NAT_TOWERS, MARY_STAR, JESUS_CROSS, APSE_Z, CRZ, NAT_X } = D;
const { tAt, CLOCK, T_TODAY, VO_SECS, VO_GAIN, seat } = D;

export default class SagradaFilm extends Component<{ Args: { embed?: boolean } }> {
  get src() { return `${this.assets}/index.html`; }
  get assets() { return `${window.location.origin}/sagrada`; }
  get seek(): 'cut' | 'exact' { return /[?&]seek=exact\b/.test(window.location.search) ? 'exact' : 'cut'; }

  <template>
    <Film
      @name="sagrada"
      @title="Sagrada Família"
      @seek={{this.seek}}
      {{! the film's own clock: years both ways; the rail becomes a date rule }}
      @clock={{CLOCK}}
      @voGain={{VO_GAIN}}
      @embed={{@embed}}
    >
      {{! THE PICTURE is a component, not fourteen arguments. It draws the
          frame, knows where its files live, seats itself before the door —
          and DECLARES ITS ADJUSTMENTS: Weather, Sun, Winter, Light, Set,
          Build, and one filter, Look — each a typed component the film
          yields as f.picture.* }}
      <:picture>
        <SagradaPage
          @src={{this.src}}
          @assets={{this.assets}}
          @standing={{T_TODAY}}
          @seat={{seat}}
          @rigMid={{6.6}}
          @cityGlass={{0.16}}
          @lutAmount={{0.52}}
        />
      </:picture>

      <:default as |f|>
      {{! THE SPINE. A sequence of chapters; a chapter is a sequence of
          shots; a join is a sibling between two shots and consumes their
          handles. A shot that names no join gets the spine's. Everything
          under a shot is attached to it: it rides the shot's clock and is
          driven, never played. }}
      <f.Spine @join="dip">

      {{! 01 — THE SITE: a field, a cornerstone, one man's forty years }}
      <f.Chapter @n="01" @title="THE SITE" @grade="amber" @lut="sandstone">
        <f.Shot
          @name="title"
          @ticks={{5}}
          @dolly={{0.5}}
          @fx={{0}}
          @fz={{0}}
          @lookY={{-2.4}}
          @ox={{0.28}}
          @pitch={{14}}
          @yaw={{35}}
        >
          <f.To
            @dolly={{0.74}}
            @fx={{0}}
            @fz={{-1}}
            @lookY={{-2.0}}
            @ox={{0.2}}
            @pitch={{14}}
            @yaw={{52}}
          />
          <f.Type
            @mode="title"
            @kicker="A CONSTRUCTION STUDY"
            @word="Obra"
            @reading="THE WORKS"
            @gloss="Barcelona, 19 March 1882"
            @says={{array "A field at the edge of the grid" "One cornerstone" "A plan nobody alive would finish"}}
          />
          <f.Voice
            @line="March, eighteen eighty-two. A field at the edge of the grid, a cornerstone, and a plan nobody alive would finish."
            @read={{VO_SECS.title}}
          />
          <f.picture.Weather @theme={{0}} @wx={{1}} />
          <f.picture.Set @city="glass" @grass={{true}} />
          <f.picture.Build @clock={{tAt 1882.3}} />
          <f.Stamp @year={{1882}} @at={{0.04}} />
          <f.Sky
            @az={{0}}
            @dist={{26}}
            @lines={{array "1882"}}
            @opacity={{0.4}}
            @size={{4.2}}
            @track={{0.12}}
            @y={{7.5}}
          />
        </f.Shot>
        <f.Shot
          @name="crypt"
          @ticks={{5}}
          @cut={{true}}
          @dolly={{2.4}}
          @fx={{0}}
          @fz={{APSE_Z}}
          @lookY={{-5.4}}
          @ox={{0.1}}
          @pitch={{9}}
          @yaw={{205}}
        >
          <f.To
            @dolly={{2.1}}
            @fx={{0}}
            @fz={{APSE_Z}}
            @lookY={{-5.0}}
            @ox={{0.1}}
            @pitch={{11}}
            @yaw={{228}}
          />
          <f.Type
            @mode="lower"
            @kicker="BELOW THE GROUND"
            @word="Cripta"
            @reading="CRYPT"
            @gloss="the crypt, 1882–1889"
            @says={{array "Villar draws a Gothic church" "He quits over the cost" "Gaudí is thirty-one"}}
          />
          <f.Voice
            @line="Villar draws a neo-Gothic church and leaves over the cost of the stone. The man who takes over is thirty-one."
            @read={{VO_SECS.crypt}}
          />
          <f.picture.Weather @wx={{1}} />
          <f.picture.Set @city="off" @grass={{true}} />
          <f.picture.Build @clock={{array (tAt 1882.3) (tAt 1889)}} />
        </f.Shot>
        <f.Shot
          @name="apse"
          @ticks={{6}}
          @follow="apse"
          @to={{array 1.35 3.6 (sub APSE_Z 0.9)}}
          @dolly={{1.5}}
          @fx={{0}}
          @fz={{APSE_Z}}
          @lookY={{-4.6}}
          @ox={{0.12}}
          @pitch={{12}}
          @yaw={{160}}
        >
          <f.To
            @dolly={{1.35}}
            @fx={{0}}
            @fz={{APSE_Z}}
            @lookY={{-3.6}}
            @ox={{0.12}}
            @pitch={{12}}
            @yaw={{176}}
          />
          <f.Type
            @mode="lower"
            @kicker="THE LAST GOTHIC THING"
            @word="Absis"
            @reading="APSE"
            @gloss="the apse, 1891–1895"
            @says={{array "Seven chapels" "Pinnacles like ears of corn" "Gothic, for the last time"}}
          />
          <f.Voice
            @line="The apse. Seven chapels, pinnacles like ears of corn. Gothic, and the last Gothic thing he built."
            @read={{VO_SECS.apse}}
          />
          <f.picture.Weather @theme={{0}} @wx={{0}} />
          <f.picture.Set @city="off" @grass={{true}} />
          <f.picture.Build @clock={{array (tAt 1891) (tAt 1895)}} @by={{0.6}} />
          <f.Trace @pts={{APSE_WALL}} />
        </f.Shot>
        <f.Shot
          @name="nativity"
          @ticks={{8}}
          @follow="nativity"
          @dolly={{1.1}}
          @fx={{NAT_X}}
          @fz={{CRZ}}
          @lookY={{-4.2}}
          @ox={{0.14}}
          @pitch={{6}}
          @yaw={{96}}
        >
          <f.To
            @dolly={{1.0}}
            @fx={{NAT_X}}
            @fz={{CRZ}}
            @lookY={{-2.6}}
            @ox={{0.14}}
            @pitch={{8}}
            @yaw={{82}}
          />
          <f.Type
            @mode="lower"
            @kicker="THE FRONT THAT FACES SUNRISE"
            @word="Naixement"
            @reading="NATIVITY"
            @gloss="the Nativity front, 1894–1930"
            @says={{array "Stone melted into figures" "A cypress full of doves" "Thirty-one years"}}
          />
          <f.Voice
            @line="The Nativity front, facing the sunrise. Stone melted into figures, a cypress full of doves. Thirty-one years of it."
            @read={{VO_SECS.nativity}}
          />
          <f.picture.Weather @haze={{0.18}} @wx={{0}} />
          <f.picture.Set @city="off" />
          <f.picture.Build @clock={{array (tAt 1894) (tAt 1925)}} @by={{0.85}} />
        </f.Shot>
        <f.Join @presentation="blend" />
        <f.Shot
          @name="portal"
          @ticks={{3}}
          @cut={{true}}
          @follow={{false}}
          @to={{array 2.4 2.1 CRZ}}
          @dolly={{4.2}}
          @fx={{2.35}}
          @fz={{CRZ}}
          @lookY={{-5.0}}
          @ox={{0.08}}
          @pitch={{3}}
          @yaw={{88}}
        >
          <f.To
            @dolly={{3.8}}
            @fx={{2.35}}
            @fz={{CRZ}}
            @lookY={{-4.6}}
            @ox={{0.08}}
            @pitch={{5}}
            @yaw={{96}}
          />
          <f.Type
            @mode="point"
            @kicker="THE MIDDLE DOOR"
            @word="Caritat"
            @reading="CHARITY"
            @gloss="the Portal of Charity"
            @says={{array "The cypress, the doves" "The family under it"}}
          />
          <f.picture.Weather @wx={{0}} />
          <f.picture.Set @city="off" />
          <f.picture.Build @clock={{tAt 1931}} />
        </f.Shot>
        <f.Shot
          @name="barnabas"
          @ticks={{6}}
          @cut={{true}}
          @hold={{true}}
          @follow="barnabas"
          @to={{array NAT_X 7.9 (sub CRZ 1.05)}}
          @dolly={{4.5}}
          @fx={{2.05}}
          @fz={{-2.0}}
          @lookY={{0.9}}
          @ox={{-0.1}}
          @pitch={{6}}
          @yaw={{62}}
        >
          <f.To
            @dolly={{4.2}}
            @fx={{2.05}}
            @fz={{-2.0}}
            @lookY={{1.0}}
            @ox={{-0.1}}
            @pitch={{9}}
            @yaw={{74}}
          />
          <f.Type
            @mode="point"
            @kicker="THE ONLY ONE HE SAW"
            @word="Bernabé"
            @reading="BARNABAS"
            @gloss="Saint Barnabas, 1925"
            @says={{array "One tower finished" "Ninety-eight metres" "November 1925"}}
          />
          <f.Voice
            @line="One tower finished. Ninety-eight metres, November nineteen twenty-five. The only one Gaudí ever saw complete."
            @read={{VO_SECS.barnabas}}
          />
          <f.picture.Weather @wx={{1}} />
          <f.picture.Set @city="off" />
          <f.picture.Build @clock={{array (tAt 1912) (tAt 1925.9)}} @by={{0.6}} />
          <f.Stamp @year={{1925}} @at={{0.44}} />
          <f.Trace @pts={{NAT_TOWERS}} />
        </f.Shot>
        <f.Shot
          @name="barnabas-wide"
          @ticks={{3}}
          @cut={{true}}
          @bob={{0.9}}
          @follow={{false}}
          @dolly={{0.55}}
          @fx={{0}}
          @fz={{0}}
          @lookY={{-1.6}}
          @ox={{0.16}}
          @pitch={{11}}
          @yaw={{70}}
        >
          <f.To
            @dolly={{0.48}}
            @fx={{0}}
            @fz={{0}}
            @lookY={{-1.0}}
            @ox={{0.16}}
            @pitch={{17}}
            @yaw={{98}}
          />
          <f.Type @mode="clear" />
          <f.picture.Weather @wx={{1}} />
          <f.picture.Set @city="glass" />
          <f.picture.Build @clock={{tAt 1926}} />
        </f.Shot>
      </f.Chapter>

      {{! 02 — SILENCE: a death, a war, twenty years of plaster }}
      <f.Chapter @n="02" @title="SILENCE" @grade="iron" @lut="iron">
        <f.Join @presentation="dip" @to="#0d0905" />
        <f.Shot
          @name="gaudi"
          @ticks={{6}}
          @lead={{2}}
          @dolly={{0.9}}
          @fx={{1.5}}
          @fz={{-1.5}}
          @lookY={{-3.4}}
          @ox={{0.14}}
          @pitch={{7}}
          @yaw={{122}}
        >
          <f.To
            @dolly={{0.86}}
            @fx={{1.5}}
            @fz={{-1.5}}
            @lookY={{-3.0}}
            @ox={{0.14}}
            @pitch={{9}}
            @yaw={{134}}
          />
          <f.Type
            @mode="plate"
            @kicker="THE ARCHITECT DIES"
            @word="Gaudí"
            @reading="ANTONI GAUDÍ"
            @gloss="10 June 1926"
            @says={{array "A tram on the Gran Via" "Nobody recognises him" "Buried in his own crypt"}}
          />
          <f.Voice
            @line="June nineteen twenty-six. A tram on the Gran Via. Nobody recognises him. Three days later he is buried in his own crypt."
            @read={{VO_SECS.gaudi}}
          />
          <f.picture.Weather @theme={{2}} @wx={{2}} />
          <f.picture.Sun @az={{-100}} @el={{14}} />
          <f.picture.Light @rim={{0.9}} />
          <f.picture.Set @city="glass" />
          <f.picture.Build @clock={{tAt 1926.5}} />
          <f.Stamp @year={{1926}} @at={{0.03}} />
        </f.Shot>
        <f.Join @presentation="dip" @to="#080604" />
        <f.Shot
          @name="war"
          @ticks={{6}}
          @cut={{true}}
          @dolly={{1.1}}
          @fx={{0}}
          @fz={{APSE_Z}}
          @lookY={{-4.0}}
          @ox={{-0.1}}
          @pitch={{6}}
          @yaw={{152}}
        >
          <f.To
            @dolly={{1.0}}
            @fx={{0}}
            @fz={{APSE_Z}}
            @lookY={{-3.4}}
            @ox={{-0.1}}
            @pitch={{8}}
            @yaw={{166}}
          />
          <f.Type
            @mode="lower"
            @kicker="THE CRYPT BURNS"
            @word="Guerra"
            @reading="CIVIL WAR"
            @gloss="the night of 20 July 1936"
            @says={{array "The workshop is torched" "Plans and photographs burn" "The plaster models are smashed"}}
          />
          <f.Voice
            @line="July nineteen thirty-six. The workshop is torched. The plans burn, the photographs burn, and the plaster models are smashed to pieces."
            @read={{VO_SECS.war}}
          />
          <f.picture.Weather @theme={{3}} @wx={{4}} @lightning={{1.4}} />
          <f.picture.Light @rim={{1.2}} />
          <f.picture.Set @city="off" />
          <f.picture.Build @clock={{array (tAt 1936.5) (tAt 1939.2)}} />
          <f.Stamp @year={{1936}} @at={{0.03}} />
        </f.Shot>
        <f.Join @presentation="dip" />
        <f.Shot
          @name="ashes"
          @ticks={{4}}
          @cut={{true}}
          @dolly={{0.9}}
          @fx={{0}}
          @fz={{APSE_Z}}
          @lookY={{-3.2}}
          @ox={{-0.06}}
          @pitch={{6}}
          @yaw={{158}}
        >
          <f.To
            @dolly={{0.72}}
            @fx={{0}}
            @fz={{APSE_Z}}
            @lookY={{-2.6}}
            @ox={{0.04}}
            @pitch={{11}}
            @yaw={{146}}
          />
          <f.Type
            @mode="lower"
            @kicker="WHAT THE FIRE LEFT"
            @word="Cendra"
            @reading="ASHES"
            @gloss="the morning after"
            @says={{array "The rain put it out" "Nothing rises for twelve years"}}
          />
          <f.picture.Look @look="silver" />
          <f.picture.Weather @theme={{0}} @haze={{0.5}} @wx={{3}} />
          <f.picture.Set @city="off" />
          <f.picture.Build @clock={{tAt 1938.4}} />
        </f.Shot>
        <f.Shot
          @name="models"
          @ticks={{5}}
          @lead={{2}}
          @dolly={{0.7}}
          @fx={{0.6}}
          @fz={{-0.6}}
          @lookY={{-2.6}}
          @ox={{0.18}}
          @pitch={{14}}
          @yaw={{40}}
        >
          <f.To
            @dolly={{0.74}}
            @fx={{0.6}}
            @fz={{-0.6}}
            @lookY={{-2.2}}
            @ox={{0.18}}
            @pitch={{14}}
            @yaw={{52}}
          />
          <f.Type
            @mode="plate"
            @kicker="PIECED BACK TOGETHER"
            @word="Models"
            @reading="THE PLASTER MODELS"
            @gloss="1940–1952"
            @says={{array "From the fragments" "From published photographs" "The plan survives the man"}}
          />
          <f.Voice
            @line="For twelve years nothing rises. The models are pieced back together from fragments and photographs. The plan survives the man."
            @read={{VO_SECS.models}}
          />
          <f.picture.Weather @theme={{1}} @wx={{3}} />
          <f.picture.Set @city="glass" />
          <f.picture.Build @clock={{array (tAt 1940) (tAt 1952)}} />
        </f.Shot>
      </f.Chapter>

      {{! 03 — THE LONG BUILD: concrete, cranes, and a consecration }}
      <f.Chapter @n="03" @title="THE LONG BUILD" @grade="chalk" @lut="chalk">
        <f.Shot
          @name="passion"
          @ticks={{6}}
          @lead={{2}}
          @dolly={{1.0}}
          @fx={{neg NAT_X}}
          @fz={{CRZ}}
          @lookY={{-3.6}}
          @ox={{-0.14}}
          @pitch={{5}}
          @yaw={{-96}}
        >
          <f.To
            @dolly={{0.95}}
            @fx={{neg NAT_X}}
            @fz={{CRZ}}
            @lookY={{-2.2}}
            @ox={{-0.14}}
            @pitch={{7}}
            @yaw={{-82}}
          />
          <f.Type
            @mode="lower"
            @kicker="THE OTHER FRONT"
            @word="Passió"
            @reading="PASSION"
            @gloss="the Passion front, 1954–1976"
            @says={{array "Concrete, and the first crane" "Columns like bones" "Four more towers by 1976"}}
          />
          <f.Voice
            @line="Nineteen fifty-four. Concrete, and the first tower crane. The Passion front, bare as bone, and four more towers by seventy-six."
            @read={{VO_SECS.passion}}
          />
          <f.picture.Weather @theme={{1}} @wx={{0}} />
          <f.picture.Sun @az={{-120}} @el={{22}} />
          <f.picture.Set @city="off" />
          <f.picture.Build @clock={{array (tAt 1954) (tAt 1976)}} />
        </f.Shot>
        <f.Join @presentation="blend" />
        <f.Shot
          @name="portico"
          @ticks={{3}}
          @cut={{true}}
          @follow={{false}}
          @to={{array -2.5 1.4 CRZ}}
          @dolly={{4.0}}
          @fx={{-2.35}}
          @fz={{CRZ}}
          @lookY={{-5.2}}
          @ox={{-0.08}}
          @pitch={{3}}
          @yaw={{-88}}
        >
          <f.To
            @dolly={{3.6}}
            @fx={{-2.35}}
            @fz={{CRZ}}
            @lookY={{-4.8}}
            @ox={{-0.08}}
            @pitch={{5}}
            @yaw={{-96}}
          />
          <f.Type
            @mode="point"
            @kicker="COLUMNS LIKE BONES"
            @word="Ossos"
            @reading="THE BONES"
            @gloss="the Passion portico"
            @says={{array "Six columns, leaning" "Tendons for capitals"}}
          />
          <f.picture.Weather @wx={{0}} />
          <f.picture.Set @city="off" />
          <f.picture.Build @clock={{tAt 1978}} />
        </f.Shot>
        <f.Shot
          @name="naves"
          @ticks={{6}}
          @hold={{true}}
          @dolly={{0.85}}
          @fx={{0}}
          @fz={{1.4}}
          @lookY={{-3.2}}
          @ox={{0.14}}
          @pitch={{10}}
          @yaw={{24}}
        >
          <f.To
            @dolly={{0.8}}
            @fx={{0}}
            @fz={{1.0}}
            @lookY={{-2.4}}
            @ox={{0.14}}
            @pitch={{11}}
            @yaw={{46}}
          />
          <f.Type
            @mode="lower"
            @kicker="A FOREST OF COLUMNS"
            @word="Naus"
            @reading="THE NAVES"
            @gloss="the naves, 1978–2010"
            @says={{array "Side naves, then the crossing" "Vaults at forty-five metres" "Consecrated, November 2010"}}
          />
          <f.Voice
            @line="Thirty years for the naves. Side naves, then the crossing, vaults at forty-five metres. Consecrated in November twenty-ten."
            @read={{VO_SECS.naves}}
          />
          <f.picture.Weather @theme={{0}} @wx={{1}} />
          <f.picture.Set @city="glass" />
          <f.picture.Build @clock={{array (tAt 1978) (tAt 2010)}} />
          <f.Stamp @year={{2010}} @at={{0.82}} />
        </f.Shot>
        <f.Join @presentation="blend" />
        <f.Shot
          @name="fruit"
          @ticks={{7}}
          @cut={{true}}
          @to={{array 1.85 3.3 1.6}}
          @dolly={{3.6}}
          @fx={{1.85}}
          @fz={{1.6}}
          @lookY={{-3.3}}
          @ox={{0}}
          @pitch={{6}}
          @yaw={{60}}
        >
          <f.To
            @dolly={{3.1}}
            @fx={{1.85}}
            @fz={{1.6}}
            @lookY={{-3.1}}
            @ox={{-0.08}}
            @pitch={{8}}
            @yaw={{70}}
          />
          <f.Type
            @mode="point"
            @kicker="THE HARVEST ON THE ROOF"
            @word="Fruita"
            @reading="THE FRUIT"
            @gloss="the baskets on the gables"
            @says={{array "Spring fruit on the Nativity side" "Autumn fruit on the Passion side" "Bread and wine on the nave"}}
          />
          <f.Voice
            @line="The gables are crowned with baskets of fruit. Spring and summer on the Nativity side, autumn and winter on the Passion side, and bread and wine over the nave."
            @read={{VO_SECS.fruit}}
          />
          <f.picture.Weather @theme={{1}} @wx={{0}} />
          <f.picture.Set @city="glass" />
          <f.picture.Build @clock={{T_TODAY}} />
        </f.Shot>
        <f.Shot
          @name="fruit-wide"
          @ticks={{3}}
          @cut={{true}}
          @bob={{0.9}}
          @follow={{false}}
          @dolly={{0.55}}
          @fx={{0}}
          @fz={{0}}
          @lookY={{-1.6}}
          @ox={{0.16}}
          @pitch={{11}}
          @yaw={{30}}
        >
          <f.To
            @dolly={{0.48}}
            @fx={{0}}
            @fz={{0}}
            @lookY={{-1.0}}
            @ox={{0.16}}
            @pitch={{17}}
            @yaw={{62}}
          />
          <f.Type @mode="clear" />
          <f.picture.Weather @wx={{0}} />
          <f.picture.Set @city="glass" />
          <f.picture.Build @clock={{T_TODAY}} />
        </f.Shot>
      </f.Chapter>

      {{! 04 — THE TOWERS: the central six, and a hundred years to the day }}
      <f.Chapter @n="04" @title="THE TOWERS" @grade="ink" @lut="ink">
        <f.Shot
          @name="mary"
          @ticks={{8}}
          @lead={{2}}
          @follow="mary"
          @to={{array 0 10.9 APSE_Z}}
          @dolly={{4.2}}
          @fx={{0}}
          @fz={{APSE_Z}}
          @lookY={{3.6}}
          @ox={{-0.12}}
          @pitch={{8}}
          @yaw={{150}}
        >
          <f.To
            @dolly={{4.0}}
            @fx={{0}}
            @fz={{APSE_Z}}
            @lookY={{4.0}}
            @ox={{-0.12}}
            @pitch={{12}}
            @yaw={{166}}
          />
          <f.Type
            @mode="point"
            @kicker="THE SECOND TALLEST"
            @word="Maria"
            @reading="THE VIRGIN MARY"
            @gloss="the tower of Mary, 2016–2021"
            @says={{array "138 metres" "A twelve-pointed star" "Lit on 8 December 2021"}}
          />
          <f.Voice
            @line="The tower of the Virgin Mary. A hundred and thirty-eight metres, a twelve-pointed star, lit for the first time on the eighth of December, twenty twenty-one."
            @read={{VO_SECS.mary}}
          />
          <f.picture.Weather @theme={{1}} @wx={{0}} />
          <f.picture.Light @rim={{1.1}} />
          <f.picture.Set @city="glass" />
          <f.picture.Build @clock={{array (tAt 2016) (tAt 2021.96)}} @by={{0.6}} />
          <f.Stamp @year={{2021}} @at={{0.8}} />
          <f.Trace @pts={{MARY_STAR}} />
        </f.Shot>
        <f.Shot
          @name="mary-wide"
          @ticks={{3}}
          @cut={{true}}
          @bob={{0.9}}
          @follow={{false}}
          @dolly={{0.55}}
          @fx={{0}}
          @fz={{0}}
          @lookY={{-1.6}}
          @ox={{0.16}}
          @pitch={{9}}
          @yaw={{150}}
        >
          <f.To
            @dolly={{0.48}}
            @fx={{0}}
            @fz={{0}}
            @lookY={{-1.0}}
            @ox={{0.16}}
            @pitch={{14}}
            @yaw={{186}}
          />
          <f.Type @mode="clear" />
          <f.picture.Weather @theme={{0}} @wx={{0}} />
          <f.picture.Set @city="glass" />
          <f.picture.Build @clock={{tAt 2022}} />
        </f.Shot>
        <f.Join @presentation="blend" />
        <f.Shot
          @name="evangelists"
          @ticks={{6}}
          @cut={{true}}
          @follow="evang2"
          @dolly={{1.4}}
          @fx={{0}}
          @fz={{CRZ}}
          @lookY={{3.6}}
          @ox={{0.12}}
          @pitch={{9}}
          @yaw={{300}}
        >
          <f.To
            @dolly={{1.3}}
            @fx={{0}}
            @fz={{CRZ}}
            @lookY={{4.2}}
            @ox={{0.12}}
            @pitch={{11}}
            @yaw={{322}}
          />
          <f.Type
            @mode="lower"
            @kicker="FOUR, ROUND THE CENTRE"
            @word="Evangelistes"
            @reading="THE EVANGELISTS"
            @gloss="the Evangelists, 2022–2023"
            @says={{array "Luke and Mark, 2022" "Matthew and John, 2023" "Each crowned with its figure"}}
          />
          <f.Voice
            @line="Four towers round the centre. Luke and Mark in twenty twenty-two, Matthew and John the year after, each crowned with its own figure."
            @read={{VO_SECS.evangelists}}
          />
          <f.picture.Weather @theme={{0}} @wx={{0}} />
          <f.picture.Set @city="glass" />
          <f.picture.Build @clock={{array (tAt 2016) (tAt 2023.9)}} @by={{0.8}} />
          <f.Stamp @year={{2022}} @at={{0.34}} />
        </f.Shot>
        <f.Join @presentation="whip" />
        <f.Shot
          @name="gruistes"
          @ticks={{6}}
          @cut={{true}}
          @dolly={{1.5}}
          @fx={{-1.2}}
          @fz={{calc "CRZ + 2.6"}}
          @lookY={{5.8}}
          @ox={{0.12}}
          @pitch={{4}}
          @yaw={{-20}}
        >
          <f.To
            @dolly={{1.4}}
            @fx={{-1.2}}
            @fz={{calc "CRZ + 2.6"}}
            @lookY={{6.6}}
            @ox={{0.12}}
            @pitch={{6}}
            @yaw={{-8}}
          />
          <f.Type
            @mode="lower"
            @kicker="THE PEOPLE AT THE TOP"
            @word="Gruistes"
            @reading="THE CRANE DRIVERS"
            @gloss="the crane crew, 200 metres up"
            @says={{array "The tallest crane in Spain" "330 tonnes, with a black box" "Three men, every day"}}
          />
          <f.Voice
            @line="Two hundred metres up, the tallest crane in Spain, three hundred and thirty tonnes with a black box. Three men drive it, every day."
            @read={{VO_SECS.gruistes}}
          />
          <f.picture.Weather @theme={{0}} @wx={{1}} />
          <f.picture.Set @city="glass" />
          <f.picture.Build @clock={{tAt 2024.5}} />
          <f.Attach @lane={{2}} @at={{3}} @for={{8}}>
            <Freeze @caption="FREEZE FRAME · 200 M" @credit="the picture, read back and held" @fit="inset" />
          </f.Attach>
        </f.Shot>
        <f.Join @presentation="blend" />
        <f.Shot
          @name="jesus"
          @ticks={{10}}
          @cut={{true}}
          @hold={{true}}
          @follow="jesus"
          @to={{array 0 13.4 CRZ}}
          @dolly={{4.4}}
          @fx={{0}}
          @fz={{CRZ}}
          @lookY={{6.8}}
          @ox={{-0.1}}
          @pitch={{10}}
          @yaw={{36}}
        >
          <f.To
            @dolly={{4.2}}
            @fx={{0}}
            @fz={{CRZ}}
            @lookY={{6.8}}
            @ox={{-0.1}}
            @pitch={{12}}
            @yaw={{54}}
          />
          <f.Type
            @mode="point"
            @kicker="THE TALLEST CHURCH ON EARTH"
            @word="Jesucrist"
            @reading="JESUS CHRIST"
            @gloss="the tower of Jesus, 2016–2026"
            @says={{array "172.5 metres" "17 m of white ceramic and glass" "Lit from the towers round it"}}
          />
          <f.Voice
            @line="And the tower of Jesus Christ. A hundred and seventy-two and a half metres, the tallest church on earth, its cross seventeen metres of white glazed ceramic and glass, lit at night from the towers round it."
            @read={{VO_SECS.jesus}}
          />
          <f.picture.Weather @theme={{1}} @wx={{0}} />
          <f.picture.Set @city="glass" />
          <f.picture.Build @clock={{array (tAt 2016) (tAt 2026.14)}} @by={{0.6}} />
          <f.Trace @pts={{JESUS_CROSS}} @wide={{true}} />
        </f.Shot>
        <f.Shot
          @name="jesus-wide"
          @ticks={{3}}
          @cut={{true}}
          @bob={{0.9}}
          @follow={{false}}
          @dolly={{0.55}}
          @fx={{0}}
          @fz={{0}}
          @lookY={{-1.6}}
          @ox={{0.16}}
          @pitch={{11}}
          @yaw={{20}}
        >
          <f.To
            @dolly={{0.48}}
            @fx={{0}}
            @fz={{0}}
            @lookY={{-1.0}}
            @ox={{0.16}}
            @pitch={{17}}
            @yaw={{52}}
          />
          <f.Type @mode="clear" />
          <f.picture.Look @look="vivid" />
          <f.picture.Weather @wx={{0}} />
          <f.picture.Set @city="glass" />
          <f.picture.Build @clock={{tAt 2026.2}} />
        </f.Shot>
        <f.Shot
          @name="tourist"
          @ticks={{6}}
          @cut={{true}}
          @lift={{0.55}}
          @follow={{false}}
          @dolly={{1}}
          @fx={{0}}
          @fz={{CRZ}}
          @lookY={{-4.9}}
          @ox={{0}}
          @pitch={{8}}
          @yaw={{96}}
        >
          <f.To
            @dolly={{1}}
            @fx={{0}}
            @fz={{CRZ}}
            @lookY={{7.4}}
            @ox={{0}}
            @pitch={{8}}
            @yaw={{96}}
          />
          <f.Eye @from={{array 6.0 0.16 0.6}} @to={{array 4.8 0.16 -0.2}} @fov={{96}} />
          <f.Type
            @mode="point"
            @kicker="LOOK UP"
            @word="Amunt"
            @reading="UP"
            @gloss="up the street, then the head goes back"
            @says={{array "A hundred and seventy-two metres" "From the pavement"}}
          />
          <f.picture.Weather @wx={{0}} />
          <f.picture.Set @city="off" />
          <f.picture.Build @clock={{tAt 2026.2}} />
        </f.Shot>
        <f.Join @presentation="blend" />
        <f.Shot
          @name="aerial"
          @ticks={{8}}
          @cut={{true}}
          @bob={{1.0}}
          @follow={{false}}
          @quality={{2}}
          @dolly={{0.46}}
          @fx={{0}}
          @fz={{0}}
          @lookY={{-0.6}}
          @ox={{0.1}}
          @pitch={{16}}
          @yaw={{20}}
        >
          <f.To
            @dolly={{0.42}}
            @fx={{0}}
            @fz={{0}}
            @lookY={{-0.2}}
            @ox={{0.1}}
            @pitch={{24}}
            @yaw={{112}}
          />
          <f.Type
            @mode="lower"
            @kicker="THE WHOLE OF IT"
            @word="Temple"
            @reading="THE TEMPLE"
            @gloss="the whole of it, at the hour it was built for"
            @says={{array "Eighteen towers planned" "Thirteen standing" "One hundred and forty-four years"}}
          />
          <f.picture.Look @look="vivid" />
          <f.picture.Weather @theme={{2}} @wx={{0}} />
          <f.picture.Set @city="glass" />
          <f.picture.Build @clock={{tAt 2026.3}} />
        </f.Shot>
        <f.Join @presentation="dip" @to="#0d0905" />
        <f.Shot
          @name="centenary"
          @ticks={{6}}
          @cut={{true}}
          @dolly={{0.7}}
          @fx={{0}}
          @fz={{CRZ}}
          @lookY={{0.4}}
          @ox={{0.14}}
          @pitch={{9}}
          @yaw={{60}}
        >
          <f.To
            @dolly={{0.74}}
            @fx={{0}}
            @fz={{CRZ}}
            @lookY={{1.0}}
            @ox={{0.14}}
            @pitch={{11}}
            @yaw={{76}}
          />
          <f.Type
            @mode="plate"
            @kicker="A HUNDRED YEARS TO THE DAY"
            @word="Centenari"
            @reading="THE CENTENARY"
            @gloss="10 June 2026"
            @says={{array "Leo XIV says the mass" "The cross is lit" "Gaudí, a hundred years dead"}}
          />
          <f.Voice
            @line="The tenth of June, twenty twenty-six. A hundred years to the day. The pope says the mass, and the cross is lit."
            @read={{VO_SECS.centenary}}
          />
          <f.picture.Look @look="floodlit" />
          <f.picture.Weather @theme={{3}} @wx={{0}} />
          <f.picture.Light @rim={{1.2}} />
          <f.picture.Set @city="glass" />
          <f.picture.Build @clock={{tAt 2026.6}} />
          <f.Stamp @year={{2026}} @at={{0.22}} />
        </f.Shot>
        <f.Shot
          @name="street"
          @ticks={{5}}
          @cut={{true}}
          @lift={{0.55}}
          @follow={{false}}
          @dolly={{1}}
          @fx={{0}}
          @fz={{CRZ}}
          @lookY={{-4.6}}
          @ox={{0}}
          @pitch={{8}}
          @yaw={{-100}}
        >
          <f.To
            @dolly={{1}}
            @fx={{0}}
            @fz={{CRZ}}
            @lookY={{7.6}}
            @ox={{0}}
            @pitch={{8}}
            @yaw={{-100}}
          />
          <f.Eye @from={{array -5.6 0.14 0.9}} @to={{array -4.4 0.14 0.2}} @fov={{92}} />
          <f.Type @mode="clear" @gloss="the street, that night" />
          <f.picture.Look @look="floodlit" />
          <f.picture.Weather @theme={{3}} @wx={{0}} />
          <f.picture.Light @rim={{1.2}} />
          <f.picture.Set @city="off" />
          <f.picture.Build @clock={{tAt 2026.6}} />
        </f.Shot>
        <f.Join @presentation="blend" />
        <f.Shot
          @name="aerial-night"
          @ticks={{5}}
          @cut={{true}}
          @bob={{1.0}}
          @follow={{false}}
          @quality={{2}}
          @dolly={{0.5}}
          @fx={{0}}
          @fz={{0}}
          @lookY={{-0.8}}
          @ox={{0.1}}
          @pitch={{14}}
          @yaw={{-100}}
        >
          <f.To
            @dolly={{0.46}}
            @fx={{0}}
            @fz={{0}}
            @lookY={{-0.4}}
            @ox={{0.1}}
            @pitch={{21}}
            @yaw={{-22}}
          />
          <f.Type @mode="clear" @gloss="the night it was lit" />
          <f.picture.Look @look="floodlit" />
          <f.picture.Weather @theme={{3}} @wx={{0}} />
          <f.picture.Light @rim={{1.2}} />
          <f.picture.Set @city="glass" />
          <f.picture.Build @clock={{tAt 2026.6}} />
        </f.Shot>
      </f.Chapter>

      {{! 05 — THE PLAN: what the record does not yet contain }}
      <f.Chapter @n="05" @title="THE PLAN" @grade="plate" @lut="plate">
        <f.Shot
          @name="plan"
          @ticks={{6}}
          @lead={{2}}
          @dolly={{0.85}}
          @fx={{0}}
          @fz={{3.2}}
          @lookY={{-1.6}}
          @ox={{-0.12}}
          @pitch={{8}}
          @yaw={{-18}}
        >
          <f.To
            @dolly={{0.9}}
            @fx={{0}}
            @fz={{3.2}}
            @lookY={{-0.4}}
            @ox={{-0.12}}
            @pitch={{10}}
            @yaw={{6}}
          />
          <f.Type
            @mode="lower"
            @kicker="WHAT FOLLOWS IS THE PLAN"
            @word="Glòria"
            @reading="GLORY"
            @gloss="the Glory front, projected"
            @says={{array "A forest of lanterns" "Four more towers" "A stair over the street"}}
          />
          <f.Voice
            @line="What follows is the plan. The Glory front: a forest of lanterns, four more towers, and a stair over the street below."
            @read={{VO_SECS.plan}}
          />
          <f.picture.Weather @theme={{0}} @wx={{1}} />
          <f.picture.Set @city="glass" />
          <f.picture.Build @clock={{array (tAt 2026.8) (tAt 2034.6)}} />
        </f.Shot>
        <f.Join @presentation="blend" />
        <f.Shot
          @name="coda"
          @ticks={{6}}
          @cut={{true}}
          @dolly={{0.5}}
          @fx={{0}}
          @fz={{0}}
          @lookY={{-1.6}}
          @ox={{0.2}}
          @pitch={{10}}
          @yaw={{165}}
        >
          <f.To
            @dolly={{0.48}}
            @fx={{0}}
            @fz={{0}}
            @lookY={{-1.4}}
            @ox={{0.2}}
            @pitch={{13}}
            @yaw={{178}}
          />
          <f.Type
            @mode="title"
            @word="Obra"
            @reading="THE WORKS"
            @gloss="Antoni Gaudí"
            @says={{array "“My client is not in a hurry.”"}}
          />
          <f.picture.Look @look="floodlit" />
          <f.picture.Weather @theme={{3}} @wx={{0}} />
          <f.picture.Sun @az={{-100}} @el={{12}} />
          <f.picture.Light @rim={{1.1}} />
          <f.picture.Set @city="glass" />
          <f.picture.Build @clock={{tAt 2036}} />
          <f.Sky
            @az={{0}}
            @dist={{26}}
            @lines={{array "1882 —"}}
            @opacity={{0.36}}
            @size={{3.6}}
            @track={{0.12}}
            @y={{7.5}}
          />
        </f.Shot>
      </f.Chapter>
      </f.Spine>

      {{! THE DOOR and THE CARD are the film's own regions, hung on the
          head and the tail above everything else. The engine no longer
          owns their shells; it owns two attachment points. }}
      <f.Attach @to={{f.head}} @lane={{9}}>
        <Gate>
          <span class="cf-gate-vert" aria-hidden="true">Temple Expiatori de la Sagrada Família — 1882</span>
          <div class="cf-gate-in cf-matter">
            <i class="cf-mg-rule" aria-hidden="true"></i>
            <p class="cf-gate-k">
              <span class="cf-gate-ghost" aria-hidden="true">1882</span>
              <span class="cf-mg-g1">18</span><span class="cf-mg-g2">82</span></p>
            <p class="cf-gate-t cf-mg-mark">SAGRADA FAMÍLIA</p>
            <p class="cf-gate-s cf-mg-sub">A construction study · {{f.runtime}}</p>
            <span class="cf-mg-seal" aria-hidden="true">Obra</span>
            <div class="cf-gate-row cf-mg-row">
              <button type="button" class="cf-go" {{on "click" (fn f.begin true)}}>▶ Begin with sound</button>
              <button type="button" class="cf-go is-quiet" {{on "click" (fn f.begin false)}}>Begin muted</button>
            </div>
          </div>
          <p class="cf-gate-index" aria-hidden="true">
            {{#each f.chapters as |c|}}<span>{{c.n}} — {{c.title}}</span>{{/each}}
          </p>
        </Gate>
      </f.Attach>

      <f.Attach @to={{f.tail}} @lane={{9}}>
        <EndCard>
          <i class="cf-mg-rule" aria-hidden="true"></i>
          <p class="cf-end-k"><span class="cf-mg-g1">1882<i class="cf-end-dash">—</i></span></p>
          <p class="cf-end-t cf-mg-mark">SAGRADA FAMÍLIA</p>
          <p class="cf-end-s cf-mg-sub">A construction study</p>
          <span class="cf-mg-seal" aria-hidden="true">Obra</span>
          <p class="cf-mg-credits">
            <span>Model built from the published plans</span>
            <span>Record · sagradafamilia.org</span>
            <span>Cut by a score · Choreo</span>
          </p>
          <div class="cf-gate-row cf-mg-row">
            <button type="button" class="cf-go" {{on "click" f.restart}}>↺ Watch again</button>
            <button type="button" class="cf-go is-quiet" {{on "click" f.toc}}>☰ Chapters</button>
          </div>
        </EndCard>
      </f.Attach>

      {{! UI, OFF THE TIMELINE: the transport holds the handle and edits
          the clock. It is not attached to anything and has no window. }}
      <Player @film={{f}} @rail="clock" @title="SAGRADA FAMÍLIA" @sub="A construction study · chapters" />
      </:default>
    </Film>

    {{! THE IDENTITY: the faces, as before; nothing else changes here }}
    <style>
      @import url("https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&display=swap");
    </style>
  </template>
}
