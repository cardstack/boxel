/*! media-chrome 4.19.2 — https://github.com/muxinc/media-chrome
 * SPDX-License-Identifier: MIT · Copyright (c) 2020 Mux, Inc.
 * Full licence text: ./LICENSE (kept alongside this bundle per the MIT notice clause). */
var Wn=Object.defineProperty;var Vo=(t,e)=>{for(var i in e)Wn(t,i,{get:e[i],enumerable:!0})};var Go={};Vo(Go,{AttributeToStateChangeEventMap:()=>ur,AvailabilityStates:()=>J,MediaStateChangeEvents:()=>Pe,MediaStateReceiverAttributes:()=>M,MediaUIAttributes:()=>o,MediaUIEvents:()=>h,MediaUIProps:()=>Bi,PointerTypes:()=>ni,ReadyStates:()=>Gn,StateChangeEventToAttributeMap:()=>Kn,StreamTypes:()=>ae,TextTrackKinds:()=>X,TextTrackModes:()=>Ce,VolumeLevels:()=>qn,WebkitPresentationModes:()=>hr});var h={MEDIA_PLAY_REQUEST:"mediaplayrequest",MEDIA_PAUSE_REQUEST:"mediapauserequest",MEDIA_MUTE_REQUEST:"\
mediamuterequest",MEDIA_UNMUTE_REQUEST:"mediaunmuterequest",MEDIA_LOOP_REQUEST:"medialooprequest",MEDIA_VOLUME_REQUEST:"mediavolumerequest",MEDIA_SEEK_REQUEST:"mediaseekrequest",MEDIA_AIRPLAY_REQUEST:"mediaairplayrequest",MEDIA_ENTER_FULLSCREEN_REQUEST:"mediaenterfullscreenrequest",MEDIA_EXIT_FULLSCREEN_REQUEST:"mediaexitfullscreenrequest",MEDIA_PREVIEW_REQUEST:"mediapreviewrequest",MEDIA_ENTER_PIP_REQUEST:"mediaenterpiprequest",MEDIA_EXIT_PIP_REQUEST:"mediaexitpiprequest",MEDIA_ENTER_CAST_REQUEST:"\
mediaentercastrequest",MEDIA_EXIT_CAST_REQUEST:"mediaexitcastrequest",MEDIA_SHOW_TEXT_TRACKS_REQUEST:"mediashowtexttracksrequest",MEDIA_HIDE_TEXT_TRACKS_REQUEST:"mediahidetexttracksrequest",MEDIA_SHOW_SUBTITLES_REQUEST:"mediashowsubtitlesrequest",MEDIA_DISABLE_SUBTITLES_REQUEST:"mediadisablesubtitlesrequest",MEDIA_TOGGLE_SUBTITLES_REQUEST:"mediatogglesubtitlesrequest",MEDIA_PLAYBACK_RATE_REQUEST:"mediaplaybackraterequest",MEDIA_RENDITION_REQUEST:"mediarenditionrequest",MEDIA_AUDIO_TRACK_REQUEST:"\
mediaaudiotrackrequest",MEDIA_SEEK_TO_LIVE_REQUEST:"mediaseektoliverequest",REGISTER_MEDIA_STATE_RECEIVER:"registermediastatereceiver",UNREGISTER_MEDIA_STATE_RECEIVER:"unregistermediastatereceiver"},M={MEDIA_CHROME_ATTRIBUTES:"mediachromeattributes",MEDIA_CONTROLLER:"mediacontroller"},Bi={MEDIA_AIRPLAY_UNAVAILABLE:"mediaAirplayUnavailable",MEDIA_AUDIO_TRACK_ENABLED:"mediaAudioTrackEnabled",MEDIA_AUDIO_TRACK_LIST:"mediaAudioTrackList",MEDIA_AUDIO_TRACK_UNAVAILABLE:"mediaAudioTrackUnavailable",MEDIA_BUFFERED:"\
mediaBuffered",MEDIA_CAST_UNAVAILABLE:"mediaCastUnavailable",MEDIA_CHAPTERS_CUES:"mediaChaptersCues",MEDIA_CURRENT_TIME:"mediaCurrentTime",MEDIA_DURATION:"mediaDuration",MEDIA_ENDED:"mediaEnded",MEDIA_ERROR:"mediaError",MEDIA_ERROR_CODE:"mediaErrorCode",MEDIA_ERROR_MESSAGE:"mediaErrorMessage",MEDIA_FULLSCREEN_UNAVAILABLE:"mediaFullscreenUnavailable",MEDIA_HAS_PLAYED:"mediaHasPlayed",MEDIA_HEIGHT:"mediaHeight",MEDIA_IS_AIRPLAYING:"mediaIsAirplaying",MEDIA_IS_CASTING:"mediaIsCasting",MEDIA_IS_FULLSCREEN:"\
mediaIsFullscreen",MEDIA_IS_PIP:"mediaIsPip",MEDIA_LOADING:"mediaLoading",MEDIA_MUTED:"mediaMuted",MEDIA_LOOP:"mediaLoop",MEDIA_PAUSED:"mediaPaused",MEDIA_PIP_UNAVAILABLE:"mediaPipUnavailable",MEDIA_PLAYBACK_RATE:"mediaPlaybackRate",MEDIA_PREVIEW_CHAPTER:"mediaPreviewChapter",MEDIA_PREVIEW_COORDS:"mediaPreviewCoords",MEDIA_PREVIEW_IMAGE:"mediaPreviewImage",MEDIA_PREVIEW_TIME:"mediaPreviewTime",MEDIA_RENDITION_LIST:"mediaRenditionList",MEDIA_RENDITION_SELECTED:"mediaRenditionSelected",MEDIA_RENDITION_UNAVAILABLE:"\
mediaRenditionUnavailable",MEDIA_SEEKABLE:"mediaSeekable",MEDIA_STREAM_TYPE:"mediaStreamType",MEDIA_SUBTITLES_LIST:"mediaSubtitlesList",MEDIA_SUBTITLES_SHOWING:"mediaSubtitlesShowing",MEDIA_TARGET_LIVE_WINDOW:"mediaTargetLiveWindow",MEDIA_TIME_IS_LIVE:"mediaTimeIsLive",MEDIA_VOLUME:"mediaVolume",MEDIA_VOLUME_LEVEL:"mediaVolumeLevel",MEDIA_VOLUME_UNAVAILABLE:"mediaVolumeUnavailable",MEDIA_LANG:"mediaLang",MEDIA_WIDTH:"mediaWidth"},Ko=Object.entries(Bi),o=Ko.reduce((t,[e,i])=>(t[e]=i.toLowerCase(),
t),{}),Vn={USER_INACTIVE_CHANGE:"userinactivechange",BREAKPOINTS_CHANGE:"breakpointchange",BREAKPOINTS_COMPUTED:"breakpointscomputed"},Pe=Ko.reduce((t,[e,i])=>(t[e]=i.toLowerCase(),t),{...Vn}),Kn=Object.entries(Pe).reduce((t,[e,i])=>{let a=o[e];return a&&(t[i]=a),t},{userinactivechange:"userinactive"}),ur=Object.entries(o).reduce((t,[e,i])=>{let a=Pe[e];return a&&(t[i]=a),t},{userinactive:"userinactivechange"}),X={SUBTITLES:"subtitles",CAPTIONS:"captions",DESCRIPTIONS:"descriptions",CHAPTERS:"ch\
apters",METADATA:"metadata"},Ce={DISABLED:"disabled",HIDDEN:"hidden",SHOWING:"showing"},Gn={HAVE_NOTHING:0,HAVE_METADATA:1,HAVE_CURRENT_DATA:2,HAVE_FUTURE_DATA:3,HAVE_ENOUGH_DATA:4},ni={MOUSE:"mouse",PEN:"pen",TOUCH:"touch"},J={UNAVAILABLE:"unavailable",UNSUPPORTED:"unsupported"},ae={LIVE:"live",ON_DEMAND:"on-demand",UNKNOWN:"unknown"},qn={HIGH:"high",MEDIUM:"medium",LOW:"low",OFF:"off"},hr={INLINE:"inline",FULLSCREEN:"fullscreen",PICTURE_IN_PICTURE:"picture-in-picture"};var es={};Vo(es,{emptyTimeRanges:()=>jo,formatAsTimePhrase:()=>Ne,formatTime:()=>re,serializeTimeRanges:()=>Xn});function qo(t){return t?.map(Yn).join(" ")}function Yn(t){if(t){let{id:e,width:i,height:a}=t;return[e,i,a].filter(r=>r!=null).join(":")}}function Yo(t){return t?.map(Qn).join(" ")}function Qn(t){if(t){let{id:e,kind:i,language:a,label:r}=t;return[e,i,a,r].filter(s=>s!=null).join(":")}}function ct(t){return typeof t=="number"&&!Number.isNaN(t)&&Number.isFinite(t)}var $i=t=>new Promise(e=>setTimeout(e,t));var Qo={"Start airplay":"Start airplay","Stop airplay":"Stop airplay",Audio:"Audio",Captions:"Captions","Enable captions":"Enable captions","Disable captions":"Disable captions","Start casting":"Start casting","Stop casting":"Stop casting","Enter fullscreen mode":"Enter fullscreen mode","Exit fullscreen mode":"Exit fullscreen mode",Mute:"Mute",Unmute:"Unmute",Loop:"Loop","Enter picture in picture mode":"Enter picture in picture mode","Exit picture in picture mode":"Exit picture in picture mode",
Play:"Play",Pause:"Pause","Playback rate":"Playback rate","Playback rate {playbackRate}":"Playback rate {playbackRate}",Quality:"Quality","Seek backward":"Seek backward","Seek forward":"Seek forward",Settings:"Settings",Auto:"Auto","audio player":"audio player","video player":"video player",volume:"volume",seek:"seek","closed captions":"closed captions","current playback rate":"current playback rate","playback time":"playback time","media loading":"media loading",settings:"settings","audio track\
s":"audio tracks",quality:"quality",play:"play",pause:"pause",mute:"mute",unmute:"unmute","chapter: {chapterName}":"chapter: {chapterName}",live:"live",Off:"Off","start airplay":"start airplay","stop airplay":"stop airplay","start casting":"start casting","stop casting":"stop casting","enter fullscreen mode":"enter fullscreen mode","exit fullscreen mode":"exit fullscreen mode","enter picture in picture mode":"enter picture in picture mode","exit picture in picture mode":"exit picture in picture \
mode","seek to live":"seek to live","playing live":"playing live","seek back {seekOffset} seconds":"seek back {seekOffset} seconds","seek forward {seekOffset} seconds":"seek forward {seekOffset} seconds","Network Error":"Network Error","Decode Error":"Decode Error","Source Not Supported":"Source Not Supported","Encryption Error":"Encryption Error","A network error caused the media download to fail.":"A network error caused the media download to fail.","A media error caused playback to be aborted\
. The media could be corrupt or your browser does not support this format.":"A media error caused playback to be aborted. The media could be corrupt or your browser does not support this format.","An unsupported error occurred. The server or network failed, or your browser does not support this format.":"An unsupported error occurred. The server or network failed, or your browser does not support this format.","The media is encrypted and there are no keys to decrypt it.":"The media is encrypted \
and there are no keys to decrypt it.",hour:"hour",hours:"hours",minute:"minute",minutes:"minutes",second:"second",seconds:"seconds","{time} remaining":"{time} remaining","{currentTime} of {totalTime}":"{currentTime} of {totalTime}","video not loaded, unknown time.":"video not loaded, unknown time."};var zo,li={en:Qo},ut=((zo=globalThis.navigator)==null?void 0:zo.language)||"en",Zo=t=>{ut=t};var zn=t=>{var e,i,a;let[r]=ut.split("-");return((e=li[ut])==null?void 0:e[t])||((i=li[r])==null?void 0:i[t])||((a=li.en)==null?void 0:a[t])||t},Xo=()=>{let[t]=ut.split("-");return li[ut]?ut:li[t]?t:"en"},m=(t,e={})=>zn(t).replace(/\{(\w+)\}/g,(i,a)=>a in e?String(e[a]):`{${a}}`);var Jo=[{singular:"hour",plural:"hours"},{singular:"minute",plural:"minutes"},{singular:"second",plural:"seconds"}],Zn=(t,e)=>{let i=t===1?m(Jo[e].singular):m(Jo[e].plural);return`${t} ${i}`},Ne=t=>{if(!ct(t))return"";let e=Math.abs(t),i=e!==t,a=new Date(0,0,0,0,0,e,0),s=[a.getHours(),a.getMinutes(),a.getSeconds()].map((l,d)=>l&&Zn(l,d)).filter(l=>l).join(", ");return i?m("{time} remaining",{time:s}):s};function re(t,e){let i=!1;t<0&&(i=!0,t=0-t),t=t<0?0:t;let a=Math.floor(t%60),r=Math.floor(t/60%
60),s=Math.floor(t/3600),l=Math.floor(e/60%60),d=Math.floor(e/3600);return(isNaN(t)||t===1/0)&&(s=r=a="0"),s=s>0||d>0?s+":":"",r=((s||l>=10)&&r<10?"0"+r:r)+":",a=a<10?"0"+a:a,(i?"-":"")+s+r+a}var jo=Object.freeze({length:0,start(t){let e=t>>>0;if(e>=this.length)throw new DOMException(`Failed to execute 'start' on 'TimeRanges': The index provided (${e}) is greater than or equal to the maximum bound (${this.length}).`);return 0},end(t){let e=t>>>0;if(e>=this.length)throw new DOMException(`Failed t\
o execute 'end' on 'TimeRanges': The index provided (${e}) is greater than or equal to the maximum bound (${this.length}).`);return 0}});function Xn(t=jo){return Array.from(t).map((e,i)=>[Number(t.start(i).toFixed(3)),Number(t.end(i).toFixed(3))].join(":")).join(" ")}var Wi=class{addEventListener(){}removeEventListener(){}dispatchEvent(){return!0}},Vi=class extends Wi{},Ki=class extends Vi{constructor(){super(...arguments),this.role=null}},mr=class{observe(){}unobserve(){}disconnect(){}},ts={createElement:function(){return new di.HTMLElement},createElementNS:function(){return new di.HTMLElement},addEventListener(){},removeEventListener(){},dispatchEvent(t){return!1}},di={ResizeObserver:mr,document:ts,Node:Vi,Element:Ki,HTMLElement:class extends Ki{constructor(){
super(...arguments),this.innerHTML=""}get content(){return new di.DocumentFragment}},DocumentFragment:class extends Wi{},customElements:{get:function(){},define:function(){},whenDefined:function(){}},localStorage:{getItem(t){return null},setItem(t,e){},removeItem(t){}},CustomEvent:function(){},getComputedStyle:function(){},navigator:{languages:[],get userAgent(){return""}},matchMedia(t){return{matches:!1,media:t}},DOMParser:class{parseFromString(e,i){return{body:{textContent:e}}}}},is="global"in
globalThis&&globalThis?.global===globalThis||typeof window>"u"||typeof window.customElements>"u",as=Object.keys(di).every(t=>t in globalThis),n=is&&!as?di:globalThis,W=is&&!as?ts:globalThis.document;var rs=new WeakMap,pr=t=>{let e=rs.get(t);return e||rs.set(t,e=new Set),e},os=new n.ResizeObserver(t=>{for(let e of t)for(let i of pr(e.target))i(e)});function Gi(t,e){pr(t).add(e),os.observe(t)}function qi(t,e){let i=pr(t);i.delete(e),i.size||os.unobserve(t)}function F(t){let e={};for(let i of t)e[i.name]=i.value;return e}function ss(t){var e;return(e=Jn(t))!=null?e:He(t,"media-controller")}function Jn(t){var e;let{MEDIA_CONTROLLER:i}=M,a=t.getAttribute(i);if(a)return(e=el(t))==null?void 0:e.getElementById(a)}var Yi=(t,e,i=".value")=>{let a=t.querySelector(i);a&&(a.textContent=e)},jn=(t,e)=>{let i=`slot[name="${e}"]`,a=t.shadowRoot.querySelector(i);return a?a.children:[]},Qi=(t,e)=>jn(t,e)[0],_e=(t,e)=>!t||!e?!1:t?.contains(e)?!0:_e(t,e.getRootNode().
host),He=(t,e)=>{if(!t)return null;let i=t.closest(e);return i||He(t.getRootNode().host,e)};function Er(t=document){var e;let i=t?.activeElement;return i?(e=Er(i.shadowRoot))!=null?e:i:null}function el(t){var e;let i=(e=t?.getRootNode)==null?void 0:e.call(t);return i instanceof ShadowRoot||i instanceof Document?i:null}function zi(t,{depth:e=3,checkOpacity:i=!0,checkVisibilityCSS:a=!0}={}){if(t.checkVisibility)return t.checkVisibility({checkOpacity:i,checkVisibilityCSS:a});let r=t;for(;r&&e>0;){let s=getComputedStyle(
r);if(i&&s.opacity==="0"||a&&s.visibility==="hidden"||s.display==="none")return!1;r=r.parentElement,e--}return!0}function ns(t,e,i,a){let r=a.x-i.x,s=a.y-i.y,l=r*r+s*s;if(l===0)return 0;let d=((t-i.x)*r+(e-i.y)*s)/l;return Math.max(0,Math.min(1,d))}function x(t,e){let i=tl(t,a=>a===e);return i||vr(t,e)}function tl(t,e){var i,a;let r;for(r of(i=t.querySelectorAll("style:not([media])"))!=null?i:[]){let s;try{s=(a=r.sheet)==null?void 0:a.cssRules}catch{continue}for(let l of s??[])if(e(l.selectorText))return l}}function vr(t,e){var i,a;let r=(i=t.querySelectorAll("style:not([media])"))!=null?i:[],s=r?.[r.length-1];if(!s?.sheet)return console.warn("Media Chrome: No style sheet found on style tag of",t),{style:{setProperty:()=>{},removeProperty:()=>"",
getPropertyValue:()=>""}};let l=s?.sheet.insertRule(`${e}{}`,s.sheet.cssRules.length);return(a=s.sheet.cssRules)==null?void 0:a[l]}function D(t,e,i=Number.NaN){let a=t.getAttribute(e);return a!=null?+a:i}function U(t,e,i){let a=+i;if(i==null||Number.isNaN(a)){t.hasAttribute(e)&&t.removeAttribute(e);return}D(t,e,void 0)!==a&&t.setAttribute(e,`${a}`)}function _(t,e){return t.hasAttribute(e)}function g(t,e,i){if(i==null){t.hasAttribute(e)&&t.removeAttribute(e);return}_(t,e)!=i&&t.toggleAttribute(e,
i)}function w(t,e,i=null){var a;return(a=t.getAttribute(e))!=null?a:i}function L(t,e,i){if(i==null){t.hasAttribute(e)&&t.removeAttribute(e);return}let a=`${i}`;w(t,e,void 0)!==a&&t.setAttribute(e,a)}var ls=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},de=(t,e,i)=>(ls(t,e,"read from private field"),i?i.call(t):e.get(t)),il=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},Zi=(t,e,i,a)=>(ls(t,e,"write to private field"),a?a.call(t,i):e.set(t,i),i),Q;function al(t){return`
    <style>
      :host {
        display: var(--media-control-display, var(--media-gesture-receiver-display, inline-block));
        box-sizing: border-box;
      }
    </style>
  `}var ht=class extends n.HTMLElement{constructor(){if(super(),il(this,Q,void 0),!this.shadowRoot){this.attachShadow(this.constructor.shadowRootOptions);let e=F(this.attributes);this.shadowRoot.innerHTML=this.constructor.getTemplateHTML(e)}}static get observedAttributes(){return[M.MEDIA_CONTROLLER,o.MEDIA_PAUSED]}attributeChangedCallback(e,i,a){var r,s,l,d,c;e===M.MEDIA_CONTROLLER&&(i&&((s=(r=de(this,Q))==null?void 0:r.unassociateElement)==null||s.call(r,this),Zi(this,Q,null)),a&&this.isConnected&&
(Zi(this,Q,(l=this.getRootNode())==null?void 0:l.getElementById(a)),(c=(d=de(this,Q))==null?void 0:d.associateElement)==null||c.call(d,this)))}connectedCallback(){var e,i;this.tabIndex=-1,this.setAttribute("aria-hidden","true"),Zi(this,Q,rl(this)),this.getAttribute(M.MEDIA_CONTROLLER)&&((i=(e=de(this,Q))==null?void 0:e.associateElement)==null||i.call(e,this)),de(this,Q)&&(de(this,Q).addEventListener("pointerdown",this),de(this,Q).addEventListener("click",this),de(this,Q).hasAttribute("tabindex")||
(de(this,Q).tabIndex=0))}disconnectedCallback(){var e,i,a,r;this.getAttribute(M.MEDIA_CONTROLLER)&&((i=(e=de(this,Q))==null?void 0:e.unassociateElement)==null||i.call(e,this)),(a=de(this,Q))==null||a.removeEventListener("pointerdown",this),(r=de(this,Q))==null||r.removeEventListener("click",this),Zi(this,Q,null)}handleEvent(e){var i;let a=(i=e.composedPath())==null?void 0:i[0];if(["video","media-controller"].includes(a?.localName)){if(e.type==="pointerdown")this._pointerType=e.pointerType;else if(e.
type==="click"){let{clientX:s,clientY:l}=e,{left:d,top:c,width:y,height:S}=this.getBoundingClientRect(),T=s-d,f=l-c;if(T<0||f<0||T>y||f>S||y===0&&S===0)return;let p=this._pointerType||"mouse";if(this._pointerType=void 0,p===ni.TOUCH){this.handleTap(e);return}else if(p===ni.MOUSE||p===ni.PEN){this.handleMouseClick(e);return}}}}get mediaPaused(){return _(this,o.MEDIA_PAUSED)}set mediaPaused(e){g(this,o.MEDIA_PAUSED,e)}handleTap(e){}handleMouseClick(e){let i=this.mediaPaused?h.MEDIA_PLAY_REQUEST:h.
MEDIA_PAUSE_REQUEST;this.dispatchEvent(new n.CustomEvent(i,{composed:!0,bubbles:!0}))}};Q=new WeakMap;ht.shadowRootOptions={mode:"open"};ht.getTemplateHTML=al;function rl(t){var e;let i=t.getAttribute(M.MEDIA_CONTROLLER);return i?(e=t.getRootNode())==null?void 0:e.getElementById(i):He(t,"media-controller")}n.customElements.get("media-gesture-receiver")||n.customElements.define("media-gesture-receiver",ht);var Xi=ht;var br=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},B=(t,e,i)=>(br(t,e,"read from private field"),i?i.call(t):e.get(t)),j=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},ce=(t,e,i,a)=>(br(t,e,"write to private field"),a?a.call(t,i):e.set(t,i),i),ue=(t,e,i)=>(br(t,e,"access private method"),i),ci,ea,mt,vt,Et,fr,pt,Ji,_r,ds,gr,cs,ui,ta,ia,Ar,ft,hi,Fe,ji,b={AUDIO:"audio",AUTOHIDE:"autohide",BREAKPOINTS:"bre\
akpoints",GESTURES_DISABLED:"gesturesdisabled",KEYBOARD_CONTROL:"keyboardcontrol",NO_AUTOHIDE:"noautohide",USER_INACTIVE:"userinactive",AUTOHIDE_OVER_CONTROLS:"autohideovercontrols"};function ol(t){return`
    <style>
      
      :host([${o.MEDIA_IS_FULLSCREEN}]) ::slotted([slot=media]) {
        outline: none;
      }

      :host {
        box-sizing: border-box;
        position: relative;
        display: inline-block;
        line-height: 0;
        background-color: var(--media-background-color, #000);
        overflow: hidden;
      }

      :host(:not([${b.AUDIO}])) [part~=layer]:not([part~=media-layer]) {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        right: 0;
        display: flex;
        flex-flow: column nowrap;
        align-items: start;
        pointer-events: none;
        background: none;
      }

      slot[name=media] {
        display: var(--media-slot-display, contents);
      }

      
      :host([${b.AUDIO}]) slot[name=media] {
        display: var(--media-slot-display, none);
      }

      
      :host([${b.AUDIO}]) [part~=layer][part~=gesture-layer] {
        height: 0;
        display: block;
      }

      
      :host(:not([${b.AUDIO}])[${b.GESTURES_DISABLED}]) ::slotted([slot=gestures-chrome]),
          :host(:not([${b.AUDIO}])[${b.GESTURES_DISABLED}]) media-gesture-receiver[slot=gestures-chrome] {
        display: none;
      }

      
      ::slotted(:not([slot=media]):not([slot=poster]):not(media-loading-indicator):not([role=dialog]):not([hidden])) {
        pointer-events: auto;
      }

      :host(:not([${b.AUDIO}])) *[part~=layer][part~=centered-layer] {
        align-items: center;
        justify-content: center;
      }

      :host(:not([${b.AUDIO}])) ::slotted(media-gesture-receiver[slot=gestures-chrome]),
      :host(:not([${b.AUDIO}])) media-gesture-receiver[slot=gestures-chrome] {
        align-self: stretch;
        flex-grow: 1;
      }

      slot[name=middle-chrome] {
        display: inline;
        flex-grow: 1;
        pointer-events: none;
        background: none;
      }

      
      ::slotted([slot=media]),
      ::slotted([slot=poster]) {
        width: 100%;
        height: 100%;
      }

      
      :host(:not([${b.AUDIO}])) .spacer {
        flex-grow: 1;
      }

      
      :host(:-webkit-full-screen) {
        
        width: 100% !important;
        height: 100% !important;
      }

      
      ::slotted(:not([slot=media]):not([slot=poster]):not([${b.NO_AUTOHIDE}]):not([hidden]):not([role=dialog])) {
        opacity: 1;
        transition: var(--media-control-transition-in, opacity 0.25s);
      }

      
      :host([${b.USER_INACTIVE}]:not([${o.MEDIA_PAUSED}]):not([${o.MEDIA_IS_AIRPLAYING}]):not([${o.MEDIA_IS_CASTING}]):not([${b.AUDIO}])) ::slotted(:not([slot=media]):not([slot=poster]):not([${b.NO_AUTOHIDE}]):not([role=dialog])) {
        opacity: 0;
        transition: var(--media-control-transition-out, opacity 1s);
      }

      :host([${b.USER_INACTIVE}]:not([${b.NO_AUTOHIDE}]):not([${o.MEDIA_PAUSED}]):not([${o.MEDIA_IS_CASTING}]):not([${b.AUDIO}])) ::slotted([slot=media]) {
        cursor: none;
      }

      :host([${b.USER_INACTIVE}][${b.AUTOHIDE_OVER_CONTROLS}]:not([${b.NO_AUTOHIDE}]):not([${o.MEDIA_PAUSED}]):not([${o.MEDIA_IS_CASTING}]):not([${b.AUDIO}])) * {
        --media-cursor: none;
        cursor: none;
      }


      ::slotted(media-control-bar)  {
        align-self: stretch;
      }

      
      :host(:not([${b.AUDIO}])[${o.MEDIA_HAS_PLAYED}]) slot[name=poster] {
        display: none;
      }

      ::slotted([role=dialog]) {
        width: 100%;
        height: 100%;
        align-self: center;
      }

      ::slotted([role=menu]) {
        align-self: end;
      }
    </style>

    <slot name="media" part="layer media-layer"></slot>
    <slot name="poster" part="layer poster-layer"></slot>
    <slot name="gestures-chrome" part="layer gesture-layer">
      <media-gesture-receiver slot="gestures-chrome">
        <template shadowrootmode="${Xi.shadowRootOptions.mode}">
          ${Xi.getTemplateHTML({})}
        </template>
      </media-gesture-receiver>
    </slot>
    <span part="layer vertical-layer">
      <slot name="top-chrome" part="top chrome"></slot>
      <slot name="middle-chrome" part="middle chrome"></slot>
      <slot name="centered-chrome" part="layer centered-layer center centered chrome"></slot>
      
      <slot part="bottom chrome"></slot>
    </span>
    <slot name="dialog" part="layer dialog-layer"></slot>
  `}var sl=Object.values(o),nl="sm:384 md:576 lg:768 xl:960";function ll(t){us(t.target,t.contentRect.width)}function us(t,e){var i;if(!t.isConnected)return;let a=(i=t.getAttribute(b.BREAKPOINTS))!=null?i:nl,r=dl(a),s=cl(r,e),l=!1;if(Object.keys(r).forEach(d=>{if(s.includes(d)){t.hasAttribute(`breakpoint${d}`)||(t.setAttribute(`breakpoint${d}`,""),l=!0);return}t.hasAttribute(`breakpoint${d}`)&&(t.removeAttribute(`breakpoint${d}`),l=!0)}),l){let d=new CustomEvent(Pe.BREAKPOINTS_CHANGE,{detail:s});
t.dispatchEvent(d)}t.breakpointsComputed||(t.breakpointsComputed=!0,t.dispatchEvent(new CustomEvent(Pe.BREAKPOINTS_COMPUTED,{bubbles:!0,composed:!0})))}function dl(t){let e=t.split(/\s+/);return Object.fromEntries(e.map(i=>i.split(":")))}function cl(t,e){return Object.keys(t).filter(i=>e>=parseInt(t[i]))}var Be=class extends n.HTMLElement{constructor(){if(super(),j(this,_r),j(this,gr),j(this,ui),j(this,ia),j(this,ft),j(this,ci,void 0),j(this,ea,0),j(this,mt,null),j(this,vt,null),j(this,Et,void 0),
this.breakpointsComputed=!1,j(this,fr,e=>{let i=this.media;for(let a of e){if(a.type!=="childList")continue;let r=a.removedNodes;for(let s of r){if(s.slot!="media"||a.target!=this)continue;let l=a.previousSibling&&a.previousSibling.previousElementSibling;if(!l||!i)this.mediaUnsetCallback(s);else{let d=l.slot!=="media";for(;(l=l.previousSibling)!==null;)l.slot=="media"&&(d=!1);d&&this.mediaUnsetCallback(s)}}if(i)for(let s of a.addedNodes)s===i&&this.handleMediaUpdated(i)}}),j(this,pt,!1),j(this,Ji,
e=>{B(this,pt)||(setTimeout(()=>{ll(e),ce(this,pt,!1)},0),ce(this,pt,!0))}),j(this,Fe,void 0),j(this,ji,()=>{if(!B(this,Fe).assignedElements({flatten:!0}).length){B(this,mt)&&this.mediaUnsetCallback(B(this,mt));return}this.handleMediaUpdated(this.media)}),!this.shadowRoot){this.attachShadow(this.constructor.shadowRootOptions);let e=F(this.attributes),i=this.constructor.getTemplateHTML(e);this.shadowRoot.setHTMLUnsafe?this.shadowRoot.setHTMLUnsafe(i):this.shadowRoot.innerHTML=i}ce(this,ci,new MutationObserver(
B(this,fr)))}static get observedAttributes(){return[b.AUTOHIDE,b.GESTURES_DISABLED].concat(sl).filter(e=>![o.MEDIA_RENDITION_LIST,o.MEDIA_AUDIO_TRACK_LIST,o.MEDIA_CHAPTERS_CUES,o.MEDIA_WIDTH,o.MEDIA_HEIGHT,o.MEDIA_ERROR,o.MEDIA_ERROR_MESSAGE].includes(e))}attributeChangedCallback(e,i,a){e.toLowerCase()==b.AUTOHIDE&&(this.autohide=a)}get media(){let e=this.querySelector(":scope > [slot=media]");return e?.nodeName=="SLOT"&&(e=e.assignedElements({flatten:!0})[0]),e}async handleMediaUpdated(e){e&&(ce(
this,mt,e),e.localName.includes("-")&&await n.customElements.whenDefined(e.localName),this.mediaSetCallback(e))}connectedCallback(){var e;B(this,ci).observe(this,{childList:!0,subtree:!0}),Gi(this,B(this,Ji));let a=this.getAttribute(b.AUDIO)!=null?m("audio player"):m("video player");this.setAttribute("role","region"),this.setAttribute("aria-label",a),this.handleMediaUpdated(this.media),this.setAttribute(b.USER_INACTIVE,""),us(this,this.getBoundingClientRect().width);let r=this.querySelector(":sc\
ope > slot[slot=media]");r&&(ce(this,Fe,r),B(this,Fe).addEventListener("slotchange",B(this,ji))),this.addEventListener("pointerdown",this),this.addEventListener("pointermove",this),this.addEventListener("pointerup",this),this.addEventListener("mouseleave",this),this.addEventListener("keyup",this),(e=n.window)==null||e.addEventListener("mouseup",this)}disconnectedCallback(){var e;qi(this,B(this,Ji)),clearTimeout(B(this,vt)),B(this,ci).disconnect(),this.media&&this.mediaUnsetCallback(this.media),(e=
n.window)==null||e.removeEventListener("mouseup",this),this.removeEventListener("pointerdown",this),this.removeEventListener("pointermove",this),this.removeEventListener("pointerup",this),this.removeEventListener("mouseleave",this),this.removeEventListener("keyup",this),B(this,Fe)&&(B(this,Fe).removeEventListener("slotchange",B(this,ji)),ce(this,Fe,null)),ce(this,pt,!1)}mediaSetCallback(e){}mediaUnsetCallback(e){ce(this,mt,null)}handleEvent(e){switch(e.type){case"pointerdown":ce(this,ea,e.timeStamp);
break;case"pointermove":ue(this,_r,ds).call(this,e);break;case"pointerup":ue(this,gr,cs).call(this,e);break;case"mouseleave":ue(this,ui,ta).call(this);break;case"mouseup":this.removeAttribute(b.KEYBOARD_CONTROL);break;case"keyup":ue(this,ft,hi).call(this),this.setAttribute(b.KEYBOARD_CONTROL,"");break}}set autohide(e){let i=Number(e);ce(this,Et,isNaN(i)?0:i)}get autohide(){return(B(this,Et)===void 0?2:B(this,Et)).toString()}get breakpoints(){return w(this,b.BREAKPOINTS)}set breakpoints(e){L(this,
b.BREAKPOINTS,e)}get audio(){return _(this,b.AUDIO)}set audio(e){g(this,b.AUDIO,e)}get gesturesDisabled(){return _(this,b.GESTURES_DISABLED)}set gesturesDisabled(e){g(this,b.GESTURES_DISABLED,e)}get keyboardControl(){return _(this,b.KEYBOARD_CONTROL)}set keyboardControl(e){g(this,b.KEYBOARD_CONTROL,e)}get noAutohide(){return _(this,b.NO_AUTOHIDE)}set noAutohide(e){g(this,b.NO_AUTOHIDE,e)}get autohideOverControls(){return _(this,b.AUTOHIDE_OVER_CONTROLS)}set autohideOverControls(e){g(this,b.AUTOHIDE_OVER_CONTROLS,
e)}get userInteractive(){return _(this,b.USER_INACTIVE)}set userInteractive(e){g(this,b.USER_INACTIVE,e)}};ci=new WeakMap;ea=new WeakMap;mt=new WeakMap;vt=new WeakMap;Et=new WeakMap;fr=new WeakMap;pt=new WeakMap;Ji=new WeakMap;_r=new WeakSet;ds=function(t){if(t.pointerType!=="mouse"&&t.timeStamp-B(this,ea)<250)return;ue(this,ia,Ar).call(this),clearTimeout(B(this,vt));let e=this.hasAttribute(b.AUTOHIDE_OVER_CONTROLS);([this,this.media].includes(t.target)||e)&&ue(this,ft,hi).call(this)};gr=new WeakSet;
cs=function(t){if(t.pointerType==="touch"){let e=!this.hasAttribute(b.USER_INACTIVE);[this,this.media].includes(t.target)&&e?ue(this,ui,ta).call(this):ue(this,ft,hi).call(this)}else t.composedPath().some(e=>["media-play-button","media-fullscreen-button"].includes(e?.localName))&&ue(this,ft,hi).call(this)};ui=new WeakSet;ta=function(){if(B(this,Et)<0||this.hasAttribute(b.USER_INACTIVE))return;this.setAttribute(b.USER_INACTIVE,"");let t=new n.CustomEvent(Pe.USER_INACTIVE_CHANGE,{composed:!0,bubbles:!0,
detail:!0});this.dispatchEvent(t)};ia=new WeakSet;Ar=function(){if(!this.hasAttribute(b.USER_INACTIVE))return;this.removeAttribute(b.USER_INACTIVE);let t=new n.CustomEvent(Pe.USER_INACTIVE_CHANGE,{composed:!0,bubbles:!0,detail:!1});this.dispatchEvent(t)};ft=new WeakSet;hi=function(){ue(this,ia,Ar).call(this),clearTimeout(B(this,vt));let t=parseInt(this.autohide);t<0||ce(this,vt,setTimeout(()=>{ue(this,ui,ta).call(this)},t*1e3))};Fe=new WeakMap;ji=new WeakMap;Be.shadowRootOptions={mode:"open"};Be.
getTemplateHTML=ol;n.customElements.get("media-container")||n.customElements.define("media-container",Be);var ul=Be;var hs=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},q=(t,e,i)=>(hs(t,e,"read from private field"),i?i.call(t):e.get(t)),mi=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},aa=(t,e,i,a)=>(hs(t,e,"write to private field"),a?a.call(t,i):e.set(t,i),i),_t,gt,ra,Xe,Oe,$e,bt=class{constructor(e,i,{defaultValue:a}={defaultValue:void 0}){mi(this,Oe),mi(this,_t,void 0),mi(this,gt,void 0),mi(this,ra,void 0),mi(this,
Xe,new Set),aa(this,_t,e),aa(this,gt,i),aa(this,ra,new Set(a))}[Symbol.iterator](){return q(this,Oe,$e).values()}get length(){return q(this,Oe,$e).size}get value(){var e;return(e=[...q(this,Oe,$e)].join(" "))!=null?e:""}set value(e){var i;e!==this.value&&(aa(this,Xe,new Set),this.add(...(i=e?.split(" "))!=null?i:[]))}toString(){return this.value}item(e){return[...q(this,Oe,$e)][e]}values(){return q(this,Oe,$e).values()}forEach(e,i){q(this,Oe,$e).forEach(e,i)}add(...e){var i,a;e.forEach(r=>q(this,
Xe).add(r)),!(this.value===""&&!((i=q(this,_t))!=null&&i.hasAttribute(`${q(this,gt)}`)))&&((a=q(this,_t))==null||a.setAttribute(`${q(this,gt)}`,`${this.value}`))}remove(...e){var i;e.forEach(a=>q(this,Xe).delete(a)),(i=q(this,_t))==null||i.setAttribute(`${q(this,gt)}`,`${this.value}`)}contains(e){return q(this,Oe,$e).has(e)}toggle(e,i){return typeof i<"u"?i?(this.add(e),!0):(this.remove(e),!1):this.contains(e)?(this.remove(e),!1):(this.add(e),!0)}replace(e,i){return this.remove(e),this.add(i),e===
i}};_t=new WeakMap;gt=new WeakMap;ra=new WeakMap;Xe=new WeakMap;Oe=new WeakSet;$e=function(){return q(this,Xe).size?q(this,Xe):q(this,ra)};var hl=(t="")=>t.split(/\s+/),ms=(t="")=>{let[e,i,a]=t.split(":"),r=a?decodeURIComponent(a):void 0;return{kind:e==="cc"?X.CAPTIONS:X.SUBTITLES,language:i,label:r}},Tr=(t="",e={})=>hl(t).map(i=>{let a=ms(i);return{...e,...a}}),Ir=t=>t?Array.isArray(t)?t.map(e=>typeof e=="string"?ms(e):e):typeof t=="string"?Tr(t):[t]:[],ml=({kind:t,label:e,language:i}={kind:"subtitles"})=>e?`${t==="captions"?"cc":"sb"}:${i}:${encodeURIComponent(e)}`:i,pi=(t=[])=>Array.prototype.map.call(t,ml).join(" "),pl=(t,e)=>i=>i[t]===
e,ps=t=>{let e=Object.entries(t).map(([i,a])=>pl(i,a));return i=>e.every(a=>a(i))},Je=(t,e=[],i=[])=>{let a=Ir(i).map(ps),r=s=>a.some(l=>l(s));Array.from(e).filter(r).forEach(s=>{s.mode=t})},je=(t,e=()=>!0)=>{if(!t?.textTracks)return[];let i=typeof e=="function"?e:ps(e);return Array.from(t.textTracks).filter(i)},Es=t=>{var e;return!!((e=t.mediaSubtitlesShowing)!=null&&e.length)||t.hasAttribute(o.MEDIA_SUBTITLES_SHOWING)};var fs=t=>{var e;let{media:i,fullscreenElement:a}=t;try{let r=a&&"requestFullscreen"in a?"requestFullscreen":a&&"webkitRequestFullScreen"in a?"webkitRequestFullScreen":void 0;if(r){let s=(e=a[r])==null?void 0:e.call(a);if(s instanceof Promise)return s.catch(()=>{})}else i?.webkitEnterFullscreen?i.webkitEnterFullscreen():i?.requestFullscreen&&i.requestFullscreen()}catch(r){console.error(r)}},vs="exitFullscreen"in W?"exitFullscreen":"webkitExitFullscreen"in W?"webkitExitFullscreen":"webkitCancelFu\
llScreen"in W?"webkitCancelFullScreen":void 0,_s=t=>{var e;let{documentElement:i}=t;if(vs){let a=(e=i?.[vs])==null?void 0:e.call(i);if(a instanceof Promise)return a.catch(()=>{})}},Ei="fullscreenElement"in W?"fullscreenElement":"webkitFullscreenElement"in W?"webkitFullscreenElement":void 0,El=t=>{let{documentElement:e,media:i}=t,a=e?.[Ei];return!a&&"webkitDisplayingFullscreen"in i&&"webkitPresentationMode"in i&&i.webkitDisplayingFullscreen&&i.webkitPresentationMode===hr.FULLSCREEN?i:a},gs=t=>{var e;
let{media:i,documentElement:a,fullscreenElement:r=i}=t;if(!i||!a)return!1;let s=El(t);if(!s)return!1;if(s===r||s===i)return!0;if(s.localName.includes("-")){let l=s.shadowRoot;if(!(Ei in l))return _e(s,r);for(;l?.[Ei];){if(l[Ei]===r)return!0;l=(e=l[Ei])==null?void 0:e.shadowRoot}}return!1},vl="fullscreenEnabled"in W?"fullscreenEnabled":"webkitFullscreenEnabled"in W?"webkitFullscreenEnabled":void 0,bs=t=>{let{documentElement:e,media:i}=t;return!!e?.[vl]||i&&"webkitSupportsFullscreen"in i};var oa,Sr=()=>{var t,e;return oa||(oa=(e=(t=W)==null?void 0:t.createElement)==null?void 0:e.call(t,"video"),oa)},As=async(t=Sr())=>{if(!t)return!1;let e=t.volume;t.volume=e/2+.1;let i=new AbortController,a=await Promise.race([fl(t,i.signal),_l(t,e)]);return i.abort(),a},fl=(t,e)=>new Promise(i=>{t.addEventListener("volumechange",()=>i(!0),{signal:e})}),_l=async(t,e)=>{for(let i=0;i<10;i++){if(t.volume===e)return!1;await $i(10)}return t.volume!==e},gl=/.*Version\/.*Safari\/.*/.test(n.navigator.userAgent),
Mr=(t=Sr())=>n.matchMedia("(display-mode: standalone)").matches&&gl?!1:typeof t?.requestPictureInPicture=="function",yr=(t=Sr())=>bs({documentElement:W,media:t}),Ts=yr(),Is=Mr(),Ss=!!n.WebKitPlaybackTargetAvailabilityEvent,Ms=!!n.chrome;var At=t=>je(t.media,e=>[X.SUBTITLES,X.CAPTIONS].includes(e.kind)).sort((e,i)=>e.kind>=i.kind?1:-1),kr=t=>je(t.media,e=>e.mode===Ce.SHOWING&&[X.SUBTITLES,X.CAPTIONS].includes(e.kind)),sa=(t,e)=>{let i=At(t),a=kr(t),r=!!a.length;if(i.length){if(e===!1||r&&e!==!0)Je(Ce.DISABLED,i,a);else if(e===!0||!r&&e!==!1){let s=i[0],{options:l}=t;if(!l?.noSubtitlesLangPref){let S=n.localStorage.getItem("media-chrome-pref-subtitles-lang"),T=S?[S,...n.navigator.languages]:n.navigator.languages,f=i.filter(p=>T.some(
A=>p.language.toLowerCase().startsWith(A.split("-")[0]))).sort((p,A)=>{let v=T.findIndex(I=>p.language.toLowerCase().startsWith(I.split("-")[0])),k=T.findIndex(I=>A.language.toLowerCase().startsWith(I.split("-")[0]));return v-k});f[0]&&(s=f[0])}let{language:d,label:c,kind:y}=s;Je(Ce.DISABLED,i,a),Je(Ce.SHOWING,i,[{language:d,label:c,kind:y}])}}},na=(t,e)=>t===e?!0:t==null||e==null||typeof t!=typeof e?!1:typeof t=="number"&&Number.isNaN(t)&&Number.isNaN(e)?!0:typeof t!="object"?!1:Array.isArray(t)?
bl(t,e):Object.entries(t).every(([i,a])=>i in e&&na(a,e[i])),bl=(t,e)=>{let i=Array.isArray(t),a=Array.isArray(e);return i!==a?!1:i||a?t.length!==e.length?!1:t.every((r,s)=>na(r,e[s])):!0};var Al=Object.values(ae),la,Tl=As().then(t=>(la=t,la)),ys=async(...t)=>{await Promise.all(t.filter(e=>e).map(async e=>{if(!("localName"in e&&e instanceof n.HTMLElement))return;let i=e.localName;if(!i.includes("-"))return;let a=n.customElements.get(i);a&&e instanceof a||(await n.customElements.whenDefined(i),n.customElements.upgrade(e))}))},Il=new n.DOMParser,Sl=t=>t&&(Il.parseFromString(t,"text/html").body.textContent||t),Tt={mediaError:{get(t,e){let{media:i}=t;if(e?.type!=="playing")return i?.error},
mediaEvents:["emptied","error","playing"]},mediaErrorCode:{get(t,e){var i;let{media:a}=t;if(e?.type!=="playing")return(i=a?.error)==null?void 0:i.code},mediaEvents:["emptied","error","playing"]},mediaErrorMessage:{get(t,e){var i,a;let{media:r}=t;if(e?.type!=="playing")return(a=(i=r?.error)==null?void 0:i.message)!=null?a:""},mediaEvents:["emptied","error","playing"]},mediaWidth:{get(t){var e;let{media:i}=t;return(e=i?.videoWidth)!=null?e:0},mediaEvents:["resize"]},mediaHeight:{get(t){var e;let{media:i}=t;
return(e=i?.videoHeight)!=null?e:0},mediaEvents:["resize"]},mediaPaused:{get(t){var e;let{media:i}=t;return(e=i?.paused)!=null?e:!0},set(t,e){var i;let{media:a}=e;a&&(t?a.pause():(i=a.play())==null||i.catch(()=>{}))},mediaEvents:["play","playing","pause","emptied"]},mediaHasPlayed:{get(t,e){let{media:i}=t;return i?e?e.type==="playing":!i.paused:!1},mediaEvents:["playing","emptied"]},mediaEnded:{get(t){var e;let{media:i}=t;return(e=i?.ended)!=null?e:!1},mediaEvents:["seeked","ended","emptied"]},mediaPlaybackRate:{
get(t){var e;let{media:i}=t;return(e=i?.playbackRate)!=null?e:1},set(t,e){let{media:i}=e;i&&Number.isFinite(+t)&&(i.playbackRate=+t)},mediaEvents:["ratechange","loadstart"]},mediaMuted:{get(t){var e;let{media:i}=t;return(e=i?.muted)!=null?e:!1},set(t,e){let{media:i,options:{noMutedPref:a}={}}=e;if(i){i.muted=t;try{let r=n.localStorage.getItem("media-chrome-pref-muted")!==null,s=i.hasAttribute("muted");if(a){r&&n.localStorage.removeItem("media-chrome-pref-muted");return}if(s&&!r)return;n.localStorage.
setItem("media-chrome-pref-muted",t?"true":"false")}catch(r){console.debug("Error setting muted pref",r)}}},mediaEvents:["volumechange"],stateOwnersUpdateHandlers:[(t,e)=>{let{options:{noMutedPref:i}}=e,{media:a}=e;if(!(!a||a.muted||i))try{let r=n.localStorage.getItem("media-chrome-pref-muted")==="true";Tt.mediaMuted.set(r,e),t(r)}catch(r){console.debug("Error getting muted pref",r)}}]},mediaLoop:{get(t){let{media:e}=t;return e?.loop},set(t,e){let{media:i}=e;i&&(i.loop=t)},mediaEvents:["medialoo\
prequest"]},mediaVolume:{get(t){var e;let{media:i}=t;return(e=i?.volume)!=null?e:1},set(t,e){let{media:i,options:{noVolumePref:a}={}}=e;if(i){try{t==null?n.localStorage.removeItem("media-chrome-pref-volume"):!i.hasAttribute("muted")&&!a&&n.localStorage.setItem("media-chrome-pref-volume",t.toString())}catch(r){console.debug("Error setting volume pref",r)}Number.isFinite(+t)&&(i.volume=+t)}},mediaEvents:["volumechange"],stateOwnersUpdateHandlers:[(t,e)=>{let{options:{noVolumePref:i}}=e;if(!i)try{let{
media:a}=e;if(!a)return;let r=n.localStorage.getItem("media-chrome-pref-volume");if(r==null)return;Tt.mediaVolume.set(+r,e),t(+r)}catch(a){console.debug("Error getting volume pref",a)}}]},mediaVolumeLevel:{get(t){let{media:e}=t;return typeof e?.volume>"u"?"high":e.muted||e.volume===0?"off":e.volume<.5?"low":e.volume<.75?"medium":"high"},mediaEvents:["volumechange"]},mediaCurrentTime:{get(t){var e;let{media:i}=t;return(e=i?.currentTime)!=null?e:0},set(t,e){let{media:i}=e;!i||!ct(t)||(i.currentTime=
t)},mediaEvents:["timeupdate","loadedmetadata"]},mediaDuration:{get(t){let{media:e,options:{defaultDuration:i}={}}=t;return i&&(!e||!e.duration||Number.isNaN(e.duration)||!Number.isFinite(e.duration))?i:Number.isFinite(e?.duration)?e.duration:Number.NaN},mediaEvents:["durationchange","loadedmetadata","emptied"]},mediaLoading:{get(t){let{media:e}=t;return e?.readyState<3},mediaEvents:["waiting","playing","emptied"]},mediaSeekable:{get(t){var e;let{media:i}=t;if(!((e=i?.seekable)!=null&&e.length))
return;let a=i.seekable.start(0),r=i.seekable.end(i.seekable.length-1);if(!(!a&&!r))return[Number(a.toFixed(3)),Number(r.toFixed(3))]},mediaEvents:["loadedmetadata","emptied","progress","seekablechange"]},mediaBuffered:{get(t){var e;let{media:i}=t,a=(e=i?.buffered)!=null?e:[];return Array.from(a).map((r,s)=>[Number(a.start(s).toFixed(3)),Number(a.end(s).toFixed(3))])},mediaEvents:["progress","emptied"]},mediaStreamType:{get(t){let{media:e,options:{defaultStreamType:i}={}}=t,a=[ae.LIVE,ae.ON_DEMAND].
includes(i)?i:void 0;if(!e)return a;let{streamType:r}=e;if(Al.includes(r))return r===ae.UNKNOWN?a:r;let s=e.duration;return s===1/0?ae.LIVE:Number.isFinite(s)?ae.ON_DEMAND:a},mediaEvents:["emptied","durationchange","loadedmetadata","streamtypechange"]},mediaTargetLiveWindow:{get(t){let{media:e}=t;if(!e)return Number.NaN;let{targetLiveWindow:i}=e,a=Tt.mediaStreamType.get(t);return(i==null||Number.isNaN(i))&&a===ae.LIVE?0:i},mediaEvents:["emptied","durationchange","loadedmetadata","streamtypechang\
e","targetlivewindowchange"]},mediaTimeIsLive:{get(t){let{media:e,options:{liveEdgeOffset:i=10}={}}=t;if(!e)return!1;if(typeof e.liveEdgeStart=="number")return Number.isNaN(e.liveEdgeStart)?!1:e.currentTime>=e.liveEdgeStart;if(!(Tt.mediaStreamType.get(t)===ae.LIVE))return!1;let r=e.seekable;if(!r)return!0;if(!r.length)return!1;let s=r.end(r.length-1)-i;return e.currentTime>=s},mediaEvents:["playing","timeupdate","progress","waiting","emptied"]},mediaSubtitlesList:{get(t){return At(t).map(({kind:e,
label:i,language:a})=>({kind:e,label:i,language:a}))},mediaEvents:["loadstart"],textTracksEvents:["addtrack","removetrack"]},mediaSubtitlesShowing:{get(t){return kr(t).map(({kind:e,label:i,language:a})=>({kind:e,label:i,language:a}))},mediaEvents:["loadstart"],textTracksEvents:["addtrack","removetrack","change"],stateOwnersUpdateHandlers:[(t,e)=>{var i,a;let{media:r,options:s}=e;if(!r)return;let l=d=>{var c;!s.defaultSubtitles||d&&![X.CAPTIONS,X.SUBTITLES].includes((c=d?.track)==null?void 0:c.kind)||
sa(e,!0)};return r.addEventListener("loadstart",l),(i=r.textTracks)==null||i.addEventListener("addtrack",l),(a=r.textTracks)==null||a.addEventListener("removetrack",l),()=>{var d,c;r.removeEventListener("loadstart",l),(d=r.textTracks)==null||d.removeEventListener("addtrack",l),(c=r.textTracks)==null||c.removeEventListener("removetrack",l)}}]},mediaChaptersCues:{get(t){var e;let{media:i}=t;if(!i)return[];let[a]=je(i,{kind:X.CHAPTERS});return Array.from((e=a?.cues)!=null?e:[]).map(({text:r,startTime:s,
endTime:l})=>({text:Sl(r),startTime:s,endTime:l}))},mediaEvents:["loadstart","loadedmetadata"],textTracksEvents:["addtrack","removetrack","change"],stateOwnersUpdateHandlers:[(t,e)=>{var i;let{media:a}=e;if(!a)return;let r=a.querySelector('track[kind="chapters"][default][src]'),s=(i=a.shadowRoot)==null?void 0:i.querySelector(':is(video,audio) > track[kind="chapters"][default][src]');return r?.addEventListener("load",t),s?.addEventListener("load",t),()=>{r?.removeEventListener("load",t),s?.removeEventListener(
"load",t)}}]},mediaIsPip:{get(t){var e,i;let{media:a,documentElement:r}=t;if(!a||!r||!r.pictureInPictureElement)return!1;if(r.pictureInPictureElement===a)return!0;if(r.pictureInPictureElement instanceof HTMLMediaElement)return(e=a.localName)!=null&&e.includes("-")?_e(a,r.pictureInPictureElement):!1;if(r.pictureInPictureElement.localName.includes("-")){let s=r.pictureInPictureElement.shadowRoot;for(;s?.pictureInPictureElement;){if(s.pictureInPictureElement===a)return!0;s=(i=s.pictureInPictureElement)==
null?void 0:i.shadowRoot}}return!1},set(t,e){let{media:i}=e;if(i)if(t){if(!W.pictureInPictureEnabled){console.warn("MediaChrome: Picture-in-picture is not enabled");return}if(!i.requestPictureInPicture){console.warn("MediaChrome: The current media does not support picture-in-picture");return}let a=()=>{console.warn("MediaChrome: The media is not ready for picture-in-picture. It must have a readyState > 0.")};i.requestPictureInPicture().catch(r=>{if(r.code===11){if(!i.src){console.warn("MediaChro\
me: The media is not ready for picture-in-picture. It must have a src set.");return}if(i.readyState===0&&i.preload==="none"){let s=()=>{i.removeEventListener("loadedmetadata",l),i.preload="none"},l=()=>{i.requestPictureInPicture().catch(a),s()};i.addEventListener("loadedmetadata",l),i.preload="metadata",setTimeout(()=>{i.readyState===0&&a(),s()},1e3)}else throw r}else throw r})}else W.pictureInPictureElement&&W.exitPictureInPicture()},mediaEvents:["enterpictureinpicture","leavepictureinpicture"]},
mediaRenditionList:{get(t){var e;let{media:i}=t;return[...(e=i?.videoRenditions)!=null?e:[]].map(a=>({...a}))},mediaEvents:["emptied","loadstart"],videoRenditionsEvents:["addrendition","removerendition"]},mediaRenditionSelected:{get(t){var e,i,a;let{media:r}=t;return(a=(i=r?.videoRenditions)==null?void 0:i[(e=r.videoRenditions)==null?void 0:e.selectedIndex])==null?void 0:a.id},set(t,e){let{media:i}=e;if(!i?.videoRenditions){console.warn("MediaController: Rendition selection not supported by this\
 media.");return}let a=t,r=Array.prototype.findIndex.call(i.videoRenditions,s=>s.id==a);i.videoRenditions.selectedIndex!=r&&(i.videoRenditions.selectedIndex=r)},mediaEvents:["emptied"],videoRenditionsEvents:["addrendition","removerendition","change"]},mediaAudioTrackList:{get(t){var e;let{media:i}=t;return[...(e=i?.audioTracks)!=null?e:[]]},mediaEvents:["emptied","loadstart"],audioTracksEvents:["addtrack","removetrack"]},mediaAudioTrackEnabled:{get(t){var e,i;let{media:a}=t;return(i=[...(e=a?.audioTracks)!=
null?e:[]].find(r=>r.enabled))==null?void 0:i.id},set(t,e){let{media:i}=e;if(!i?.audioTracks){console.warn("MediaChrome: Audio track selection not supported by this media.");return}let a=t;for(let r of i.audioTracks)r.enabled=a==r.id},mediaEvents:["emptied"],audioTracksEvents:["addtrack","removetrack","change"]},mediaIsFullscreen:{get(t){return gs(t)},set(t,e,i){var a,r;t?(fs(e),i.detail&&!((a=e.media)!=null&&a.inert)&&((r=e.media)==null||r.focus())):_s(e)},rootEvents:["fullscreenchange","webkit\
fullscreenchange"],mediaEvents:["webkitbeginfullscreen","webkitendfullscreen","webkitpresentationmodechanged"]},mediaIsCasting:{get(t){var e;let{media:i}=t;return!i?.remote||((e=i.remote)==null?void 0:e.state)==="disconnected"?!1:i.remote.state==="connected"},set(t,e){var i,a;let{media:r}=e;if(r&&!(t&&((i=r.remote)==null?void 0:i.state)!=="disconnected")&&!(!t&&((a=r.remote)==null?void 0:a.state)!=="connected")){if(typeof r.remote.prompt!="function"){console.warn("MediaChrome: Casting is not sup\
ported in this environment");return}r.remote.prompt().catch(()=>{})}},remoteEvents:["connect","connecting","disconnect"]},mediaIsAirplaying:{get(){return!1},set(t,e){let{media:i}=e;if(i){if(!(i.webkitShowPlaybackTargetPicker&&n.WebKitPlaybackTargetAvailabilityEvent)){console.error("MediaChrome: received a request to select AirPlay but AirPlay is not supported in this environment");return}i.webkitShowPlaybackTargetPicker()}},mediaEvents:["webkitcurrentplaybacktargetiswirelesschanged"]},mediaFullscreenUnavailable:{
get(t){let{media:e}=t;if(!Ts||!yr(e))return J.UNSUPPORTED}},mediaPipUnavailable:{get(t){let{media:e}=t;if(!Is||!Mr(e))return J.UNSUPPORTED;if(e?.disablePictureInPicture)return J.UNAVAILABLE}},mediaVolumeUnavailable:{get(t){let{media:e}=t;if(la===!1||e?.volume==null)return J.UNSUPPORTED},stateOwnersUpdateHandlers:[t=>{la==null&&Tl.then(e=>t(e?void 0:J.UNSUPPORTED))}]},mediaCastUnavailable:{get(t,{availability:e="not-available"}={}){var i;let{media:a}=t;if(!Ms||!((i=a?.remote)!=null&&i.state))return J.
UNSUPPORTED;if(!(e==null||e==="available"))return J.UNAVAILABLE},stateOwnersUpdateHandlers:[(t,e)=>{var i;let{media:a}=e;return a?(a.disableRemotePlayback||a.hasAttribute("disableremoteplayback")||(i=a?.remote)==null||i.watchAvailability(s=>{t({availability:s?"available":"not-available"})}).catch(s=>{s.name==="NotSupportedError"?t({availability:null}):t({availability:"not-available"})}),()=>{var s;(s=a?.remote)==null||s.cancelWatchAvailability().catch(()=>{})}):void 0}]},mediaAirplayUnavailable:{
get(t,e){if(!Ss)return J.UNSUPPORTED;if(e?.availability==="not-available")return J.UNAVAILABLE},mediaEvents:["webkitplaybacktargetavailabilitychanged"],stateOwnersUpdateHandlers:[(t,e)=>{var i;let{media:a}=e;return a?(a.disableRemotePlayback||a.hasAttribute("disableremoteplayback")||(i=a?.remote)==null||i.watchAvailability(s=>{t({availability:s?"available":"not-available"})}).catch(s=>{s.name==="NotSupportedError"?t({availability:null}):t({availability:"not-available"})}),()=>{var s;(s=a?.remote)==
null||s.cancelWatchAvailability().catch(()=>{})}):void 0}]},mediaRenditionUnavailable:{get(t){var e;let{media:i}=t;if(!i?.videoRenditions)return J.UNSUPPORTED;if(!((e=i.videoRenditions)!=null&&e.length))return J.UNAVAILABLE},mediaEvents:["emptied","loadstart"],videoRenditionsEvents:["addrendition","removerendition"]},mediaAudioTrackUnavailable:{get(t){var e,i;let{media:a}=t;if(!a?.audioTracks)return J.UNSUPPORTED;if(((i=(e=a.audioTracks)==null?void 0:e.length)!=null?i:0)<=1)return J.UNAVAILABLE},
mediaEvents:["emptied","loadstart"],audioTracksEvents:["addtrack","removetrack"]},mediaLang:{get(t){let{options:{mediaLang:e}={}}=t;return e??"en"}}};var ks={[h.MEDIA_PREVIEW_REQUEST](t,e,{detail:i}){var a,r,s;let{media:l}=e,d=i??void 0,c,y;if(l&&d!=null){let[p]=je(l,{kind:X.METADATA,label:"thumbnails"}),A=Array.prototype.find.call((a=p?.cues)!=null?a:[],(v,k,I)=>k===0?v.endTime>d:k===I.length-1?v.startTime<=d:v.startTime<=d&&v.endTime>d);if(A){let v=/'^(?:[a-z]+:)?\/\//i.test(A.text)||(r=l?.querySelector('track[label="thumbnails"]'))==null?void 0:r.src,k=new URL(A.text,v);y=new URLSearchParams(k.hash).get("#xywh").split(",").map(Z=>+Z),c=k.href}}
let S=t.mediaDuration.get(e),f=(s=t.mediaChaptersCues.get(e).find((p,A,v)=>A===v.length-1&&S===p.endTime?p.startTime<=d&&p.endTime>=d:p.startTime<=d&&p.endTime>d))==null?void 0:s.text;return i!=null&&f==null&&(f=""),{mediaPreviewTime:d,mediaPreviewImage:c,mediaPreviewCoords:y,mediaPreviewChapter:f}},[h.MEDIA_PAUSE_REQUEST](t,e){t["mediaPaused"].set(!0,e)},[h.MEDIA_PLAY_REQUEST](t,e){var i,a,r,s;let l="mediaPaused",c=t.mediaStreamType.get(e)===ae.LIVE,y=!((i=e.options)!=null&&i.noAutoSeekToLive),
S=t.mediaTargetLiveWindow.get(e)>0;if(c&&y&&!S){let T=(a=t.mediaSeekable.get(e))==null?void 0:a[1];if(T){let f=(s=(r=e.options)==null?void 0:r.seekToLiveOffset)!=null?s:0,p=T-f;t.mediaCurrentTime.set(p,e)}}t[l].set(!1,e)},[h.MEDIA_PLAYBACK_RATE_REQUEST](t,e,{detail:i}){let a="mediaPlaybackRate",r=i;t[a].set(r,e)},[h.MEDIA_MUTE_REQUEST](t,e){t["mediaMuted"].set(!0,e)},[h.MEDIA_UNMUTE_REQUEST](t,e){let i="mediaMuted";t.mediaVolume.get(e)||t.mediaVolume.set(.25,e),t[i].set(!1,e)},[h.MEDIA_LOOP_REQUEST](t,e,{
detail:i}){let a="mediaLoop",r=!!i;return t[a].set(r,e),{mediaLoop:r}},[h.MEDIA_VOLUME_REQUEST](t,e,{detail:i}){let a="mediaVolume",r=i;r&&t.mediaMuted.get(e)&&t.mediaMuted.set(!1,e),t[a].set(r,e)},[h.MEDIA_SEEK_REQUEST](t,e,{detail:i}){let a="mediaCurrentTime",r=i;t[a].set(r,e)},[h.MEDIA_SEEK_TO_LIVE_REQUEST](t,e){var i,a,r;let s="mediaCurrentTime",l=(i=t.mediaSeekable.get(e))==null?void 0:i[1];if(Number.isNaN(Number(l)))return;let d=(r=(a=e.options)==null?void 0:a.seekToLiveOffset)!=null?r:0,c=l-
d;t[s].set(c,e)},[h.MEDIA_SHOW_SUBTITLES_REQUEST](t,e,{detail:i}){var a;let{options:r}=e,s=At(e),l=Ir(i),d=(a=l[0])==null?void 0:a.language;d&&!r.noSubtitlesLangPref&&n.localStorage.setItem("media-chrome-pref-subtitles-lang",d),Je(Ce.SHOWING,s,l)},[h.MEDIA_DISABLE_SUBTITLES_REQUEST](t,e,{detail:i}){let a=At(e),r=i??[];Je(Ce.DISABLED,a,r)},[h.MEDIA_TOGGLE_SUBTITLES_REQUEST](t,e,{detail:i}){sa(e,i)},[h.MEDIA_RENDITION_REQUEST](t,e,{detail:i}){let a="mediaRenditionSelected",r=i;t[a].set(r,e)},[h.MEDIA_AUDIO_TRACK_REQUEST](t,e,{
detail:i}){let a="mediaAudioTrackEnabled",r=i;t[a].set(r,e)},[h.MEDIA_ENTER_PIP_REQUEST](t,e){let i="mediaIsPip";t.mediaIsFullscreen.get(e)&&t.mediaIsFullscreen.set(!1,e),t[i].set(!0,e)},[h.MEDIA_EXIT_PIP_REQUEST](t,e){t["mediaIsPip"].set(!1,e)},[h.MEDIA_ENTER_FULLSCREEN_REQUEST](t,e,i){let a="mediaIsFullscreen";t.mediaIsPip.get(e)&&t.mediaIsPip.set(!1,e),t[a].set(!0,e,i)},[h.MEDIA_EXIT_FULLSCREEN_REQUEST](t,e){t["mediaIsFullscreen"].set(!1,e)},[h.MEDIA_ENTER_CAST_REQUEST](t,e){let i="mediaIsCas\
ting";t.mediaIsFullscreen.get(e)&&t.mediaIsFullscreen.set(!1,e),t[i].set(!0,e)},[h.MEDIA_EXIT_CAST_REQUEST](t,e){t["mediaIsCasting"].set(!1,e)},[h.MEDIA_AIRPLAY_REQUEST](t,e){t["mediaIsAirplaying"].set(!0,e)}};var Ls=({media:t,fullscreenElement:e,documentElement:i,stateMediator:a=Tt,requestMap:r=ks,options:s={},monitorStateOwnersOnlyWithSubscriptions:l=!0})=>{let d=[],c={options:{...s}},y=Object.freeze({mediaPreviewTime:void 0,mediaPreviewImage:void 0,mediaPreviewCoords:void 0,mediaPreviewChapter:void 0}),S=v=>{v!=null&&(na(v,y)||(y=Object.freeze({...y,...v}),d.forEach(k=>k(y))))},T=()=>{let v=Object.entries(a).reduce((k,[I,{get:Z}])=>(k[I]=Z(c),k),{});S(v)},f={},p,A=async(v,k)=>{var I,Z,ai,ri,nt,Re,De,
oi,Ze,fo,_o,go,bo,Ao,To,Io;let Un=!!p;if(p={...c,...p??{},...v},Un)return;await ys(...Object.values(v));let lt=d.length>0&&k===0&&l,So=c.media!==p.media,Mo=((I=c.media)==null?void 0:I.textTracks)!==((Z=p.media)==null?void 0:Z.textTracks),yo=((ai=c.media)==null?void 0:ai.videoRenditions)!==((ri=p.media)==null?void 0:ri.videoRenditions),ko=((nt=c.media)==null?void 0:nt.audioTracks)!==((Re=p.media)==null?void 0:Re.audioTracks),Lo=((De=c.media)==null?void 0:De.remote)!==((oi=p.media)==null?void 0:oi.
remote),wo=c.documentElement!==p.documentElement,Ro=!!c.media&&(So||lt),Do=!!((Ze=c.media)!=null&&Ze.textTracks)&&(Mo||lt),Co=!!((fo=c.media)!=null&&fo.videoRenditions)&&(yo||lt),Oo=!!((_o=c.media)!=null&&_o.audioTracks)&&(ko||lt),Uo=!!((go=c.media)!=null&&go.remote)&&(Lo||lt),xo=!!c.documentElement&&(wo||lt),cr=Ro||Do||Co||Oo||Uo||xo,dt=d.length===0&&k===1&&l,Po=!!p.media&&(So||dt),No=!!((bo=p.media)!=null&&bo.textTracks)&&(Mo||dt),Ho=!!((Ao=p.media)!=null&&Ao.videoRenditions)&&(yo||dt),Fo=!!((To=
p.media)!=null&&To.audioTracks)&&(ko||dt),Bo=!!((Io=p.media)!=null&&Io.remote)&&(Lo||dt),$o=!!p.documentElement&&(wo||dt),Wo=Po||No||Ho||Fo||Bo||$o;if(!(cr||Wo)){Object.entries(p).forEach(([O,si])=>{c[O]=si}),T(),p=void 0;return}Object.entries(a).forEach(([O,{get:si,mediaEvents:xn=[],textTracksEvents:Pn=[],videoRenditionsEvents:Nn=[],audioTracksEvents:Hn=[],remoteEvents:Fn=[],rootEvents:Bn=[],stateOwnersUpdateHandlers:$n=[]}])=>{f[O]||(f[O]={});let te=N=>{let $=si(c,N);S({[O]:$})},G;G=f[O].mediaEvents,
xn.forEach(N=>{G&&Ro&&(c.media.removeEventListener(N,G),f[O].mediaEvents=void 0),Po&&(p.media.addEventListener(N,te),f[O].mediaEvents=te)}),G=f[O].textTracksEvents,Pn.forEach(N=>{var $,le;G&&Do&&(($=c.media.textTracks)==null||$.removeEventListener(N,G),f[O].textTracksEvents=void 0),No&&((le=p.media.textTracks)==null||le.addEventListener(N,te),f[O].textTracksEvents=te)}),G=f[O].videoRenditionsEvents,Nn.forEach(N=>{var $,le;G&&Co&&(($=c.media.videoRenditions)==null||$.removeEventListener(N,G),f[O].
videoRenditionsEvents=void 0),Ho&&((le=p.media.videoRenditions)==null||le.addEventListener(N,te),f[O].videoRenditionsEvents=te)}),G=f[O].audioTracksEvents,Hn.forEach(N=>{var $,le;G&&Oo&&(($=c.media.audioTracks)==null||$.removeEventListener(N,G),f[O].audioTracksEvents=void 0),Fo&&((le=p.media.audioTracks)==null||le.addEventListener(N,te),f[O].audioTracksEvents=te)}),G=f[O].remoteEvents,Fn.forEach(N=>{var $,le;G&&Uo&&(($=c.media.remote)==null||$.removeEventListener(N,G),f[O].remoteEvents=void 0),Bo&&
((le=p.media.remote)==null||le.addEventListener(N,te),f[O].remoteEvents=te)}),G=f[O].rootEvents,Bn.forEach(N=>{G&&xo&&(c.documentElement.removeEventListener(N,G),f[O].rootEvents=void 0),$o&&(p.documentElement.addEventListener(N,te),f[O].rootEvents=te)});let Fi=f[O].stateOwnersUpdateHandlers;if(Fi&&cr&&(Array.isArray(Fi)?Fi:[Fi]).forEach($=>{typeof $=="function"&&$()}),Wo){let N=$n.map($=>$(te,p)).filter($=>typeof $=="function");f[O].stateOwnersUpdateHandlers=N.length===1?N[0]:N}else cr&&(f[O].stateOwnersUpdateHandlers=
void 0)}),Object.entries(p).forEach(([O,si])=>{c[O]=si}),T(),p=void 0};return A({media:t,fullscreenElement:e,documentElement:i,options:s}),{dispatch(v){let{type:k,detail:I}=v;if(r[k]&&y.mediaErrorCode==null){S(r[k](a,c,v));return}k==="mediaelementchangerequest"?A({media:I}):k==="fullscreenelementchangerequest"?A({fullscreenElement:I}):k==="documentelementchangerequest"?A({documentElement:I}):k==="optionschangerequest"&&(Object.entries(I??{}).forEach(([Z,ai])=>{c.options[Z]=ai}),T())},getState(){
return y},subscribe(v){return A({},d.length+1),d.push(v),v(y),()=>{let k=d.indexOf(v);k>=0&&(A({},d.length-1),d.splice(k,1))}}}};var Cr=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},E=(t,e,i)=>(Cr(t,e,"read from private field"),i?i.call(t):e.get(t)),oe=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},he=(t,e,i,a)=>(Cr(t,e,"write to private field"),a?a.call(t,i):e.set(t,i),i),vi=(t,e,i)=>(Cr(t,e,"access private method"),i),Ue,fi,R,be,_i,ge,da,gi,ca,Lr,tt,ua,wr,Rr,xs,Ps=["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Enter"," ","f","\
m","k","c","l","j",">","<","p"],ws=10,Rs=.025,Ds=.25,Ml=.25,yl=2,u={DEFAULT_SUBTITLES:"defaultsubtitles",DEFAULT_STREAM_TYPE:"defaultstreamtype",DEFAULT_DURATION:"defaultduration",FULLSCREEN_ELEMENT:"fullscreenelement",HOTKEYS:"hotkeys",KEYBOARD_BACKWARD_SEEK_OFFSET:"keyboardbackwardseekoffset",KEYBOARD_FORWARD_SEEK_OFFSET:"keyboardforwardseekoffset",KEYBOARD_DOWN_VOLUME_STEP:"keyboarddownvolumestep",KEYBOARD_UP_VOLUME_STEP:"keyboardupvolumestep",KEYS_USED:"keysused",LANG:"lang",LOOP:"loop",LIVE_EDGE_OFFSET:"\
liveedgeoffset",NO_AUTO_SEEK_TO_LIVE:"noautoseektolive",NO_DEFAULT_STORE:"nodefaultstore",NO_HOTKEYS:"nohotkeys",NO_MUTED_PREF:"nomutedpref",NO_SUBTITLES_LANG_PREF:"nosubtitleslangpref",NO_VOLUME_PREF:"novolumepref",SEEK_TO_LIVE_OFFSET:"seektoliveoffset"},ha=class extends Be{constructor(){super(),oe(this,ca),oe(this,ua),oe(this,Rr),this.mediaStateReceivers=[],this.associatedElementSubscriptions=new Map,oe(this,Ue,new bt(this,u.HOTKEYS)),oe(this,fi,void 0),oe(this,R,void 0),oe(this,be,null),oe(this,
_i,void 0),oe(this,ge,void 0),oe(this,da,i=>{var a;(a=E(this,R))==null||a.dispatch(i)}),oe(this,gi,void 0),oe(this,tt,i=>{let{key:a,shiftKey:r}=i;if(!(r&&(a==="/"||a==="?")||Ps.includes(a))){this.removeEventListener("keyup",E(this,tt));return}this.keyboardShortcutHandler(i)}),this.associateElement(this);let e={};he(this,_i,i=>{Object.entries(i).forEach(([a,r])=>{if(a in e&&e[a]===r)return;this.propagateMediaState(a,r);let s=a.toLowerCase(),l=new n.CustomEvent(ur[s],{composed:!0,detail:r});this.dispatchEvent(
l)}),e=i})}static get observedAttributes(){return super.observedAttributes.concat(u.NO_HOTKEYS,u.HOTKEYS,u.DEFAULT_STREAM_TYPE,u.DEFAULT_SUBTITLES,u.DEFAULT_DURATION,u.NO_MUTED_PREF,u.NO_VOLUME_PREF,u.LANG,u.LOOP,u.LIVE_EDGE_OFFSET,u.SEEK_TO_LIVE_OFFSET,u.NO_AUTO_SEEK_TO_LIVE)}get mediaStore(){return E(this,R)}set mediaStore(e){var i,a;if(E(this,R)&&((i=E(this,ge))==null||i.call(this),he(this,ge,void 0)),he(this,R,e),!E(this,R)&&!this.hasAttribute(u.NO_DEFAULT_STORE)){vi(this,ca,Lr).call(this);return}
he(this,ge,(a=E(this,R))==null?void 0:a.subscribe(E(this,_i)))}get fullscreenElement(){var e;return(e=E(this,fi))!=null?e:this}set fullscreenElement(e){var i;this.hasAttribute(u.FULLSCREEN_ELEMENT)&&this.removeAttribute(u.FULLSCREEN_ELEMENT),he(this,fi,e),(i=E(this,R))==null||i.dispatch({type:"fullscreenelementchangerequest",detail:this.fullscreenElement})}get defaultSubtitles(){return _(this,u.DEFAULT_SUBTITLES)}set defaultSubtitles(e){g(this,u.DEFAULT_SUBTITLES,e)}get defaultStreamType(){return w(
this,u.DEFAULT_STREAM_TYPE)}set defaultStreamType(e){L(this,u.DEFAULT_STREAM_TYPE,e)}get defaultDuration(){return D(this,u.DEFAULT_DURATION)}set defaultDuration(e){U(this,u.DEFAULT_DURATION,e)}get noHotkeys(){return _(this,u.NO_HOTKEYS)}set noHotkeys(e){g(this,u.NO_HOTKEYS,e)}get keysUsed(){return w(this,u.KEYS_USED)}set keysUsed(e){L(this,u.KEYS_USED,e)}get liveEdgeOffset(){return D(this,u.LIVE_EDGE_OFFSET)}set liveEdgeOffset(e){U(this,u.LIVE_EDGE_OFFSET,e)}get noAutoSeekToLive(){return _(this,
u.NO_AUTO_SEEK_TO_LIVE)}set noAutoSeekToLive(e){g(this,u.NO_AUTO_SEEK_TO_LIVE,e)}get noVolumePref(){return _(this,u.NO_VOLUME_PREF)}set noVolumePref(e){g(this,u.NO_VOLUME_PREF,e)}get noMutedPref(){return _(this,u.NO_MUTED_PREF)}set noMutedPref(e){g(this,u.NO_MUTED_PREF,e)}get noSubtitlesLangPref(){return _(this,u.NO_SUBTITLES_LANG_PREF)}set noSubtitlesLangPref(e){g(this,u.NO_SUBTITLES_LANG_PREF,e)}get noDefaultStore(){return _(this,u.NO_DEFAULT_STORE)}set noDefaultStore(e){g(this,u.NO_DEFAULT_STORE,
e)}get resolvedLang(){return Xo()}attributeChangedCallback(e,i,a){var r,s,l,d,c,y,S,T,f,p,A,v;if(super.attributeChangedCallback(e,i,a),e===u.NO_HOTKEYS)a!==i&&a===""?(this.hasAttribute(u.HOTKEYS)&&console.warn("Media Chrome: Both `hotkeys` and `nohotkeys` have been set. All hotkeys will be disabled."),this.disableHotkeys()):a!==i&&a===null&&this.enableHotkeys();else if(e===u.HOTKEYS)E(this,Ue).value=a;else if(e===u.DEFAULT_SUBTITLES&&a!==i)(r=E(this,R))==null||r.dispatch({type:"optionschangerequ\
est",detail:{defaultSubtitles:this.hasAttribute(u.DEFAULT_SUBTITLES)}});else if(e===u.DEFAULT_STREAM_TYPE)(l=E(this,R))==null||l.dispatch({type:"optionschangerequest",detail:{defaultStreamType:(s=this.getAttribute(u.DEFAULT_STREAM_TYPE))!=null?s:void 0}});else if(e===u.LIVE_EDGE_OFFSET&&a!==i)(d=E(this,R))==null||d.dispatch({type:"optionschangerequest",detail:{liveEdgeOffset:this.hasAttribute(u.LIVE_EDGE_OFFSET)?+this.getAttribute(u.LIVE_EDGE_OFFSET):void 0,seekToLiveOffset:this.hasAttribute(u.SEEK_TO_LIVE_OFFSET)?
+this.getAttribute(u.SEEK_TO_LIVE_OFFSET):this.hasAttribute(u.LIVE_EDGE_OFFSET)?+this.getAttribute(u.LIVE_EDGE_OFFSET):void 0}});else if(e===u.SEEK_TO_LIVE_OFFSET&&a!==i)(c=E(this,R))==null||c.dispatch({type:"optionschangerequest",detail:{seekToLiveOffset:this.hasAttribute(u.SEEK_TO_LIVE_OFFSET)?+this.getAttribute(u.SEEK_TO_LIVE_OFFSET):this.hasAttribute(u.LIVE_EDGE_OFFSET)?+this.getAttribute(u.LIVE_EDGE_OFFSET):void 0}});else if(e===u.NO_AUTO_SEEK_TO_LIVE)(y=E(this,R))==null||y.dispatch({type:"\
optionschangerequest",detail:{noAutoSeekToLive:this.hasAttribute(u.NO_AUTO_SEEK_TO_LIVE)}});else if(e===u.FULLSCREEN_ELEMENT){let k=a?(S=this.getRootNode())==null?void 0:S.getElementById(a):void 0;he(this,fi,k),(T=E(this,R))==null||T.dispatch({type:"fullscreenelementchangerequest",detail:this.fullscreenElement})}else e===u.LANG&&a!==i?(Zo(a),(f=E(this,R))==null||f.dispatch({type:"optionschangerequest",detail:{mediaLang:a}})):e===u.LOOP&&a!==i?(p=E(this,R))==null||p.dispatch({type:h.MEDIA_LOOP_REQUEST,
detail:a!=null}):e===u.NO_VOLUME_PREF&&a!==i?(A=E(this,R))==null||A.dispatch({type:"optionschangerequest",detail:{noVolumePref:this.hasAttribute(u.NO_VOLUME_PREF)}}):e===u.NO_MUTED_PREF&&a!==i&&((v=E(this,R))==null||v.dispatch({type:"optionschangerequest",detail:{noMutedPref:this.hasAttribute(u.NO_MUTED_PREF)}}))}connectedCallback(){var e,i,a;this.associateElement(this),!E(this,R)&&!this.hasAttribute(u.NO_DEFAULT_STORE)&&vi(this,ca,Lr).call(this),(e=E(this,R))==null||e.dispatch({type:"documentel\
ementchangerequest",detail:W}),(i=E(this,R))==null||i.dispatch({type:"fullscreenelementchangerequest",detail:this.fullscreenElement}),super.connectedCallback(),E(this,R)&&!E(this,ge)&&he(this,ge,(a=E(this,R))==null?void 0:a.subscribe(E(this,_i))),E(this,gi)!==void 0&&E(this,R)&&this.media&&setTimeout(()=>{var r,s,l;(s=(r=this.media)==null?void 0:r.textTracks)!=null&&s.length&&((l=E(this,R))==null||l.dispatch({type:h.MEDIA_TOGGLE_SUBTITLES_REQUEST,detail:E(this,gi)}))},0),this.hasAttribute(u.NO_HOTKEYS)?
this.disableHotkeys():this.enableHotkeys()}disconnectedCallback(){var e,i,a,r,s,l;if((e=super.disconnectedCallback)==null||e.call(this),this.disableHotkeys(),E(this,R)){let d=E(this,R).getState();he(this,gi,!!((i=d.mediaSubtitlesShowing)!=null&&i.length)),(a=E(this,R))==null||a.dispatch({type:"fullscreenelementchangerequest",detail:void 0}),(r=E(this,R))==null||r.dispatch({type:"documentelementchangerequest",detail:void 0}),(s=E(this,R))==null||s.dispatch({type:h.MEDIA_TOGGLE_SUBTITLES_REQUEST,detail:!1})}
E(this,ge)&&((l=E(this,ge))==null||l.call(this),he(this,ge,void 0)),this.unassociateElement(this),E(this,be)&&(E(this,be).remove(),he(this,be,null))}mediaSetCallback(e){var i;super.mediaSetCallback(e),(i=E(this,R))==null||i.dispatch({type:"mediaelementchangerequest",detail:e}),e.hasAttribute("tabindex")||(e.tabIndex=-1)}mediaUnsetCallback(e){var i;super.mediaUnsetCallback(e),(i=E(this,R))==null||i.dispatch({type:"mediaelementchangerequest",detail:void 0})}propagateMediaState(e,i){Us(this.mediaStateReceivers,
e,i)}associateElement(e){if(!e)return;let{associatedElementSubscriptions:i}=this;if(i.has(e))return;let a=this.registerMediaStateReceiver.bind(this),r=this.unregisterMediaStateReceiver.bind(this),s=Cl(e,a,r);Object.values(h).forEach(l=>{e.addEventListener(l,E(this,da))}),i.set(e,s)}unassociateElement(e){if(!e)return;let{associatedElementSubscriptions:i}=this;if(!i.has(e))return;i.get(e)(),i.delete(e),Object.values(h).forEach(r=>{e.removeEventListener(r,E(this,da))})}registerMediaStateReceiver(e){
if(!e)return;let i=this.mediaStateReceivers;i.indexOf(e)>-1||(i.push(e),E(this,R)&&Object.entries(E(this,R).getState()).forEach(([r,s])=>{Us([e],r,s)}))}unregisterMediaStateReceiver(e){let i=this.mediaStateReceivers,a=i.indexOf(e);a<0||i.splice(a,1)}enableHotkeys(){this.addEventListener("keydown",vi(this,ua,wr))}disableHotkeys(){this.removeEventListener("keydown",vi(this,ua,wr)),this.removeEventListener("keyup",E(this,tt))}get hotkeys(){return E(this,Ue)}set hotkeys(e){L(this,u.HOTKEYS,e)}keyboardShortcutHandler(e){
var i,a,r,s,l,d,c,y,S;let T=e.target;if(((r=(a=(i=T.getAttribute(u.KEYS_USED))==null?void 0:i.split(" "))!=null?a:T?.keysUsed)!=null?r:[]).map(I=>I==="Space"?" ":I).filter(Boolean).includes(e.key))return;let p,A,v;if(!(E(this,Ue).contains(`no${e.key.toLowerCase()}`)||e.key===" "&&E(this,Ue).contains("nospace")||e.shiftKey&&(e.key==="/"||e.key==="?")&&E(this,Ue).contains("noshift+/")))switch(e.key){case" ":case"k":p=E(this,R).getState().mediaPaused?h.MEDIA_PLAY_REQUEST:h.MEDIA_PAUSE_REQUEST,this.
dispatchEvent(new n.CustomEvent(p,{composed:!0,bubbles:!0}));break;case"m":p=this.mediaStore.getState().mediaVolumeLevel==="off"?h.MEDIA_UNMUTE_REQUEST:h.MEDIA_MUTE_REQUEST,this.dispatchEvent(new n.CustomEvent(p,{composed:!0,bubbles:!0}));break;case"f":p=this.mediaStore.getState().mediaIsFullscreen?h.MEDIA_EXIT_FULLSCREEN_REQUEST:h.MEDIA_ENTER_FULLSCREEN_REQUEST,this.dispatchEvent(new n.CustomEvent(p,{composed:!0,bubbles:!0}));break;case"c":this.dispatchEvent(new n.CustomEvent(h.MEDIA_TOGGLE_SUBTITLES_REQUEST,
{composed:!0,bubbles:!0}));break;case"ArrowLeft":case"j":{let I=this.hasAttribute(u.KEYBOARD_BACKWARD_SEEK_OFFSET)?+this.getAttribute(u.KEYBOARD_BACKWARD_SEEK_OFFSET):ws;A=Math.max(((s=this.mediaStore.getState().mediaCurrentTime)!=null?s:0)-I,0),v=new n.CustomEvent(h.MEDIA_SEEK_REQUEST,{composed:!0,bubbles:!0,detail:A}),this.dispatchEvent(v);break}case"ArrowRight":case"l":{let I=this.hasAttribute(u.KEYBOARD_FORWARD_SEEK_OFFSET)?+this.getAttribute(u.KEYBOARD_FORWARD_SEEK_OFFSET):ws;A=Math.max(((l=
this.mediaStore.getState().mediaCurrentTime)!=null?l:0)+I,0),v=new n.CustomEvent(h.MEDIA_SEEK_REQUEST,{composed:!0,bubbles:!0,detail:A}),this.dispatchEvent(v);break}case"ArrowUp":{let I=this.hasAttribute(u.KEYBOARD_UP_VOLUME_STEP)?+this.getAttribute(u.KEYBOARD_UP_VOLUME_STEP):Rs;A=Math.min(((d=this.mediaStore.getState().mediaVolume)!=null?d:1)+I,1),v=new n.CustomEvent(h.MEDIA_VOLUME_REQUEST,{composed:!0,bubbles:!0,detail:A}),this.dispatchEvent(v);break}case"ArrowDown":{let I=this.hasAttribute(u.
KEYBOARD_DOWN_VOLUME_STEP)?+this.getAttribute(u.KEYBOARD_DOWN_VOLUME_STEP):Rs;A=Math.max(((c=this.mediaStore.getState().mediaVolume)!=null?c:1)-I,0),v=new n.CustomEvent(h.MEDIA_VOLUME_REQUEST,{composed:!0,bubbles:!0,detail:A}),this.dispatchEvent(v);break}case"<":{let I=(y=this.mediaStore.getState().mediaPlaybackRate)!=null?y:1;A=Math.max(I-Ds,Ml).toFixed(2),v=new n.CustomEvent(h.MEDIA_PLAYBACK_RATE_REQUEST,{composed:!0,bubbles:!0,detail:A}),this.dispatchEvent(v);break}case">":{let I=(S=this.mediaStore.
getState().mediaPlaybackRate)!=null?S:1;A=Math.min(I+Ds,yl).toFixed(2),v=new n.CustomEvent(h.MEDIA_PLAYBACK_RATE_REQUEST,{composed:!0,bubbles:!0,detail:A}),this.dispatchEvent(v);break}case"/":case"?":{e.shiftKey&&vi(this,Rr,xs).call(this);break}case"p":{p=this.mediaStore.getState().mediaIsPip?h.MEDIA_EXIT_PIP_REQUEST:h.MEDIA_ENTER_PIP_REQUEST,v=new n.CustomEvent(p,{composed:!0,bubbles:!0}),this.dispatchEvent(v);break}default:break}}};Ue=new WeakMap;fi=new WeakMap;R=new WeakMap;be=new WeakMap;_i=
new WeakMap;ge=new WeakMap;da=new WeakMap;gi=new WeakMap;ca=new WeakSet;Lr=function(){var t;this.mediaStore=Ls({media:this.media,fullscreenElement:this.fullscreenElement,options:{defaultSubtitles:this.hasAttribute(u.DEFAULT_SUBTITLES),defaultDuration:this.hasAttribute(u.DEFAULT_DURATION)?+this.getAttribute(u.DEFAULT_DURATION):void 0,defaultStreamType:(t=this.getAttribute(u.DEFAULT_STREAM_TYPE))!=null?t:void 0,liveEdgeOffset:this.hasAttribute(u.LIVE_EDGE_OFFSET)?+this.getAttribute(u.LIVE_EDGE_OFFSET):
void 0,seekToLiveOffset:this.hasAttribute(u.SEEK_TO_LIVE_OFFSET)?+this.getAttribute(u.SEEK_TO_LIVE_OFFSET):this.hasAttribute(u.LIVE_EDGE_OFFSET)?+this.getAttribute(u.LIVE_EDGE_OFFSET):void 0,noAutoSeekToLive:this.hasAttribute(u.NO_AUTO_SEEK_TO_LIVE),noVolumePref:this.hasAttribute(u.NO_VOLUME_PREF),noMutedPref:this.hasAttribute(u.NO_MUTED_PREF),noSubtitlesLangPref:this.hasAttribute(u.NO_SUBTITLES_LANG_PREF)}})};tt=new WeakMap;ua=new WeakSet;wr=function(t){var e;let{metaKey:i,altKey:a,key:r,shiftKey:s}=t,
l=s&&(r==="/"||r==="?");if(l&&((e=E(this,be))!=null&&e.open)){this.removeEventListener("keyup",E(this,tt));return}if(i||a||!l&&!Ps.includes(r)){this.removeEventListener("keyup",E(this,tt));return}let d=t.target,c=d instanceof HTMLElement&&(d.tagName.toLowerCase()==="media-volume-range"||d.tagName.toLowerCase()==="media-time-range");[" ","ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(r)&&!(E(this,Ue).contains(`no${r.toLowerCase()}`)||r===" "&&E(this,Ue).contains("nospace"))&&!c&&t.preventDefault(),
this.addEventListener("keyup",E(this,tt),{once:!0})};Rr=new WeakSet;xs=function(){E(this,be)||(he(this,be,W.createElement("media-keyboard-shortcuts-dialog")),this.appendChild(E(this,be))),E(this,be).open=!0};var kl=Object.values(o),Ll=Object.values(Bi),Ns=t=>{var e,i,a,r;let{observedAttributes:s}=t.constructor;!s&&((e=t.nodeName)!=null&&e.includes("-"))&&(n.customElements.upgrade(t),{observedAttributes:s}=t.constructor);let l=(r=(a=(i=t?.getAttribute)==null?void 0:i.call(t,M.MEDIA_CHROME_ATTRIBUTES))==
null?void 0:a.split)==null?void 0:r.call(a,/\s+/);return Array.isArray(s||l)?(s||l).filter(d=>kl.includes(d)):[]},wl=t=>{var e,i;return(e=t.nodeName)!=null&&e.includes("-")&&n.customElements.get((i=t.nodeName)==null?void 0:i.toLowerCase())&&!(t instanceof n.customElements.get(t.nodeName.toLowerCase()))&&n.customElements.upgrade(t),Ll.some(a=>a in t)},Dr=t=>wl(t)||!!Ns(t).length,Cs=t=>{var e;return(e=t?.join)==null?void 0:e.call(t,":")},Os={[o.MEDIA_SUBTITLES_LIST]:pi,[o.MEDIA_SUBTITLES_SHOWING]:pi,
[o.MEDIA_SEEKABLE]:Cs,[o.MEDIA_BUFFERED]:t=>t?.map(Cs).join(" "),[o.MEDIA_PREVIEW_COORDS]:t=>t?.join(" "),[o.MEDIA_RENDITION_LIST]:qo,[o.MEDIA_AUDIO_TRACK_LIST]:Yo},Rl=async(t,e,i)=>{var a,r;if(t.isConnected||await $i(0),typeof i=="boolean"||i==null)return g(t,e,i);if(typeof i=="number")return U(t,e,i);if(typeof i=="string")return L(t,e,i);if(Array.isArray(i)&&!i.length)return t.removeAttribute(e);let s=(r=(a=Os[e])==null?void 0:a.call(Os,i))!=null?r:i;return t.setAttribute(e,s)},Dl=t=>{var e;return!!((e=
t.closest)!=null&&e.call(t,'*[slot="media"]'))},et=(t,e)=>{if(Dl(t))return;let i=(r,s)=>{var l,d;Dr(r)&&s(r);let{children:c=[]}=r??{},y=(d=(l=r?.shadowRoot)==null?void 0:l.children)!=null?d:[];[...c,...y].forEach(T=>et(T,s))},a=t?.nodeName.toLowerCase();if(a.includes("-")&&!Dr(t)){n.customElements.whenDefined(a).then(()=>{i(t,e)});return}i(t,e)},Us=(t,e,i)=>{t.forEach(a=>{if(e in a){a[e]=i;return}let r=Ns(a),s=e.toLowerCase();r.includes(s)&&Rl(a,s,i)})},Cl=(t,e,i)=>{et(t,e);let a=S=>{var T;let f=(T=
S?.composedPath()[0])!=null?T:S.target;e(f)},r=S=>{var T;let f=(T=S?.composedPath()[0])!=null?T:S.target;i(f)};t.addEventListener(h.REGISTER_MEDIA_STATE_RECEIVER,a),t.addEventListener(h.UNREGISTER_MEDIA_STATE_RECEIVER,r);let s=S=>{S.forEach(T=>{let{addedNodes:f=[],removedNodes:p=[],type:A,target:v,attributeName:k}=T;A==="childList"?(Array.prototype.forEach.call(f,I=>et(I,e)),Array.prototype.forEach.call(p,I=>et(I,i))):A==="attributes"&&k===M.MEDIA_CHROME_ATTRIBUTES&&(Dr(v)?e(v):i(v))})},l=[],d=S=>{
let T=S.target;T.name!=="media"&&(l.forEach(f=>et(f,i)),l=[...T.assignedElements({flatten:!0})],l.forEach(f=>et(f,e)))};t.addEventListener("slotchange",d);let c=new MutationObserver(s);return c.observe(t,{childList:!0,attributes:!0,subtree:!0}),()=>{et(t,i),t.removeEventListener("slotchange",d),c.disconnect(),t.removeEventListener(h.REGISTER_MEDIA_STATE_RECEIVER,a),t.removeEventListener(h.UNREGISTER_MEDIA_STATE_RECEIVER,r)}};n.customElements.get("media-controller")||n.customElements.define("medi\
a-controller",ha);var Ol=ha;var It={PLACEMENT:"placement",BOUNDS:"bounds"};function Ul(t){return`
    <style>
      :host {
        --_tooltip-background-color: var(--media-tooltip-background-color, var(--media-secondary-color, rgba(20, 20, 30, .7)));
        --_tooltip-background: var(--media-tooltip-background, var(--_tooltip-background-color));
        --_tooltip-arrow-half-width: calc(var(--media-tooltip-arrow-width, 12px) / 2);
        --_tooltip-arrow-height: var(--media-tooltip-arrow-height, 5px);
        --_tooltip-arrow-background: var(--media-tooltip-arrow-color, var(--_tooltip-background-color));
        position: relative;
        pointer-events: none;
        display: var(--media-tooltip-display, inline-flex);
        justify-content: center;
        align-items: center;
        box-sizing: border-box;
        z-index: var(--media-tooltip-z-index, 1);
        background: var(--_tooltip-background);
        color: var(--media-text-color, var(--media-primary-color, rgb(238 238 238)));
        font: var(--media-font,
          var(--media-font-weight, 400)
          var(--media-font-size, 13px) /
          var(--media-text-content-height, var(--media-control-height, 18px))
          var(--media-font-family, helvetica neue, segoe ui, roboto, arial, sans-serif));
        padding: var(--media-tooltip-padding, .35em .7em);
        border: var(--media-tooltip-border, none);
        border-radius: var(--media-tooltip-border-radius, 5px);
        filter: var(--media-tooltip-filter, drop-shadow(0 0 4px rgba(0, 0, 0, .2)));
        white-space: var(--media-tooltip-white-space, nowrap);
      }

      :host([hidden]) {
        display: none;
      }

      img, svg {
        display: inline-block;
      }

      #arrow {
        position: absolute;
        width: 0px;
        height: 0px;
        border-style: solid;
        display: var(--media-tooltip-arrow-display, block);
      }

      :host(:not([placement])),
      :host([placement="top"]) {
        position: absolute;
        bottom: calc(100% + var(--media-tooltip-distance, 12px));
        left: 50%;
        transform: translate(calc(-50% - var(--media-tooltip-offset-x, 0px)), 0);
      }
      :host(:not([placement])) #arrow,
      :host([placement="top"]) #arrow {
        top: 100%;
        left: 50%;
        border-width: var(--_tooltip-arrow-height) var(--_tooltip-arrow-half-width) 0 var(--_tooltip-arrow-half-width);
        border-color: var(--_tooltip-arrow-background) transparent transparent transparent;
        transform: translate(calc(-50% + var(--media-tooltip-offset-x, 0px)), 0);
      }

      :host([placement="right"]) {
        position: absolute;
        left: calc(100% + var(--media-tooltip-distance, 12px));
        top: 50%;
        transform: translate(0, -50%);
      }
      :host([placement="right"]) #arrow {
        top: 50%;
        right: 100%;
        border-width: var(--_tooltip-arrow-half-width) var(--_tooltip-arrow-height) var(--_tooltip-arrow-half-width) 0;
        border-color: transparent var(--_tooltip-arrow-background) transparent transparent;
        transform: translate(0, -50%);
      }

      :host([placement="bottom"]) {
        position: absolute;
        top: calc(100% + var(--media-tooltip-distance, 12px));
        left: 50%;
        transform: translate(calc(-50% - var(--media-tooltip-offset-x, 0px)), 0);
      }
      :host([placement="bottom"]) #arrow {
        bottom: 100%;
        left: 50%;
        border-width: 0 var(--_tooltip-arrow-half-width) var(--_tooltip-arrow-height) var(--_tooltip-arrow-half-width);
        border-color: transparent transparent var(--_tooltip-arrow-background) transparent;
        transform: translate(calc(-50% + var(--media-tooltip-offset-x, 0px)), 0);
      }

      :host([placement="left"]) {
        position: absolute;
        right: calc(100% + var(--media-tooltip-distance, 12px));
        top: 50%;
        transform: translate(0, -50%);
      }
      :host([placement="left"]) #arrow {
        top: 50%;
        left: 100%;
        border-width: var(--_tooltip-arrow-half-width) 0 var(--_tooltip-arrow-half-width) var(--_tooltip-arrow-height);
        border-color: transparent transparent transparent var(--_tooltip-arrow-background);
        transform: translate(0, -50%);
      }
      
      :host([placement="none"]) #arrow {
        display: none;
      }
    </style>
    <slot></slot>
    <div id="arrow"></div>
  `}var St=class extends n.HTMLElement{constructor(){if(super(),this.updateXOffset=()=>{var e;if(!zi(this,{checkOpacity:!1,checkVisibilityCSS:!1}))return;let i=this.placement;if(i==="left"||i==="right"){this.style.removeProperty("--media-tooltip-offset-x");return}let a=getComputedStyle(this),r=(e=He(this,"#"+this.bounds))!=null?e:ss(this);if(!r)return;let{x:s,width:l}=r.getBoundingClientRect(),{x:d,width:c}=this.getBoundingClientRect(),y=d+c,S=s+l,T=a.getPropertyValue("--media-tooltip-offset-x"),
f=T?parseFloat(T.replace("px","")):0,p=a.getPropertyValue("--media-tooltip-container-margin"),A=p?parseFloat(p.replace("px","")):0,v=d-s+f-A,k=y-S+f+A;if(v<0){this.style.setProperty("--media-tooltip-offset-x",`${v}px`);return}if(k>0){this.style.setProperty("--media-tooltip-offset-x",`${k}px`);return}this.style.removeProperty("--media-tooltip-offset-x")},!this.shadowRoot){this.attachShadow(this.constructor.shadowRootOptions);let e=F(this.attributes);this.shadowRoot.innerHTML=this.constructor.getTemplateHTML(
e)}if(this.arrowEl=this.shadowRoot.querySelector("#arrow"),Object.prototype.hasOwnProperty.call(this,"placement")){let e=this.placement;delete this.placement,this.placement=e}}static get observedAttributes(){return[It.PLACEMENT,It.BOUNDS]}get placement(){return w(this,It.PLACEMENT)}set placement(e){L(this,It.PLACEMENT,e)}get bounds(){return w(this,It.BOUNDS)}set bounds(e){L(this,It.BOUNDS,e)}};St.shadowRootOptions={mode:"open"};St.getTemplateHTML=Ul;n.customElements.get("media-tooltip")||n.customElements.
define("media-tooltip",St);var ma=St;var Ur=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},V=(t,e,i)=>(Ur(t,e,"read from private field"),i?i.call(t):e.get(t)),Mt=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},pa=(t,e,i,a)=>(Ur(t,e,"write to private field"),a?a.call(t,i):e.set(t,i),i),xl=(t,e,i)=>(Ur(t,e,"access private method"),i),Ae,kt,Ve,yt,Ea,Or,Hs,We={TOOLTIP_PLACEMENT:"tooltipplacement",DISABLED:"disabled",NO_TOOLTIP:"notooltip"};function Pl(t,e={}){
return`
    <style>
      :host {
        position: relative;
        font: var(--media-font,
          var(--media-font-weight, bold)
          var(--media-font-size, 14px) /
          var(--media-text-content-height, var(--media-control-height, 24px))
          var(--media-font-family, helvetica neue, segoe ui, roboto, arial, sans-serif));
        color: var(--media-text-color, var(--media-primary-color, rgb(238 238 238)));
        background: var(--media-control-background, var(--media-secondary-color, rgb(20 20 30 / .7)));
        padding: var(--media-button-padding, var(--media-control-padding, 10px));
        justify-content: var(--media-button-justify-content, center);
        display: inline-flex;
        align-items: center;
        vertical-align: middle;
        box-sizing: border-box;
        transition: background .15s linear;
        pointer-events: auto;
        cursor: var(--media-cursor, pointer);
        -webkit-tap-highlight-color: transparent;
      }

      
      :host(:focus-visible) {
        box-shadow: var(--media-focus-box-shadow, inset 0 0 0 2px rgb(27 127 204 / .9));
        outline: 0;
      }
      
      :host(:where(:focus)) {
        box-shadow: none;
        outline: 0;
      }

      :host(:hover) {
        background: var(--media-control-hover-background, rgba(50 50 70 / .7));
      }

      slot[name="icon"] {
        display: inline-flex;
        align-items: center;
      }

      svg, img, ::slotted(svg), ::slotted(img) {
        width: var(--media-button-icon-width);
        height: var(--media-button-icon-height, var(--media-control-height, 24px));
        transform: var(--media-button-icon-transform);
        transition: var(--media-button-icon-transition);
        fill: var(--media-icon-color, var(--media-primary-color, rgb(238 238 238)));
        vertical-align: middle;
        max-width: 100%;
        max-height: 100%;
        min-width: 100%;
      }

      media-tooltip {
        
        max-width: 0;
        overflow-x: clip;
        opacity: 0;
        transition: opacity .3s, max-width 0s 9s;
      }

      :host(:hover) media-tooltip,
      :host(:focus-visible) media-tooltip {
        max-width: 100vw;
        opacity: 1;
        transition: opacity .3s;
      }

      :host([notooltip]) slot[name="tooltip"] {
        display: none;
      }
    </style>

    ${this.getSlotTemplateHTML(t,e)}

    <slot name="tooltip">
      <media-tooltip part="tooltip" aria-hidden="true">
        <template shadowrootmode="${ma.shadowRootOptions.mode}">
          ${ma.getTemplateHTML({})}
        </template>
        <slot name="tooltip-content">
          ${this.getTooltipContentHTML(t)}
        </slot>
      </media-tooltip>
    </slot>
  `}function Nl(t,e){return`
    <slot></slot>
  `}function Hl(){return""}var C=class extends n.HTMLElement{constructor(){if(super(),Mt(this,Or),Mt(this,Ae,void 0),this.preventClick=!1,this.tooltipEl=null,Mt(this,kt,e=>{this.preventClick||this.handleClick(e),setTimeout(V(this,Ve),0)}),Mt(this,Ve,()=>{var e,i;(i=(e=this.tooltipEl)==null?void 0:e.updateXOffset)==null||i.call(e)}),Mt(this,yt,e=>{let{key:i}=e;if(!this.keysUsed.includes(i)){this.removeEventListener("keyup",V(this,yt));return}this.preventClick||this.handleClick(e)}),Mt(this,Ea,e=>{
let{metaKey:i,altKey:a,key:r}=e;if(i||a||!this.keysUsed.includes(r)){this.removeEventListener("keyup",V(this,yt));return}this.addEventListener("keyup",V(this,yt),{once:!0})}),!this.shadowRoot){this.attachShadow(this.constructor.shadowRootOptions);let e=F(this.attributes),i=this.constructor.getTemplateHTML(e);this.shadowRoot.setHTMLUnsafe?this.shadowRoot.setHTMLUnsafe(i):this.shadowRoot.innerHTML=i}this.tooltipEl=this.shadowRoot.querySelector("media-tooltip")}static get observedAttributes(){return[
"disabled",We.TOOLTIP_PLACEMENT,M.MEDIA_CONTROLLER,o.MEDIA_LANG]}enable(){this.addEventListener("click",V(this,kt)),this.addEventListener("keydown",V(this,Ea)),this.tabIndex=0}disable(){this.removeEventListener("click",V(this,kt)),this.removeEventListener("keydown",V(this,Ea)),this.removeEventListener("keyup",V(this,yt)),this.tabIndex=-1}attributeChangedCallback(e,i,a){var r,s,l,d,c;e===M.MEDIA_CONTROLLER?(i&&((s=(r=V(this,Ae))==null?void 0:r.unassociateElement)==null||s.call(r,this),pa(this,Ae,
null)),a&&this.isConnected&&(pa(this,Ae,(l=this.getRootNode())==null?void 0:l.getElementById(a)),(c=(d=V(this,Ae))==null?void 0:d.associateElement)==null||c.call(d,this))):e==="disabled"&&a!==i?a==null?this.enable():this.disable():e===We.TOOLTIP_PLACEMENT&&this.tooltipEl&&a!==i?this.tooltipEl.placement=a:e===o.MEDIA_LANG&&(this.shadowRoot.querySelector('slot[name="tooltip-content"]').innerHTML=this.constructor.getTooltipContentHTML()),V(this,Ve).call(this)}connectedCallback(){var e,i,a;let{style:r}=x(
this.shadowRoot,":host");r.setProperty("display",`var(--media-control-display, var(--${this.localName}-display, inline-flex))`),this.hasAttribute("disabled")?this.disable():this.enable(),this.setAttribute("role","button");let s=this.getAttribute(M.MEDIA_CONTROLLER);s&&(pa(this,Ae,(e=this.getRootNode())==null?void 0:e.getElementById(s)),(a=(i=V(this,Ae))==null?void 0:i.associateElement)==null||a.call(i,this)),n.customElements.whenDefined("media-tooltip").then(()=>xl(this,Or,Hs).call(this))}disconnectedCallback(){
var e,i;this.disable(),(i=(e=V(this,Ae))==null?void 0:e.unassociateElement)==null||i.call(e,this),pa(this,Ae,null),this.removeEventListener("mouseenter",V(this,Ve)),this.removeEventListener("focus",V(this,Ve)),this.removeEventListener("click",V(this,kt))}get keysUsed(){return["Enter"," "]}get tooltipPlacement(){return w(this,We.TOOLTIP_PLACEMENT)}set tooltipPlacement(e){L(this,We.TOOLTIP_PLACEMENT,e)}get mediaController(){return w(this,M.MEDIA_CONTROLLER)}set mediaController(e){L(this,M.MEDIA_CONTROLLER,
e)}get disabled(){return _(this,We.DISABLED)}set disabled(e){g(this,We.DISABLED,e)}get noTooltip(){return _(this,We.NO_TOOLTIP)}set noTooltip(e){g(this,We.NO_TOOLTIP,e)}handleClick(e){}};Ae=new WeakMap;kt=new WeakMap;Ve=new WeakMap;yt=new WeakMap;Ea=new WeakMap;Or=new WeakSet;Hs=function(){this.addEventListener("mouseenter",V(this,Ve)),this.addEventListener("focus",V(this,Ve)),this.addEventListener("click",V(this,kt));let t=this.tooltipPlacement;t&&this.tooltipEl&&(this.tooltipEl.placement=t)};C.
shadowRootOptions={mode:"open"};C.getTemplateHTML=Pl;C.getSlotTemplateHTML=Nl;C.getTooltipContentHTML=Hl;n.customElements.get("media-chrome-button")||n.customElements.define("media-chrome-button",C);var Fl=C;var Fs=`<svg aria-hidden="true" viewBox="0 0 26 24">
  <path d="M22.13 3H3.87a.87.87 0 0 0-.87.87v13.26a.87.87 0 0 0 .87.87h3.4L9 16H5V5h16v11h-4l1.72 2h3.4a.87.87 0 0 0 .87-.87V3.87a.87.87 0 0 0-.86-.87Zm-8.75 11.44a.5.5 0 0 0-.76 0l-4.91 5.73a.5.5 0 0 0 .38.83h9.82a.501.501 0 0 0 .38-.83l-4.91-5.73Z"/>
</svg>
`;function Bl(t){return`
    <style>
      :host([${o.MEDIA_IS_AIRPLAYING}]) slot[name=icon] slot:not([name=exit]) {
        display: none !important;
      }

      
      :host(:not([${o.MEDIA_IS_AIRPLAYING}])) slot[name=icon] slot:not([name=enter]) {
        display: none !important;
      }

      :host([${o.MEDIA_IS_AIRPLAYING}]) slot[name=tooltip-enter],
      :host(:not([${o.MEDIA_IS_AIRPLAYING}])) slot[name=tooltip-exit] {
        display: none;
      }
    </style>

    <slot name="icon">
      <slot name="enter">${Fs}</slot>
      <slot name="exit">${Fs}</slot>
    </slot>
  `}function $l(){return`
    <slot name="tooltip-enter">${m("start airplay")}</slot>
    <slot name="tooltip-exit">${m("stop airplay")}</slot>
  `}var Bs=t=>{let e=t.mediaIsAirplaying?m("stop airplay"):m("start airplay");t.setAttribute("aria-label",e)},Lt=class extends C{static get observedAttributes(){return[...super.observedAttributes,o.MEDIA_IS_AIRPLAYING,o.MEDIA_AIRPLAY_UNAVAILABLE]}connectedCallback(){super.connectedCallback(),Bs(this)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),e===o.MEDIA_IS_AIRPLAYING&&Bs(this)}get mediaIsAirplaying(){return _(this,o.MEDIA_IS_AIRPLAYING)}set mediaIsAirplaying(e){g(this,
o.MEDIA_IS_AIRPLAYING,e)}get mediaAirplayUnavailable(){return w(this,o.MEDIA_AIRPLAY_UNAVAILABLE)}set mediaAirplayUnavailable(e){L(this,o.MEDIA_AIRPLAY_UNAVAILABLE,e)}handleClick(){let e=new n.CustomEvent(h.MEDIA_AIRPLAY_REQUEST,{composed:!0,bubbles:!0});this.dispatchEvent(e)}};Lt.getSlotTemplateHTML=Bl;Lt.getTooltipContentHTML=$l;n.customElements.get("media-airplay-button")||n.customElements.define("media-airplay-button",Lt);var Wl=Lt;var Vl=`<svg aria-hidden="true" viewBox="0 0 26 24">
  <path d="M22.83 5.68a2.58 2.58 0 0 0-2.3-2.5c-3.62-.24-11.44-.24-15.06 0a2.58 2.58 0 0 0-2.3 2.5c-.23 4.21-.23 8.43 0 12.64a2.58 2.58 0 0 0 2.3 2.5c3.62.24 11.44.24 15.06 0a2.58 2.58 0 0 0 2.3-2.5c.23-4.21.23-8.43 0-12.64Zm-11.39 9.45a3.07 3.07 0 0 1-1.91.57 3.06 3.06 0 0 1-2.34-1 3.75 3.75 0 0 1-.92-2.67 3.92 3.92 0 0 1 .92-2.77 3.18 3.18 0 0 1 2.43-1 2.94 2.94 0 0 1 2.13.78c.364.359.62.813.74 1.31l-1.43.35a1.49 1.49 0 0 0-1.51-1.17 1.61 1.61 0 0 0-1.29.58 2.79 2.79 0 0 0-.5 1.89 3 3 0 0 0 .4\
9 1.93 1.61 1.61 0 0 0 1.27.58 1.48 1.48 0 0 0 1-.37 2.1 2.1 0 0 0 .59-1.14l1.4.44a3.23 3.23 0 0 1-1.07 1.69Zm7.22 0a3.07 3.07 0 0 1-1.91.57 3.06 3.06 0 0 1-2.34-1 3.75 3.75 0 0 1-.92-2.67 3.88 3.88 0 0 1 .93-2.77 3.14 3.14 0 0 1 2.42-1 3 3 0 0 1 2.16.82 2.8 2.8 0 0 1 .73 1.31l-1.43.35a1.49 1.49 0 0 0-1.51-1.21 1.61 1.61 0 0 0-1.29.58A2.79 2.79 0 0 0 15 12a3 3 0 0 0 .49 1.93 1.61 1.61 0 0 0 1.27.58 1.44 1.44 0 0 0 1-.37 2.1 2.1 0 0 0 .6-1.15l1.4.44a3.17 3.17 0 0 1-1.1 1.7Z"/>
</svg>`,Kl=`<svg aria-hidden="true" viewBox="0 0 26 24">
  <path d="M17.73 14.09a1.4 1.4 0 0 1-1 .37 1.579 1.579 0 0 1-1.27-.58A3 3 0 0 1 15 12a2.8 2.8 0 0 1 .5-1.85 1.63 1.63 0 0 1 1.29-.57 1.47 1.47 0 0 1 1.51 1.2l1.43-.34A2.89 2.89 0 0 0 19 9.07a3 3 0 0 0-2.14-.78 3.14 3.14 0 0 0-2.42 1 3.91 3.91 0 0 0-.93 2.78 3.74 3.74 0 0 0 .92 2.66 3.07 3.07 0 0 0 2.34 1 3.07 3.07 0 0 0 1.91-.57 3.17 3.17 0 0 0 1.07-1.74l-1.4-.45c-.083.43-.3.822-.62 1.12Zm-7.22 0a1.43 1.43 0 0 1-1 .37 1.58 1.58 0 0 1-1.27-.58A3 3 0 0 1 7.76 12a2.8 2.8 0 0 1 .5-1.85 1.63 1.63 0 \
0 1 1.29-.57 1.47 1.47 0 0 1 1.51 1.2l1.43-.34a2.81 2.81 0 0 0-.74-1.32 2.94 2.94 0 0 0-2.13-.78 3.18 3.18 0 0 0-2.43 1 4 4 0 0 0-.92 2.78 3.74 3.74 0 0 0 .92 2.66 3.07 3.07 0 0 0 2.34 1 3.07 3.07 0 0 0 1.91-.57 3.23 3.23 0 0 0 1.07-1.74l-1.4-.45a2.06 2.06 0 0 1-.6 1.07Zm12.32-8.41a2.59 2.59 0 0 0-2.3-2.51C18.72 3.05 15.86 3 13 3c-2.86 0-5.72.05-7.53.17a2.59 2.59 0 0 0-2.3 2.51c-.23 4.207-.23 8.423 0 12.63a2.57 2.57 0 0 0 2.3 2.5c1.81.13 4.67.19 7.53.19 2.86 0 5.72-.06 7.53-.19a2.57 2.57 0 0 0 2\
.3-2.5c.23-4.207.23-8.423 0-12.63Zm-1.49 12.53a1.11 1.11 0 0 1-.91 1.11c-1.67.11-4.45.18-7.43.18-2.98 0-5.76-.07-7.43-.18a1.11 1.11 0 0 1-.91-1.11c-.21-4.14-.21-8.29 0-12.43a1.11 1.11 0 0 1 .91-1.11C7.24 4.56 10 4.49 13 4.49s5.76.07 7.43.18a1.11 1.11 0 0 1 .91 1.11c.21 4.14.21 8.29 0 12.43Z"/>
</svg>`;function Gl(t){return`
    <style>
      :host([aria-checked="true"]) slot[name=off] {
        display: none !important;
      }

      
      :host(:not([aria-checked="true"])) slot[name=on] {
        display: none !important;
      }

      :host([aria-checked="true"]) slot[name=tooltip-enable],
      :host(:not([aria-checked="true"])) slot[name=tooltip-disable] {
        display: none;
      }
    </style>

    <slot name="icon">
      <slot name="on">${Vl}</slot>
      <slot name="off">${Kl}</slot>
    </slot>
  `}function ql(){return`
    <slot name="tooltip-enable">${m("Enable captions")}</slot>
    <slot name="tooltip-disable">${m("Disable captions")}</slot>
  `}var $s=t=>{t.setAttribute("aria-checked",Es(t).toString())},wt=class extends C{static get observedAttributes(){return[...super.observedAttributes,o.MEDIA_SUBTITLES_LIST,o.MEDIA_SUBTITLES_SHOWING]}connectedCallback(){super.connectedCallback(),this.setAttribute("role","button"),this.setAttribute("aria-label",m("closed captions")),$s(this)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),e===o.MEDIA_SUBTITLES_SHOWING&&$s(this)}get mediaSubtitlesList(){return Ws(this,o.MEDIA_SUBTITLES_LIST)}set mediaSubtitlesList(e){
Vs(this,o.MEDIA_SUBTITLES_LIST,e)}get mediaSubtitlesShowing(){return Ws(this,o.MEDIA_SUBTITLES_SHOWING)}set mediaSubtitlesShowing(e){Vs(this,o.MEDIA_SUBTITLES_SHOWING,e)}handleClick(){this.dispatchEvent(new n.CustomEvent(h.MEDIA_TOGGLE_SUBTITLES_REQUEST,{composed:!0,bubbles:!0}))}};wt.getSlotTemplateHTML=Gl;wt.getTooltipContentHTML=ql;var Ws=(t,e)=>{let i=t.getAttribute(e);return i?Tr(i):[]},Vs=(t,e,i)=>{if(!i?.length){t.removeAttribute(e);return}let a=pi(i);t.getAttribute(e)!==a&&t.setAttribute(
e,a)};n.customElements.get("media-captions-button")||n.customElements.define("media-captions-button",wt);var Yl=wt;var Ql='<svg aria-hidden="true" viewBox="0 0 24 24"><g><path class="cast_caf_icon_arch0" d="M1,18 L1,21 L4,21 C4,19.3 2.66,18 1,18 L1,18 Z"/><path class="cast_caf_icon_arch1" d="M1,14 L1,16 C3.76,16 6,18.2 6,21 L8,21 C8,17.13 4.87,14 1,14 L1,14 Z"/><path class="cast_caf_icon_arch2" d="M1,10 L1,12 C5.97,12 10,16.0 10,21 L12,21 C12,14.92 7.07,10 1,10 L1,10 Z"/><path class="cast_caf_icon_box" d="M21,3 L3,3 C1.9,3 1,3.9 1,5 L1,8 L3,8 L3,5 L21,5 L21,19 L14,19 L14,21 L21,21 C22.1,21 23,20.1 23,19 L23,\
5 C23,3.9 22.1,3 21,3 L21,3 Z"/></g></svg>',zl='<svg aria-hidden="true" viewBox="0 0 24 24"><g><path class="cast_caf_icon_arch0" d="M1,18 L1,21 L4,21 C4,19.3 2.66,18 1,18 L1,18 Z"/><path class="cast_caf_icon_arch1" d="M1,14 L1,16 C3.76,16 6,18.2 6,21 L8,21 C8,17.13 4.87,14 1,14 L1,14 Z"/><path class="cast_caf_icon_arch2" d="M1,10 L1,12 C5.97,12 10,16.0 10,21 L12,21 C12,14.92 7.07,10 1,10 L1,10 Z"/><path class="cast_caf_icon_box" d="M21,3 L3,3 C1.9,3 1,3.9 1,5 L1,8 L3,8 L3,5 L21,5 L21,19 L14,19 L\
14,21 L21,21 C22.1,21 23,20.1 23,19 L23,5 C23,3.9 22.1,3 21,3 L21,3 Z"/><path class="cast_caf_icon_boxfill" d="M5,7 L5,8.63 C8,8.6 13.37,14 13.37,17 L19,17 L19,7 Z"/></g></svg>';function Zl(t){return`
    <style>
      :host([${o.MEDIA_IS_CASTING}]) slot[name=icon] slot:not([name=exit]) {
        display: none !important;
      }

      
      :host(:not([${o.MEDIA_IS_CASTING}])) slot[name=icon] slot:not([name=enter]) {
        display: none !important;
      }

      :host([${o.MEDIA_IS_CASTING}]) slot[name=tooltip-enter],
      :host(:not([${o.MEDIA_IS_CASTING}])) slot[name=tooltip-exit] {
        display: none;
      }
    </style>

    <slot name="icon">
      <slot name="enter">${Ql}</slot>
      <slot name="exit">${zl}</slot>
    </slot>
  `}function Xl(){return`
    <slot name="tooltip-enter">${m("Start casting")}</slot>
    <slot name="tooltip-exit">${m("Stop casting")}</slot>
  `}var Ks=t=>{let e=t.mediaIsCasting?m("stop casting"):m("start casting");t.setAttribute("aria-label",e)},Rt=class extends C{static get observedAttributes(){return[...super.observedAttributes,o.MEDIA_IS_CASTING,o.MEDIA_CAST_UNAVAILABLE]}connectedCallback(){super.connectedCallback(),Ks(this)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),e===o.MEDIA_IS_CASTING&&Ks(this)}get mediaIsCasting(){return _(this,o.MEDIA_IS_CASTING)}set mediaIsCasting(e){g(this,o.MEDIA_IS_CASTING,e)}get mediaCastUnavailable(){
return w(this,o.MEDIA_CAST_UNAVAILABLE)}set mediaCastUnavailable(e){L(this,o.MEDIA_CAST_UNAVAILABLE,e)}handleClick(){let e=this.mediaIsCasting?h.MEDIA_EXIT_CAST_REQUEST:h.MEDIA_ENTER_CAST_REQUEST;this.dispatchEvent(new n.CustomEvent(e,{composed:!0,bubbles:!0}))}};Rt.getSlotTemplateHTML=Zl;Rt.getTooltipContentHTML=Xl;n.customElements.get("media-cast-button")||n.customElements.define("media-cast-button",Rt);var Jl=Rt;var $r=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},at=(t,e,i)=>($r(t,e,"read from private field"),i?i.call(t):e.get(t)),xe=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},Wr=(t,e,i,a)=>($r(t,e,"write to private field"),a?a.call(t,i):e.set(t,i),i),it=(t,e,i)=>($r(t,e,"access private method"),i),fa,Ai,rt,va,xr,Pr,Gs,Nr,qs,Hr,Ys,Fr,Qs,Br,zs;function jl(t){return`
    <style>
      :host {
        font: var(--media-font,
          var(--media-font-weight, normal)
          var(--media-font-size, 14px) /
          var(--media-text-content-height, var(--media-control-height, 24px))
          var(--media-font-family, helvetica neue, segoe ui, roboto, arial, sans-serif));
        color: var(--media-text-color, var(--media-primary-color, rgb(238 238 238)));
        display: var(--media-dialog-display, inline-flex);
        justify-content: center;
        align-items: center;
        
        transition-behavior: allow-discrete;
        visibility: hidden;
        opacity: 0;
        transform: translateY(2px) scale(.99);
        pointer-events: none;
      }

      :host([open]) {
        transition: display .2s, visibility 0s, opacity .2s ease-out, transform .15s ease-out;
        visibility: visible;
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }

      #content {
        display: flex;
        position: relative;
        box-sizing: border-box;
        width: min(320px, 100%);
        word-wrap: break-word;
        max-height: 100%;
        overflow: auto;
        text-align: center;
        line-height: 1.4;
      }
    </style>
    ${this.getSlotTemplateHTML(t)}
  `}function ed(t){return`
    <slot id="content"></slot>
  `}var bi={OPEN:"open",ANCHOR:"anchor"},me=class extends n.HTMLElement{constructor(){super(),xe(this,va),xe(this,Pr),xe(this,Nr),xe(this,Hr),xe(this,Fr),xe(this,Br),xe(this,fa,!1),xe(this,Ai,null),xe(this,rt,null)}static get observedAttributes(){return[bi.OPEN,bi.ANCHOR]}get open(){return _(this,bi.OPEN)}set open(e){g(this,bi.OPEN,e)}handleEvent(e){switch(e.type){case"invoke":it(this,Hr,Ys).call(this,e);break;case"focusout":it(this,Fr,Qs).call(this,e);break;case"keydown":it(this,Br,zs).call(this,
e);break}}connectedCallback(){it(this,va,xr).call(this),this.role||(this.role="dialog"),this.addEventListener("invoke",this),this.addEventListener("focusout",this),this.addEventListener("keydown",this)}disconnectedCallback(){this.removeEventListener("invoke",this),this.removeEventListener("focusout",this),this.removeEventListener("keydown",this)}attributeChangedCallback(e,i,a){it(this,va,xr).call(this),e===bi.OPEN&&a!==i&&(this.open?it(this,Pr,Gs).call(this):it(this,Nr,qs).call(this))}focus(){Wr(
this,Ai,Er());let e=!this.dispatchEvent(new Event("focus",{composed:!0,cancelable:!0})),i=!this.dispatchEvent(new Event("focusin",{composed:!0,bubbles:!0,cancelable:!0}));if(e||i)return;let a=this.querySelector('[autofocus], [tabindex]:not([tabindex="-1"]), [role="menu"]');a?.focus()}get keysUsed(){return["Escape","Tab"]}};fa=new WeakMap;Ai=new WeakMap;rt=new WeakMap;va=new WeakSet;xr=function(){if(!at(this,fa)&&(Wr(this,fa,!0),!this.shadowRoot)){this.attachShadow(this.constructor.shadowRootOptions);
let t=F(this.attributes);this.shadowRoot.innerHTML=this.constructor.getTemplateHTML(t),queueMicrotask(()=>{let{style:e}=x(this.shadowRoot,":host");e.setProperty("transition","display .15s, visibility .15s, opacity .15s ease-in, transform .15s ease-in")})}};Pr=new WeakSet;Gs=function(){var t;(t=at(this,rt))==null||t.setAttribute("aria-expanded","true"),this.dispatchEvent(new Event("open",{composed:!0,bubbles:!0})),this.addEventListener("transitionend",()=>this.focus(),{once:!0})};Nr=new WeakSet;qs=
function(){var t;(t=at(this,rt))==null||t.setAttribute("aria-expanded","false"),this.dispatchEvent(new Event("close",{composed:!0,bubbles:!0}))};Hr=new WeakSet;Ys=function(t){Wr(this,rt,t.relatedTarget),_e(this,t.relatedTarget)||(this.open=!this.open)};Fr=new WeakSet;Qs=function(t){var e;_e(this,t.relatedTarget)||((e=at(this,Ai))==null||e.focus(),at(this,rt)&&at(this,rt)!==t.relatedTarget&&this.open&&(this.open=!1))};Br=new WeakSet;zs=function(t){var e,i,a,r,s;let{key:l,ctrlKey:d,altKey:c,metaKey:y}=t;
d||c||y||this.keysUsed.includes(l)&&(t.preventDefault(),t.stopPropagation(),l==="Tab"?(t.shiftKey?(i=(e=this.previousElementSibling)==null?void 0:e.focus)==null||i.call(e):(r=(a=this.nextElementSibling)==null?void 0:a.focus)==null||r.call(a),this.blur()):l==="Escape"&&((s=at(this,Ai))==null||s.focus(),this.open=!1))};me.shadowRootOptions={mode:"open"};me.getTemplateHTML=jl;me.getSlotTemplateHTML=ed;n.customElements.get("media-chrome-dialog")||n.customElements.define("media-chrome-dialog",me);var td=me;var zr=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},H=(t,e,i)=>(zr(t,e,"read from private field"),i?i.call(t):e.get(t)),z=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},Ke=(t,e,i,a)=>(zr(t,e,"write to private field"),a?a.call(t,i):e.set(t,i),i),pe=(t,e,i)=>(zr(t,e,"access private method"),i),Te,ka,_a,ga,Ee,Ma,ba,Aa,Ta,Zr,Zs,Ia,Vr,Sa,Kr,ya,Xr,Gr,Xs,qr,Js,Yr,js,Qr,en;function id(t){return`
    <style>
      :host {
        --_focus-box-shadow: var(--media-focus-box-shadow, inset 0 0 0 2px rgb(27 127 204 / .9));
        --_media-range-padding: var(--media-range-padding, var(--media-control-padding, 10px));

        box-shadow: var(--_focus-visible-box-shadow, none);
        background: var(--media-control-background, var(--media-secondary-color, rgb(20 20 30 / .7)));
        height: calc(var(--media-control-height, 24px) + 2 * var(--_media-range-padding));
        display: inline-flex;
        align-items: center;
        
        vertical-align: middle;
        box-sizing: border-box;
        position: relative;
        width: 100px;
        transition: background .15s linear;
        cursor: var(--media-cursor, pointer);
        pointer-events: auto;
        touch-action: none; 
      }

      
      input[type=range]:focus {
        outline: 0;
      }
      input[type=range]:focus::-webkit-slider-runnable-track {
        outline: 0;
      }

      :host(:hover) {
        background: var(--media-control-hover-background, rgb(50 50 70 / .7));
      }

      #leftgap {
        padding-left: var(--media-range-padding-left, var(--_media-range-padding));
      }

      #rightgap {
        padding-right: var(--media-range-padding-right, var(--_media-range-padding));
      }

      #startpoint,
      #endpoint {
        position: absolute;
      }

      #endpoint {
        right: 0;
      }

      #container {
        
        width: var(--media-range-track-width, 100%);
        transform: translate(var(--media-range-track-translate-x, 0px), var(--media-range-track-translate-y, 0px));
        position: relative;
        height: 100%;
        display: flex;
        align-items: center;
        min-width: 40px;
      }

      #range {
        
        display: var(--media-time-range-hover-display, block);
        bottom: var(--media-time-range-hover-bottom, 0);
        height: var(--media-time-range-hover-height, max(100% , 25px));
        width: 100%;
        position: absolute;
        cursor: var(--media-cursor, pointer);

        -webkit-appearance: none; 
        -webkit-tap-highlight-color: transparent;
        background: transparent; 
        margin: 0;
        z-index: 1;
      }

      @media (hover: hover) {
        #range {
          bottom: var(--media-time-range-hover-bottom, 0);
          height: var(--media-time-range-hover-height, max(100%, 20px));
        }
      }

      
      
      #range::-webkit-slider-thumb {
        -webkit-appearance: none;
        background: transparent;
        width: .1px;
        height: .1px;
      }

      
      #range::-moz-range-thumb {
        background: transparent;
        border: transparent;
        width: .1px;
        height: .1px;
      }

      #appearance {
        height: var(--media-range-track-height, 4px);
        display: flex;
        flex-direction: column;
        justify-content: center;
        width: 100%;
        position: absolute;
        
        will-change: transform;
      }

      #track {
        background: var(--media-range-track-background, rgb(255 255 255 / .2));
        border-radius: var(--media-range-track-border-radius, 1px);
        border: var(--media-range-track-border, none);
        outline: var(--media-range-track-outline);
        outline-offset: var(--media-range-track-outline-offset);
        backdrop-filter: var(--media-range-track-backdrop-filter);
        -webkit-backdrop-filter: var(--media-range-track-backdrop-filter);
        box-shadow: var(--media-range-track-box-shadow, none);
        position: absolute;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }

      #progress,
      #pointer {
        position: absolute;
        height: 100%;
        will-change: width;
      }

      #progress {
        background: var(--media-range-bar-color, var(--media-primary-color, rgb(238 238 238)));
        transition: var(--media-range-track-transition);
      }

      #pointer {
        background: var(--media-range-track-pointer-background);
        border-right: var(--media-range-track-pointer-border-right);
        transition: visibility .25s, opacity .25s;
        visibility: hidden;
        opacity: 0;
      }

      @media (hover: hover) {
        :host(:hover) #pointer {
          transition: visibility .5s, opacity .5s;
          visibility: visible;
          opacity: 1;
        }
      }

      #thumb,
      ::slotted([slot=thumb]) {
        width: var(--media-range-thumb-width, 10px);
        height: var(--media-range-thumb-height, 10px);
        transition: var(--media-range-thumb-transition);
        transform: var(--media-range-thumb-transform, none);
        opacity: var(--media-range-thumb-opacity, 1);
        translate: -50%;
        position: absolute;
        left: 0;
        cursor: var(--media-cursor, pointer);
      }

      #thumb {
        border-radius: var(--media-range-thumb-border-radius, 10px);
        background: var(--media-range-thumb-background, var(--media-primary-color, rgb(238 238 238)));
        box-shadow: var(--media-range-thumb-box-shadow, 1px 1px 1px transparent);
        border: var(--media-range-thumb-border, none);
      }

      :host([disabled]) #thumb {
        background-color: #777;
      }

      .segments #appearance {
        height: var(--media-range-segment-hover-height, 7px);
      }

      #track {
        clip-path: url(#segments-clipping);
      }

      #segments {
        --segments-gap: var(--media-range-segments-gap, 2px);
        position: absolute;
        width: 100%;
        height: 100%;
      }

      #segments-clipping {
        transform: translateX(calc(var(--segments-gap) / 2));
      }

      #segments-clipping:empty {
        display: none;
      }

      #segments-clipping rect {
        height: var(--media-range-track-height, 4px);
        y: calc((var(--media-range-segment-hover-height, 7px) - var(--media-range-track-height, 4px)) / 2);
        transition: var(--media-range-segment-transition, transform .1s ease-in-out);
        transform: var(--media-range-segment-transform, scaleY(1));
        transform-origin: center;
      }

      /* Visible label for accessibility - positioned off-screen but technically visible (Firefox requires visible labels) */
      #range-label {
        position: absolute;
        left: -10000px;
        background: var(--media-control-background, var(--media-secondary-color, rgb(20 20 30 / .7)));
        pointer-events: none;
      }
    </style>
    <div id="leftgap"></div>
    <div id="container">
      <div id="startpoint"></div>
      <div id="endpoint"></div>
      <div id="appearance">
        <div id="track" part="track">
          <div id="pointer"></div>
          <div id="progress" part="progress"></div>
        </div>
        <slot name="thumb">
          <div id="thumb" part="thumb"></div>
        </slot>
        <svg id="segments" aria-hidden="true"><clipPath id="segments-clipping"></clipPath></svg>
      </div>
        <input id="range" type="range" min="0" max="1" step="any" value="0">
        <label for="range" id="range-label"></label>

      ${this.getContainerTemplateHTML(t)}
    </div>
    <div id="rightgap"></div>
  `}function ad(t){return""}var ve=class extends n.HTMLElement{constructor(){if(super(),z(this,Zr),z(this,Ia),z(this,Sa),z(this,ya),z(this,Gr),z(this,qr),z(this,Yr),z(this,Qr),z(this,Te,void 0),z(this,ka,void 0),z(this,_a,void 0),z(this,ga,void 0),z(this,Ee,{}),z(this,Ma,[]),z(this,ba,()=>{if(this.range.matches(":focus-visible")){let{style:e}=x(this.shadowRoot,":host");e.setProperty("--_focus-visible-box-shadow","var(--_focus-box-shadow)")}}),z(this,Aa,()=>{let{style:e}=x(this.shadowRoot,":host");
e.removeProperty("--_focus-visible-box-shadow")}),z(this,Ta,()=>{let e=this.shadowRoot.querySelector("#segments-clipping");e&&e.parentNode.append(e)}),!this.shadowRoot){this.attachShadow(this.constructor.shadowRootOptions);let e=F(this.attributes),i=this.constructor.getTemplateHTML(e);this.shadowRoot.setHTMLUnsafe?this.shadowRoot.setHTMLUnsafe(i):this.shadowRoot.innerHTML=i}this.container=this.shadowRoot.querySelector("#container"),Ke(this,_a,this.shadowRoot.querySelector("#startpoint")),Ke(this,
ga,this.shadowRoot.querySelector("#endpoint")),this.range=this.shadowRoot.querySelector("#range"),this.appearance=this.shadowRoot.querySelector("#appearance")}static get observedAttributes(){return["disabled","aria-disabled",M.MEDIA_CONTROLLER]}attributeChangedCallback(e,i,a){var r,s,l,d,c;e===M.MEDIA_CONTROLLER?(i&&((s=(r=H(this,Te))==null?void 0:r.unassociateElement)==null||s.call(r,this),Ke(this,Te,null)),a&&this.isConnected&&(Ke(this,Te,(l=this.getRootNode())==null?void 0:l.getElementById(a)),
(c=(d=H(this,Te))==null?void 0:d.associateElement)==null||c.call(d,this))):(e==="disabled"||e==="aria-disabled"&&i!==a)&&(a==null?(this.range.removeAttribute(e),pe(this,Ia,Vr).call(this)):(this.range.setAttribute(e,a),pe(this,Sa,Kr).call(this)))}connectedCallback(){var e,i,a;let{style:r}=x(this.shadowRoot,":host");r.setProperty("display",`var(--media-control-display, var(--${this.localName}-display, inline-flex))`),H(this,Ee).pointer=x(this.shadowRoot,"#pointer"),H(this,Ee).progress=x(this.shadowRoot,
"#progress"),H(this,Ee).thumb=x(this.shadowRoot,'#thumb, ::slotted([slot="thumb"])'),H(this,Ee).activeSegment=x(this.shadowRoot,"#segments-clipping rect:nth-child(0)");let s=this.getAttribute(M.MEDIA_CONTROLLER);s&&(Ke(this,Te,(e=this.getRootNode())==null?void 0:e.getElementById(s)),(a=(i=H(this,Te))==null?void 0:i.associateElement)==null||a.call(i,this)),this.updateBar(),this.shadowRoot.addEventListener("focusin",H(this,ba)),this.shadowRoot.addEventListener("focusout",H(this,Aa)),pe(this,Ia,Vr).
call(this),Gi(this.container,H(this,Ta))}disconnectedCallback(){var e,i;pe(this,Sa,Kr).call(this),(i=(e=H(this,Te))==null?void 0:e.unassociateElement)==null||i.call(e,this),Ke(this,Te,null),this.shadowRoot.removeEventListener("focusin",H(this,ba)),this.shadowRoot.removeEventListener("focusout",H(this,Aa)),qi(this.container,H(this,Ta))}updatePointerBar(e){var i;(i=H(this,Ee).pointer)==null||i.style.setProperty("width",`${this.getPointerRatio(e)*100}%`)}updateBar(){var e,i;let a=this.range.valueAsNumber*
100;(e=H(this,Ee).progress)==null||e.style.setProperty("width",`${a}%`),(i=H(this,Ee).thumb)==null||i.style.setProperty("left",`${a}%`)}updateSegments(e){let i=this.shadowRoot.querySelector("#segments-clipping");if(i.textContent="",this.container.classList.toggle("segments",!!e?.length),!e?.length)return;let a=[...new Set([+this.range.min,...e.flatMap(s=>[s.start,s.end]),+this.range.max])];Ke(this,Ma,[...a]);let r=a.pop();for(let[s,l]of a.entries()){let[d,c]=[s===0,s===a.length-1],y=d?"calc(var(\
--segments-gap) / -1)":`${l*100}%`,T=`calc(${((c?r:a[s+1])-l)*100}%${d||c?"":" - var(--segments-gap)"})`,f=W.createElementNS("http://www.w3.org/2000/svg","rect"),p=vr(this.shadowRoot,`#segments-clipping rect:nth-child(${s+1})`);p.style.setProperty("x",y),p.style.setProperty("width",T),i.append(f)}}getPointerRatio(e){return ns(e.clientX,e.clientY,H(this,_a).getBoundingClientRect(),H(this,ga).getBoundingClientRect())}get dragging(){return this.hasAttribute("dragging")}handleEvent(e){switch(e.type){case"\
pointermove":pe(this,Qr,en).call(this,e);break;case"input":this.updateBar();break;case"pointerenter":pe(this,Gr,Xs).call(this,e);break;case"pointerdown":pe(this,ya,Xr).call(this,e);break;case"pointerup":pe(this,qr,Js).call(this);break;case"pointerleave":pe(this,Yr,js).call(this);break}}get keysUsed(){return["ArrowUp","ArrowRight","ArrowDown","ArrowLeft"]}};Te=new WeakMap;ka=new WeakMap;_a=new WeakMap;ga=new WeakMap;Ee=new WeakMap;Ma=new WeakMap;ba=new WeakMap;Aa=new WeakMap;Ta=new WeakMap;Zr=new WeakSet;
Zs=function(t){let e=H(this,Ee).activeSegment;if(!e)return;let i=this.getPointerRatio(t),r=`#segments-clipping rect:nth-child(${H(this,Ma).findIndex((s,l,d)=>{let c=d[l+1];return c!=null&&i>=s&&i<=c})+1})`;(e.selectorText!=r||!e.style.transform)&&(e.selectorText=r,e.style.setProperty("transform","var(--media-range-segment-hover-transform, scaleY(2))"))};Ia=new WeakSet;Vr=function(){this.hasAttribute("disabled")||!this.isConnected||(this.addEventListener("input",this),this.addEventListener("point\
erdown",this),this.addEventListener("pointerenter",this))};Sa=new WeakSet;Kr=function(){var t,e;this.removeEventListener("input",this),this.removeEventListener("pointerdown",this),this.removeEventListener("pointerenter",this),this.removeEventListener("pointerleave",this),(t=n.window)==null||t.removeEventListener("pointerup",this),(e=n.window)==null||e.removeEventListener("pointermove",this)};ya=new WeakSet;Xr=function(t){var e;Ke(this,ka,t.composedPath().includes(this.range)),(e=n.window)==null||
e.addEventListener("pointerup",this,{once:!0})};Gr=new WeakSet;Xs=function(t){var e;t.pointerType!=="mouse"&&pe(this,ya,Xr).call(this,t),this.addEventListener("pointerleave",this,{once:!0}),(e=n.window)==null||e.addEventListener("pointermove",this)};qr=new WeakSet;Js=function(){var t;(t=n.window)==null||t.removeEventListener("pointerup",this),this.toggleAttribute("dragging",!1),this.range.disabled=this.hasAttribute("disabled")};Yr=new WeakSet;js=function(){var t,e;this.removeEventListener("point\
erleave",this),(t=n.window)==null||t.removeEventListener("pointermove",this),this.toggleAttribute("dragging",!1),this.range.disabled=this.hasAttribute("disabled"),(e=H(this,Ee).activeSegment)==null||e.style.removeProperty("transform")};Qr=new WeakSet;en=function(t){t.pointerType==="pen"&&t.buttons===0||(this.toggleAttribute("dragging",t.buttons===1||t.pointerType!=="mouse"),this.updatePointerBar(t),pe(this,Zr,Zs).call(this,t),this.dragging&&(t.pointerType!=="mouse"||!H(this,ka))&&(this.range.disabled=
!0,this.range.valueAsNumber=this.getPointerRatio(t),this.range.dispatchEvent(new Event("input",{bubbles:!0,composed:!0}))))};ve.shadowRootOptions={mode:"open"};ve.getTemplateHTML=id;ve.getContainerTemplateHTML=ad;n.customElements.get("media-chrome-range")||n.customElements.define("media-chrome-range",ve);var rd=ve;var tn=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},La=(t,e,i)=>(tn(t,e,"read from private field"),i?i.call(t):e.get(t)),od=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},wa=(t,e,i,a)=>(tn(t,e,"write to private field"),a?a.call(t,i):e.set(t,i),i),Ie;function sd(t){return`
    <style>
      :host {
        
        box-sizing: border-box;
        display: var(--media-control-display, var(--media-control-bar-display, inline-flex));
        color: var(--media-text-color, var(--media-primary-color, rgb(238 238 238)));
        --media-loading-indicator-icon-height: 44px;
      }

      ::slotted(media-time-range),
      ::slotted(media-volume-range) {
        min-height: 100%;
      }

      ::slotted(media-time-range),
      ::slotted(media-clip-selector) {
        flex-grow: 1;
      }

      ::slotted([role="menu"]) {
        position: absolute;
      }
    </style>

    <slot></slot>
  `}var Dt=class extends n.HTMLElement{constructor(){if(super(),od(this,Ie,void 0),!this.shadowRoot){this.attachShadow(this.constructor.shadowRootOptions);let e=F(this.attributes);this.shadowRoot.innerHTML=this.constructor.getTemplateHTML(e)}}static get observedAttributes(){return[M.MEDIA_CONTROLLER]}attributeChangedCallback(e,i,a){var r,s,l,d,c;e===M.MEDIA_CONTROLLER&&(i&&((s=(r=La(this,Ie))==null?void 0:r.unassociateElement)==null||s.call(r,this),wa(this,Ie,null)),a&&this.isConnected&&(wa(this,
Ie,(l=this.getRootNode())==null?void 0:l.getElementById(a)),(c=(d=La(this,Ie))==null?void 0:d.associateElement)==null||c.call(d,this)))}connectedCallback(){var e,i,a;let r=this.getAttribute(M.MEDIA_CONTROLLER);r&&(wa(this,Ie,(e=this.getRootNode())==null?void 0:e.getElementById(r)),(a=(i=La(this,Ie))==null?void 0:i.associateElement)==null||a.call(i,this))}disconnectedCallback(){var e,i;(i=(e=La(this,Ie))==null?void 0:e.unassociateElement)==null||i.call(e,this),wa(this,Ie,null)}};Ie=new WeakMap;Dt.
shadowRootOptions={mode:"open"};Dt.getTemplateHTML=sd;n.customElements.get("media-control-bar")||n.customElements.define("media-control-bar",Dt);var nd=Dt;var an=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},Ra=(t,e,i)=>(an(t,e,"read from private field"),i?i.call(t):e.get(t)),ld=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},Da=(t,e,i,a)=>(an(t,e,"write to private field"),a?a.call(t,i):e.set(t,i),i),Se;function dd(t,e={}){return`
    <style>
      :host {
        font: var(--media-font,
          var(--media-font-weight, normal)
          var(--media-font-size, 14px) /
          var(--media-text-content-height, var(--media-control-height, 24px))
          var(--media-font-family, helvetica neue, segoe ui, roboto, arial, sans-serif));
        color: var(--media-text-color, var(--media-primary-color, rgb(238 238 238)));
        background: var(--media-text-background, var(--media-control-background, var(--media-secondary-color, rgb(20 20 30 / .7))));
        padding: var(--media-control-padding, 10px);
        display: inline-flex;
        justify-content: center;
        align-items: center;
        vertical-align: middle;
        box-sizing: border-box;
        text-align: center;
        pointer-events: auto;
      }

      
      :host(:focus-visible) {
        box-shadow: var(--media-focus-box-shadow, inset 0 0 0 2px rgb(27 127 204 / .9));
        outline: 0;
      }

      
      :host(:where(:focus)) {
        box-shadow: none;
        outline: 0;
      }
    </style>

    ${this.getSlotTemplateHTML(t,e)}
  `}function cd(t,e){return`
    <slot></slot>
  `}var ee=class extends n.HTMLElement{constructor(){if(super(),ld(this,Se,void 0),!this.shadowRoot){this.attachShadow(this.constructor.shadowRootOptions);let e=F(this.attributes);this.shadowRoot.innerHTML=this.constructor.getTemplateHTML(e)}}static get observedAttributes(){return[M.MEDIA_CONTROLLER]}attributeChangedCallback(e,i,a){var r,s,l,d,c;e===M.MEDIA_CONTROLLER&&(i&&((s=(r=Ra(this,Se))==null?void 0:r.unassociateElement)==null||s.call(r,this),Da(this,Se,null)),a&&this.isConnected&&(Da(this,
Se,(l=this.getRootNode())==null?void 0:l.getElementById(a)),(c=(d=Ra(this,Se))==null?void 0:d.associateElement)==null||c.call(d,this)))}connectedCallback(){var e,i,a;let{style:r}=x(this.shadowRoot,":host");r.setProperty("display",`var(--media-control-display, var(--${this.localName}-display, inline-flex))`);let s=this.getAttribute(M.MEDIA_CONTROLLER);s&&(Da(this,Se,(e=this.getRootNode())==null?void 0:e.getElementById(s)),(a=(i=Ra(this,Se))==null?void 0:i.associateElement)==null||a.call(i,this))}disconnectedCallback(){
var e,i;(i=(e=Ra(this,Se))==null?void 0:e.unassociateElement)==null||i.call(e,this),Da(this,Se,null)}};Se=new WeakMap;ee.shadowRootOptions={mode:"open"};ee.getTemplateHTML=dd;ee.getSlotTemplateHTML=cd;n.customElements.get("media-text-display")||n.customElements.define("media-text-display",ee);var ud=ee;var on=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},rn=(t,e,i)=>(on(t,e,"read from private field"),i?i.call(t):e.get(t)),hd=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},md=(t,e,i,a)=>(on(t,e,"write to private field"),a?a.call(t,i):e.set(t,i),i),Ti;function pd(t,e){return`
    <slot>${re(e.mediaDuration)}</slot>
  `}var Ii=class extends ee{constructor(){var e;super(),hd(this,Ti,void 0),md(this,Ti,this.shadowRoot.querySelector("slot")),rn(this,Ti).textContent=re((e=this.mediaDuration)!=null?e:0)}static get observedAttributes(){return[...super.observedAttributes,o.MEDIA_DURATION]}attributeChangedCallback(e,i,a){e===o.MEDIA_DURATION&&(rn(this,Ti).textContent=re(+a)),super.attributeChangedCallback(e,i,a)}get mediaDuration(){return D(this,o.MEDIA_DURATION)}set mediaDuration(e){U(this,o.MEDIA_DURATION,e)}};Ti=
new WeakMap;Ii.getSlotTemplateHTML=pd;n.customElements.get("media-duration-display")||n.customElements.define("media-duration-display",Ii);var Ed=Ii;var vd={2:m("Network Error"),3:m("Decode Error"),4:m("Source Not Supported"),5:m("Encryption Error")},fd={2:m("A network error caused the media download to fail."),3:m("A media error caused playback to be aborted. The media could be corrupt or your browser does not support this format."),4:m("An unsupported error occurred. The server or network failed, or your browser does not support this format."),5:m("The media is encrypted and there are no keys to decrypt it.")},Ca=t=>{var e,i;return t.code===
1?null:{title:(e=vd[t.code])!=null?e:`Error ${t.code}`,message:(i=fd[t.code])!=null?i:t.message}};var nn=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},_d=(t,e,i)=>(nn(t,e,"read from private field"),i?i.call(t):e.get(t)),gd=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},bd=(t,e,i,a)=>(nn(t,e,"write to private field"),a?a.call(t,i):e.set(t,i),i),Oa;function Ad(t){return`
    <style>
      :host {
        background: rgb(20 20 30 / .8);
      }

      #content {
        display: block;
        padding: 1.2em 1.5em;
      }

      h3,
      p {
        margin-block: 0 .3em;
      }
    </style>
    <slot name="error-${t.mediaerrorcode}" id="content">
      ${ln({code:+t.mediaerrorcode,message:t.mediaerrormessage})}
    </slot>
  `}function Td(t){return t.code&&Ca(t)!==null}function ln(t){var e;let{title:i,message:a}=(e=Ca(t))!=null?e:{},r="";return i&&(r+=`<slot name="error-${t.code}-title"><h3>${i}</h3></slot>`),a&&(r+=`<slot name="error-${t.code}-message"><p>${a}</p></slot>`),r}var sn=[o.MEDIA_ERROR_CODE,o.MEDIA_ERROR_MESSAGE],Ct=class extends me{constructor(){super(...arguments),gd(this,Oa,null)}static get observedAttributes(){return[...super.observedAttributes,...sn]}formatErrorMessage(e){return this.constructor.formatErrorMessage(
e)}attributeChangedCallback(e,i,a){var r;if(super.attributeChangedCallback(e,i,a),!sn.includes(e))return;let s=(r=this.mediaError)!=null?r:{code:this.mediaErrorCode,message:this.mediaErrorMessage};if(this.open=Td(s),this.open&&(this.shadowRoot.querySelector("slot").name=`error-${this.mediaErrorCode}`,this.shadowRoot.querySelector("#content").innerHTML=this.formatErrorMessage(s),!this.hasAttribute("aria-label"))){let{title:l}=Ca(s);l&&this.setAttribute("aria-label",l)}}get mediaError(){return _d(
this,Oa)}set mediaError(e){bd(this,Oa,e)}get mediaErrorCode(){return D(this,"mediaerrorcode")}set mediaErrorCode(e){U(this,"mediaerrorcode",e)}get mediaErrorMessage(){return w(this,"mediaerrormessage")}set mediaErrorMessage(e){L(this,"mediaerrormessage",e)}};Oa=new WeakMap;Ct.getSlotTemplateHTML=Ad;Ct.formatErrorMessage=ln;n.customElements.get("media-error-dialog")||n.customElements.define("media-error-dialog",Ct);var Id=Ct;var Sd=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},Ge=(t,e,i)=>(Sd(t,e,"read from private field"),i?i.call(t):e.get(t)),dn=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},Ot,Ut;function Md(t){return`
    <style>
      :host {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 9999;
        background: rgb(20 20 30 / .8);
        backdrop-filter: blur(10px);
      }

      #content {
        display: block;
        width: clamp(400px, 40vw, 700px);
        max-width: 90vw;
        text-align: left;
      }

      h2 {
        margin: 0 0 1.5rem 0;
        font-size: 1.5rem;
        font-weight: 500;
        text-align: center;
      }

      .shortcuts-table {
        width: 100%;
        border-collapse: collapse;
      }

      .shortcuts-table tr {
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .shortcuts-table tr:last-child {
        border-bottom: none;
      }

      .shortcuts-table td {
        padding: 0.75rem 0.5rem;
      }

      .shortcuts-table td:first-child {
        text-align: right;
        padding-right: 1rem;
        width: 40%;
        min-width: 120px;
      }

      .shortcuts-table td:last-child {
        padding-left: 1rem;
      }

      .key {
        display: inline-block;
        background: rgba(255, 255, 255, 0.15);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 4px;
        padding: 0.25rem 0.5rem;
        font-family: 'Courier New', monospace;
        font-size: 0.9rem;
        font-weight: 500;
        min-width: 1.5rem;
        text-align: center;
        margin: 0 0.2rem;
      }

      .description {
        color: rgba(255, 255, 255, 0.9);
        font-size: 0.95rem;
      }

      .key-combo {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 0.3rem;
      }

      .key-separator {
        color: rgba(255, 255, 255, 0.5);
        font-size: 0.9rem;
      }
    </style>
    <slot id="content">
      ${yd()}
    </slot>
  `}function yd(){return`
    <h2>Keyboard Shortcuts</h2>
    <table class="shortcuts-table">${[{keys:["Space","k"],description:"Toggle Playback"},{keys:["m"],description:"Toggle mute"},{keys:["f"],description:"Toggle fullscreen"},{keys:["c"],description:"Toggle captions or subtitles, if available"},{keys:["p"],description:"Toggle Picture in Picture"},{keys:["\u2190","j"],description:"Seek back 10s"},{keys:["\u2192","l"],description:"Seek forward 10s"},{keys:["\u2191"],description:"Turn volume up"},{keys:["\u2193"],description:"Turn volume down"},{keys:[
"< (SHIFT+,)"],description:"Decrease playback rate"},{keys:["> (SHIFT+.)"],description:"Increase playback rate"}].map(({keys:i,description:a})=>`
      <tr>
        <td>
          <div class="key-combo">${i.map((s,l)=>l>0?`<span class="key-separator">or</span><span class="key">${s}</span>`:`<span class="key">${s}</span>`).join("")}</div>
        </td>
        <td class="description">${a}</td>
      </tr>
    `).join("")}</table>
  `}var Si=class extends me{constructor(){super(...arguments),dn(this,Ot,e=>{var i;if(!this.open)return;let a=(i=this.shadowRoot)==null?void 0:i.querySelector("#content");if(!a)return;let r=e.composedPath(),s=r[0]===this||r.includes(this),l=r.includes(a);s&&!l&&(this.open=!1)}),dn(this,Ut,e=>{if(!this.open)return;let i=e.shiftKey&&(e.key==="/"||e.key==="?");(e.key==="Escape"||i)&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&(this.open=!1,e.preventDefault(),e.stopPropagation())})}connectedCallback(){super.
connectedCallback(),this.open&&(this.addEventListener("click",Ge(this,Ot)),document.addEventListener("keydown",Ge(this,Ut)))}disconnectedCallback(){this.removeEventListener("click",Ge(this,Ot)),document.removeEventListener("keydown",Ge(this,Ut))}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),e==="open"&&(this.open?(this.addEventListener("click",Ge(this,Ot)),document.addEventListener("keydown",Ge(this,Ut))):(this.removeEventListener("click",Ge(this,Ot)),document.removeEventListener(
"keydown",Ge(this,Ut))))}};Ot=new WeakMap;Ut=new WeakMap;Si.getSlotTemplateHTML=Md;n.customElements.get("media-keyboard-shortcuts-dialog")||n.customElements.define("media-keyboard-shortcuts-dialog",Si);var kd=Si;var un=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},Ld=(t,e,i)=>(un(t,e,"read from private field"),i?i.call(t):e.get(t)),wd=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},Rd=(t,e,i,a)=>(un(t,e,"write to private field"),a?a.call(t,i):e.set(t,i),i),Ua,Dd=`<svg aria-hidden="true" viewBox="0 0 26 24">
  <path d="M16 3v2.5h3.5V9H22V3h-6ZM4 9h2.5V5.5H10V3H4v6Zm15.5 9.5H16V21h6v-6h-2.5v3.5ZM6.5 15H4v6h6v-2.5H6.5V15Z"/>
</svg>`,Cd=`<svg aria-hidden="true" viewBox="0 0 26 24">
  <path d="M18.5 6.5V3H16v6h6V6.5h-3.5ZM16 21h2.5v-3.5H22V15h-6v6ZM4 17.5h3.5V21H10v-6H4v2.5Zm3.5-11H4V9h6V3H7.5v3.5Z"/>
</svg>`;function Od(t){return`
    <style>
      :host([${o.MEDIA_IS_FULLSCREEN}]) slot[name=icon] slot:not([name=exit]) {
        display: none !important;
      }

      
      :host(:not([${o.MEDIA_IS_FULLSCREEN}])) slot[name=icon] slot:not([name=enter]) {
        display: none !important;
      }

      :host([${o.MEDIA_IS_FULLSCREEN}]) slot[name=tooltip-enter],
      :host(:not([${o.MEDIA_IS_FULLSCREEN}])) slot[name=tooltip-exit] {
        display: none;
      }
    </style>

    <slot name="icon">
      <slot name="enter">${Dd}</slot>
      <slot name="exit">${Cd}</slot>
    </slot>
  `}function Ud(){return`
    <slot name="tooltip-enter">${m("Enter fullscreen mode")}</slot>
    <slot name="tooltip-exit">${m("Exit fullscreen mode")}</slot>
  `}var cn=t=>{let e=t.mediaIsFullscreen?m("exit fullscreen mode"):m("enter fullscreen mode");t.setAttribute("aria-label",e)},xt=class extends C{constructor(){super(...arguments),wd(this,Ua,null)}static get observedAttributes(){return[...super.observedAttributes,o.MEDIA_IS_FULLSCREEN,o.MEDIA_FULLSCREEN_UNAVAILABLE]}connectedCallback(){super.connectedCallback(),cn(this)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),e===o.MEDIA_IS_FULLSCREEN&&cn(this)}get mediaFullscreenUnavailable(){
return w(this,o.MEDIA_FULLSCREEN_UNAVAILABLE)}set mediaFullscreenUnavailable(e){L(this,o.MEDIA_FULLSCREEN_UNAVAILABLE,e)}get mediaIsFullscreen(){return _(this,o.MEDIA_IS_FULLSCREEN)}set mediaIsFullscreen(e){g(this,o.MEDIA_IS_FULLSCREEN,e)}handleClick(e){Rd(this,Ua,e);let i=Ld(this,Ua)instanceof PointerEvent,a=this.mediaIsFullscreen?new n.CustomEvent(h.MEDIA_EXIT_FULLSCREEN_REQUEST,{composed:!0,bubbles:!0}):new n.CustomEvent(h.MEDIA_ENTER_FULLSCREEN_REQUEST,{composed:!0,bubbles:!0,detail:i});this.
dispatchEvent(a)}};Ua=new WeakMap;xt.getSlotTemplateHTML=Od;xt.getTooltipContentHTML=Ud;n.customElements.get("media-fullscreen-button")||n.customElements.define("media-fullscreen-button",xt);var xd=xt;var{MEDIA_TIME_IS_LIVE:xa,MEDIA_PAUSED:Mi}=o,{MEDIA_SEEK_TO_LIVE_REQUEST:Pd,MEDIA_PLAY_REQUEST:Nd}=h,Hd='<svg viewBox="0 0 6 12" aria-hidden="true"><circle cx="3" cy="6" r="2"></circle></svg>';function Fd(t){return`
    <style>
      :host { --media-tooltip-display: none; }
      
      slot[name=indicator] > *,
      :host ::slotted([slot=indicator]) {
        
        min-width: auto;
        fill: var(--media-live-button-icon-color, rgb(140, 140, 140));
        color: var(--media-live-button-icon-color, rgb(140, 140, 140));
      }

      :host([${xa}]:not([${Mi}])) slot[name=indicator] > *,
      :host([${xa}]:not([${Mi}])) ::slotted([slot=indicator]) {
        fill: var(--media-live-button-indicator-color, rgb(255, 0, 0));
        color: var(--media-live-button-indicator-color, rgb(255, 0, 0));
      }

      :host([${xa}]:not([${Mi}])) {
        cursor: var(--media-cursor, not-allowed);
      }

      slot[name=text]{
        text-transform: uppercase;
      }

    </style>

    <slot name="indicator">${Hd}</slot>
    
    <slot name="spacer">&nbsp;</slot><slot name="text">${m("live")}</slot>
  `}var hn=t=>{var e;let i=t.mediaPaused||!t.mediaTimeIsLive,a=i?m("seek to live"):m("playing live");t.setAttribute("aria-label",a);let r=(e=t.shadowRoot)==null?void 0:e.querySelector('slot[name="text"]');r&&(r.textContent=m("live")),i?t.removeAttribute("aria-disabled"):t.setAttribute("aria-disabled","true")},yi=class extends C{static get observedAttributes(){return[...super.observedAttributes,xa,Mi]}connectedCallback(){super.connectedCallback(),hn(this)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(
e,i,a),hn(this)}get mediaPaused(){return _(this,o.MEDIA_PAUSED)}set mediaPaused(e){g(this,o.MEDIA_PAUSED,e)}get mediaTimeIsLive(){return _(this,o.MEDIA_TIME_IS_LIVE)}set mediaTimeIsLive(e){g(this,o.MEDIA_TIME_IS_LIVE,e)}handleClick(){!this.mediaPaused&&this.mediaTimeIsLive||(this.dispatchEvent(new n.CustomEvent(Pd,{composed:!0,bubbles:!0})),this.hasAttribute(Mi)&&this.dispatchEvent(new n.CustomEvent(Nd,{composed:!0,bubbles:!0})))}};yi.getSlotTemplateHTML=Fd;n.customElements.get("media-live-butto\
n")||n.customElements.define("media-live-button",yi);var Bd=yi;var pn=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},ki=(t,e,i)=>(pn(t,e,"read from private field"),i?i.call(t):e.get(t)),mn=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},Li=(t,e,i,a)=>(pn(t,e,"write to private field"),a?a.call(t,i):e.set(t,i),i),Me,Na,Pa={LOADING_DELAY:"loadingdelay",NO_AUTOHIDE:"noautohide"},En=500,$d=`
<svg aria-hidden="true" viewBox="0 0 100 100">
  <path d="M73,50c0-12.7-10.3-23-23-23S27,37.3,27,50 M30.9,50c0-10.5,8.5-19.1,19.1-19.1S69.1,39.5,69.1,50">
    <animateTransform
       attributeName="transform"
       attributeType="XML"
       type="rotate"
       dur="1s"
       from="0 50 50"
       to="360 50 50"
       repeatCount="indefinite" />
  </path>
</svg>
`;function Wd(t){return`
    <style>
      :host {
        display: var(--media-control-display, var(--media-loading-indicator-display, inline-block));
        vertical-align: middle;
        box-sizing: border-box;
        --_loading-indicator-delay: var(--media-loading-indicator-transition-delay, ${En}ms);
      }

      #status {
        color: rgba(0,0,0,0);
        width: 0px;
        height: 0px;
      }

      :host slot[name=icon] > *,
      :host ::slotted([slot=icon]) {
        opacity: var(--media-loading-indicator-opacity, 0);
        transition: opacity 0.15s;
      }

      :host([${o.MEDIA_LOADING}]:not([${o.MEDIA_PAUSED}])) slot[name=icon] > *,
      :host([${o.MEDIA_LOADING}]:not([${o.MEDIA_PAUSED}])) ::slotted([slot=icon]) {
        opacity: var(--media-loading-indicator-opacity, 1);
        transition: opacity 0.15s var(--_loading-indicator-delay);
      }

      :host #status {
        visibility: var(--media-loading-indicator-opacity, hidden);
        transition: visibility 0.15s;
      }

      :host([${o.MEDIA_LOADING}]:not([${o.MEDIA_PAUSED}])) #status {
        visibility: var(--media-loading-indicator-opacity, visible);
        transition: visibility 0.15s var(--_loading-indicator-delay);
      }

      svg, img, ::slotted(svg), ::slotted(img) {
        width: var(--media-loading-indicator-icon-width);
        height: var(--media-loading-indicator-icon-height, 100px);
        fill: var(--media-icon-color, var(--media-primary-color, rgb(238 238 238)));
        vertical-align: middle;
      }
    </style>

    <slot name="icon">${$d}</slot>
    <div id="status" role="status" aria-live="polite">${m("media loading")}</div>
  `}var Pt=class extends n.HTMLElement{constructor(){if(super(),mn(this,Me,void 0),mn(this,Na,En),!this.shadowRoot){this.attachShadow(this.constructor.shadowRootOptions);let e=F(this.attributes);this.shadowRoot.innerHTML=this.constructor.getTemplateHTML(e)}}static get observedAttributes(){return[M.MEDIA_CONTROLLER,o.MEDIA_PAUSED,o.MEDIA_LOADING,Pa.LOADING_DELAY]}attributeChangedCallback(e,i,a){var r,s,l,d,c;e===Pa.LOADING_DELAY&&i!==a?this.loadingDelay=Number(a):e===M.MEDIA_CONTROLLER&&(i&&((s=(r=
ki(this,Me))==null?void 0:r.unassociateElement)==null||s.call(r,this),Li(this,Me,null)),a&&this.isConnected&&(Li(this,Me,(l=this.getRootNode())==null?void 0:l.getElementById(a)),(c=(d=ki(this,Me))==null?void 0:d.associateElement)==null||c.call(d,this)))}connectedCallback(){var e,i,a;let r=this.getAttribute(M.MEDIA_CONTROLLER);r&&(Li(this,Me,(e=this.getRootNode())==null?void 0:e.getElementById(r)),(a=(i=ki(this,Me))==null?void 0:i.associateElement)==null||a.call(i,this))}disconnectedCallback(){var e,
i;(i=(e=ki(this,Me))==null?void 0:e.unassociateElement)==null||i.call(e,this),Li(this,Me,null)}get loadingDelay(){return ki(this,Na)}set loadingDelay(e){Li(this,Na,e);let{style:i}=x(this.shadowRoot,":host");i.setProperty("--_loading-indicator-delay",`var(--media-loading-indicator-transition-delay, ${e}ms)`)}get mediaPaused(){return _(this,o.MEDIA_PAUSED)}set mediaPaused(e){g(this,o.MEDIA_PAUSED,e)}get mediaLoading(){return _(this,o.MEDIA_LOADING)}set mediaLoading(e){g(this,o.MEDIA_LOADING,e)}get mediaController(){
return w(this,M.MEDIA_CONTROLLER)}set mediaController(e){L(this,M.MEDIA_CONTROLLER,e)}get noAutohide(){return _(this,Pa.NO_AUTOHIDE)}set noAutohide(e){g(this,Pa.NO_AUTOHIDE,e)}};Me=new WeakMap;Na=new WeakMap;Pt.shadowRootOptions={mode:"open"};Pt.getTemplateHTML=Wd;n.customElements.get("media-loading-indicator")||n.customElements.define("media-loading-indicator",Pt);var Vd=Pt;var Kd=`<svg aria-hidden="true" viewBox="0 0 24 24">
  <path d="M16.5 12A4.5 4.5 0 0 0 14 8v2.18l2.45 2.45a4.22 4.22 0 0 0 .05-.63Zm2.5 0a6.84 6.84 0 0 1-.54 2.64L20 16.15A8.8 8.8 0 0 0 21 12a9 9 0 0 0-7-8.77v2.06A7 7 0 0 1 19 12ZM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25A6.92 6.92 0 0 1 14 18.7v2.06A9 9 0 0 0 17.69 19l2 2.05L21 19.73l-9-9L4.27 3ZM12 4 9.91 6.09 12 8.18V4Z"/>
</svg>`,vn=`<svg aria-hidden="true" viewBox="0 0 24 24">
  <path d="M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.47 4.47 0 0 0 2.5-4Z"/>
</svg>`,Gd=`<svg aria-hidden="true" viewBox="0 0 24 24">
  <path d="M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.47 4.47 0 0 0 2.5-4ZM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54Z"/>
</svg>`;function qd(t){return`
    <style>
      :host(:not([${o.MEDIA_VOLUME_LEVEL}])) slot[name=icon] slot:not([name=high]),
      :host([${o.MEDIA_VOLUME_LEVEL}=high]) slot[name=icon] slot:not([name=high]) {
        display: none !important;
      }

      :host([${o.MEDIA_VOLUME_LEVEL}=off]) slot[name=icon] slot:not([name=off]) {
        display: none !important;
      }

      :host([${o.MEDIA_VOLUME_LEVEL}=low]) slot[name=icon] slot:not([name=low]) {
        display: none !important;
      }

      :host([${o.MEDIA_VOLUME_LEVEL}=medium]) slot[name=icon] slot:not([name=medium]) {
        display: none !important;
      }

      :host(:not([${o.MEDIA_VOLUME_LEVEL}=off])) slot[name=tooltip-unmute],
      :host([${o.MEDIA_VOLUME_LEVEL}=off]) slot[name=tooltip-mute] {
        display: none;
      }
    </style>

    <slot name="icon">
      <slot name="off">${Kd}</slot>
      <slot name="low">${vn}</slot>
      <slot name="medium">${vn}</slot>
      <slot name="high">${Gd}</slot>
    </slot>
  `}function Yd(){return`
    <slot name="tooltip-mute">${m("Mute")}</slot>
    <slot name="tooltip-unmute">${m("Unmute")}</slot>
  `}var fn=t=>{let i=t.mediaVolumeLevel==="off"?m("unmute"):m("mute");t.setAttribute("aria-label",i)},Nt=class extends C{static get observedAttributes(){return[...super.observedAttributes,o.MEDIA_VOLUME_LEVEL]}connectedCallback(){super.connectedCallback(),fn(this)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),e===o.MEDIA_VOLUME_LEVEL&&fn(this)}get mediaVolumeLevel(){return w(this,o.MEDIA_VOLUME_LEVEL)}set mediaVolumeLevel(e){L(this,o.MEDIA_VOLUME_LEVEL,e)}handleClick(){let e=this.
mediaVolumeLevel==="off"?h.MEDIA_UNMUTE_REQUEST:h.MEDIA_MUTE_REQUEST;this.dispatchEvent(new n.CustomEvent(e,{composed:!0,bubbles:!0}))}};Nt.getSlotTemplateHTML=qd;Nt.getTooltipContentHTML=Yd;n.customElements.get("media-mute-button")||n.customElements.define("media-mute-button",Nt);var Qd=Nt;var _n=`<svg aria-hidden="true" viewBox="0 0 28 24">
  <path d="M24 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h20a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Zm-1 16H5V5h18v14Zm-3-8h-7v5h7v-5Z"/>
</svg>`;function zd(t){return`
    <style>
      :host([${o.MEDIA_IS_PIP}]) slot[name=icon] slot:not([name=exit]) {
        display: none !important;
      }

      :host(:not([${o.MEDIA_IS_PIP}])) slot[name=icon] slot:not([name=enter]) {
        display: none !important;
      }

      :host([${o.MEDIA_IS_PIP}]) slot[name=tooltip-enter],
      :host(:not([${o.MEDIA_IS_PIP}])) slot[name=tooltip-exit] {
        display: none;
      }
    </style>

    <slot name="icon">
      <slot name="enter">${_n}</slot>
      <slot name="exit">${_n}</slot>
    </slot>
  `}function Zd(){return`
    <slot name="tooltip-enter">${m("Enter picture in picture mode")}</slot>
    <slot name="tooltip-exit">${m("Exit picture in picture mode")}</slot>
  `}var gn=t=>{let e=t.mediaIsPip?m("exit picture in picture mode"):m("enter picture in picture mode");t.setAttribute("aria-label",e)},Ht=class extends C{static get observedAttributes(){return[...super.observedAttributes,o.MEDIA_IS_PIP,o.MEDIA_PIP_UNAVAILABLE]}connectedCallback(){super.connectedCallback(),gn(this)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),e===o.MEDIA_IS_PIP&&gn(this)}get mediaPipUnavailable(){return w(this,o.MEDIA_PIP_UNAVAILABLE)}set mediaPipUnavailable(e){
L(this,o.MEDIA_PIP_UNAVAILABLE,e)}get mediaIsPip(){return _(this,o.MEDIA_IS_PIP)}set mediaIsPip(e){g(this,o.MEDIA_IS_PIP,e)}handleClick(){let e=this.mediaIsPip?h.MEDIA_EXIT_PIP_REQUEST:h.MEDIA_ENTER_PIP_REQUEST;this.dispatchEvent(new n.CustomEvent(e,{composed:!0,bubbles:!0}))}};Ht.getSlotTemplateHTML=zd;Ht.getTooltipContentHTML=Zd;n.customElements.get("media-pip-button")||n.customElements.define("media-pip-button",Ht);var Xd=Ht;var Jd=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},Ft=(t,e,i)=>(Jd(t,e,"read from private field"),i?i.call(t):e.get(t)),jd=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},qe,Jr={RATES:"rates"},ec=[1,1.2,1.5,1.7,2],wi=1;function jr(t){return Math.round(t*100)/100}function tc(t){return`
    <style>
      :host {
        min-width: 5ch;
        padding: var(--media-button-padding, var(--media-control-padding, 10px 5px));
      }
    </style>
    <slot name="icon">${t.mediaplaybackrate?jr(+t.mediaplaybackrate):wi}x</slot>
  `}function ic(){return m("Playback rate")}var Bt=class extends C{constructor(){var e;super(),jd(this,qe,new bt(this,Jr.RATES,{defaultValue:ec})),this.container=this.shadowRoot.querySelector('slot[name="icon"]'),this.container.innerHTML=`${jr((e=this.mediaPlaybackRate)!=null?e:wi)}x`}static get observedAttributes(){return[...super.observedAttributes,o.MEDIA_PLAYBACK_RATE,Jr.RATES]}attributeChangedCallback(e,i,a){if(super.attributeChangedCallback(e,i,a),e===Jr.RATES&&(Ft(this,qe).value=a),e===o.
MEDIA_PLAYBACK_RATE){let r=a?+a:Number.NaN,s=jr(Number.isNaN(r)?wi:r);this.container.innerHTML=`${s}x`,this.setAttribute("aria-label",m("Playback rate {playbackRate}",{playbackRate:s}))}}get rates(){return Ft(this,qe)}set rates(e){e?Array.isArray(e)?Ft(this,qe).value=e.join(" "):typeof e=="string"&&(Ft(this,qe).value=e):Ft(this,qe).value=""}get mediaPlaybackRate(){return D(this,o.MEDIA_PLAYBACK_RATE,wi)}set mediaPlaybackRate(e){U(this,o.MEDIA_PLAYBACK_RATE,e)}handleClick(){var e,i;let a=Array.from(
Ft(this,qe).values(),l=>+l).sort((l,d)=>l-d),r=(i=(e=a.find(l=>l>this.mediaPlaybackRate))!=null?e:a[0])!=null?i:wi,s=new n.CustomEvent(h.MEDIA_PLAYBACK_RATE_REQUEST,{composed:!0,bubbles:!0,detail:r});this.dispatchEvent(s)}};qe=new WeakMap;Bt.getSlotTemplateHTML=tc;Bt.getTooltipContentHTML=ic;n.customElements.get("media-playback-rate-button")||n.customElements.define("media-playback-rate-button",Bt);var ac=Bt;var rc=`<svg aria-hidden="true" viewBox="0 0 24 24">
  <path d="m6 21 15-9L6 3v18Z"/>
</svg>`,oc=`<svg aria-hidden="true" viewBox="0 0 24 24">
  <path d="M6 20h4V4H6v16Zm8-16v16h4V4h-4Z"/>
</svg>`;function sc(t){return`
    <style>
      :host([${o.MEDIA_PAUSED}]) slot[name=pause],
      :host(:not([${o.MEDIA_PAUSED}])) slot[name=play] {
        display: none !important;
      }

      :host([${o.MEDIA_PAUSED}]) slot[name=tooltip-pause],
      :host(:not([${o.MEDIA_PAUSED}])) slot[name=tooltip-play] {
        display: none;
      }
    </style>

    <slot name="icon">
      <slot name="play">${rc}</slot>
      <slot name="pause">${oc}</slot>
    </slot>
  `}function nc(){return`
    <slot name="tooltip-play">${m("Play")}</slot>
    <slot name="tooltip-pause">${m("Pause")}</slot>
  `}var bn=t=>{let e=t.mediaPaused?m("play"):m("pause");t.setAttribute("aria-label",e)},$t=class extends C{static get observedAttributes(){return[...super.observedAttributes,o.MEDIA_PAUSED,o.MEDIA_ENDED]}connectedCallback(){super.connectedCallback(),bn(this)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),(e===o.MEDIA_PAUSED||e===o.MEDIA_LANG)&&bn(this)}get mediaPaused(){return _(this,o.MEDIA_PAUSED)}set mediaPaused(e){g(this,o.MEDIA_PAUSED,e)}handleClick(){let e=this.mediaPaused?
h.MEDIA_PLAY_REQUEST:h.MEDIA_PAUSE_REQUEST;this.dispatchEvent(new n.CustomEvent(e,{composed:!0,bubbles:!0}))}};$t.getSlotTemplateHTML=sc;$t.getTooltipContentHTML=nc;n.customElements.get("media-play-button")||n.customElements.define("media-play-button",$t);var lc=$t;var ye={PLACEHOLDER_SRC:"placeholdersrc",SRC:"src"};function dc(t){return`
    <style>
      :host {
        pointer-events: none;
        display: var(--media-poster-image-display, inline-block);
        box-sizing: border-box;
      }

      img {
        max-width: 100%;
        max-height: 100%;
        min-width: 100%;
        min-height: 100%;
        background-repeat: no-repeat;
        background-position: var(--media-poster-image-background-position, var(--media-object-position, center));
        background-size: var(--media-poster-image-background-size, var(--media-object-fit, contain));
        object-fit: var(--media-object-fit, contain);
        object-position: var(--media-object-position, center);
      }
    </style>

    <img part="poster img" aria-hidden="true" id="image"/>
  `}var cc=t=>{t.style.removeProperty("background-image")},uc=(t,e)=>{t.style["background-image"]=`url('${e}')`},Wt=class extends n.HTMLElement{static get observedAttributes(){return[ye.PLACEHOLDER_SRC,ye.SRC]}constructor(){if(super(),!this.shadowRoot){this.attachShadow(this.constructor.shadowRootOptions);let e=F(this.attributes);this.shadowRoot.innerHTML=this.constructor.getTemplateHTML(e)}this.image=this.shadowRoot.querySelector("#image")}attributeChangedCallback(e,i,a){e===ye.SRC&&(a==null?this.
image.removeAttribute(ye.SRC):this.image.setAttribute(ye.SRC,a)),e===ye.PLACEHOLDER_SRC&&(a==null?cc(this.image):uc(this.image,a))}get placeholderSrc(){return w(this,ye.PLACEHOLDER_SRC)}set placeholderSrc(e){L(this,ye.SRC,e)}get src(){return w(this,ye.SRC)}set src(e){L(this,ye.SRC,e)}};Wt.shadowRootOptions={mode:"open"};Wt.getTemplateHTML=dc;n.customElements.get("media-poster-image")||n.customElements.define("media-poster-image",Wt);var hc=Wt;var An=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},mc=(t,e,i)=>(An(t,e,"read from private field"),i?i.call(t):e.get(t)),pc=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},Ec=(t,e,i,a)=>(An(t,e,"write to private field"),a?a.call(t,i):e.set(t,i),i),Ha,Fa=class extends ee{constructor(){super(),pc(this,Ha,void 0),Ec(this,Ha,this.shadowRoot.querySelector("slot"))}static get observedAttributes(){return[...super.
observedAttributes,o.MEDIA_PREVIEW_CHAPTER,o.MEDIA_LANG]}attributeChangedCallback(e,i,a){if(super.attributeChangedCallback(e,i,a),(e===o.MEDIA_PREVIEW_CHAPTER||e===o.MEDIA_LANG)&&a!==i&&a!=null)if(mc(this,Ha).textContent=a,a!==""){let r=m("chapter: {chapterName}",{chapterName:a});this.setAttribute("aria-valuetext",r)}else this.removeAttribute("aria-valuetext")}get mediaPreviewChapter(){return w(this,o.MEDIA_PREVIEW_CHAPTER)}set mediaPreviewChapter(e){L(this,o.MEDIA_PREVIEW_CHAPTER,e)}};Ha=new WeakMap;
n.customElements.get("media-preview-chapter-display")||n.customElements.define("media-preview-chapter-display",Fa);var vc=Fa;var Tn=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},Ba=(t,e,i)=>(Tn(t,e,"read from private field"),i?i.call(t):e.get(t)),fc=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},$a=(t,e,i,a)=>(Tn(t,e,"write to private field"),a?a.call(t,i):e.set(t,i),i),ke;function _c(t){return`
    <style>
      :host {
        box-sizing: border-box;
        display: var(--media-control-display, var(--media-preview-thumbnail-display, inline-block));
        overflow: hidden;
      }

      img {
        display: none;
        position: relative;
      }
    </style>
    <img crossorigin loading="eager" decoding="async">
  `}var Vt=class extends n.HTMLElement{constructor(){if(super(),fc(this,ke,void 0),!this.shadowRoot){this.attachShadow(this.constructor.shadowRootOptions);let e=F(this.attributes);this.shadowRoot.innerHTML=this.constructor.getTemplateHTML(e)}}static get observedAttributes(){return[M.MEDIA_CONTROLLER,o.MEDIA_PREVIEW_IMAGE,o.MEDIA_PREVIEW_COORDS]}connectedCallback(){var e,i,a;let r=this.getAttribute(M.MEDIA_CONTROLLER);r&&($a(this,ke,(e=this.getRootNode())==null?void 0:e.getElementById(r)),(a=(i=Ba(
this,ke))==null?void 0:i.associateElement)==null||a.call(i,this))}disconnectedCallback(){var e,i;(i=(e=Ba(this,ke))==null?void 0:e.unassociateElement)==null||i.call(e,this),$a(this,ke,null)}attributeChangedCallback(e,i,a){var r,s,l,d,c;[o.MEDIA_PREVIEW_IMAGE,o.MEDIA_PREVIEW_COORDS].includes(e)&&this.update(),e===M.MEDIA_CONTROLLER&&(i&&((s=(r=Ba(this,ke))==null?void 0:r.unassociateElement)==null||s.call(r,this),$a(this,ke,null)),a&&this.isConnected&&($a(this,ke,(l=this.getRootNode())==null?void 0:
l.getElementById(a)),(c=(d=Ba(this,ke))==null?void 0:d.associateElement)==null||c.call(d,this)))}get mediaPreviewImage(){return w(this,o.MEDIA_PREVIEW_IMAGE)}set mediaPreviewImage(e){L(this,o.MEDIA_PREVIEW_IMAGE,e)}get mediaPreviewCoords(){let e=this.getAttribute(o.MEDIA_PREVIEW_COORDS);if(e)return e.split(/\s+/).map(i=>+i)}set mediaPreviewCoords(e){if(!e){this.removeAttribute(o.MEDIA_PREVIEW_COORDS);return}this.setAttribute(o.MEDIA_PREVIEW_COORDS,e.join(" "))}update(){let e=this.mediaPreviewCoords,
i=this.mediaPreviewImage;if(!(e&&i))return;let[a,r,s,l]=e,d=i.split("#")[0],c=getComputedStyle(this),{maxWidth:y,maxHeight:S,minWidth:T,minHeight:f}=c,p=c.getPropertyValue("--media-preview-thumbnail-object-fit").trim()||"contain",A,v;if(p==="fill"){let Re=parseInt(y)/s,De=parseInt(S)/l,oi=parseInt(T)/s,Ze=parseInt(f)/l;A=Re<1?Re:Math.max(Re,oi),v=De<1?De:Math.max(De,Ze)}else{let Re=Math.min(parseInt(y)/s,parseInt(S)/l),De=Math.max(parseInt(T)/s,parseInt(f)/l),Ze=Re<1?Re:De>1?De:1;A=Ze,v=Ze}let{style:k}=x(
this.shadowRoot,":host"),I=x(this.shadowRoot,"img").style,Z=this.shadowRoot.querySelector("img"),ri=Math.min(A,v)<1?"min":"max";k.setProperty(`${ri}-width`,"initial","important"),k.setProperty(`${ri}-height`,"initial","important"),k.width=`${s*A}px`,k.height=`${l*v}px`;let nt=()=>{I.width=`${this.imgWidth*A}px`,I.height=`${this.imgHeight*v}px`,I.display="block"};Z.src!==d&&(Z.onload=()=>{this.imgWidth=Z.naturalWidth,this.imgHeight=Z.naturalHeight,nt(),Z.onload=null},Z.src=d,nt()),nt(),I.transform=
`translate(-${a*A}px, -${r*v}px)`}};ke=new WeakMap;Vt.shadowRootOptions={mode:"open"};Vt.getTemplateHTML=_c;n.customElements.get("media-preview-thumbnail")||n.customElements.define("media-preview-thumbnail",Vt);var Wa=Vt;var Sn=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},In=(t,e,i)=>(Sn(t,e,"read from private field"),i?i.call(t):e.get(t)),gc=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},bc=(t,e,i,a)=>(Sn(t,e,"write to private field"),a?a.call(t,i):e.set(t,i),i),Ri,Va=class extends ee{constructor(){super(),gc(this,Ri,void 0),bc(this,Ri,this.shadowRoot.querySelector("slot")),In(this,Ri).textContent=re(0)}static get observedAttributes(){
return[...super.observedAttributes,o.MEDIA_PREVIEW_TIME]}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),e===o.MEDIA_PREVIEW_TIME&&a!=null&&(In(this,Ri).textContent=re(parseFloat(a)))}get mediaPreviewTime(){return D(this,o.MEDIA_PREVIEW_TIME)}set mediaPreviewTime(e){U(this,o.MEDIA_PREVIEW_TIME,e)}};Ri=new WeakMap;n.customElements.get("media-preview-time-display")||n.customElements.define("media-preview-time-display",Va);var Ac=Va;var Kt={SEEK_OFFSET:"seekoffset"},eo=30,Tc=t=>`
  <svg aria-hidden="true" viewBox="0 0 20 24">
    <defs>
      <style>.text{font-size:8px;font-family:Arial-BoldMT, Arial;font-weight:700;}</style>
    </defs>
    <text class="text value" transform="translate(2.18 19.87)">${t}</text>
    <path d="M10 6V3L4.37 7 10 10.94V8a5.54 5.54 0 0 1 1.9 10.48v2.12A7.5 7.5 0 0 0 10 6Z"/>
  </svg>`;function Ic(t,e){return`
    <slot name="icon">${Tc(e.seekOffset)}</slot>
  `}var Sc=(t,e)=>{t.setAttribute("aria-label",m("seek back {seekOffset} seconds",{seekOffset:e}))};function Mc(){return m("Seek backward")}var yc=0,Gt=class extends C{static get observedAttributes(){return[...super.observedAttributes,o.MEDIA_CURRENT_TIME,Kt.SEEK_OFFSET]}connectedCallback(){super.connectedCallback(),this.seekOffset=D(this,Kt.SEEK_OFFSET,eo)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),Sc(this,this.seekOffset),e===Kt.SEEK_OFFSET&&(this.seekOffset=D(this,Kt.
SEEK_OFFSET,eo))}get seekOffset(){return D(this,Kt.SEEK_OFFSET,eo)}set seekOffset(e){U(this,Kt.SEEK_OFFSET,e),this.setAttribute("aria-label",m("seek back {seekOffset} seconds",{seekOffset:this.seekOffset})),Yi(Qi(this,"icon"),this.seekOffset)}get mediaCurrentTime(){return D(this,o.MEDIA_CURRENT_TIME,yc)}set mediaCurrentTime(e){U(this,o.MEDIA_CURRENT_TIME,e)}handleClick(){let e=Math.max(this.mediaCurrentTime-this.seekOffset,0),i=new n.CustomEvent(h.MEDIA_SEEK_REQUEST,{composed:!0,bubbles:!0,detail:e});
this.dispatchEvent(i)}};Gt.getSlotTemplateHTML=Ic;Gt.getTooltipContentHTML=Mc;n.customElements.get("media-seek-backward-button")||n.customElements.define("media-seek-backward-button",Gt);var kc=Gt;var qt={SEEK_OFFSET:"seekoffset"},to=30,Lc=t=>`
  <svg aria-hidden="true" viewBox="0 0 20 24">
    <defs>
      <style>.text{font-size:8px;font-family:Arial-BoldMT, Arial;font-weight:700;}</style>
    </defs>
    <text class="text value" transform="translate(8.9 19.87)">${t}</text>
    <path d="M10 6V3l5.61 4L10 10.94V8a5.54 5.54 0 0 0-1.9 10.48v2.12A7.5 7.5 0 0 1 10 6Z"/>
  </svg>`;function wc(t,e){return`
    <slot name="icon">${Lc(e.seekOffset)}</slot>
  `}var Rc=(t,e)=>{t.setAttribute("aria-label",m("seek forward {seekOffset} seconds",{seekOffset:e}))};function Dc(){return m("Seek forward")}var Cc=0,Yt=class extends C{static get observedAttributes(){return[...super.observedAttributes,o.MEDIA_CURRENT_TIME,qt.SEEK_OFFSET]}connectedCallback(){super.connectedCallback(),this.seekOffset=D(this,qt.SEEK_OFFSET,to)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),Rc(this,this.seekOffset),e===qt.SEEK_OFFSET&&(this.seekOffset=D(this,
qt.SEEK_OFFSET,to))}get seekOffset(){return D(this,qt.SEEK_OFFSET,to)}set seekOffset(e){U(this,qt.SEEK_OFFSET,e),this.setAttribute("aria-label",m("seek forward {seekOffset} seconds",{seekOffset:this.seekOffset})),Yi(Qi(this,"icon"),this.seekOffset)}get mediaCurrentTime(){return D(this,o.MEDIA_CURRENT_TIME,Cc)}set mediaCurrentTime(e){U(this,o.MEDIA_CURRENT_TIME,e)}handleClick(){let e=this.mediaCurrentTime+this.seekOffset,i=new n.CustomEvent(h.MEDIA_SEEK_REQUEST,{composed:!0,bubbles:!0,detail:e});
this.dispatchEvent(i)}};Yt.getSlotTemplateHTML=wc;Yt.getTooltipContentHTML=Dc;n.customElements.get("media-seek-forward-button")||n.customElements.define("media-seek-forward-button",Yt);var Oc=Yt;var ro=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},fe=(t,e,i)=>(ro(t,e,"read from private field"),i?i.call(t):e.get(t)),ot=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},oo=(t,e,i,a)=>(ro(t,e,"write to private field"),a?a.call(t,i):e.set(t,i),i),Qe=(t,e,i)=>(ro(t,e,"access private method"),i),Qt,Le,Ya,so,yn,qa,no,Di,Ka,Ga,io,Ye={REMAINING:"remaining",SHOW_DURATION:"showduration",NO_TOGGLE:"notoggle"},Mn=[
...Object.values(Ye),o.MEDIA_CURRENT_TIME,o.MEDIA_DURATION,o.MEDIA_SEEKABLE],kn=["Enter"," "],Uc="&nbsp;/&nbsp;",ao=(t,{timesSep:e=Uc}={})=>{var i,a;let r=(i=t.mediaCurrentTime)!=null?i:0,[,s]=(a=t.mediaSeekable)!=null?a:[],l=0;Number.isFinite(t.mediaDuration)?l=t.mediaDuration:Number.isFinite(s)&&(l=s);let d=t.remaining?re(0-(l-r)):re(r);return t.showDuration?`${d}${e}${re(l)}`:d},xc=t=>{var e;let i=t.mediaCurrentTime,[,a]=(e=t.mediaSeekable)!=null?e:[],r=null;if(Number.isFinite(t.mediaDuration)?
r=t.mediaDuration:Number.isFinite(a)&&(r=a),i==null||r===null){t.setAttribute("aria-description",m("video not loaded, unknown time."));return}let s=t.remaining?Ne(0-(r-i)):Ne(i);if(!t.showDuration){t.setAttribute("aria-description",s);return}let l=Ne(r),d=m("{currentTime} of {totalTime}",{currentTime:s,totalTime:l});t.setAttribute("aria-description",d)};function Pc(t,e){return`
    <slot>${ao(e)}</slot>
  `}var Nc=t=>{t.setAttribute("aria-label",m("playback time"))},Ci=class extends ee{constructor(){super(),ot(this,so),ot(this,qa),ot(this,Di),ot(this,Ga),ot(this,Qt,void 0),ot(this,Le,null),ot(this,Ya,e=>{let{metaKey:i,altKey:a,key:r}=e;if(i||a||!kn.includes(r)){this.removeEventListener("keyup",fe(this,Le));return}this.addEventListener("keyup",fe(this,Le))}),oo(this,Qt,this.shadowRoot.querySelector("slot")),fe(this,Qt).innerHTML=`${ao(this)}`}static get observedAttributes(){return[...super.observedAttributes,
...Mn,"disabled"]}connectedCallback(){let{style:e}=x(this.shadowRoot,":host(:hover:not([notoggle]))");e.setProperty("cursor","var(--media-cursor, pointer)"),e.setProperty("background","var(--media-control-hover-background, rgba(50 50 70 / .7))"),this.setAttribute("aria-label",m("playback time")),Qe(this,Di,Ka).call(this),super.connectedCallback()}toggleTimeDisplay(){this.noToggle||(this.hasAttribute("remaining")?this.removeAttribute("remaining"):this.setAttribute("remaining",""))}disconnectedCallback(){
this.disable(),Qe(this,qa,no).call(this),super.disconnectedCallback()}attributeChangedCallback(e,i,a){Nc(this),Mn.includes(e)?this.update():e==="disabled"&&a!==i?a==null?Qe(this,Di,Ka).call(this):Qe(this,Ga,io).call(this):e===Ye.NO_TOGGLE&&a!==i&&(this.noToggle?Qe(this,Ga,io).call(this):Qe(this,Di,Ka).call(this)),super.attributeChangedCallback(e,i,a)}enable(){this.noToggle||(this.tabIndex=0)}disable(){this.tabIndex=-1}get remaining(){return _(this,Ye.REMAINING)}set remaining(e){g(this,Ye.REMAINING,
e)}get showDuration(){return _(this,Ye.SHOW_DURATION)}set showDuration(e){g(this,Ye.SHOW_DURATION,e)}get noToggle(){return _(this,Ye.NO_TOGGLE)}set noToggle(e){g(this,Ye.NO_TOGGLE,e)}get mediaDuration(){return D(this,o.MEDIA_DURATION)}set mediaDuration(e){U(this,o.MEDIA_DURATION,e)}get mediaCurrentTime(){return D(this,o.MEDIA_CURRENT_TIME)}set mediaCurrentTime(e){U(this,o.MEDIA_CURRENT_TIME,e)}get mediaSeekable(){let e=this.getAttribute(o.MEDIA_SEEKABLE);if(e)return e.split(":").map(i=>+i)}set mediaSeekable(e){
if(e==null){this.removeAttribute(o.MEDIA_SEEKABLE);return}this.setAttribute(o.MEDIA_SEEKABLE,e.join(":"))}update(){let e=ao(this);xc(this),e!==fe(this,Qt).innerHTML&&(fe(this,Qt).innerHTML=e)}};Qt=new WeakMap;Le=new WeakMap;Ya=new WeakMap;so=new WeakSet;yn=function(){fe(this,Le)||(oo(this,Le,t=>{let{key:e}=t;if(!kn.includes(e)){this.removeEventListener("keyup",fe(this,Le));return}this.toggleTimeDisplay()}),this.addEventListener("keydown",fe(this,Ya)),this.addEventListener("click",this.toggleTimeDisplay))};
qa=new WeakSet;no=function(){fe(this,Le)&&(this.removeEventListener("keyup",fe(this,Le)),this.removeEventListener("keydown",fe(this,Ya)),this.removeEventListener("click",this.toggleTimeDisplay),oo(this,Le,null))};Di=new WeakSet;Ka=function(){!this.noToggle&&!this.hasAttribute("disabled")&&(this.setAttribute("role","button"),this.enable(),Qe(this,so,yn).call(this))};Ga=new WeakSet;io=function(){this.removeAttribute("role"),this.disable(),Qe(this,qa,no).call(this)};Ci.getSlotTemplateHTML=Pc;n.customElements.
get("media-time-display")||n.customElements.define("media-time-display",Ci);var Hc=Ci;var Ln=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},Y=(t,e,i)=>(Ln(t,e,"read from private field"),i?i.call(t):e.get(t)),we=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},ie=(t,e,i,a)=>(Ln(t,e,"write to private field"),a?a.call(t,i):e.set(t,i),i),Fc=(t,e,i,a)=>({set _(r){ie(t,e,r,i)},get _(){return Y(t,e,a)}}),zt,Qa,Zt,Oi,za,Za,Xa,Xt,st,Ja,ja=class{constructor(e,i,a){we(this,zt,void 0),we(this,Qa,void 0),
we(this,Zt,void 0),we(this,Oi,void 0),we(this,za,void 0),we(this,Za,void 0),we(this,Xa,void 0),we(this,Xt,void 0),we(this,st,0),we(this,Ja,(r=performance.now())=>{ie(this,st,requestAnimationFrame(Y(this,Ja))),ie(this,Oi,performance.now()-Y(this,Zt));let s=1e3/this.fps;if(Y(this,Oi)>s){ie(this,Zt,r-Y(this,Oi)%s);let l=1e3/((r-Y(this,Qa))/++Fc(this,za)._),d=(r-Y(this,Za))/1e3/this.duration,c=Y(this,Xa)+d*this.playbackRate;c-Y(this,zt).valueAsNumber>0?ie(this,Xt,this.playbackRate/this.duration/l):(ie(
this,Xt,.995*Y(this,Xt)),c=Y(this,zt).valueAsNumber+Y(this,Xt)),this.callback(c)}}),ie(this,zt,e),this.callback=i,this.fps=a}start(){Y(this,st)===0&&(ie(this,Zt,performance.now()),ie(this,Qa,Y(this,Zt)),ie(this,za,0),Y(this,Ja).call(this))}stop(){Y(this,st)!==0&&(cancelAnimationFrame(Y(this,st)),ie(this,st,0))}update({start:e,duration:i,playbackRate:a}){let r=e-Y(this,zt).valueAsNumber,s=Math.abs(i-this.duration);(r>0||r<-.03||s>=.5)&&this.callback(e),ie(this,Xa,e),ie(this,Za,performance.now()),
this.duration=i,this.playbackRate=a}};zt=new WeakMap;Qa=new WeakMap;Zt=new WeakMap;Oi=new WeakMap;za=new WeakMap;Za=new WeakMap;Xa=new WeakMap;Xt=new WeakMap;st=new WeakMap;Ja=new WeakMap;var mo=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},P=(t,e,i)=>(mo(t,e,"read from private field"),i?i.call(t):e.get(t)),K=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},se=(t,e,i,a)=>(mo(t,e,"write to private field"),a?a.call(t,i):e.set(t,i),i),ne=(t,e,i)=>(mo(t,e,"access private method"),i),Jt,ze,ir,xi,ar,tr,Pi,Ni,jt,ei,Ui,lo,wn,co,rr,po,or,Eo,sr,vo,uo,Rn,Hi,nr,ho,Dn,Bc=t=>{let e=t.range,i=Ne(+Cn(t)),a=Ne(
+t.mediaSeekableEnd),r=i&&a?m("{currentTime} of {totalTime}",{currentTime:i,totalTime:a}):m("video not loaded, unknown time.");e.setAttribute("aria-valuetext",r)};function $c(t){return`
    <style>
      :host {
        --media-box-border-radius: 4px;
        --media-box-padding-left: 10px;
        --media-box-padding-right: 10px;
        --media-preview-border-radius: var(--media-box-border-radius);
        --media-box-arrow-offset: var(--media-box-border-radius);
        --_control-background: var(--media-control-background, var(--media-secondary-color, rgb(20 20 30 / .7)));
        --_preview-background: var(--media-preview-background, var(--_control-background));

        
        contain: layout;
      }

      #buffered {
        background: var(--media-time-range-buffered-color, rgb(255 255 255 / .4));
        position: absolute;
        height: 100%;
        will-change: width;
      }

      #preview-rail,
      #current-rail {
        width: 100%;
        position: absolute;
        left: 0;
        bottom: 100%;
        pointer-events: none;
        will-change: transform;
      }

      [part~="box"] {
        width: min-content;
        
        position: absolute;
        bottom: 100%;
        flex-direction: column;
        align-items: center;
        transform: translateX(-50%);
      }

      [part~="current-box"] {
        display: var(--media-current-box-display, var(--media-box-display, flex));
        margin: var(--media-current-box-margin, var(--media-box-margin, 0 0 5px));
        visibility: hidden;
      }

      [part~="preview-box"] {
        display: var(--media-preview-box-display, var(--media-box-display, flex));
        margin: var(--media-preview-box-margin, var(--media-box-margin, 0 0 5px));
        transition-property: var(--media-preview-transition-property, visibility, opacity);
        transition-duration: var(--media-preview-transition-duration-out, .25s);
        transition-delay: var(--media-preview-transition-delay-out, 0s);
        visibility: hidden;
        opacity: 0;
      }

      :host(:is([${o.MEDIA_PREVIEW_IMAGE}], [${o.MEDIA_PREVIEW_TIME}])[dragging]) [part~="preview-box"] {
        transition-duration: var(--media-preview-transition-duration-in, .5s);
        transition-delay: var(--media-preview-transition-delay-in, .25s);
        visibility: visible;
        opacity: 1;
      }

      @media (hover: hover) {
        :host(:is([${o.MEDIA_PREVIEW_IMAGE}], [${o.MEDIA_PREVIEW_TIME}]):hover) [part~="preview-box"] {
          transition-duration: var(--media-preview-transition-duration-in, .5s);
          transition-delay: var(--media-preview-transition-delay-in, .25s);
          visibility: visible;
          opacity: 1;
        }
      }

      media-preview-thumbnail,
      ::slotted(media-preview-thumbnail) {
        visibility: hidden;
        
        transition: visibility 0s .25s;
        transition-delay: calc(var(--media-preview-transition-delay-out, 0s) + var(--media-preview-transition-duration-out, .25s));
        background: var(--media-preview-thumbnail-background, var(--_preview-background));
        box-shadow: var(--media-preview-thumbnail-box-shadow, 0 0 4px rgb(0 0 0 / .2));
        max-width: var(--media-preview-thumbnail-max-width, 180px);
        max-height: var(--media-preview-thumbnail-max-height, 160px);
        min-width: var(--media-preview-thumbnail-min-width, 120px);
        min-height: var(--media-preview-thumbnail-min-height, 80px);
        border: var(--media-preview-thumbnail-border);
        border-radius: var(--media-preview-thumbnail-border-radius,
          var(--media-preview-border-radius) var(--media-preview-border-radius) 0 0);
      }

      :host([${o.MEDIA_PREVIEW_IMAGE}][dragging]) media-preview-thumbnail,
      :host([${o.MEDIA_PREVIEW_IMAGE}][dragging]) ::slotted(media-preview-thumbnail) {
        transition-delay: var(--media-preview-transition-delay-in, .25s);
        visibility: visible;
      }

      @media (hover: hover) {
        :host([${o.MEDIA_PREVIEW_IMAGE}]:hover) media-preview-thumbnail,
        :host([${o.MEDIA_PREVIEW_IMAGE}]:hover) ::slotted(media-preview-thumbnail) {
          transition-delay: var(--media-preview-transition-delay-in, .25s);
          visibility: visible;
        }

        :host([${o.MEDIA_PREVIEW_TIME}]:hover) {
          --media-time-range-hover-display: block;
        }
      }

      media-preview-chapter-display,
      ::slotted(media-preview-chapter-display) {
        font-size: var(--media-font-size, 13px);
        line-height: 17px;
        min-width: 0;
        visibility: hidden;
        
        transition: min-width 0s, border-radius 0s, margin 0s, padding 0s, visibility 0s;
        transition-delay: calc(var(--media-preview-transition-delay-out, 0s) + var(--media-preview-transition-duration-out, .25s));
        background: var(--media-preview-chapter-background, var(--_preview-background));
        border-radius: var(--media-preview-chapter-border-radius,
          var(--media-preview-border-radius) var(--media-preview-border-radius)
          var(--media-preview-border-radius) var(--media-preview-border-radius));
        padding: var(--media-preview-chapter-padding, 3.5px 9px);
        margin: var(--media-preview-chapter-margin, 0 0 5px);
        text-shadow: var(--media-preview-chapter-text-shadow, 0 0 4px rgb(0 0 0 / .75));
      }

      :host([${o.MEDIA_PREVIEW_IMAGE}]) media-preview-chapter-display,
      :host([${o.MEDIA_PREVIEW_IMAGE}]) ::slotted(media-preview-chapter-display) {
        transition-delay: var(--media-preview-transition-delay-in, .25s);
        border-radius: var(--media-preview-chapter-border-radius, 0);
        padding: var(--media-preview-chapter-padding, 3.5px 9px 0);
        margin: var(--media-preview-chapter-margin, 0);
        min-width: 100%;
      }

      media-preview-chapter-display[${o.MEDIA_PREVIEW_CHAPTER}],
      ::slotted(media-preview-chapter-display[${o.MEDIA_PREVIEW_CHAPTER}]) {
        visibility: visible;
      }

      media-preview-chapter-display:not([aria-valuetext]),
      ::slotted(media-preview-chapter-display:not([aria-valuetext])) {
        display: none;
      }

      media-preview-time-display,
      ::slotted(media-preview-time-display),
      media-time-display,
      ::slotted(media-time-display) {
        font-size: var(--media-font-size, 13px);
        line-height: 17px;
        min-width: 0;
        
        transition: min-width 0s, border-radius 0s;
        transition-delay: calc(var(--media-preview-transition-delay-out, 0s) + var(--media-preview-transition-duration-out, .25s));
        background: var(--media-preview-time-background, var(--_preview-background));
        border-radius: var(--media-preview-time-border-radius,
          var(--media-preview-border-radius) var(--media-preview-border-radius)
          var(--media-preview-border-radius) var(--media-preview-border-radius));
        padding: var(--media-preview-time-padding, 3.5px 9px);
        margin: var(--media-preview-time-margin, 0);
        text-shadow: var(--media-preview-time-text-shadow, 0 0 4px rgb(0 0 0 / .75));
        transform: translateX(min(
          max(calc(50% - var(--_box-width) / 2),
          calc(var(--_box-shift, 0))),
          calc(var(--_box-width) / 2 - 50%)
        ));
      }

      :host([${o.MEDIA_PREVIEW_IMAGE}]) media-preview-time-display,
      :host([${o.MEDIA_PREVIEW_IMAGE}]) ::slotted(media-preview-time-display) {
        transition-delay: var(--media-preview-transition-delay-in, .25s);
        border-radius: var(--media-preview-time-border-radius,
          0 0 var(--media-preview-border-radius) var(--media-preview-border-radius));
        min-width: 100%;
      }

      :host([${o.MEDIA_PREVIEW_TIME}]:hover) {
        --media-time-range-hover-display: block;
      }

      [part~="arrow"],
      ::slotted([part~="arrow"]) {
        display: var(--media-box-arrow-display, inline-block);
        transform: translateX(min(
          max(calc(50% - var(--_box-width) / 2 + var(--media-box-arrow-offset)),
          calc(var(--_box-shift, 0))),
          calc(var(--_box-width) / 2 - 50% - var(--media-box-arrow-offset))
        ));
        
        border-color: transparent;
        border-top-color: var(--media-box-arrow-background, var(--_control-background));
        border-width: var(--media-box-arrow-border-width,
          var(--media-box-arrow-height, 5px) var(--media-box-arrow-width, 6px) 0);
        border-style: solid;
        justify-content: center;
        height: 0;
      }
    </style>
    <div id="preview-rail">
      <slot name="preview" part="box preview-box">
        <media-preview-thumbnail>
          <template shadowrootmode="${Wa.shadowRootOptions.mode}">
            ${Wa.getTemplateHTML({})}
          </template>
        </media-preview-thumbnail>
        <media-preview-chapter-display></media-preview-chapter-display>
        <media-preview-time-display></media-preview-time-display>
        <slot name="preview-arrow"><div part="arrow"></div></slot>
      </slot>
    </div>
    <div id="current-rail">
      <slot name="current" part="box current-box">
        
      </slot>
    </div>
  `}var er=(t,e=t.mediaCurrentTime)=>{let i=Number.isFinite(t.mediaSeekableStart)?t.mediaSeekableStart:0,a=Number.isFinite(t.mediaDuration)?t.mediaDuration:t.mediaSeekableEnd;if(Number.isNaN(a))return 0;let r=(e-i)/(a-i);return Math.max(0,Math.min(r,1))},Cn=(t,e=t.range.valueAsNumber)=>{let i=Number.isFinite(t.mediaSeekableStart)?t.mediaSeekableStart:0,a=Number.isFinite(t.mediaDuration)?t.mediaDuration:t.mediaSeekableEnd;return Number.isNaN(a)?0:e*(a-i)+i},ti=class extends ve{constructor(){super(),
K(this,lo),K(this,rr),K(this,or),K(this,sr),K(this,uo),K(this,Hi),K(this,ho),K(this,Jt,null),K(this,ze,void 0),K(this,ir,void 0),K(this,xi,void 0),K(this,ar,void 0),K(this,tr,void 0),K(this,Pi,void 0),K(this,Ni,void 0),K(this,jt,void 0),K(this,ei,void 0),K(this,Ui,()=>{ne(this,lo,wn).call(this)?P(this,ze).start():P(this,ze).stop()}),K(this,co,a=>{this.dragging||(ct(a)&&(this.range.valueAsNumber=a),P(this,ei)||this.updateBar())}),this.shadowRoot.querySelector("#track").insertAdjacentHTML("afterbe\
gin",'<div id="buffered" part="buffered"></div>'),se(this,ir,this.shadowRoot.querySelectorAll('[part~="box"]')),se(this,ar,this.shadowRoot.querySelector('[part~="preview-box"]')),se(this,tr,this.shadowRoot.querySelector('[part~="current-box"]'));let i=getComputedStyle(this);se(this,Pi,parseInt(i.getPropertyValue("--media-box-padding-left"))),se(this,Ni,parseInt(i.getPropertyValue("--media-box-padding-right"))),se(this,ze,new ja(this.range,P(this,co),60))}static get observedAttributes(){return[...super.
observedAttributes,o.MEDIA_PAUSED,o.MEDIA_DURATION,o.MEDIA_SEEKABLE,o.MEDIA_CURRENT_TIME,o.MEDIA_PREVIEW_IMAGE,o.MEDIA_PREVIEW_TIME,o.MEDIA_PREVIEW_CHAPTER,o.MEDIA_BUFFERED,o.MEDIA_PLAYBACK_RATE,o.MEDIA_LOADING,o.MEDIA_ENDED]}connectedCallback(){var e;super.connectedCallback(),this.range.setAttribute("aria-label",m("seek")),P(this,Ui).call(this),se(this,Jt,this.getRootNode()),(e=P(this,Jt))==null||e.addEventListener("transitionstart",this)}disconnectedCallback(){var e;super.disconnectedCallback(),
P(this,ze).stop(),(e=P(this,Jt))==null||e.removeEventListener("transitionstart",this),se(this,Jt,null)}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),i!=a&&(e===o.MEDIA_CURRENT_TIME||e===o.MEDIA_PAUSED||e===o.MEDIA_ENDED||e===o.MEDIA_LOADING||e===o.MEDIA_DURATION||e===o.MEDIA_SEEKABLE?(P(this,ze).update({start:er(this),duration:this.mediaSeekableEnd-this.mediaSeekableStart,playbackRate:this.mediaPlaybackRate}),P(this,Ui).call(this),Bc(this)):e===o.MEDIA_BUFFERED&&this.updateBufferedBar(),
(e===o.MEDIA_DURATION||e===o.MEDIA_SEEKABLE)&&(this.mediaChaptersCues=P(this,jt),this.updateBar()))}get mediaChaptersCues(){return P(this,jt)}set mediaChaptersCues(e){var i;se(this,jt,e),this.updateSegments((i=P(this,jt))==null?void 0:i.map(a=>({start:er(this,a.startTime),end:er(this,a.endTime)})))}get mediaPaused(){return _(this,o.MEDIA_PAUSED)}set mediaPaused(e){g(this,o.MEDIA_PAUSED,e)}get mediaLoading(){return _(this,o.MEDIA_LOADING)}set mediaLoading(e){g(this,o.MEDIA_LOADING,e)}get mediaDuration(){
return D(this,o.MEDIA_DURATION)}set mediaDuration(e){U(this,o.MEDIA_DURATION,e)}get mediaCurrentTime(){return D(this,o.MEDIA_CURRENT_TIME)}set mediaCurrentTime(e){U(this,o.MEDIA_CURRENT_TIME,e)}get mediaPlaybackRate(){return D(this,o.MEDIA_PLAYBACK_RATE,1)}set mediaPlaybackRate(e){U(this,o.MEDIA_PLAYBACK_RATE,e)}get mediaBuffered(){let e=this.getAttribute(o.MEDIA_BUFFERED);return e?e.split(" ").map(i=>i.split(":").map(a=>+a)):[]}set mediaBuffered(e){if(!e){this.removeAttribute(o.MEDIA_BUFFERED);
return}let i=e.map(a=>a.join(":")).join(" ");this.setAttribute(o.MEDIA_BUFFERED,i)}get mediaSeekable(){let e=this.getAttribute(o.MEDIA_SEEKABLE);if(e)return e.split(":").map(i=>+i)}set mediaSeekable(e){if(e==null){this.removeAttribute(o.MEDIA_SEEKABLE);return}this.setAttribute(o.MEDIA_SEEKABLE,e.join(":"))}get mediaSeekableEnd(){var e;let[,i=this.mediaDuration]=(e=this.mediaSeekable)!=null?e:[];return i}get mediaSeekableStart(){var e;let[i=0]=(e=this.mediaSeekable)!=null?e:[];return i}get mediaPreviewImage(){
return w(this,o.MEDIA_PREVIEW_IMAGE)}set mediaPreviewImage(e){L(this,o.MEDIA_PREVIEW_IMAGE,e)}get mediaPreviewTime(){return D(this,o.MEDIA_PREVIEW_TIME)}set mediaPreviewTime(e){U(this,o.MEDIA_PREVIEW_TIME,e)}get mediaEnded(){return _(this,o.MEDIA_ENDED)}set mediaEnded(e){g(this,o.MEDIA_ENDED,e)}updateBar(){super.updateBar(),this.updateBufferedBar(),this.updateCurrentBox()}updateBufferedBar(){var e;let i=this.mediaBuffered;if(!i.length)return;let a;if(this.mediaEnded)a=1;else{let s=this.mediaCurrentTime,
[,l=this.mediaSeekableStart]=(e=i.find(([d,c])=>d<=s&&s<=c))!=null?e:[];a=er(this,l)}let{style:r}=x(this.shadowRoot,"#buffered");r.setProperty("width",`${a*100}%`)}updateCurrentBox(){if(!this.shadowRoot.querySelector('slot[name="current"]').assignedElements().length)return;let i=x(this.shadowRoot,"#current-rail"),a=x(this.shadowRoot,'[part~="current-box"]'),r=ne(this,rr,po).call(this,P(this,tr)),s=ne(this,or,Eo).call(this,r,this.range.valueAsNumber),l=ne(this,sr,vo).call(this,r,this.range.valueAsNumber);
i.style.transform=`translateX(${s})`,i.style.setProperty("--_range-width",`${r.range.width}`),a.style.setProperty("--_box-shift",`${l}`),a.style.setProperty("--_box-width",`${r.box.width}px`),a.style.setProperty("visibility","initial")}handleEvent(e){switch(super.handleEvent(e),e.type){case"input":ne(this,ho,Dn).call(this);break;case"pointermove":ne(this,uo,Rn).call(this,e);break;case"pointerup":P(this,ei)&&se(this,ei,!1);break;case"pointerdown":se(this,ei,!0);break;case"pointerleave":ne(this,Hi,
nr).call(this,null);break;case"transitionstart":_e(e.target,this)&&setTimeout(()=>P(this,Ui).call(this),0);break}}};Jt=new WeakMap;ze=new WeakMap;ir=new WeakMap;xi=new WeakMap;ar=new WeakMap;tr=new WeakMap;Pi=new WeakMap;Ni=new WeakMap;jt=new WeakMap;ei=new WeakMap;Ui=new WeakMap;lo=new WeakSet;wn=function(){return this.isConnected&&!this.mediaPaused&&!this.mediaLoading&&!this.mediaEnded&&this.mediaSeekableEnd>0&&zi(this)};co=new WeakMap;rr=new WeakSet;po=function(t){var e;let a=((e=this.getAttribute(
"bounds")?He(this,`#${this.getAttribute("bounds")}`):this.parentElement)!=null?e:this).getBoundingClientRect(),r=this.range.getBoundingClientRect(),s=t.offsetWidth,l=-(r.left-a.left-s/2),d=a.right-r.left-s/2;return{box:{width:s,min:l,max:d},bounds:a,range:r}};or=new WeakSet;Eo=function(t,e){let i=`${e*100}%`,{width:a,min:r,max:s}=t.box;if(!a)return i;if(Number.isNaN(r)||(i=`max(${`calc(1 / var(--_range-width) * 100 * ${r}% + var(--media-box-padding-left))`}, ${i})`),!Number.isNaN(s)){let d=`calc\
(1 / var(--_range-width) * 100 * ${s}% - var(--media-box-padding-right))`;i=`min(${i}, ${d})`}return i};sr=new WeakSet;vo=function(t,e){let{width:i,min:a,max:r}=t.box,s=e*t.range.width;if(s<a+P(this,Pi)){let l=t.range.left-t.bounds.left-P(this,Pi);return`${s-i/2+l}px`}if(s>r-P(this,Ni)){let l=t.bounds.right-t.range.right-P(this,Ni);return`${s+i/2-l-t.range.width}px`}return 0};uo=new WeakSet;Rn=function(t){let e=[...P(this,ir)].some(S=>t.composedPath().includes(S));if(!this.dragging&&(e||!t.composedPath().
includes(this))){ne(this,Hi,nr).call(this,null);return}let i=this.mediaSeekableEnd;if(!i)return;let a=x(this.shadowRoot,"#preview-rail"),r=x(this.shadowRoot,'[part~="preview-box"]'),s=ne(this,rr,po).call(this,P(this,ar)),l=(t.clientX-s.range.left)/s.range.width;l=Math.max(0,Math.min(1,l));let d=ne(this,or,Eo).call(this,s,l),c=ne(this,sr,vo).call(this,s,l);a.style.transform=`translateX(${d})`,a.style.setProperty("--_range-width",`${s.range.width}`),r.style.setProperty("--_box-shift",`${c}`),r.style.
setProperty("--_box-width",`${s.box.width}px`);let y=Math.round(P(this,xi))-Math.round(l*i);Math.abs(y)<1&&l>.01&&l<.99||(se(this,xi,l*i),ne(this,Hi,nr).call(this,P(this,xi)))};Hi=new WeakSet;nr=function(t){this.dispatchEvent(new n.CustomEvent(h.MEDIA_PREVIEW_REQUEST,{composed:!0,bubbles:!0,detail:t}))};ho=new WeakSet;Dn=function(){P(this,ze).stop();let t=Cn(this);this.dispatchEvent(new n.CustomEvent(h.MEDIA_SEEK_REQUEST,{composed:!0,bubbles:!0,detail:t}))};ti.shadowRootOptions={mode:"open"};ti.
getContainerTemplateHTML=$c;n.customElements.get("media-time-range")||n.customElements.define("media-time-range",ti);var Wc=ti;var Vc=(t,e,i)=>{if(!e.has(t))throw TypeError("Cannot "+i)},On=(t,e,i)=>(Vc(t,e,"read from private field"),i?i.call(t):e.get(t)),Kc=(t,e,i)=>{if(e.has(t))throw TypeError("Cannot add the same private member more than once");e instanceof WeakSet?e.add(t):e.set(t,i)},lr,Gc=1,qc=t=>t.mediaMuted?0:t.mediaVolume,Yc=t=>`${Math.round(t*100)}%`,dr=class extends ve{constructor(){super(...arguments),Kc(this,lr,()=>{let e=this.range.value,i=new n.CustomEvent(h.MEDIA_VOLUME_REQUEST,{composed:!0,bubbles:!0,detail:e});
this.dispatchEvent(i)})}static get observedAttributes(){return[...super.observedAttributes,o.MEDIA_VOLUME,o.MEDIA_MUTED,o.MEDIA_VOLUME_UNAVAILABLE]}connectedCallback(){super.connectedCallback(),this.range.setAttribute("aria-label",m("volume")),this.range.addEventListener("input",On(this,lr))}disconnectedCallback(){this.range.removeEventListener("input",On(this,lr)),super.disconnectedCallback()}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),(e===o.MEDIA_VOLUME||e===o.MEDIA_MUTED)&&
(this.range.valueAsNumber=qc(this),this.range.setAttribute("aria-valuetext",Yc(this.range.valueAsNumber)),this.updateBar())}get mediaVolume(){return D(this,o.MEDIA_VOLUME,Gc)}set mediaVolume(e){U(this,o.MEDIA_VOLUME,e)}get mediaMuted(){return _(this,o.MEDIA_MUTED)}set mediaMuted(e){g(this,o.MEDIA_MUTED,e)}get mediaVolumeUnavailable(){return w(this,o.MEDIA_VOLUME_UNAVAILABLE)}set mediaVolumeUnavailable(e){L(this,o.MEDIA_VOLUME_UNAVAILABLE,e)}};lr=new WeakMap;n.customElements.get("media-volume-ran\
ge")||n.customElements.define("media-volume-range",dr);var Qc=dr;function zc(t){return`
      <style>
        :host {
          min-width: 4ch;
          padding: var(--media-button-padding, var(--media-control-padding, 10px 5px));
          width: 100%;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 1rem;
          font-weight: var(--media-button-font-weight, normal);
        }

        #checked-indicator {
          display: none;
        }

        :host([${o.MEDIA_LOOP}]) #checked-indicator {
          display: block;
        }
      </style>
      
      <span id="icon">
     </span>

      <div id="checked-indicator">
        <svg aria-hidden="true" viewBox="0 1 24 24" part="checked-indicator indicator">
          <path d="m10 15.17 9.193-9.191 1.414 1.414-10.606 10.606-6.364-6.364 1.414-1.414 4.95 4.95Z"/>
        </svg>
      </div>
    `}function Zc(){return m("Loop")}var ii=class extends C{constructor(){super(...arguments),this.container=null}static get observedAttributes(){return[...super.observedAttributes,o.MEDIA_LOOP]}connectedCallback(){var e;super.connectedCallback(),this.container=((e=this.shadowRoot)==null?void 0:e.querySelector("#icon"))||null,this.container&&(this.container.textContent=m("Loop"))}attributeChangedCallback(e,i,a){super.attributeChangedCallback(e,i,a),e===o.MEDIA_LOOP&&this.container&&this.setAttribute(
"aria-checked",this.mediaLoop?"true":"false")}get mediaLoop(){return _(this,o.MEDIA_LOOP)}set mediaLoop(e){g(this,o.MEDIA_LOOP,e)}handleClick(){let e=!this.mediaLoop,i=new n.CustomEvent(h.MEDIA_LOOP_REQUEST,{composed:!0,bubbles:!0,detail:e});this.dispatchEvent(i)}};ii.getSlotTemplateHTML=zc;ii.getTooltipContentHTML=Zc;n.customElements.get("media-loop-button")||n.customElements.define("media-loop-button",ii);var Xc=ii;export{Wl as MediaAirplayButton,Yl as MediaCaptionsButton,Jl as MediaCastButton,Fl as MediaChromeButton,td as MediaChromeDialog,rd as MediaChromeRange,ul as MediaContainer,nd as MediaControlBar,Ol as MediaController,Ed as MediaDurationDisplay,Id as MediaErrorDialog,xd as MediaFullscreenButton,Xi as MediaGestureReceiver,kd as MediaKeyboardShortcutsDialog,Bd as MediaLiveButton,Vd as MediaLoadingIndicator,Xc as MediaLoopButton,Qd as MediaMuteButton,Xd as MediaPipButton,lc as MediaPlayButton,ac as MediaPlaybackRateButton,
hc as MediaPosterImage,vc as MediaPreviewChapterDisplay,Wa as MediaPreviewThumbnail,Ac as MediaPreviewTimeDisplay,kc as MediaSeekBackwardButton,Oc as MediaSeekForwardButton,ud as MediaTextDisplay,Hc as MediaTimeDisplay,Wc as MediaTimeRange,ma as MediaTooltip,Qc as MediaVolumeRange,Go as constants,m as t,es as timeUtils};
