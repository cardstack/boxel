'use strict';



;define("animations/adapters/-json-api", ["exports", "@ember-data/adapter/json-api"], function (_exports, _jsonApi) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _jsonApi.default;
    }
  });
});
;define("animations/app", ["exports", "ember-resolver", "ember-load-initializers", "animations/config/environment"], function (_exports, _emberResolver, _emberLoadInitializers, _environment) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  class App extends Ember.Application {
    constructor(...args) {
      super(...args);

      _defineProperty(this, "modulePrefix", _environment.default.modulePrefix);

      _defineProperty(this, "podModulePrefix", _environment.default.podModulePrefix);

      _defineProperty(this, "Resolver", _emberResolver.default);
    }

  }

  _exports.default = App;
  (0, _emberLoadInitializers.default)(App, _environment.default.modulePrefix);
});
;define("animations/behaviors/base", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.timeToFrame = timeToFrame;
  _exports.FPS = void 0;
  const FPS = 60 / 1000; // 60 FPS

  _exports.FPS = FPS;

  function timeToFrame(time) {
    return Math.round(time * FPS);
  }
});
;define("animations/behaviors/linear", ["exports", "animations/behaviors/base", "animations/utils/instantaneous-velocity"], function (_exports, _base, _instantaneousVelocity) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  class LinearBehavior {
    toFrames(options) {
      let {
        from,
        to,
        duration,
        delay = 0,
        lastFrame,
        previousFramesFromTime
      } = options;

      if (from === to) {
        return [];
      } // if from and to are not the same we generate at minimum 2 frames


      duration = Math.max(duration, 1 / _base.FPS);
      let frameCount = Math.max((0, _base.timeToFrame)(duration), 1);
      let delayFrameCount = (0, _base.timeToFrame)(delay);
      let frames = Array.from(new Array(delayFrameCount)).map(() => ({
        value: from,
        velocity: 0
      }));
      let velocity = (to - from) / duration / 1000;

      for (let i = 0; i <= frameCount; i++) {
        let t = i / frameCount;
        let value = (1 - t) * from + t * to;
        frames.push({
          value,
          velocity
        });
      } // linearly combine if a motion was still happening


      if (previousFramesFromTime?.length) {
        let frameCount = previousFramesFromTime.length < frames.length ? previousFramesFromTime.length : frames.length;
        frameCount--;

        for (let i = 0; i <= frameCount; i++) {
          let progress = i / frameCount;
          frames[i].value = progress * frames[i].value + (1 - progress) * previousFramesFromTime[i].value;
        }

        if (lastFrame) {
          // We explicitly add the lastFrame (if any) to correctly calculate the velocity at the transfer point.
          frames[0].velocity = (0, _instantaneousVelocity.default)(1, [lastFrame, ...frames]);
        } else {
          frames[0].velocity = (0, _instantaneousVelocity.default)(0, frames);
        }

        for (let i = 1; i <= frameCount; i++) {
          frames[i].velocity = (0, _instantaneousVelocity.default)(i, frames);
        }
      }

      return frames;
    }

  }

  _exports.default = LinearBehavior;
});
;define("animations/behaviors/spring", ["exports", "animations/behaviors/base"], function (_exports, _base) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  class SpringBehavior {
    constructor(options) {
      _defineProperty(this, "options", void 0);

      this.options = {
        stiffness: 100,
        damping: 10,
        mass: 1,
        overshootClamping: false,
        allowsOverdamping: false,
        restVelocityThreshold: 0.001,
        restDisplacementThreshold: 0.001,
        ...options
      };
      (true && !(this.options.mass > 0) && Ember.assert('Mass value must be greater than 0', this.options.mass > 0));
      (true && !(this.options.stiffness > 0) && Ember.assert('Stiffness value must be greater than 0', this.options.stiffness > 0));
      (true && !(this.options.damping > 0) && Ember.assert('Damping value must be greater than 0', this.options.damping > 0));
    }

    toFrames(options) {
      let {
        from,
        to,
        velocity = 0,
        delay = 0
      } = options;
      let delayFrameCount = (0, _base.timeToFrame)(delay);
      let frames = Array.from(new Array(delayFrameCount)).map(() => ({
        value: from,
        velocity: 0
      }));
      frames = [...frames, ...this.springToKeyframes({
        fromValue: from,
        toValue: to,
        initialVelocity: velocity
      })];
      return frames;
    }

    isSpringOvershooting({
      fromValue,
      toValue,
      value
    }) {
      let isOvershooting = false;

      if (this.options.overshootClamping && this.options.stiffness !== 0) {
        if (fromValue < toValue) {
          isOvershooting = value > toValue;
        } else {
          isOvershooting = value < toValue;
        }
      }

      return isOvershooting;
    }

    isSpringAtRest({
      toValue,
      value,
      velocity
    }) {
      let isNoVelocity = Math.abs(velocity) <= this.options.restVelocityThreshold;
      let isNoDisplacement = this.options.stiffness !== 0 && Math.abs(toValue - value) <= this.options.restDisplacementThreshold;
      return isNoDisplacement && isNoVelocity;
    }

    finalizeSpring(frame, fromValue, toValue) {
      let {
        velocity,
        value
      } = frame; // If the Spring is overshooting (when overshoot clamping is on), or if the
      // spring is at rest (based on the thresholds set in the config), stop the
      // animation.

      if ((this.isSpringOvershooting({
        fromValue,
        toValue,
        value
      }) || this.isSpringAtRest({
        toValue,
        value,
        velocity
      })) && this.options.stiffness !== 0) {
        // Ensure that we end up with a round value
        return {
          value: toValue,
          velocity: 0
        };
      }

      return {
        value,
        velocity
      };
    }

    getSpringFunction({
      fromValue,
      toValue,
      initialVelocity
    }) {
      let {
        damping: c,
        mass: m,
        stiffness: k,
        allowsOverdamping
      } = this.options;
      let v0 = initialVelocity ?? 0;
      let zeta = c / (2 * Math.sqrt(k * m)); // damping ratio (dimensionless)

      let omega0 = Math.sqrt(k / m) / 1000; // undamped angular frequency of the oscillator (rad/ms)

      let omega1 = omega0 * Math.sqrt(1.0 - zeta * zeta); // exponential decay

      let omega2 = omega0 * Math.sqrt(zeta * zeta - 1.0); // frequency of damped oscillation

      let x0 = toValue - fromValue; // initial displacement of the spring at t = 0

      if (zeta > 1 && !allowsOverdamping) {
        zeta = 1;
      }

      if (zeta < 1) {
        // Underdamped
        return t => {
          let envelope = Math.exp(-zeta * omega0 * t);
          let oscillation = toValue - envelope * ((v0 + zeta * omega0 * x0) / omega1 * Math.sin(omega1 * t) + x0 * Math.cos(omega1 * t)); // Derivative of the oscillation function

          let velocity = zeta * omega0 * envelope * (Math.sin(omega1 * t) * (v0 + zeta * omega0 * x0) / omega1 + x0 * Math.cos(omega1 * t)) - envelope * (Math.cos(omega1 * t) * (v0 + zeta * omega0 * x0) - omega1 * x0 * Math.sin(omega1 * t));
          return this.finalizeSpring({
            value: oscillation,
            velocity
          }, fromValue, toValue);
        };
      } else if (zeta === 1) {
        // Critically damped
        return t => {
          let envelope = Math.exp(-omega0 * t);
          let oscillation = toValue - envelope * (x0 + (v0 + omega0 * x0) * t);
          let velocity = envelope * (v0 * (t * omega0 - 1) + t * x0 * (omega0 * omega0));
          return this.finalizeSpring({
            value: oscillation,
            velocity
          }, fromValue, toValue);
        };
      } else {
        // Overdamped
        return t => {
          let envelope = Math.exp(-zeta * omega0 * t);
          let oscillation = toValue - envelope * ((v0 + zeta * omega0 * x0) * Math.sinh(omega2 * t) + omega2 * x0 * Math.cosh(omega2 * t)) / omega2;
          let velocity = envelope * zeta * omega0 * (Math.sinh(omega2 * t) * (v0 + zeta * omega0 * x0) + x0 * omega2 * Math.cosh(omega2 * t)) / omega2 - envelope * (omega2 * Math.cosh(omega2 * t) * (v0 + zeta * omega0 * x0) + omega2 * omega2 * x0 * Math.sinh(omega2 * t)) / omega2;
          return this.finalizeSpring({
            value: oscillation,
            velocity
          }, fromValue, toValue);
        };
      }
    }

    springToKeyframes(values) {
      let {
        fromValue = 0,
        toValue = 1,
        initialVelocity = 0
      } = values;

      if (fromValue === toValue && initialVelocity === 0) {
        return [];
      }

      if (isNaN(fromValue) || isNaN(toValue)) {
        throw new Error(`Cannot calculate spring for non-numerical values: ${fromValue} -> ${toValue}`);
      }

      let springFunction = this.getSpringFunction({
        fromValue,
        toValue,
        initialVelocity
      });
      let time = 0;
      let value = fromValue;
      let velocity = initialVelocity;
      let deltaTimeMs = 1 / _base.FPS;
      let frames = [];

      while (!this.isSpringAtRest({
        value,
        toValue,
        velocity
      })) {
        let frame = springFunction(time);
        time += deltaTimeMs;
        value = frame.value;
        velocity = frame.velocity;
        frames.push(frame);
      }

      return frames;
    }

  }

  _exports.default = SpringBehavior;
});
;define("animations/component-managers/glimmer", ["exports", "@glimmer/component/-private/ember-component-manager"], function (_exports, _emberComponentManager) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _emberComponentManager.default;
    }
  });
});
;define("animations/components/-dynamic-element-alt", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  // avoiding reexport directly here because in some circumstances (ember-engines
  // for example) a simple reexport is transformed to `define.alias`,
  // unfortunately at the moment (ember-source@3.13) there is no _actual_
  // `@ember/component` module to alias so this causes issues
  //
  // tldr; we can replace this with a simple reexport when we can rely on Ember
  // actually providing a `@ember/component` module
  var _default = Ember.Component.extend();

  _exports.default = _default;
});
;define("animations/components/-dynamic-element", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  // avoiding reexport directly here because in some circumstances (ember-engines
  // for example) a simple reexport is transformed to `define.alias`,
  // unfortunately at the moment (ember-source@3.13) there is no _actual_
  // `@ember/component` module to alias so this causes issues
  //
  // tldr; we can replace this with a simple reexport when we can rely on Ember
  // actually providing a `@ember/component` module
  var _default = Ember.Component.extend();

  _exports.default = _default;
});
;define("animations/components/-ember-table-private/row-wrapper", ["exports", "ember-table/components/-private/row-wrapper"], function (_exports, _rowWrapper) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _rowWrapper.default;
    }
  });
});
;define("animations/components/-ember-table-private/simple-checkbox", ["exports", "ember-table/components/-private/simple-checkbox"], function (_exports, _simpleCheckbox) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _simpleCheckbox.default;
    }
  });
});
;define("animations/components/accordion/index.css", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;
  var _default = {
    "Accordion": "_Accordion_uk9m7z",
    "focus": "_focus_uk9m7z"
  };
  _exports.default = _default;
});
;define("animations/components/accordion/index", ["exports", "@glimmer/component"], function (_exports, _component) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _dec7, _class, _descriptor, _descriptor2, _temp;

  function _initializerDefineProperty(target, property, descriptor, context) { if (!descriptor) return; Object.defineProperty(target, property, { enumerable: descriptor.enumerable, configurable: descriptor.configurable, writable: descriptor.writable, value: descriptor.initializer ? descriptor.initializer.call(context) : void 0 }); }

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  function _applyDecoratedDescriptor(target, property, decorators, descriptor, context) { var desc = {}; Object.keys(descriptor).forEach(function (key) { desc[key] = descriptor[key]; }); desc.enumerable = !!desc.enumerable; desc.configurable = !!desc.configurable; if ('value' in desc || desc.initializer) { desc.writable = true; } desc = decorators.slice().reverse().reduce(function (desc, decorator) { return decorator(target, property, desc) || desc; }, desc); if (context && desc.initializer !== void 0) { desc.value = desc.initializer ? desc.initializer.call(context) : void 0; desc.initializer = undefined; } if (desc.initializer === void 0) { Object.defineProperty(target, property, desc); desc = null; } return desc; }

  function _initializerWarningHelper(descriptor, context) { throw new Error('Decorating class property failed. Please ensure that ' + 'proposal-class-properties is enabled and runs after the decorators transform.'); }

  const __COLOCATED_TEMPLATE__ = Ember.HTMLBars.template(
  /*
    {{!--
    This accordion component includes material copied from or derived from W3's Accordion Example (https://www.w3.org/TR/wai-aria-practices-1.1/examples/accordion/accordion.html).
    Copyright © 2022 W3C® (MIT, ERCIM, Keio, Beihang).
  
    This work is being provided by the copyright holders under the following license.
  
    License
    By obtaining and/or copying this work, you (the licensee) agree that you have read, understood, and will comply with the following terms and conditions.
  
    Permission to copy, modify, and distribute this work, with or without modification, for any purpose and without fee or royalty is hereby granted, provided that you include the following on ALL copies of the work or portions thereof, including modifications:
  
    The full text of this NOTICE in a location viewable to users of the redistributed or derivative work.
    Any pre-existing intellectual property disclaimers, notices, or terms and conditions. If none exist, the W3C Software and Document Short Notice should be included.
    Notice of any changes or modifications, through a copyright statement on the new code or document such as "This software or document includes material copied from or derived from [title and URI of the W3C document]. Copyright © [YEAR] W3C® (MIT, ERCIM, Keio, Beihang)."
    Disclaimers
    THIS WORK IS PROVIDED "AS IS," AND COPYRIGHT HOLDERS MAKE NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO, WARRANTIES OF MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE SOFTWARE OR DOCUMENT WILL NOT INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR OTHER RIGHTS.
  
    COPYRIGHT HOLDERS WILL NOT BE LIABLE FOR ANY DIRECT, INDIRECT, SPECIAL OR CONSEQUENTIAL DAMAGES ARISING OUT OF ANY USE OF THE SOFTWARE OR DOCUMENT.
  
    The name and trademarks of copyright holders may NOT be used in advertising or publicity pertaining to the work without specific, written prior permission. Title to copyright in this work will at all times remain with copyright holders.
  
    Notes
    This version: http://www.w3.org/Consortium/Legal/2015/copyright-software-and-document
  
    Previous version: http://www.w3.org/Consortium/Legal/2002/copyright-software-20021231
  
    This version makes clear that the license is applicable to both software and text, by changing the name and substituting "work" for instances of "software and its documentation." It moves "notice of changes or modifications to the files" to the copyright notice, to make clear that the license is compatible with other liberal licenses.
  --}}
  
  <div
    local-class="Accordion {{if this.isTriggerFocused "focus"}}"
    {{on "focusin" this.handleFocusin}}
    {{on "focusout" this.handleFocusout}}
    {{on-key "ArrowUp" this.jumpToPreviousTrigger event="keyup"}}
    {{on-key "ArrowDown" this.jumpToNextTrigger event="keyup"}}
  >
    {{#each this.items as |item|}}
      <Accordion::Panel
        @id={{item.id}}
        @title={{item.title}}
        @expanded={{eq this.currentItem item.id}}
        @trigger={{this.handleTrigger}}
        @fields={{item.fields}}
      />
    {{/each}}
  </div>
  
  */
  {
    "id": "K9JHnkHW",
    "block": "{\"symbols\":[\"item\"],\"statements\":[[2,\"\\n\"],[11,\"div\"],[16,0,[31,[[30,[36,3],[[30,[36,2],[\"Accordion \",[30,[36,1],[[32,0,[\"isTriggerFocused\"]],\"focus\"],null]],null]],[[\"from\"],[\"animations/components/accordion/index.css\"]]]]]],[4,[38,4],[\"focusin\",[32,0,[\"handleFocusin\"]]],null],[4,[38,4],[\"focusout\",[32,0,[\"handleFocusout\"]]],null],[4,[38,5],[\"ArrowUp\",[32,0,[\"jumpToPreviousTrigger\"]]],[[\"event\"],[\"keyup\"]]],[4,[38,5],[\"ArrowDown\",[32,0,[\"jumpToNextTrigger\"]]],[[\"event\"],[\"keyup\"]]],[12],[2,\"\\n\"],[6,[37,7],[[30,[36,6],[[30,[36,6],[[32,0,[\"items\"]]],null]],null]],null,[[\"default\"],[{\"statements\":[[2,\"    \"],[8,\"accordion/panel\",[],[[\"@id\",\"@title\",\"@expanded\",\"@trigger\",\"@fields\"],[[32,1,[\"id\"]],[32,1,[\"title\"]],[30,[36,0],[[32,0,[\"currentItem\"]],[32,1,[\"id\"]]],null],[32,0,[\"handleTrigger\"]],[32,1,[\"fields\"]]]],null],[2,\"\\n\"]],\"parameters\":[1]}]]],[13],[2,\"\\n\"]],\"hasEval\":false,\"upvars\":[\"eq\",\"if\",\"concat\",\"local-class\",\"on\",\"on-key\",\"-track-array\",\"each\"]}",
    "moduleName": "animations/components/accordion/index.hbs"
  });

  let Accordion = (_dec = Ember._tracked, _dec2 = Ember._tracked, _dec3 = Ember._action, _dec4 = Ember._action, _dec5 = Ember._action, _dec6 = Ember._action, _dec7 = Ember._action, (_class = (_temp = class Accordion extends _component.default {
    constructor(...args) {
      super(...args);

      _defineProperty(this, "items", [{
        id: 'pi',
        title: 'Personal Information',
        fields: ['Name', 'Age']
      }, {
        id: 'mi',
        title: 'More Information',
        fields: ['Email']
      }, {
        id: 'emi',
        title: 'Even More Information',
        fields: ['IP Address', 'ZIP Code', 'Last Meal', "Pet's Name"]
      }, {
        id: 'dsti',
        title: "Don't Stop The Information",
        fields: ['Favourite Song']
      }]);

      _initializerDefineProperty(this, "isTriggerFocused", _descriptor, this);

      _initializerDefineProperty(this, "currentItem", _descriptor2, this);
    }

    handleFocusin(e) {
      if (e.target instanceof HTMLElement) {
        if (e.target.dataset.isAccordionTrigger) {
          this.isTriggerFocused = true;
        }
      }
    }

    handleFocusout(e) {
      if (e.target instanceof HTMLElement) {
        if (e.target.dataset.isAccordionTrigger) {
          this.isTriggerFocused = false;
        }
      }
    }

    handleTrigger(target) {
      this.currentItem = target;
    }

    jumpToNextTrigger(event) {
      if (!(document.activeElement instanceof HTMLElement && document.activeElement.dataset.isAccordionTrigger)) {
        return;
      }

      if (event.repeat) return;
      let id = document.activeElement.id.replace(/-trigger$/, '');
      let index = this.items.findIndex(item => item.id === id);

      if (index < this.items.length - 1) {
        document.getElementById(this.items[index + 1].id + '-trigger')?.focus();
      } else {
        document.getElementById(this.items[0].id + '-trigger')?.focus();
      }

      event.preventDefault();
    }

    jumpToPreviousTrigger(event) {
      if (!(document.activeElement instanceof HTMLElement && document.activeElement.dataset.isAccordionTrigger)) {
        return;
      }

      if (event.repeat) return;
      let id = document.activeElement.id.replace(/-trigger$/, '');
      let index = this.items.findIndex(item => item.id === id);

      if (index > 0) {
        document.getElementById(this.items[index - 1].id + '-trigger')?.focus();
      } else {
        document.getElementById(this.items[this.items.length - 1].id + '-trigger')?.focus();
      }

      event.preventDefault();
    }

  }, _temp), (_descriptor = _applyDecoratedDescriptor(_class.prototype, "isTriggerFocused", [_dec], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: function () {
      return false;
    }
  }), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "currentItem", [_dec2], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: function () {
      return '';
    }
  }), _applyDecoratedDescriptor(_class.prototype, "handleFocusin", [_dec3], Object.getOwnPropertyDescriptor(_class.prototype, "handleFocusin"), _class.prototype), _applyDecoratedDescriptor(_class.prototype, "handleFocusout", [_dec4], Object.getOwnPropertyDescriptor(_class.prototype, "handleFocusout"), _class.prototype), _applyDecoratedDescriptor(_class.prototype, "handleTrigger", [_dec5], Object.getOwnPropertyDescriptor(_class.prototype, "handleTrigger"), _class.prototype), _applyDecoratedDescriptor(_class.prototype, "jumpToNextTrigger", [_dec6], Object.getOwnPropertyDescriptor(_class.prototype, "jumpToNextTrigger"), _class.prototype), _applyDecoratedDescriptor(_class.prototype, "jumpToPreviousTrigger", [_dec7], Object.getOwnPropertyDescriptor(_class.prototype, "jumpToPreviousTrigger"), _class.prototype)), _class));
  _exports.default = Accordion;

  Ember._setComponentTemplate(__COLOCATED_TEMPLATE__, Accordion);
});
;define("animations/components/accordion/panel/index.css", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;
  var _default = {
    "Accordion": "_Accordion_1kdpbt",
    "focus": "_focus_1kdpbt",
    "accordion-panel-animation-context": "_accordion-panel-animation-context_1kdpbt",
    "accordion-panel-body": "_accordion-panel-body_1kdpbt",
    "accordion-panel-header": "_accordion-panel-header_1kdpbt",
    "Accordion-trigger": "_Accordion-trigger_1kdpbt",
    "Accordion-title": "_Accordion-title_1kdpbt",
    "Accordion-icon": "_Accordion-icon_1kdpbt",
    "Accordion-panel": "_Accordion-panel_1kdpbt"
  };
  _exports.default = _default;
});
;define("animations/components/accordion/panel/index", ["exports", "@glimmer/component", "animations/models/sprite", "animations/utils/run-animations", "animations/behaviors/spring"], function (_exports, _component, _sprite, _runAnimations, _spring) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _dec, _class;

  function _applyDecoratedDescriptor(target, property, decorators, descriptor, context) { var desc = {}; Object.keys(descriptor).forEach(function (key) { desc[key] = descriptor[key]; }); desc.enumerable = !!desc.enumerable; desc.configurable = !!desc.configurable; if ('value' in desc || desc.initializer) { desc.writable = true; } desc = decorators.slice().reverse().reduce(function (desc, decorator) { return decorator(target, property, desc) || desc; }, desc); if (context && desc.initializer !== void 0) { desc.value = desc.initializer ? desc.initializer.call(context) : void 0; desc.initializer = undefined; } if (desc.initializer === void 0) { Object.defineProperty(target, property, desc); desc = null; } return desc; }

  const __COLOCATED_TEMPLATE__ = Ember.HTMLBars.template(
  /*
    <AnimationContext local-class="accordion-panel-animation-context" @use={{this.resizePanels}}>
    <div local-class="accordion-panel-container" {{sprite id=(concat @id "-accordion-panel-container") role="accordion-panel-container"}}>
      <h3 local-class="accordion-panel-header">
        <button
          aria-expanded={{if @expanded "true" "false"}}
          {{!-- we don't allow closing by pressing an opened accordion just yet --}}
          aria-disabled={{if @expanded "true" "false"}}
          local-class="Accordion-trigger"
          aria-controls={{concat @id "-section"}}
          id={{concat @id "-trigger"}}
          type="button"
          data-is-accordion-trigger="true"
          {{on "click" (fn @trigger @id)}}
        >
          <span local-class="Accordion-title">
            {{@title}}
            <span local-class="Accordion-icon"></span>
          </span>
        </button>
      </h3>
      {{#if @expanded}}
        <div
          {{sprite id=(concat @id "-accordion-panel-content") role="accordion-panel-content"}}
          id={{concat @id "-section"}}
          role="region"
          aria-labelledby={{concat @id "-trigger"}}
          local-class="Accordion-panel"
        >
          <div>
            {{!-- Variable content within section, may include any type of markup or interactive widgets. --}}
            <fieldset>
              {{#each @fields as |field|}}
                <p>
                  <label for={{concat @id "-" field}}>
                    {{field}}
                    :
                  </label>
                  <input type="text"
                          value=""
                          name={{field}}
                          id={{concat @id "-" field}}
                          local-class="required"
                          aria-required="true">
                </p>
              {{/each}}
            </fieldset>
          </div>
        </div>
      {{/if}}
    </div>
  </AnimationContext>
  */
  {
    "id": "T22B04M3",
    "block": "{\"symbols\":[\"field\",\"@id\",\"@fields\",\"@expanded\",\"@trigger\",\"@title\"],\"statements\":[[8,\"animation-context\",[[16,0,[31,[[30,[36,1],[\"accordion-panel-animation-context\"],[[\"from\"],[\"animations/components/accordion/panel/index.css\"]]]]]]],[[\"@use\"],[[32,0,[\"resizePanels\"]]]],[[\"default\"],[{\"statements\":[[2,\"\\n  \"],[11,\"div\"],[16,0,[31,[[30,[36,1],[\"accordion-panel-container\"],[[\"from\"],[\"animations/components/accordion/panel/index.css\"]]]]]],[4,[38,2],null,[[\"id\",\"role\"],[[30,[36,0],[[32,2],\"-accordion-panel-container\"],null],\"accordion-panel-container\"]]],[12],[2,\"\\n    \"],[10,\"h3\"],[15,0,[31,[[30,[36,1],[\"accordion-panel-header\"],[[\"from\"],[\"animations/components/accordion/panel/index.css\"]]]]]],[12],[2,\"\\n      \"],[11,\"button\"],[16,0,[31,[[30,[36,1],[\"Accordion-trigger\"],[[\"from\"],[\"animations/components/accordion/panel/index.css\"]]]]]],[16,\"aria-expanded\",[30,[36,5],[[32,4],\"true\",\"false\"],null]],[16,\"aria-disabled\",[30,[36,5],[[32,4],\"true\",\"false\"],null]],[16,\"aria-controls\",[30,[36,0],[[32,2],\"-section\"],null]],[16,1,[30,[36,0],[[32,2],\"-trigger\"],null]],[24,\"data-is-accordion-trigger\",\"true\"],[24,4,\"button\"],[4,[38,7],[\"click\",[30,[36,6],[[32,5],[32,2]],null]],null],[12],[2,\"\\n        \"],[10,\"span\"],[15,0,[31,[[30,[36,1],[\"Accordion-title\"],[[\"from\"],[\"animations/components/accordion/panel/index.css\"]]]]]],[12],[2,\"\\n          \"],[1,[32,6]],[2,\"\\n          \"],[10,\"span\"],[15,0,[31,[[30,[36,1],[\"Accordion-icon\"],[[\"from\"],[\"animations/components/accordion/panel/index.css\"]]]]]],[12],[13],[2,\"\\n        \"],[13],[2,\"\\n      \"],[13],[2,\"\\n    \"],[13],[2,\"\\n\"],[6,[37,5],[[32,4]],null,[[\"default\"],[{\"statements\":[[2,\"      \"],[11,\"div\"],[16,0,[31,[[30,[36,1],[\"Accordion-panel\"],[[\"from\"],[\"animations/components/accordion/panel/index.css\"]]]]]],[16,1,[30,[36,0],[[32,2],\"-section\"],null]],[24,\"role\",\"region\"],[16,\"aria-labelledby\",[30,[36,0],[[32,2],\"-trigger\"],null]],[4,[38,2],null,[[\"id\",\"role\"],[[30,[36,0],[[32,2],\"-accordion-panel-content\"],null],\"accordion-panel-content\"]]],[12],[2,\"\\n        \"],[10,\"div\"],[12],[2,\"\\n\"],[2,\"          \"],[10,\"fieldset\"],[12],[2,\"\\n\"],[6,[37,4],[[30,[36,3],[[30,[36,3],[[32,3]],null]],null]],null,[[\"default\"],[{\"statements\":[[2,\"              \"],[10,\"p\"],[12],[2,\"\\n                \"],[10,\"label\"],[15,\"for\",[30,[36,0],[[32,2],\"-\",[32,1]],null]],[12],[2,\"\\n                  \"],[1,[32,1]],[2,\"\\n                  :\\n                \"],[13],[2,\"\\n                \"],[10,\"input\"],[15,0,[31,[[30,[36,1],[\"required\"],[[\"from\"],[\"animations/components/accordion/panel/index.css\"]]]]]],[14,2,\"\"],[15,3,[32,1]],[15,1,[30,[36,0],[[32,2],\"-\",[32,1]],null]],[14,\"aria-required\",\"true\"],[14,4,\"text\"],[12],[13],[2,\"\\n              \"],[13],[2,\"\\n\"]],\"parameters\":[1]}]]],[2,\"          \"],[13],[2,\"\\n        \"],[13],[2,\"\\n      \"],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"  \"],[13],[2,\"\\n\"]],\"parameters\":[]}]]]],\"hasEval\":false,\"upvars\":[\"concat\",\"local-class\",\"sprite\",\"-track-array\",\"each\",\"if\",\"fn\",\"on\"]}",
    "moduleName": "animations/components/accordion/panel/index.hbs"
  });

  let AccordionPanel = (_dec = Ember._action, (_class = class AccordionPanel extends _component.default {
    async resizePanels(changeset) {
      let behavior = new _spring.default({
        overshootClamping: true
      });
      let duration = behavior instanceof _spring.default ? undefined : 320;
      let {
        context
      } = changeset;
      let containers = changeset.spritesFor({
        type: _sprite.SpriteType.Kept,
        role: 'accordion-panel-container'
      });
      let hiddenPanel;
      let hiddenPanelContentGroup = changeset.spritesFor({
        type: _sprite.SpriteType.Removed,
        role: 'accordion-panel-content'
      });

      if (hiddenPanelContentGroup.size) {
        hiddenPanel = [...hiddenPanelContentGroup][0];
      }

      let spritesToAnimate = [];

      if (hiddenPanel) {
        // TODO: might be nice to detect this automatically in the appendOrphan function
        if (!context.hasOrphan(hiddenPanel)) {
          context.appendOrphan(hiddenPanel); // TODO: something is weird here when interrupting an interruped animation

          hiddenPanel.lockStyles();
        }
      }

      if (containers.size) {
        for (let sprite of [...containers]) {
          sprite.setupAnimation('size', {
            startHeight: sprite.initialBounds?.element.height,
            endHeight: sprite.finalBounds?.element.height,
            duration,
            behavior
          });
          spritesToAnimate.push(sprite);
        }
      }

      await (0, _runAnimations.default)(spritesToAnimate);
    }

  }, (_applyDecoratedDescriptor(_class.prototype, "resizePanels", [_dec], Object.getOwnPropertyDescriptor(_class.prototype, "resizePanels"), _class.prototype)), _class));
  _exports.default = AccordionPanel;

  Ember._setComponentTemplate(__COLOCATED_TEMPLATE__, AccordionPanel);
});
;define("animations/components/animated-beacon", ["exports", "ember-animated/components/animated-beacon"], function (_exports, _animatedBeacon) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _animatedBeacon.default;
    }
  });
});
;define("animations/components/animated-code-diff/index", ["exports", "@glimmer/component", "animations/utils/compile-markdown"], function (_exports, _component, _compileMarkdown) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _dec, _class;

  function _applyDecoratedDescriptor(target, property, decorators, descriptor, context) { var desc = {}; Object.keys(descriptor).forEach(function (key) { desc[key] = descriptor[key]; }); desc.enumerable = !!desc.enumerable; desc.configurable = !!desc.configurable; if ('value' in desc || desc.initializer) { desc.writable = true; } desc = decorators.slice().reverse().reduce(function (desc, decorator) { return decorator(target, property, desc) || desc; }, desc); if (context && desc.initializer !== void 0) { desc.value = desc.initializer ? desc.initializer.call(context) : void 0; desc.initializer = undefined; } if (desc.initializer === void 0) { Object.defineProperty(target, property, desc); desc = null; } return desc; }

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  const __COLOCATED_TEMPLATE__ = Ember.HTMLBars.template(
  /*
    <div class='rounded-lg overflow-hidden'>
    <div class="bg-black text-white py-2 px-4 text-sm font-medium border-b border-grey-darkest">
      {{@label}}
    </div>
    <div class='flex docs-bg-code-base text-grey overflow-x-scroll'>
      <div class="p-4 w-full">
        <AnimationContext @use={{this.codeTransition}} @duration={{400}}>
          <pre>
            {{#each
              (if @isShowingFinal this.finalLines this.originalLines)
              key='id'
            as |line|~}}
              <div {{sprite}}>{{line.text}}</div>
            {{~/each~}}
          </pre>
        </AnimationContext>
      </div>
    </div>
  </div>
  
  */
  {
    "id": "N56GfDQU",
    "block": "{\"symbols\":[\"line\",\"@label\",\"@isShowingFinal\"],\"statements\":[[10,\"div\"],[14,0,\"rounded-lg overflow-hidden\"],[12],[2,\"\\n  \"],[10,\"div\"],[14,0,\"bg-black text-white py-2 px-4 text-sm font-medium border-b border-grey-darkest\"],[12],[2,\"\\n    \"],[1,[32,2]],[2,\"\\n  \"],[13],[2,\"\\n  \"],[10,\"div\"],[14,0,\"flex docs-bg-code-base text-grey overflow-x-scroll\"],[12],[2,\"\\n    \"],[10,\"div\"],[14,0,\"p-4 w-full\"],[12],[2,\"\\n      \"],[8,\"animation-context\",[],[[\"@use\",\"@duration\"],[[32,0,[\"codeTransition\"]],400]],[[\"default\"],[{\"statements\":[[2,\"\\n        \"],[10,\"pre\"],[12],[2,\"\"],[6,[37,3],[[30,[36,2],[[30,[36,2],[[30,[36,1],[[32,3],[32,0,[\"finalLines\"]],[32,0,[\"originalLines\"]]],null]],null]],null]],[[\"key\"],[\"id\"]],[[\"default\"],[{\"statements\":[[11,\"div\"],[4,[38,0],null,null],[12],[1,[32,1,[\"text\"]]],[13]],\"parameters\":[1]}]]],[13],[2,\"\\n      \"]],\"parameters\":[]}]]],[2,\"\\n    \"],[13],[2,\"\\n  \"],[13],[2,\"\\n\"],[13],[2,\"\\n\"]],\"hasEval\":false,\"upvars\":[\"sprite\",\"if\",\"-track-array\",\"each\"]}",
    "moduleName": "animations/components/animated-code-diff/index.hbs"
  });

  class LineObject {
    constructor(index, text) {
      _defineProperty(this, "id", void 0);

      _defineProperty(this, "index", void 0);

      _defineProperty(this, "text", void 0);

      _defineProperty(this, "highlighted", false);

      this.index = index;
      this.text = text;
    }

  }

  let AnimatedCodeDiff = (_dec = Ember._action, (_class = class AnimatedCodeDiff extends _component.default {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onAnimationChange() {}

    get originalLines() {
      let lineObjects = getLineObjectsFromDiff(this.args.diff, 'before');
      let language = this.args.label.substr(this.args.label.lastIndexOf('.') + 1);
      return highlightLineObjects(lineObjects, language);
    }

    get finalLines() {
      let lineObjects = getLineObjectsFromDiff(this.args.diff, 'after');
      let language = this.args.label.substr(this.args.label.lastIndexOf('.') + 1);
      return highlightLineObjects(lineObjects, language);
    }

    get activeLines() {
      return this.args.isShowingFinal ? this.finalLines : this.originalLines;
    } // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    // eslint-disable-next-line no-empty-pattern


    async codeTransition({}) {// this.incrementProperty('transitionsRunning');
      // this.set('isAnimatingInsertedLines', false);
      // if (this.isShowingFinal) {
      //   removedSprites.forEach(fadeOut);
      //   // Need to set inserted sprites to 0 opacity in case their animation is interrupted
      //   insertedSprites.forEach((sprite) => {
      //     sprite.applyStyles({
      //       opacity: '0',
      //     });
      //   });
      //   keptSprites.map((sprite) => {
      //     fadeIn(sprite);
      //     move(sprite);
      //   });
      //   await wait(duration);
      //   while (this.animationPaused) {
      //     await wait(100);
      //   }
      //   // this.set('isAnimatingInsertedLines', true);
      //   this.onAnimationChange(true);
      //   for (let sprite of insertedSprites) {
      //     sprite.moveToFinalPosition();
      //     sprite.applyStyles({
      //       overflow: 'hidden',
      //       opacity: '1',
      //       display: 'inline-block',
      //       width: 'auto',
      //     });
      //     let totalWidth = sprite.element.getBoundingClientRect().width;
      //     let chars = sprite.element.textContent;
      //     let characterWidth = totalWidth / chars.length;
      //     sprite.reveal();
      //     for (let i = 0; i < chars.length; i++) {
      //       sprite.applyStyles({
      //         width: `${characterWidth * (i + 1)}`,
      //       });
      //       if (chars[i] !== ' ') {
      //         await wait(15);
      //       }
      //     }
      //   }
      //   // this.set('isAnimatingInsertedLines', false);
      //   this.onAnimationChange(false);
      // } else {
      //   removedSprites.forEach(fadeOut);
      //   keptSprites.map((sprite) => {
      //     fadeIn(sprite);
      //     move(sprite);
      //   });
      //   insertedSprites.forEach(fadeIn);
      // }
      // this.decrementProperty('transitionsRunning');
    }

  }, (_applyDecoratedDescriptor(_class.prototype, "codeTransition", [_dec], Object.getOwnPropertyDescriptor(_class.prototype, "codeTransition"), _class.prototype)), _class));
  _exports.default = AnimatedCodeDiff;

  function highlightLineObjects(lineObjects, language) {
    let code = lineObjects.map(lineObject => lineObject.text).join('\n');
    let highlightedCode = (0, _compileMarkdown.highlightCode)(code, language);
    return highlightedCode.split('\n').map((text, index) => ({
      id: lineObjects[index].id,
      highlighted: lineObjects[index].highlighted,
      // htmlSafe is justified here because we generated the highlighting markup
      // ourself in highlightCode
      text: Ember.String.htmlSafe(text === '' ? '\n' : text)
    }));
  }

  function getLineObjectsFromDiff(diff, beforeOrAfter) {
    let diffLines = diff.split('\n');
    let lineObjects = diffLines.map((diff, index) => {
      return new LineObject(index, diff);
    });
    let {
      keptLines,
      addedLines,
      removedLines
    } = groupedLines(lineObjects);
    let lines;

    if (beforeOrAfter === 'before') {
      lines = keptLines.concat(removedLines).sort((a, b) => a.index - b.index);
    } else if (beforeOrAfter === 'after') {
      lines = keptLines.concat(addedLines).sort((a, b) => a.index - b.index);
    }

    return lines || [];
  }

  class LineChangeset {
    constructor() {
      _defineProperty(this, "keptLines", []);

      _defineProperty(this, "removedLines", []);

      _defineProperty(this, "addedLines", []);
    }

  }

  function groupedLines(lineObjects) {
    let isAddedLine = lineObject => lineObject.text.indexOf('+') === 0;

    let isRemovedLine = lineObject => lineObject.text.indexOf('-') === 0;

    let isModifiedLine = lineObject => isAddedLine(lineObject) || isRemovedLine(lineObject);

    let hasAddedOrRemovedLines = lineObjects.filter(isModifiedLine).length > 0;
    return lineObjects.map((lineObject, index) => {
      if (isAddedLine(lineObject)) {
        lineObject.id = `added-${index}`;
        lineObject.text = lineObject.text.replace('+', ' ');
        lineObject.highlighted = true;
      } else if (isRemovedLine(lineObject)) {
        lineObject.id = `removed-${index}`;
        lineObject.text = lineObject.text.replace('-', ' '); // .replace(/^\s\s/, ""); // remove the 2-space indent
      } else {
        lineObject.id = `kept-${index}`;
      }

      return lineObject;
    }).map(lineObject => {
      /*
      If we have either addded or removed lines, all text has a 2-space indent
      right now, so we remove it.
       If we don't, we don't need to dedent anything, because all space was
      dedented by the `dedent` function when the diff was originally passed in.
      */
      if (hasAddedOrRemovedLines) {
        lineObject.text = lineObject.text.replace(/^\s\s/, '');
      }

      return lineObject;
    }).reduce((groupedLines, lineObject) => {
      let type = lineObject.id ? lineObject.id.split('-')[0] : 'unknown';

      switch (type) {
        case 'kept':
          groupedLines.keptLines.push(lineObject);
          break;

        case 'removed':
          groupedLines.removedLines.push(lineObject);
          break;

        case 'added':
          groupedLines.addedLines.push(lineObject);
          break;
      }

      return groupedLines;
    }, new LineChangeset());
  }

  Ember._setComponentTemplate(__COLOCATED_TEMPLATE__, AnimatedCodeDiff);
});
;define("animations/components/animated-container", ["exports", "ember-animated/components/animated-container"], function (_exports, _animatedContainer) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _animatedContainer.default;
    }
  });
});
;define("animations/components/animated-each", ["exports", "ember-animated/components/animated-each"], function (_exports, _animatedEach) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _animatedEach.default;
    }
  });
});
;define("animations/components/animated-if", ["exports", "ember-animated/components/animated-if"], function (_exports, _animatedIf) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _animatedIf.default;
    }
  });
});
;define("animations/components/animated-orphans", ["exports", "ember-animated/components/animated-orphans"], function (_exports, _animatedOrphans) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _animatedOrphans.default;
    }
  });
});
;define("animations/components/animated-value", ["exports", "ember-animated/components/animated-value"], function (_exports, _animatedValue) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _animatedValue.default;
    }
  });
});
;define("animations/components/animation-context/index", ["exports", "@glimmer/component", "macro-decorators", "animations/models/sprite", "animations/utils/measurement"], function (_exports, _component, _macroDecorators, _sprite, _measurement) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _dec, _dec2, _dec3, _dec4, _dec5, _class, _descriptor, _descriptor2, _descriptor3, _temp;

  function _initializerDefineProperty(target, property, descriptor, context) { if (!descriptor) return; Object.defineProperty(target, property, { enumerable: descriptor.enumerable, configurable: descriptor.configurable, writable: descriptor.writable, value: descriptor.initializer ? descriptor.initializer.call(context) : void 0 }); }

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  function _applyDecoratedDescriptor(target, property, decorators, descriptor, context) { var desc = {}; Object.keys(descriptor).forEach(function (key) { desc[key] = descriptor[key]; }); desc.enumerable = !!desc.enumerable; desc.configurable = !!desc.configurable; if ('value' in desc || desc.initializer) { desc.writable = true; } desc = decorators.slice().reverse().reduce(function (desc, decorator) { return decorator(target, property, desc) || desc; }, desc); if (context && desc.initializer !== void 0) { desc.value = desc.initializer ? desc.initializer.call(context) : void 0; desc.initializer = undefined; } if (desc.initializer === void 0) { Object.defineProperty(target, property, desc); desc = null; } return desc; }

  function _initializerWarningHelper(descriptor, context) { throw new Error('Decorating class property failed. Please ensure that ' + 'proposal-class-properties is enabled and runs after the decorators transform.'); }

  const __COLOCATED_TEMPLATE__ = Ember.HTMLBars.template(
  /*
    {{this.renderDetector}}
  <div class="animation-context" {{did-insert this.didInsertEl}} ...attributes>
    <div {{did-insert this.didInsertOrphansEl}}></div> {{!-- JS appends and removes here --}}
    {{yield this}}
  </div>
  
  */
  {
    "id": "fYBffuXe",
    "block": "{\"symbols\":[\"&attrs\",\"&default\"],\"statements\":[[1,[32,0,[\"renderDetector\"]]],[2,\"\\n\"],[11,\"div\"],[24,0,\"animation-context\"],[17,1],[4,[38,0],[[32,0,[\"didInsertEl\"]]],null],[12],[2,\"\\n  \"],[11,\"div\"],[4,[38,0],[[32,0,[\"didInsertOrphansEl\"]]],null],[12],[13],[2,\" \"],[2,\"\\n  \"],[18,2,[[32,0]]],[2,\"\\n\"],[13],[2,\"\\n\"]],\"hasEval\":false,\"upvars\":[\"did-insert\"]}",
    "moduleName": "animations/components/animation-context/index.hbs"
  });

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const {
    VOLATILE_TAG,
    consumeTag
  } = Ember.__loader.require('@glimmer/validator');

  let AnimationContextComponent = (_dec = Ember.inject.service, _dec2 = (0, _macroDecorators.reads)('args.id'), _dec3 = (0, _macroDecorators.reads)('args.initialInsertion', false), _dec4 = Ember._action, _dec5 = Ember._action, (_class = (_temp = class AnimationContextComponent extends _component.default {
    constructor(...args) {
      super(...args);

      _initializerDefineProperty(this, "animations", _descriptor, this);

      _initializerDefineProperty(this, "id", _descriptor2, this);

      _defineProperty(this, "element", void 0);

      _defineProperty(this, "orphansElement", null);

      _defineProperty(this, "lastBounds", void 0);

      _defineProperty(this, "currentBounds", void 0);

      _defineProperty(this, "isInitialRenderCompleted", false);

      _initializerDefineProperty(this, "initialInsertion", _descriptor3, this);
    }

    willDestroy() {
      super.willDestroy();
      this.animations.unregisterContext(this);
    }

    get renderDetector() {
      consumeTag(VOLATILE_TAG);
      this.animations.notifyContextRendering(this);
      return undefined;
    }

    didInsertEl(element) {
      this.element = element;
      this.animations.registerContext(this);
      this.captureSnapshot();
    }

    didInsertOrphansEl(element) {
      this.orphansElement = element;
    }

    captureSnapshot() {
      let {
        element
      } = this;
      (true && !(element instanceof HTMLElement) && Ember.assert('animation context must be an HTML element', element instanceof HTMLElement));
      this.lastBounds = this.currentBounds;
      this.currentBounds = (0, _measurement.getDocumentPosition)(element);
    }

    shouldAnimate(changeset) {
      return !!(changeset && this.args.use && (this.isInitialRenderCompleted || this.initialInsertion));
    }

    hasOrphan(spriteOrElement) {
      let {
        orphansElement
      } = this;

      if (spriteOrElement instanceof _sprite.default) {
        return spriteOrElement.element.parentElement === orphansElement;
      } else {
        return spriteOrElement.parentElement === orphansElement;
      }
    }

    appendOrphan(spriteOrElement) {
      let {
        orphansElement
      } = this;

      if (spriteOrElement instanceof _sprite.default) {
        orphansElement?.appendChild(spriteOrElement.element);
      } else {
        orphansElement?.appendChild(spriteOrElement);
      }
    }

    removeOrphan(spriteOrElement) {
      let {
        orphansElement
      } = this;

      if (spriteOrElement instanceof _sprite.default) {
        orphansElement?.removeChild(spriteOrElement.element);
      } else {
        orphansElement?.removeChild(spriteOrElement);
      }
    }

    clearOrphans() {
      let {
        orphansElement
      } = this;

      while (orphansElement?.firstChild) {
        orphansElement.removeChild(orphansElement.firstChild);
      }
    }

  }, _temp), (_descriptor = _applyDecoratedDescriptor(_class.prototype, "animations", [_dec], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: null
  }), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "id", [_dec2], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: null
  }), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "initialInsertion", [_dec3], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: null
  }), _applyDecoratedDescriptor(_class.prototype, "didInsertEl", [_dec4], Object.getOwnPropertyDescriptor(_class.prototype, "didInsertEl"), _class.prototype), _applyDecoratedDescriptor(_class.prototype, "didInsertOrphansEl", [_dec5], Object.getOwnPropertyDescriptor(_class.prototype, "didInsertOrphansEl"), _class.prototype)), _class));
  _exports.default = AnimationContextComponent;

  Ember._setComponentTemplate(__COLOCATED_TEMPLATE__, AnimationContextComponent);
});
;define("animations/components/basic-dropdown-content", ["exports", "ember-basic-dropdown/components/basic-dropdown-content"], function (_exports, _basicDropdownContent) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _basicDropdownContent.default;
    }
  });
});
;define("animations/components/basic-dropdown-trigger", ["exports", "ember-basic-dropdown/components/basic-dropdown-trigger"], function (_exports, _basicDropdownTrigger) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _basicDropdownTrigger.default;
    }
  });
});
;define("animations/components/basic-dropdown", ["exports", "ember-basic-dropdown/components/basic-dropdown"], function (_exports, _basicDropdown) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _basicDropdown.default;
    }
  });
});
;define("animations/components/boxel/action-chin/index", ["exports", "@cardstack/boxel/components/boxel/action-chin"], function (_exports, _actionChin) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _actionChin.default;
    }
  });
});
;define("animations/components/boxel/action-container/index", ["exports", "@cardstack/boxel/components/boxel/action-container"], function (_exports, _actionContainer) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _actionContainer.default;
    }
  });
});
;define("animations/components/boxel/add-participant-button/index", ["exports", "@cardstack/boxel/components/boxel/add-participant-button"], function (_exports, _addParticipantButton) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _addParticipantButton.default;
    }
  });
});
;define("animations/components/boxel/apply-changes-toggle/index", ["exports", "@cardstack/boxel/components/boxel/apply-changes-toggle"], function (_exports, _applyChangesToggle) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _applyChangesToggle.default;
    }
  });
});
;define("animations/components/boxel/breadcrumbs/index", ["exports", "@cardstack/boxel/components/boxel/breadcrumbs"], function (_exports, _breadcrumbs) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _breadcrumbs.default;
    }
  });
});
;define("animations/components/boxel/button/index", ["exports", "@cardstack/boxel/components/boxel/button"], function (_exports, _button) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _button.default;
    }
  });
});
;define("animations/components/boxel/card-catalog-tray-item/index", ["exports", "@cardstack/boxel/components/boxel/card-catalog-tray-item"], function (_exports, _cardCatalogTrayItem) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _cardCatalogTrayItem.default;
    }
  });
});
;define("animations/components/boxel/cover-art/index", ["exports", "@cardstack/boxel/components/boxel/cover-art"], function (_exports, _coverArt) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _coverArt.default;
    }
  });
});
;define("animations/components/boxel/dashboard/index", ["exports", "@cardstack/boxel/components/boxel/dashboard"], function (_exports, _dashboard) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _dashboard.default;
    }
  });
});
;define("animations/components/boxel/date-divider/index", ["exports", "@cardstack/boxel/components/boxel/date-divider"], function (_exports, _dateDivider) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _dateDivider.default;
    }
  });
});
;define("animations/components/boxel/drop-target/index", ["exports", "@cardstack/boxel/components/boxel/drop-target"], function (_exports, _dropTarget) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _dropTarget.default;
    }
  });
});
;define("animations/components/boxel/dropdown-button/index", ["exports", "@cardstack/boxel/components/boxel/dropdown-button"], function (_exports, _dropdownButton) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _dropdownButton.default;
    }
  });
});
;define("animations/components/boxel/field/edit/index", ["exports", "@cardstack/boxel/components/boxel/field/edit"], function (_exports, _edit) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _edit.default;
    }
  });
});
;define("animations/components/boxel/field/index", ["exports", "@cardstack/boxel/components/boxel/field"], function (_exports, _field) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _field.default;
    }
  });
});
;define("animations/components/boxel/field/view/index", ["exports", "@cardstack/boxel/components/boxel/field/view"], function (_exports, _view) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _view.default;
    }
  });
});
;define("animations/components/boxel/header/index", ["exports", "@cardstack/boxel/components/boxel/header"], function (_exports, _header) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _header.default;
    }
  });
});
;define("animations/components/boxel/help-box/index", ["exports", "@cardstack/boxel/components/boxel/help-box"], function (_exports, _helpBox) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _helpBox.default;
    }
  });
});
;define("animations/components/boxel/icon-button/index", ["exports", "@cardstack/boxel/components/boxel/icon-button"], function (_exports, _iconButton) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _iconButton.default;
    }
  });
});
;define("animations/components/boxel/infobox/index", ["exports", "@cardstack/boxel/components/boxel/infobox"], function (_exports, _infobox) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _infobox.default;
    }
  });
});
;define("animations/components/boxel/input/index", ["exports", "@cardstack/boxel/components/boxel/input"], function (_exports, _input) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _input.default;
    }
  });
});
;define("animations/components/boxel/layout-container/index", ["exports", "@cardstack/boxel/components/boxel/layout-container"], function (_exports, _layoutContainer) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _layoutContainer.default;
    }
  });
});
;define("animations/components/boxel/menu/index", ["exports", "@cardstack/boxel/components/boxel/menu"], function (_exports, _menu) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _menu.default;
    }
  });
});
;define("animations/components/boxel/milestone-banner/index", ["exports", "@cardstack/boxel/components/boxel/milestone-banner"], function (_exports, _milestoneBanner) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _milestoneBanner.default;
    }
  });
});
;define("animations/components/boxel/milestones/index", ["exports", "@cardstack/boxel/components/boxel/milestones"], function (_exports, _milestones) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _milestones.default;
    }
  });
});
;define("animations/components/boxel/modal/index", ["exports", "@cardstack/boxel/components/boxel/modal"], function (_exports, _modal) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _modal.default;
    }
  });
});
;define("animations/components/boxel/mode-indicator/index", ["exports", "@cardstack/boxel/components/boxel/mode-indicator"], function (_exports, _modeIndicator) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _modeIndicator.default;
    }
  });
});
;define("animations/components/boxel/org-header/index", ["exports", "@cardstack/boxel/components/boxel/org-header"], function (_exports, _orgHeader) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _orgHeader.default;
    }
  });
});
;define("animations/components/boxel/participant-list/index", ["exports", "@cardstack/boxel/components/boxel/participant-list"], function (_exports, _participantList) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _participantList.default;
    }
  });
});
;define("animations/components/boxel/participant/index", ["exports", "@cardstack/boxel/components/boxel/participant"], function (_exports, _participant) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _participant.default;
    }
  });
});
;define("animations/components/boxel/participants-summary/index", ["exports", "@cardstack/boxel/components/boxel/participants-summary"], function (_exports, _participantsSummary) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _participantsSummary.default;
    }
  });
});
;define("animations/components/boxel/progress-circle/index", ["exports", "@cardstack/boxel/components/boxel/progress-circle"], function (_exports, _progressCircle) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _progressCircle.default;
    }
  });
});
;define("animations/components/boxel/progress-icon/index", ["exports", "@cardstack/boxel/components/boxel/progress-icon"], function (_exports, _progressIcon) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _progressIcon.default;
    }
  });
});
;define("animations/components/boxel/searchbox/index", ["exports", "@cardstack/boxel/components/boxel/searchbox"], function (_exports, _searchbox) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _searchbox.default;
    }
  });
});
;define("animations/components/boxel/select-button/index", ["exports", "@cardstack/boxel/components/boxel/select-button"], function (_exports, _selectButton) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _selectButton.default;
    }
  });
});
;define("animations/components/boxel/selection-control-group/index", ["exports", "@cardstack/boxel/components/boxel/selection-control-group"], function (_exports, _selectionControlGroup) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _selectionControlGroup.default;
    }
  });
});
;define("animations/components/boxel/sidebar/card-container/index", ["exports", "@cardstack/boxel/components/boxel/sidebar/card-container"], function (_exports, _cardContainer) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _cardContainer.default;
    }
  });
});
;define("animations/components/boxel/sidebar/index", ["exports", "@cardstack/boxel/components/boxel/sidebar"], function (_exports, _sidebar) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _sidebar.default;
    }
  });
});
;define("animations/components/boxel/sidebar/section/index", ["exports", "@cardstack/boxel/components/boxel/sidebar/section"], function (_exports, _section) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _section.default;
    }
  });
});
;define("animations/components/boxel/sort-menu/index", ["exports", "@cardstack/boxel/components/boxel/sort-menu"], function (_exports, _sortMenu) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _sortMenu.default;
    }
  });
});
;define("animations/components/boxel/sort-menu/item/index", ["exports", "@cardstack/boxel/components/boxel/sort-menu/item"], function (_exports, _item) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _item.default;
    }
  });
});
;define("animations/components/boxel/text-field/index", ["exports", "@cardstack/boxel/components/boxel/text-field"], function (_exports, _textField) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _textField.default;
    }
  });
});
;define("animations/components/boxel/thread-header/index", ["exports", "@cardstack/boxel/components/boxel/thread-header"], function (_exports, _threadHeader) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _threadHeader.default;
    }
  });
});
;define("animations/components/boxel/thread-message/index", ["exports", "@cardstack/boxel/components/boxel/thread-message"], function (_exports, _threadMessage) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _threadMessage.default;
    }
  });
});
;define("animations/components/boxel/thread-modal/index", ["exports", "@cardstack/boxel/components/boxel/thread-modal"], function (_exports, _threadModal) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _threadModal.default;
    }
  });
});
;define("animations/components/boxel/thread/index", ["exports", "@cardstack/boxel/components/boxel/thread"], function (_exports, _thread) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _thread.default;
    }
  });
});
;define("animations/components/boxel/wave-player/index", ["exports", "@cardstack/boxel/components/boxel/wave-player"], function (_exports, _wavePlayer) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _wavePlayer.default;
    }
  });
});
;define("animations/components/card/index", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  const __COLOCATED_TEMPLATE__ = Ember.HTMLBars.template(
  /*
    <div class="boxel-card__container boxel-card__container--{{or @format "list"}} boxel-card--{{@model.type}} boxel-card--{{@model.id}}" ...attributes>
    {{#if @expandAction}}
      <button class="boxel-highlight boxel-card__expand-overlay" type="button" {{on "click" @expandAction}} />
    {{/if}}
    {{#if @model.type}}
      <Boxel::Header>
        {{humanize @model.type}}
      </Boxel::Header>
    {{/if}}
  
    {{!-- Template and the styling of the area below (the card itself) is up to the card author. --}}
    {{!-- The template below and its styling is an embedded card template for media-registry cards. --}}
      <article class="boxel-card boxel-card--default boxel-card--{{if @model @model.type "blank-card"}} {{@class}}">
        <div class="boxel-card__inner boxel-card__inner--{{or @format "list"}} {{if (or @model.imgURL @hasImage) "boxel-card__inner--with-img"}} {{if (and @status (not-eq @status "no-change")) "" "field-renderer__opacity-control"}}">
          {{#if @model.imgURL}}
            <div class="boxel-card__bg-img boxel-card__bg-img--{{@model.id}}" style={{css-url "background-image" @model.imgURL}} />
          {{/if}}
          {{#if @model.title}}
            <h3 class="boxel-card__title">{{@model.title}}</h3>
          {{/if}}
          {{#if @model.description}}
            <p class="boxel-card__description">
              {{#if @model.createdDate}}
                Created {{moment-format @model.createdDate "MMM DD, YYYY" "YYYY-MM-DD"}}<br><br>
              {{/if}}
  
              {{@model.description}}
            </p>
          {{/if}}
  
          {{#if (has-block)}}
            <div class="boxel-card__more" {{sprite role="card-more" id=@model.id}}>
              more
              {{yield}}
              /more
            </div>
          {{/if}}
  
          {{#if (and @model.fields (is-array @model.fields))}}
            <ul class="boxel-card__fields">
              {{#each @model.fields as |field|}}
                <li>
                  <Boxel::FieldRenderer
                    @class="boxel-card-field"
                    @mode={{@mode}}
                    @field={{field}}
                  />
                </li>
              {{/each}}
            </ul>
          {{/if}}
        </div>
      </article>
    {{!-- End of card author jurisdiction --}}
  
  </div>
  */
  {
    "id": "XQMvt1gB",
    "block": "{\"symbols\":[\"field\",\"@mode\",\"@model\",\"&default\",\"@expandAction\",\"@format\",\"&attrs\",\"@class\",\"@status\",\"@hasImage\"],\"statements\":[[11,\"div\"],[16,0,[31,[\"boxel-card__container boxel-card__container--\",[30,[36,8],[[32,6],\"list\"],null],\" boxel-card--\",[32,3,[\"type\"]],\" boxel-card--\",[32,3,[\"id\"]]]]],[17,7],[12],[2,\"\\n\"],[6,[37,4],[[32,5]],null,[[\"default\"],[{\"statements\":[[2,\"    \"],[11,\"button\"],[24,0,\"boxel-highlight boxel-card__expand-overlay\"],[24,4,\"button\"],[4,[38,7],[\"click\",[32,5]],null],[12],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[6,[37,4],[[32,3,[\"type\"]]],null,[[\"default\"],[{\"statements\":[[2,\"    \"],[8,\"boxel/header\",[],[[],[]],[[\"default\"],[{\"statements\":[[2,\"\\n      \"],[1,[30,[36,6],[[32,3,[\"type\"]]],null]],[2,\"\\n    \"]],\"parameters\":[]}]]],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"\\n\"],[2,\"    \"],[10,\"article\"],[15,0,[31,[\"boxel-card boxel-card--default boxel-card--\",[30,[36,4],[[32,3],[32,3,[\"type\"]],\"blank-card\"],null],\" \",[32,8]]]],[12],[2,\"\\n      \"],[10,\"div\"],[15,0,[31,[\"boxel-card__inner boxel-card__inner--\",[30,[36,8],[[32,6],\"list\"],null],\" \",[30,[36,4],[[30,[36,8],[[32,3,[\"imgURL\"]],[32,10]],null],\"boxel-card__inner--with-img\"],null],\" \",[30,[36,4],[[30,[36,10],[[32,9],[30,[36,9],[[32,9],\"no-change\"],null]],null],\"\",\"field-renderer__opacity-control\"],null]]]],[12],[2,\"\\n\"],[6,[37,4],[[32,3,[\"imgURL\"]]],null,[[\"default\"],[{\"statements\":[[2,\"          \"],[10,\"div\"],[15,0,[31,[\"boxel-card__bg-img boxel-card__bg-img--\",[32,3,[\"id\"]]]]],[15,5,[30,[36,5],[\"background-image\",[32,3,[\"imgURL\"]]],null]],[12],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[6,[37,4],[[32,3,[\"title\"]]],null,[[\"default\"],[{\"statements\":[[2,\"          \"],[10,\"h3\"],[14,0,\"boxel-card__title\"],[12],[1,[32,3,[\"title\"]]],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[6,[37,4],[[32,3,[\"description\"]]],null,[[\"default\"],[{\"statements\":[[2,\"          \"],[10,\"p\"],[14,0,\"boxel-card__description\"],[12],[2,\"\\n\"],[6,[37,4],[[32,3,[\"createdDate\"]]],null,[[\"default\"],[{\"statements\":[[2,\"              Created \"],[1,[30,[36,3],[[32,3,[\"createdDate\"]],\"MMM DD, YYYY\",\"YYYY-MM-DD\"],null]],[10,\"br\"],[12],[13],[10,\"br\"],[12],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"\\n            \"],[1,[32,3,[\"description\"]]],[2,\"\\n          \"],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"\\n\"],[6,[37,4],[[27,[32,4]]],null,[[\"default\"],[{\"statements\":[[2,\"          \"],[11,\"div\"],[24,0,\"boxel-card__more\"],[4,[38,2],null,[[\"role\",\"id\"],[\"card-more\",[32,3,[\"id\"]]]]],[12],[2,\"\\n            more\\n            \"],[18,4,null],[2,\"\\n            /more\\n          \"],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"\\n\"],[6,[37,4],[[30,[36,10],[[32,3,[\"fields\"]],[30,[36,11],[[32,3,[\"fields\"]]],null]],null]],null,[[\"default\"],[{\"statements\":[[2,\"          \"],[10,\"ul\"],[14,0,\"boxel-card__fields\"],[12],[2,\"\\n\"],[6,[37,1],[[30,[36,0],[[30,[36,0],[[32,3,[\"fields\"]]],null]],null]],null,[[\"default\"],[{\"statements\":[[2,\"              \"],[10,\"li\"],[12],[2,\"\\n                \"],[8,\"boxel/field-renderer\",[],[[\"@class\",\"@mode\",\"@field\"],[\"boxel-card-field\",[32,2],[32,1]]],null],[2,\"\\n              \"],[13],[2,\"\\n\"]],\"parameters\":[1]}]]],[2,\"          \"],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"      \"],[13],[2,\"\\n    \"],[13],[2,\"\\n\"],[2,\"\\n\"],[13]],\"hasEval\":false,\"upvars\":[\"-track-array\",\"each\",\"sprite\",\"moment-format\",\"if\",\"css-url\",\"humanize\",\"on\",\"or\",\"not-eq\",\"and\",\"is-array\"]}",
    "moduleName": "animations/components/card/index.hbs"
  });

  var _default = Ember._setComponentTemplate(__COLOCATED_TEMPLATE__, Ember._templateOnlyComponent());

  _exports.default = _default;
});
;define("animations/components/demo1/index", ["exports", "@glimmer/component", "animations/transitions/fade", "animations/utils/dedent"], function (_exports, _component, _fade, _dedent) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _dec, _dec2, _dec3, _dec4, _dec5, _class, _descriptor, _descriptor2, _descriptor3, _temp;

  function _initializerDefineProperty(target, property, descriptor, context) { if (!descriptor) return; Object.defineProperty(target, property, { enumerable: descriptor.enumerable, configurable: descriptor.configurable, writable: descriptor.writable, value: descriptor.initializer ? descriptor.initializer.call(context) : void 0 }); }

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  function _applyDecoratedDescriptor(target, property, decorators, descriptor, context) { var desc = {}; Object.keys(descriptor).forEach(function (key) { desc[key] = descriptor[key]; }); desc.enumerable = !!desc.enumerable; desc.configurable = !!desc.configurable; if ('value' in desc || desc.initializer) { desc.writable = true; } desc = decorators.slice().reverse().reduce(function (desc, decorator) { return decorator(target, property, desc) || desc; }, desc); if (context && desc.initializer !== void 0) { desc.value = desc.initializer ? desc.initializer.call(context) : void 0; desc.initializer = undefined; } if (desc.initializer === void 0) { Object.defineProperty(target, property, desc); desc = null; } return desc; }

  function _initializerWarningHelper(descriptor, context) { throw new Error('Decorating class property failed. Please ensure that ' + 'proposal-class-properties is enabled and runs after the decorators transform.'); }

  const __COLOCATED_TEMPLATE__ = Ember.HTMLBars.template(
  /*
    <div data-test-guests-demo class="lg:flex lg:-mx-4">
    <div class="lg:mx-4 lg:w-2/5 lg:flex-no-shrink">
      <div class="shadow-lg rounded-lg overflow-hidden mb-8">
        <div class="p-6">
          <div class="flex mb-3">
            <p class='text-lg'>How many guests?</p>
            <div class="ml-4 ">
              <div class="flex items-center">
                <button
                  disabled={{eq this.guests 1}}
                  class='rounded-full text-lg border font-semibold border-pink text-pink w-8 h-8 flex items-center justify-center select-none focus:outline-none focus:shadow-outline hover:bg-pink hover:text-white {{if (eq this.guests 1) ' opacity-50 pointer-events-none'}}'
                  type="button"
                  {{on 'click' this.removeGuest}}
                >
                  -
                </button>
                <span class='text-pink font-bold w-8 text-center text-lg'>
                  {{this.guests}}
                </span>
                <button
                  class='rounded-full text-lg border font-semibold border-pink text-pink w-8 h-8 flex items-center justify-center select-none focus:outline-none focus:shadow-outline hover:bg-pink hover:text-white {{if (eq this.guests 6) ' opacity-50 pointer-events-none'}}'
                  type="button"
                  disabled={{eq this.guests 6}}
                  {{on 'click' this.addGuest}}
                >
                  +
                </button>
              </div>
            </div>
          </div>
  
          <div class='text-3xl text-pink select-none'>
            {{#if this.animationEnabled}}
              <AnimationContext @use={{this.transition}}>
                {{#each (range 0 this.guests)}}
                  <span class='inline-block' {{sprite}}>{{svg-jar 'user' width=24 height=24}}</span>
                {{/each}}
              </AnimationContext>
            {{else}}
              {{#each (range 0 this.guests)}}
                <span class='inline-block'>{{svg-jar 'user' width=24 height=24}}</span>
              {{/each}}
            {{/if}}
          </div>
        </div>
  
        <ToggleBar
          @enabled={{this.animationEnabled}}
          @onToggle={{fn (mut this.animationEnabled)}}
        >
          ✨Animate
        </ToggleBar>
      </div>
    </div>
  
    <div class='lg:mx-4 lg:w-3/5 overflow-hidden'>
      <AnimatedCodeDiff
        @label='index.hbs'
        @diff={{this.templateDiff}}
        @isShowingFinal={{this.animationEnabled}}
        @onAnimationChange={{fn (mut this.isAnimating)}}
      />
  
      <div class="mt-4">
        <AnimatedCodeDiff
          @label='index.js'
          @diff={{this.componentDiff}}
          @isShowingFinal={{this.animationEnabled}}
          @animationPaused={{this.isAnimating}}
        />
      </div>
    </div>
  </div>
  
  */
  {
    "id": "4rJOBSPi",
    "block": "{\"symbols\":[],\"statements\":[[10,\"div\"],[14,\"data-test-guests-demo\",\"\"],[14,0,\"lg:flex lg:-mx-4\"],[12],[2,\"\\n  \"],[10,\"div\"],[14,0,\"lg:mx-4 lg:w-2/5 lg:flex-no-shrink\"],[12],[2,\"\\n    \"],[10,\"div\"],[14,0,\"shadow-lg rounded-lg overflow-hidden mb-8\"],[12],[2,\"\\n      \"],[10,\"div\"],[14,0,\"p-6\"],[12],[2,\"\\n        \"],[10,\"div\"],[14,0,\"flex mb-3\"],[12],[2,\"\\n          \"],[10,\"p\"],[14,0,\"text-lg\"],[12],[2,\"How many guests?\"],[13],[2,\"\\n          \"],[10,\"div\"],[14,0,\"ml-4 \"],[12],[2,\"\\n            \"],[10,\"div\"],[14,0,\"flex items-center\"],[12],[2,\"\\n              \"],[11,\"button\"],[16,\"disabled\",[30,[36,5],[[32,0,[\"guests\"]],1],null]],[16,0,[31,[\"rounded-full text-lg border font-semibold border-pink text-pink w-8 h-8 flex items-center justify-center select-none focus:outline-none focus:shadow-outline hover:bg-pink hover:text-white \",[30,[36,6],[[30,[36,5],[[32,0,[\"guests\"]],1],null],\" opacity-50 pointer-events-none\"],null]]]],[24,4,\"button\"],[4,[38,7],[\"click\",[32,0,[\"removeGuest\"]]],null],[12],[2,\"\\n                -\\n              \"],[13],[2,\"\\n              \"],[10,\"span\"],[14,0,\"text-pink font-bold w-8 text-center text-lg\"],[12],[2,\"\\n                \"],[1,[32,0,[\"guests\"]]],[2,\"\\n              \"],[13],[2,\"\\n              \"],[11,\"button\"],[16,0,[31,[\"rounded-full text-lg border font-semibold border-pink text-pink w-8 h-8 flex items-center justify-center select-none focus:outline-none focus:shadow-outline hover:bg-pink hover:text-white \",[30,[36,6],[[30,[36,5],[[32,0,[\"guests\"]],6],null],\" opacity-50 pointer-events-none\"],null]]]],[16,\"disabled\",[30,[36,5],[[32,0,[\"guests\"]],6],null]],[24,4,\"button\"],[4,[38,7],[\"click\",[32,0,[\"addGuest\"]]],null],[12],[2,\"\\n                +\\n              \"],[13],[2,\"\\n            \"],[13],[2,\"\\n          \"],[13],[2,\"\\n        \"],[13],[2,\"\\n\\n        \"],[10,\"div\"],[14,0,\"text-3xl text-pink select-none\"],[12],[2,\"\\n\"],[6,[37,6],[[32,0,[\"animationEnabled\"]]],null,[[\"default\",\"else\"],[{\"statements\":[[2,\"            \"],[8,\"animation-context\",[],[[\"@use\"],[[32,0,[\"transition\"]]]],[[\"default\"],[{\"statements\":[[2,\"\\n\"],[6,[37,3],[[30,[36,2],[[30,[36,2],[[30,[36,1],[0,[32,0,[\"guests\"]]],null]],null]],null]],null,[[\"default\"],[{\"statements\":[[2,\"                \"],[11,\"span\"],[24,0,\"inline-block\"],[4,[38,4],null,null],[12],[1,[30,[36,0],[\"user\"],[[\"width\",\"height\"],[24,24]]]],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"            \"]],\"parameters\":[]}]]],[2,\"\\n\"]],\"parameters\":[]},{\"statements\":[[6,[37,3],[[30,[36,2],[[30,[36,2],[[30,[36,1],[0,[32,0,[\"guests\"]]],null]],null]],null]],null,[[\"default\"],[{\"statements\":[[2,\"              \"],[10,\"span\"],[14,0,\"inline-block\"],[12],[1,[30,[36,0],[\"user\"],[[\"width\",\"height\"],[24,24]]]],[13],[2,\"\\n\"]],\"parameters\":[]}]]]],\"parameters\":[]}]]],[2,\"        \"],[13],[2,\"\\n      \"],[13],[2,\"\\n\\n      \"],[8,\"toggle-bar\",[],[[\"@enabled\",\"@onToggle\"],[[32,0,[\"animationEnabled\"]],[30,[36,9],[[30,[36,8],[[32,0,[\"animationEnabled\"]]],null]],null]]],[[\"default\"],[{\"statements\":[[2,\"\\n        ✨Animate\\n      \"]],\"parameters\":[]}]]],[2,\"\\n    \"],[13],[2,\"\\n  \"],[13],[2,\"\\n\\n  \"],[10,\"div\"],[14,0,\"lg:mx-4 lg:w-3/5 overflow-hidden\"],[12],[2,\"\\n    \"],[8,\"animated-code-diff\",[],[[\"@label\",\"@diff\",\"@isShowingFinal\",\"@onAnimationChange\"],[\"index.hbs\",[32,0,[\"templateDiff\"]],[32,0,[\"animationEnabled\"]],[30,[36,9],[[30,[36,8],[[32,0,[\"isAnimating\"]]],null]],null]]],null],[2,\"\\n\\n    \"],[10,\"div\"],[14,0,\"mt-4\"],[12],[2,\"\\n      \"],[8,\"animated-code-diff\",[],[[\"@label\",\"@diff\",\"@isShowingFinal\",\"@animationPaused\"],[\"index.js\",[32,0,[\"componentDiff\"]],[32,0,[\"animationEnabled\"]],[32,0,[\"isAnimating\"]]]],null],[2,\"\\n    \"],[13],[2,\"\\n  \"],[13],[2,\"\\n\"],[13],[2,\"\\n\"]],\"hasEval\":false,\"upvars\":[\"svg-jar\",\"range\",\"-track-array\",\"each\",\"sprite\",\"eq\",\"if\",\"on\",\"mut\",\"fn\"]}",
    "moduleName": "animations/components/demo1/index.hbs"
  });

  let Demo1 = (_dec = Ember._tracked, _dec2 = Ember._tracked, _dec3 = Ember._tracked, _dec4 = Ember._action, _dec5 = Ember._action, (_class = (_temp = class Demo1 extends _component.default {
    constructor(...args) {
      super(...args);

      _initializerDefineProperty(this, "transitionsRunning", _descriptor, this);

      _initializerDefineProperty(this, "guests", _descriptor2, this);

      _initializerDefineProperty(this, "animationEnabled", _descriptor3, this);

      _defineProperty(this, "transition", _fade.default);

      _defineProperty(this, "templateDiff", (0, _dedent.default)`
    + <AnimationContext @use={{this.transition}}>
        {{#each guests}}
    -     <Icon 'user' />
    +     <Icon 'user' {{sprite}} />
        {{/each}}
    + </AnimationContext>

  `);

      _defineProperty(this, "componentDiff", (0, _dedent.default)`
      import Component from '@ember/component';
    + import fade from '../../transitions/fade';

      export default Component.extend({
    +   transition: fade,
    +
        guests: 1,

        actions: {
          addGuest() {
            if (this.guests < 6) {
              this.incrementProperty('guests');
            }
          },

          removeGuest() {
            if (this.guests > 1) {
              this.decrementProperty('guests');
            }
          }
        }
      });
  `);
    }

    addGuest() {
      if (this.guests < 6) {
        this.guests = this.guests + 1;
      }
    }

    removeGuest() {
      if (this.guests > 1) {
        this.guests = this.guests - 1;
      }
    }

  }, _temp), (_descriptor = _applyDecoratedDescriptor(_class.prototype, "transitionsRunning", [_dec], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: function () {
      return 0;
    }
  }), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "guests", [_dec2], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: function () {
      return 1;
    }
  }), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "animationEnabled", [_dec3], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: function () {
      return false;
    }
  }), _applyDecoratedDescriptor(_class.prototype, "addGuest", [_dec4], Object.getOwnPropertyDescriptor(_class.prototype, "addGuest"), _class.prototype), _applyDecoratedDescriptor(_class.prototype, "removeGuest", [_dec5], Object.getOwnPropertyDescriptor(_class.prototype, "removeGuest"), _class.prototype)), _class));
  _exports.default = Demo1;

  Ember._setComponentTemplate(__COLOCATED_TEMPLATE__, Demo1);
});
;define("animations/components/ea-list-element", ["exports", "ember-animated/components/ea-list-element"], function (_exports, _eaListElement) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _eaListElement.default;
    }
  });
});
;define("animations/components/ember-table", ["exports", "ember-table/components/ember-table/component"], function (_exports, _component) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _component.default;
    }
  });
});
;define("animations/components/ember-tbody", ["exports", "ember-table/components/ember-tbody/component"], function (_exports, _component) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _component.default;
    }
  });
});
;define("animations/components/ember-td", ["exports", "ember-table/components/ember-td/component"], function (_exports, _component) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _component.default;
    }
  });
});
;define("animations/components/ember-tfoot", ["exports", "ember-table/components/ember-tfoot/component"], function (_exports, _component) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _component.default;
    }
  });
});
;define("animations/components/ember-th", ["exports", "ember-table/components/ember-th/component"], function (_exports, _component) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _component.default;
    }
  });
});
;define("animations/components/ember-th/resize-handle", ["exports", "ember-table/components/ember-th/resize-handle/component"], function (_exports, _component) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _component.default;
    }
  });
});
;define("animations/components/ember-th/sort-indicator", ["exports", "ember-table/components/ember-th/sort-indicator/component"], function (_exports, _component) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _component.default;
    }
  });
});
;define("animations/components/ember-thead", ["exports", "ember-table/components/ember-thead/component"], function (_exports, _component) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _component.default;
    }
  });
});
;define("animations/components/ember-tr", ["exports", "ember-table/components/ember-tr/component"], function (_exports, _component) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _component.default;
    }
  });
});
;define("animations/components/keyboard-press", ["exports", "ember-keyboard/deprecated/components/keyboard-press"], function (_exports, _keyboardPress) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _keyboardPress.default;
    }
  });
});
;define("animations/components/maybe-in-element", ["exports", "ember-maybe-in-element/components/maybe-in-element"], function (_exports, _maybeInElement) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _maybeInElement.default;
    }
  });
});
;define("animations/components/motion-card/component", ["exports", "@glimmer/component"], function (_exports, _component) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _dec, _dec2, _class, _descriptor, _temp;

  function _initializerDefineProperty(target, property, descriptor, context) { if (!descriptor) return; Object.defineProperty(target, property, { enumerable: descriptor.enumerable, configurable: descriptor.configurable, writable: descriptor.writable, value: descriptor.initializer ? descriptor.initializer.call(context) : void 0 }); }

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  function _applyDecoratedDescriptor(target, property, decorators, descriptor, context) { var desc = {}; Object.keys(descriptor).forEach(function (key) { desc[key] = descriptor[key]; }); desc.enumerable = !!desc.enumerable; desc.configurable = !!desc.configurable; if ('value' in desc || desc.initializer) { desc.writable = true; } desc = decorators.slice().reverse().reduce(function (desc, decorator) { return decorator(target, property, desc) || desc; }, desc); if (context && desc.initializer !== void 0) { desc.value = desc.initializer ? desc.initializer.call(context) : void 0; desc.initializer = undefined; } if (desc.initializer === void 0) { Object.defineProperty(target, property, desc); desc = null; } return desc; }

  function _initializerWarningHelper(descriptor, context) { throw new Error('Decorating class property failed. Please ensure that ' + 'proposal-class-properties is enabled and runs after the decorators transform.'); }

  let MotionCard = (_dec = Ember.inject.service, _dec2 = Ember._action, (_class = (_temp = class MotionCard extends _component.default {
    constructor(...args) {
      super(...args);

      _initializerDefineProperty(this, "router", _descriptor, this);
    }

    handleClick() {
      let name = this.router.currentRouteName;

      if (name === 'motion-study.index') {
        this.router.transitionTo('motion-study.details', this.args.identifier);
      } else {
        this.router.transitionTo('motion-study.index');
      }
    }

  }, _temp), (_descriptor = _applyDecoratedDescriptor(_class.prototype, "router", [_dec], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: null
  }), _applyDecoratedDescriptor(_class.prototype, "handleClick", [_dec2], Object.getOwnPropertyDescriptor(_class.prototype, "handleClick"), _class.prototype)), _class));
  _exports.default = MotionCard;
});
;define("animations/components/motion-card/styles", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;
  var _default = {
    "card": "_card_6ir69e",
    "content": "_content_6ir69e",
    "footer": "_footer_6ir69e"
  };
  _exports.default = _default;
});
;define("animations/components/motion-card/template", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _default = Ember.HTMLBars.template({
    "id": "tKskUY2x",
    "block": "{\"symbols\":[\"&default\",\"&attrs\",\"@identifier\"],\"statements\":[[11,\"div\"],[16,0,[31,[[30,[36,0],[\"card\"],[[\"from\"],[\"animations/components/motion-card/styles\"]]]]]],[17,2],[4,[38,2],[\"click\",[32,0,[\"handleClick\"]]],null],[4,[38,1],null,[[\"id\",\"role\"],[[32,3],\"card\"]]],[12],[2,\"\\n\"],[6,[37,3],[[27,[32,1]]],null,[[\"default\"],[{\"statements\":[[2,\"    \"],[11,\"div\"],[16,0,[31,[[30,[36,0],[\"content\"],[[\"from\"],[\"animations/components/motion-card/styles\"]]]]]],[4,[38,1],null,[[\"role\"],[\"card-content\"]]],[12],[2,\"\\n      \"],[18,1,null],[2,\"\\n    \"],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"\\n  \"],[10,\"footer\"],[15,0,[31,[[30,[36,0],[\"footer\"],[[\"from\"],[\"animations/components/motion-card/styles\"]]]]]],[12],[13],[2,\"\\n\"],[13]],\"hasEval\":false,\"upvars\":[\"local-class\",\"sprite\",\"on\",\"if\"]}",
    "moduleName": "animations/components/motion-card/template.hbs"
  });

  _exports.default = _default;
});
;define("animations/components/power-select-multiple", ["exports", "ember-power-select/components/power-select-multiple"], function (_exports, _powerSelectMultiple) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _powerSelectMultiple.default;
    }
  });
});
;define("animations/components/power-select-multiple/trigger", ["exports", "ember-power-select/components/power-select-multiple/trigger"], function (_exports, _trigger) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _trigger.default;
    }
  });
});
;define("animations/components/power-select-typeahead", ["exports", "ember-power-select-typeahead/components/power-select-typeahead"], function (_exports, _powerSelectTypeahead) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _powerSelectTypeahead.default;
    }
  });
});
;define("animations/components/power-select-typeahead/trigger", ["exports", "ember-power-select-typeahead/components/power-select-typeahead/trigger"], function (_exports, _trigger) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _trigger.default;
    }
  });
});
;define("animations/components/power-select", ["exports", "ember-power-select/components/power-select"], function (_exports, _powerSelect) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _powerSelect.default;
    }
  });
});
;define("animations/components/power-select/before-options", ["exports", "ember-power-select/components/power-select/before-options"], function (_exports, _beforeOptions) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _beforeOptions.default;
    }
  });
});
;define("animations/components/power-select/no-matches-message", ["exports", "ember-power-select/components/power-select/no-matches-message"], function (_exports, _noMatchesMessage) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _noMatchesMessage.default;
    }
  });
});
;define("animations/components/power-select/options", ["exports", "ember-power-select/components/power-select/options"], function (_exports, _options) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _options.default;
    }
  });
});
;define("animations/components/power-select/placeholder", ["exports", "ember-power-select/components/power-select/placeholder"], function (_exports, _placeholder) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _placeholder.default;
    }
  });
});
;define("animations/components/power-select/power-select-group", ["exports", "ember-power-select/components/power-select/power-select-group"], function (_exports, _powerSelectGroup) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _powerSelectGroup.default;
    }
  });
});
;define("animations/components/power-select/search-message", ["exports", "ember-power-select/components/power-select/search-message"], function (_exports, _searchMessage) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _searchMessage.default;
    }
  });
});
;define("animations/components/power-select/trigger", ["exports", "ember-power-select/components/power-select/trigger"], function (_exports, _trigger) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _trigger.default;
    }
  });
});
;define("animations/components/toggle-bar/index", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  const __COLOCATED_TEMPLATE__ = Ember.HTMLBars.template(
  /*
    <div class="bg-grey-lightest p-4 flex items-center justify-end">
    <span class="uppercase font-medium text-sm">
      {{yield}}
    </span>
  
    <button class="
        ml-2 w-15 h-5 rounded-full inline-block flex
        relative focus:outline-none focus:shadow-outline shadow-inner
        overflow-hidden transition
        {{if @enabled 'bg-blue' 'bg-grey-light'}}
      "
      type="button"
      {{on 'click' (fn @onToggle (not @enabled))}}
    >
      <span class="p-px absolute w-5 h-5 flex pin-t pin-l nudge-r-0 transition {{if @enabled 'nudge-r-10'}}">
        <span class="bg-white rounded-full w-full h-full shadow"></span>
      </span>
      <span class='
        text-white text-sm ml-auto pl-2 font-bold tracking-tight
        pb-px transition {{if @enabled 'nudge-r-0' '-nudge-r-10'}}
      '>
        ON
      </span>
      <span class='
        text-grey-darker text-sm ml-auto mr-2 font-bold tracking-tight
        pb-px transition {{if @enabled 'nudge-r-10' 'nudge-r-0'}}
      '>
        OFF
      </span>
    </button>
  </div>
  
  */
  {
    "id": "RKVbjCTZ",
    "block": "{\"symbols\":[\"&default\",\"@enabled\",\"@onToggle\"],\"statements\":[[10,\"div\"],[14,0,\"bg-grey-lightest p-4 flex items-center justify-end\"],[12],[2,\"\\n  \"],[10,\"span\"],[14,0,\"uppercase font-medium text-sm\"],[12],[2,\"\\n    \"],[18,1,null],[2,\"\\n  \"],[13],[2,\"\\n\\n  \"],[11,\"button\"],[16,0,[31,[\"\\n      ml-2 w-15 h-5 rounded-full inline-block flex\\n      relative focus:outline-none focus:shadow-outline shadow-inner\\n      overflow-hidden transition\\n      \",[30,[36,0],[[32,2],\"bg-blue\",\"bg-grey-light\"],null],\"\\n    \"]]],[24,4,\"button\"],[4,[38,3],[\"click\",[30,[36,2],[[32,3],[30,[36,1],[[32,2]],null]],null]],null],[12],[2,\"\\n    \"],[10,\"span\"],[15,0,[31,[\"p-px absolute w-5 h-5 flex pin-t pin-l nudge-r-0 transition \",[30,[36,0],[[32,2],\"nudge-r-10\"],null]]]],[12],[2,\"\\n      \"],[10,\"span\"],[14,0,\"bg-white rounded-full w-full h-full shadow\"],[12],[13],[2,\"\\n    \"],[13],[2,\"\\n    \"],[10,\"span\"],[15,0,[31,[\"\\n      text-white text-sm ml-auto pl-2 font-bold tracking-tight\\n      pb-px transition \",[30,[36,0],[[32,2],\"nudge-r-0\",\"-nudge-r-10\"],null],\"\\n    \"]]],[12],[2,\"\\n      ON\\n    \"],[13],[2,\"\\n    \"],[10,\"span\"],[15,0,[31,[\"\\n      text-grey-darker text-sm ml-auto mr-2 font-bold tracking-tight\\n      pb-px transition \",[30,[36,0],[[32,2],\"nudge-r-10\",\"nudge-r-0\"],null],\"\\n    \"]]],[12],[2,\"\\n      OFF\\n    \"],[13],[2,\"\\n  \"],[13],[2,\"\\n\"],[13],[2,\"\\n\"]],\"hasEval\":false,\"upvars\":[\"if\",\"not\",\"fn\",\"on\"]}",
    "moduleName": "animations/components/toggle-bar/index.hbs"
  });

  var _default = Ember._setComponentTemplate(__COLOCATED_TEMPLATE__, Ember._templateOnlyComponent());

  _exports.default = _default;
});
;define("animations/components/vertical-collection", ["exports", "@html-next/vertical-collection/components/vertical-collection/component"], function (_exports, _component) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _component.default;
    }
  });
});
;define("animations/components/welcome-page", ["exports", "ember-welcome-page/components/welcome-page"], function (_exports, _welcomePage) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _welcomePage.default;
    }
  });
});
;define("animations/controllers/boxel", ["exports", "animations/behaviors/spring"], function (_exports, _spring) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _dec, _class, _descriptor, _temp, _dec2, _dec3, _dec4, _dec5, _dec6, _dec7, _dec8, _dec9, _dec10, _class3, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _temp2;

  function _initializerDefineProperty(target, property, descriptor, context) { if (!descriptor) return; Object.defineProperty(target, property, { enumerable: descriptor.enumerable, configurable: descriptor.configurable, writable: descriptor.writable, value: descriptor.initializer ? descriptor.initializer.call(context) : void 0 }); }

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  function _applyDecoratedDescriptor(target, property, decorators, descriptor, context) { var desc = {}; Object.keys(descriptor).forEach(function (key) { desc[key] = descriptor[key]; }); desc.enumerable = !!desc.enumerable; desc.configurable = !!desc.configurable; if ('value' in desc || desc.initializer) { desc.writable = true; } desc = decorators.slice().reverse().reduce(function (desc, decorator) { return decorator(target, property, desc) || desc; }, desc); if (context && desc.initializer !== void 0) { desc.value = desc.initializer ? desc.initializer.call(context) : void 0; desc.initializer = undefined; } if (desc.initializer === void 0) { Object.defineProperty(target, property, desc); desc = null; } return desc; }

  function _initializerWarningHelper(descriptor, context) { throw new Error('Decorating class property failed. Please ensure that ' + 'proposal-class-properties is enabled and runs after the decorators transform.'); }

  const PIA_MIDINA_PROFILE_IMG = '/images/Pia-Midina.jpg';
  const FADE_DURATION = 300;
  const TRANSLATE_DURATION = 1000;
  let Participant = (_dec = Ember._tracked, (_class = (_temp = class Participant {
    constructor() {
      _initializerDefineProperty(this, "isIsolated", _descriptor, this);

      _defineProperty(this, "id", void 0);

      _defineProperty(this, "type", void 0);

      _defineProperty(this, "title", void 0);

      _defineProperty(this, "description", void 0);

      _defineProperty(this, "imgURL", void 0);

      _defineProperty(this, "organization", void 0);

      _defineProperty(this, "ipi", void 0);

      _defineProperty(this, "pro", void 0);

      _defineProperty(this, "email", void 0);

      _defineProperty(this, "website", void 0);

      _defineProperty(this, "number_of_recordings", void 0);

      _defineProperty(this, "phone", void 0);

      _defineProperty(this, "date_of_birth", void 0);

      _defineProperty(this, "address", void 0);

      _defineProperty(this, "city", void 0);

      _defineProperty(this, "state", void 0);

      _defineProperty(this, "zipcode", void 0);

      _defineProperty(this, "country", void 0);
    }

  }, _temp), (_descriptor = _applyDecoratedDescriptor(_class.prototype, "isIsolated", [_dec], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: function () {
      return false;
    }
  })), _class));
  const piaMidina = new Participant();
  piaMidina.id = 'pia-midina';
  piaMidina.type = 'participant';
  piaMidina.title = 'Pia Midina';
  piaMidina.description = 'Recording artist & lyricist';
  piaMidina.imgURL = PIA_MIDINA_PROFILE_IMG;
  piaMidina.organization = 'verifi';
  piaMidina.ipi = '00618723194';
  piaMidina.pro = 'SOMOA';
  piaMidina.email = 'pia.midina@gmail.com';
  piaMidina.website = 'www.piamidina.com';
  piaMidina.number_of_recordings = '17';
  piaMidina.phone = '+1 215 612 2103';
  piaMidina.date_of_birth = '1996-03-08';
  piaMidina.address = '1201 Green St';
  piaMidina.city = 'Philadelphia';
  piaMidina.state = 'PA';
  piaMidina.zipcode = '19111';
  piaMidina.country = 'United States';
  const luke = new Participant();
  luke.id = 'luke-melia';
  luke.type = 'participant';
  luke.title = 'Luke Melia';
  luke.description = 'Singapore resident';
  const alex = new Participant();
  alex.id = 'alex-speller';
  alex.type = 'participant';
  alex.title = 'Alex Speller';
  alex.description = 'Portugal resident';
  const ISOLATING_INTENT = 'isolating-card';
  const UNISOLATING_INTENT = 'unisolating-card';
  const SORTING_INTENT = 'sorting-cards';
  const SORT_SPRING_BEHAVIOR = new _spring.default({
    damping: 12
  });
  const SPRING_BEHAVIOR = new _spring.default({
    restDisplacementThreshold: 1,
    restVelocityThreshold: 0.3,
    damping: 50
  });
  let BoxelController = (_dec2 = Ember._tracked, _dec3 = Ember._tracked, _dec4 = Ember._tracked, _dec5 = Ember.inject.service, _dec6 = Ember._action, _dec7 = Ember._action, _dec8 = Ember._action, _dec9 = Ember._action, _dec10 = Ember._action, (_class3 = (_temp2 = class BoxelController extends Ember.Controller {
    constructor(...args) {
      super(...args);

      _initializerDefineProperty(this, "isCardIsolated", _descriptor2, this);

      _defineProperty(this, "models", [piaMidina, luke, alex]);

      _initializerDefineProperty(this, "isolatedCard", _descriptor3, this);

      _initializerDefineProperty(this, "ascendingSort", _descriptor4, this);

      _initializerDefineProperty(this, "animations", _descriptor5, this);
    }

    get sortedCardModels() {
      let result = this.models.sortBy('title');

      if (!this.ascendingSort) {
        result = result.reverse();
      }

      return result;
    }

    isolateCard(model) {
      this.animations.setIntent(ISOLATING_INTENT);
      this.isolatedCard = model;
    }

    dismissIsolatedCard() {
      this.animations.setIntent(UNISOLATING_INTENT);
      this.isolatedCard = null;
    }

    reverseSort() {
      this.animations.setIntent(SORTING_INTENT);
      this.ascendingSort = !this.ascendingSort;
    } // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types


    async cardSortingTransition(changeset) {
      if (changeset.intent !== SORTING_INTENT) {
        return;
      }

      let translateAnimations = [];
      let cardSprites = changeset.spritesFor({
        role: 'card'
      });

      for (let cardSprite of cardSprites) {
        cardSprite.setupAnimation('position', {
          duration: TRANSLATE_DURATION,
          behavior: SORT_SPRING_BEHAVIOR
        });
        cardSprite.setupAnimation('style', {
          property: 'boxShadow',
          keyframeValues: ['0 0 0', '0 2px 8px rgba(0,0,0,0.15)', '0 0 0'],
          duration: TRANSLATE_DURATION,
          easing: 'ease-in-out'
        });
        let animation = cardSprite.startAnimation();
        translateAnimations.push(animation);
      }

      await Promise.all(translateAnimations.map(a => a.finished));
    } // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types


    async isolatedCardTransition(changeset) {
      let {
        context,
        intent
      } = changeset;

      if (intent === ISOLATING_INTENT) {
        let cardSprite = changeset.spriteFor({
          role: 'card'
        });
        let moreSprite = changeset.spriteFor({
          role: 'card-more'
        });
        (true && !(moreSprite && cardSprite) && Ember.assert('moreSprite and cardSprite are present', moreSprite && cardSprite));
        moreSprite.hide();
        cardSprite.setupAnimation('size', {
          duration: TRANSLATE_DURATION,
          behavior: SPRING_BEHAVIOR
        });
        cardSprite.setupAnimation('position', {
          duration: TRANSLATE_DURATION,
          behavior: SPRING_BEHAVIOR
        });
        let cardAnimation = cardSprite.startAnimation();
        await cardAnimation.finished;
        moreSprite.unlockStyles();
        moreSprite.setupAnimation('opacity', {
          from: 0,
          duration: FADE_DURATION
        });
        await moreSprite.startAnimation().finished;
      }

      if (intent === UNISOLATING_INTENT) {
        let cardSprite = changeset.spriteFor({
          role: 'card'
        });
        let moreSprite = changeset.spriteFor({
          role: 'card-more'
        });
        let placeholderSprite = changeset.spriteFor({
          role: 'card-placeholder'
        });
        (true && !(moreSprite && cardSprite && placeholderSprite) && Ember.assert('sprites are present', moreSprite && cardSprite && placeholderSprite));
        (true && !(cardSprite.initialBounds && cardSprite.finalBounds && cardSprite.counterpart) && Ember.assert('cardSprite always has initialBounds and finalBounds and counterpart', cardSprite.initialBounds && cardSprite.finalBounds && cardSprite.counterpart));
        cardSprite.hide();
        context.appendOrphan(cardSprite.counterpart);
        cardSprite.counterpart.lockStyles();
        cardSprite.counterpart.element.style.zIndex = '1';
        context.appendOrphan(placeholderSprite);
        placeholderSprite.lockStyles();
        placeholderSprite.element.style.opacity = '1';
        placeholderSprite.element.style.zIndex = '-1';
        moreSprite.hide();
        moreSprite.setupAnimation('opacity', {
          to: 0,
          duration: FADE_DURATION
        });
        await moreSprite.startAnimation().finished;
        cardSprite.counterpart.setupAnimation('position', {
          duration: TRANSLATE_DURATION,
          behavior: SPRING_BEHAVIOR
        });
        cardSprite.counterpart.setupAnimation('size', {
          duration: TRANSLATE_DURATION,
          behavior: SPRING_BEHAVIOR
        });
        let cardAnimation = cardSprite.counterpart.startAnimation();
        await cardAnimation.finished;
        cardSprite.unlockStyles();
      }
    }

  }, _temp2), (_descriptor2 = _applyDecoratedDescriptor(_class3.prototype, "isCardIsolated", [_dec2], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: function () {
      return false;
    }
  }), _descriptor3 = _applyDecoratedDescriptor(_class3.prototype, "isolatedCard", [_dec3], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: null
  }), _descriptor4 = _applyDecoratedDescriptor(_class3.prototype, "ascendingSort", [_dec4], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: function () {
      return true;
    }
  }), _descriptor5 = _applyDecoratedDescriptor(_class3.prototype, "animations", [_dec5], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: null
  }), _applyDecoratedDescriptor(_class3.prototype, "isolateCard", [_dec6], Object.getOwnPropertyDescriptor(_class3.prototype, "isolateCard"), _class3.prototype), _applyDecoratedDescriptor(_class3.prototype, "dismissIsolatedCard", [_dec7], Object.getOwnPropertyDescriptor(_class3.prototype, "dismissIsolatedCard"), _class3.prototype), _applyDecoratedDescriptor(_class3.prototype, "reverseSort", [_dec8], Object.getOwnPropertyDescriptor(_class3.prototype, "reverseSort"), _class3.prototype), _applyDecoratedDescriptor(_class3.prototype, "cardSortingTransition", [_dec9], Object.getOwnPropertyDescriptor(_class3.prototype, "cardSortingTransition"), _class3.prototype), _applyDecoratedDescriptor(_class3.prototype, "isolatedCardTransition", [_dec10], Object.getOwnPropertyDescriptor(_class3.prototype, "isolatedCardTransition"), _class3.prototype)), _class3));
  var _default = BoxelController;
  _exports.default = _default;
});
;define("animations/controllers/index", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _dec7, _dec8, _dec9, _dec10, _dec11, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _descriptor7, _descriptor8, _descriptor9, _temp;

  function _initializerDefineProperty(target, property, descriptor, context) { if (!descriptor) return; Object.defineProperty(target, property, { enumerable: descriptor.enumerable, configurable: descriptor.configurable, writable: descriptor.writable, value: descriptor.initializer ? descriptor.initializer.call(context) : void 0 }); }

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  function _applyDecoratedDescriptor(target, property, decorators, descriptor, context) { var desc = {}; Object.keys(descriptor).forEach(function (key) { desc[key] = descriptor[key]; }); desc.enumerable = !!desc.enumerable; desc.configurable = !!desc.configurable; if ('value' in desc || desc.initializer) { desc.writable = true; } desc = decorators.slice().reverse().reduce(function (desc, decorator) { return decorator(target, property, desc) || desc; }, desc); if (context && desc.initializer !== void 0) { desc.value = desc.initializer ? desc.initializer.call(context) : void 0; desc.initializer = undefined; } if (desc.initializer === void 0) { Object.defineProperty(target, property, desc); desc = null; } return desc; }

  function _initializerWarningHelper(descriptor, context) { throw new Error('Decorating class property failed. Please ensure that ' + 'proposal-class-properties is enabled and runs after the decorators transform.'); }

  const FADE_DURATION = 1500;
  const TRANSLATE_DURATION = 1500;
  const MOVE_C_INTENT = 'move-c';
  let IndexController = (_dec = Ember.inject.service, _dec2 = Ember._tracked, _dec3 = Ember._tracked, _dec4 = Ember._tracked, _dec5 = Ember._tracked, _dec6 = Ember._tracked, _dec7 = Ember._tracked, _dec8 = Ember._tracked, _dec9 = Ember._tracked, _dec10 = Ember._action, _dec11 = Ember._action, (_class = (_temp = class IndexController extends Ember.Controller {
    constructor(...args) {
      super(...args);

      _initializerDefineProperty(this, "animations", _descriptor, this);

      _initializerDefineProperty(this, "contextHasPadding", _descriptor2, this);

      _initializerDefineProperty(this, "showContentBeforeContext", _descriptor3, this);

      _initializerDefineProperty(this, "showContentBefore", _descriptor4, this);

      _initializerDefineProperty(this, "showSpriteA", _descriptor5, this);

      _initializerDefineProperty(this, "spriteAPositionBottom", _descriptor6, this);

      _initializerDefineProperty(this, "showSpriteB", _descriptor7, this);

      _initializerDefineProperty(this, "spriteCPosition", _descriptor8, this);

      _initializerDefineProperty(this, "showContentAfter", _descriptor9, this);
    }

    toggleSpritesAandB() {
      this.showSpriteA = !this.showSpriteA;
      this.showSpriteB = !this.showSpriteB;
    }

    moveSpriteC() {
      this.animations.setIntent(MOVE_C_INTENT);
      this.spriteCPosition = (this.spriteCPosition + 1) % 2;
    }

    async innerTransition(changeset) {
      let {
        context,
        intent,
        insertedSprites,
        keptSprites,
        removedSprites
      } = changeset;

      if (intent === MOVE_C_INTENT) {
        return;
      }

      let animations = [];

      for (let removedSprite of [...removedSprites]) {
        context.appendOrphan(removedSprite);
        removedSprite.lockStyles();
        removedSprite.hide();
        removedSprite.setupAnimation('opacity', {
          to: 0,
          duration: FADE_DURATION
        });
        animations.push(removedSprite.startAnimation());
      }

      for (let insertedSprite of [...insertedSprites]) {
        insertedSprite.setupAnimation('opacity', {
          delay: FADE_DURATION,
          duration: TRANSLATE_DURATION
        });
        animations.push(insertedSprite.startAnimation());
      }

      for (let keptSprite of [...keptSprites]) {
        keptSprite.setupAnimation('position', {
          delay: removedSprites.size > 0 ? 1500 : 0,
          duration: TRANSLATE_DURATION
        });

        if (keptSprite.role === 'container') {
          keptSprite.setupAnimation('size', {
            delay: removedSprites.size > 0 ? 1500 : 0,
            duration: TRANSLATE_DURATION
          });
        }

        animations.push(keptSprite.startAnimation());
      }

      await Promise.all(animations.map(a => a.finished));
    }

    async outerTransition(changeset) {
      let {
        intent,
        keptSprites
      } = changeset;

      if (intent !== MOVE_C_INTENT) {
        return;
      }

      let animations = [];

      for (let keptSprite of [...keptSprites]) {
        keptSprite.setupAnimation('position', {
          duration: TRANSLATE_DURATION
        });
        animations.push(keptSprite.startAnimation());
      }

      await Promise.all(animations.map(a => a.finished));
    }

  }, _temp), (_descriptor = _applyDecoratedDescriptor(_class.prototype, "animations", [_dec], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: null
  }), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "contextHasPadding", [_dec2], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: function () {
      return false;
    }
  }), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "showContentBeforeContext", [_dec3], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: function () {
      return false;
    }
  }), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "showContentBefore", [_dec4], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: function () {
      return false;
    }
  }), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "showSpriteA", [_dec5], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: function () {
      return true;
    }
  }), _descriptor6 = _applyDecoratedDescriptor(_class.prototype, "spriteAPositionBottom", [_dec6], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: function () {
      return false;
    }
  }), _descriptor7 = _applyDecoratedDescriptor(_class.prototype, "showSpriteB", [_dec7], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: function () {
      return true;
    }
  }), _descriptor8 = _applyDecoratedDescriptor(_class.prototype, "spriteCPosition", [_dec8], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: function () {
      return 0;
    }
  }), _descriptor9 = _applyDecoratedDescriptor(_class.prototype, "showContentAfter", [_dec9], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: function () {
      return false;
    }
  }), _applyDecoratedDescriptor(_class.prototype, "toggleSpritesAandB", [_dec10], Object.getOwnPropertyDescriptor(_class.prototype, "toggleSpritesAandB"), _class.prototype), _applyDecoratedDescriptor(_class.prototype, "moveSpriteC", [_dec11], Object.getOwnPropertyDescriptor(_class.prototype, "moveSpriteC"), _class.prototype)), _class));
  _exports.default = IndexController;
});
;define("animations/controllers/interruption", ["exports", "animations/transitions/magic-move", "animations/utils/run-animations", "animations/behaviors/spring"], function (_exports, _magicMove, _runAnimations, _spring) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _dec, _class, _descriptor, _temp;

  function _initializerDefineProperty(target, property, descriptor, context) { if (!descriptor) return; Object.defineProperty(target, property, { enumerable: descriptor.enumerable, configurable: descriptor.configurable, writable: descriptor.writable, value: descriptor.initializer ? descriptor.initializer.call(context) : void 0 }); }

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  function _applyDecoratedDescriptor(target, property, decorators, descriptor, context) { var desc = {}; Object.keys(descriptor).forEach(function (key) { desc[key] = descriptor[key]; }); desc.enumerable = !!desc.enumerable; desc.configurable = !!desc.configurable; if ('value' in desc || desc.initializer) { desc.writable = true; } desc = decorators.slice().reverse().reduce(function (desc, decorator) { return decorator(target, property, desc) || desc; }, desc); if (context && desc.initializer !== void 0) { desc.value = desc.initializer ? desc.initializer.call(context) : void 0; desc.initializer = undefined; } if (desc.initializer === void 0) { Object.defineProperty(target, property, desc); desc = null; } return desc; }

  function _initializerWarningHelper(descriptor, context) { throw new Error('Decorating class property failed. Please ensure that ' + 'proposal-class-properties is enabled and runs after the decorators transform.'); }

  let InterruptionController = (_dec = Ember._tracked, (_class = (_temp = class InterruptionController extends Ember.Controller {
    constructor(...args) {
      super(...args);

      _initializerDefineProperty(this, "ballGoWhere", _descriptor, this);

      _defineProperty(this, "animationOriginPosition", null);
    }

    async transition(changeset) {
      (0, _magicMove.default)(changeset, {
        behavior: new _spring.default({
          overshootClamping: false,
          damping: 11
        })
      });
      await (0, _runAnimations.default)([...changeset.keptSprites]);
    }

  }, _temp), (_descriptor = _applyDecoratedDescriptor(_class.prototype, "ballGoWhere", [_dec], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: function () {
      return 'A';
    }
  })), _class));
  var _default = InterruptionController;
  _exports.default = _default;
});
;define("animations/controllers/list-detail", ["exports", "animations/transitions/list-detail"], function (_exports, _listDetail) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _dec, _class, _descriptor, _temp;

  function _initializerDefineProperty(target, property, descriptor, context) { if (!descriptor) return; Object.defineProperty(target, property, { enumerable: descriptor.enumerable, configurable: descriptor.configurable, writable: descriptor.writable, value: descriptor.initializer ? descriptor.initializer.call(context) : void 0 }); }

  function _applyDecoratedDescriptor(target, property, decorators, descriptor, context) { var desc = {}; Object.keys(descriptor).forEach(function (key) { desc[key] = descriptor[key]; }); desc.enumerable = !!desc.enumerable; desc.configurable = !!desc.configurable; if ('value' in desc || desc.initializer) { desc.writable = true; } desc = decorators.slice().reverse().reduce(function (desc, decorator) { return decorator(target, property, desc) || desc; }, desc); if (context && desc.initializer !== void 0) { desc.value = desc.initializer ? desc.initializer.call(context) : void 0; desc.initializer = undefined; } if (desc.initializer === void 0) { Object.defineProperty(target, property, desc); desc = null; } return desc; }

  function _initializerWarningHelper(descriptor, context) { throw new Error('Decorating class property failed. Please ensure that ' + 'proposal-class-properties is enabled and runs after the decorators transform.'); }

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  class Person {
    constructor(name, title, id, bio) {
      _defineProperty(this, "name", void 0);

      _defineProperty(this, "title", void 0);

      _defineProperty(this, "id", void 0);

      _defineProperty(this, "bio", void 0);

      this.name = name;
      this.title = title;
      this.id = id;
      this.bio = bio;
    }

  }

  let IndexController = (_dec = Ember._tracked, (_class = (_temp = class IndexController extends Ember.Controller {
    constructor(...args) {
      super(...args);

      _defineProperty(this, "people", [new Person('Alex', 'Developer', '1', 'foo bar vaz'), new Person('Luke', 'Engineering Manager', '2', 'baz foo noo')]);

      _initializerDefineProperty(this, "selectedPerson", _descriptor, this);

      _defineProperty(this, "listDetailTransition", _listDetail.default);
    }

  }, _temp), (_descriptor = _applyDecoratedDescriptor(_class.prototype, "selectedPerson", [_dec], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: function () {
      return null;
    }
  })), _class));
  _exports.default = IndexController;
});
;define("animations/controllers/motion-study", ["exports", "animations/transitions/magic-move", "animations/models/sprite", "animations/transitions/fade", "animations/utils/run-animations", "animations/behaviors/spring"], function (_exports, _magicMove, _sprite, _fade, _runAnimations, _spring) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  class MotionStudy extends Ember.Controller {
    async transition(changeset) {
      let {
        context
      } = changeset;
      let behavior = new _spring.default({
        overshootClamping: false,
        stiffness: 100,
        damping: 15
      }); //let moveDuration = 1000;

      let fadeDuration = 300;
      let magicMoveDelay = 0;
      let cardSprites = changeset.spritesFor({
        role: 'card',
        type: _sprite.SpriteType.Kept
      });
      let removedCardSprites = changeset.spritesFor({
        role: 'card',
        type: _sprite.SpriteType.Removed
      });
      removedCardSprites.forEach(removedSprite => {
        context.appendOrphan(removedSprite);
        removedSprite.lockStyles();
        removedSprite.element.style.zIndex = '0';
      });
      let removedCardContentSprites = changeset.spritesFor({
        role: 'card-content',
        type: _sprite.SpriteType.Removed
      });

      if (removedCardContentSprites.size) {
        magicMoveDelay = fadeDuration;
        (0, _fade.default)({
          context,
          insertedSprites: new Set(),
          removedSprites: removedCardContentSprites,
          keptSprites: new Set()
        }, {
          duration: fadeDuration
        });
        removedCardContentSprites.forEach(s => {
          s.element.style.zIndex = '2';
        });
        cardSprites.forEach(s => {
          // only lock styles & set z-index for the animating card
          if (s.boundsDelta && (s.boundsDelta.x !== 0 || s.boundsDelta.y !== 0)) {
            s.lockStyles();
            s.element.style.zIndex = '1';
          }
        });
        await (0, _runAnimations.default)([...removedCardContentSprites]);
        cardSprites.forEach(s => {
          s.unlockStyles();
        });
        removedCardContentSprites.forEach(r => r.hide()); // TODO: this is too late as the fade duration is shorter
      }

      (0, _magicMove.default)({
        context,
        insertedSprites: new Set(),
        removedSprites: new Set(),
        keptSprites: cardSprites
      }, {
        behavior,
        //duration: moveDuration,
        delay: magicMoveDelay
      });
      let cardContentSprites = changeset.spritesFor({
        role: 'card-content',
        type: _sprite.SpriteType.Inserted
      });
      cardContentSprites.forEach(s => {
        s.element.style.opacity = '0';
      });
      await (0, _runAnimations.default)([...cardSprites]);
      removedCardSprites.forEach(r => r.hide());
      (0, _fade.default)({
        context,
        insertedSprites: cardContentSprites,
        removedSprites: new Set(),
        keptSprites: new Set()
      }, {
        duration: fadeDuration
      });
      await (0, _runAnimations.default)([...cardContentSprites]);
      cardContentSprites.forEach(s => {
        s.element.style.removeProperty('opacity');
      });
    }

  }

  _exports.default = MotionStudy;
});
;define("animations/controllers/routes", ["exports", "animations/models/sprite", "animations/transitions/magic-move", "animations/models/context-aware-bounds", "animations/utils/run-animations", "animations/behaviors/spring"], function (_exports, _sprite, _magicMove, _contextAwareBounds, _runAnimations, _spring) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;
  const springBehavior = new _spring.default({
    overshootClamping: true,
    damping: 100
  });

  class RoutesController extends Ember.Controller {
    async transition(changeset) {
      let {
        removedSprites,
        keptSprites,
        insertedSprites,
        context
      } = changeset;
      (true && !(context.currentBounds) && Ember.assert('Context must always have currentBounds', context.currentBounds));

      if (keptSprites.size > 0) {
        let keptSprite = changeset.spriteFor({
          type: _sprite.SpriteType.Kept
        });
        (true && !(keptSprite.counterpart && keptSprite.initialBounds && keptSprite.finalBounds) && Ember.assert('keptSprite always has a counterpart, initialBounds and finalBounds', keptSprite.counterpart && keptSprite.initialBounds && keptSprite.finalBounds));

        for (let removedSprite of removedSprites) {
          (true && !(removedSprite.initialBounds) && Ember.assert('removedSprite must always have initialBounds', removedSprite.initialBounds));
          context.appendOrphan(removedSprite); // TODO: either don't compensate for the animation in lockStyles
          //  or take it into account when calculating the animation.

          removedSprite.lockStyles({
            left: 0,
            top: 0,
            width: removedSprite.initialBounds.element.width,
            height: removedSprite.initialBounds.element.height
          });
          let moveLeft = keptSprite.id === 'route-content-other';
          let {
            x,
            y,
            width
          } = keptSprite.finalBounds.element;
          let finalElementBounds;

          if (moveLeft) {
            finalElementBounds = new DOMRect(x - width, y, removedSprite.initialBounds.element.width, removedSprite.initialBounds.element.height);
          } else {
            finalElementBounds = new DOMRect(x + width, y, removedSprite.initialBounds.element.width, removedSprite.initialBounds.element.height);
          }

          removedSprite.finalBounds = new _contextAwareBounds.default({
            element: finalElementBounds,
            contextElement: context.currentBounds
          });
          let initialBounds = removedSprite.initialBounds.relativeToContext;
          let finalBounds = removedSprite.finalBounds.relativeToContext;
          removedSprite.setupAnimation('position', {
            startX: initialBounds.x,
            endX: finalBounds.x,
            behavior: springBehavior
          });
        }

        (0, _magicMove.default)(changeset, {
          behavior: springBehavior
        });
      } else {
        let removedSprite = changeset.spriteFor({
          type: _sprite.SpriteType.Removed
        });
        let insertedSprite = changeset.spriteFor({
          type: _sprite.SpriteType.Inserted
        });
        (true && !(removedSprite?.initialWidth && insertedSprite?.finalWidth) && Ember.assert('removedSprite.initialWidth and insertedSprite.finalWidth are present', removedSprite?.initialWidth && insertedSprite?.finalWidth));
        context.appendOrphan(removedSprite);
        removedSprite.lockStyles();
        let moveLeft = insertedSprite?.id === 'route-content-other';
        removedSprite.setupAnimation('position', {
          endX: removedSprite.initialWidth * (moveLeft ? -1 : 1),
          behavior: springBehavior
        });
        insertedSprite.setupAnimation('position', {
          startX: insertedSprite.finalWidth * (moveLeft ? 1 : -1),
          behavior: springBehavior
        });
      }

      await (0, _runAnimations.default)([...removedSprites, ...keptSprites, ...insertedSprites]);
    }

  }

  _exports.default = RoutesController;
});
;define("animations/data-adapter", ["exports", "@ember-data/debug"], function (_exports, _debug) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _debug.default;
    }
  });
});
;define("animations/helpers/-element", ["exports", "ember-element-helper/helpers/-element"], function (_exports, _element) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _element.default;
    }
  });
});
;define("animations/helpers/-has-block-params", ["exports", "ember-named-blocks-polyfill/helpers/-has-block-params"], function (_exports, _hasBlockParams) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _hasBlockParams.default;
    }
  });
});
;define("animations/helpers/-has-block", ["exports", "ember-named-blocks-polyfill/helpers/-has-block"], function (_exports, _hasBlock) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _hasBlock.default;
    }
  });
});
;define("animations/helpers/-is-named-block-invocation", ["exports", "ember-named-blocks-polyfill/helpers/-is-named-block-invocation"], function (_exports, _isNamedBlockInvocation) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _isNamedBlockInvocation.default;
    }
  });
});
;define("animations/helpers/-named-block-invocation", ["exports", "ember-named-blocks-polyfill/helpers/-named-block-invocation"], function (_exports, _namedBlockInvocation) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _namedBlockInvocation.default;
    }
  });
});
;define("animations/helpers/abs", ["exports", "ember-math-helpers/helpers/abs"], function (_exports, _abs) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _abs.default;
    }
  });
  Object.defineProperty(_exports, "abs", {
    enumerable: true,
    get: function () {
      return _abs.abs;
    }
  });
});
;define("animations/helpers/acos", ["exports", "ember-math-helpers/helpers/acos"], function (_exports, _acos) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _acos.default;
    }
  });
  Object.defineProperty(_exports, "acos", {
    enumerable: true,
    get: function () {
      return _acos.acos;
    }
  });
});
;define("animations/helpers/acosh", ["exports", "ember-math-helpers/helpers/acosh"], function (_exports, _acosh) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _acosh.default;
    }
  });
  Object.defineProperty(_exports, "acosh", {
    enumerable: true,
    get: function () {
      return _acosh.acosh;
    }
  });
});
;define("animations/helpers/add", ["exports", "ember-math-helpers/helpers/add"], function (_exports, _add) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _add.default;
    }
  });
  Object.defineProperty(_exports, "add", {
    enumerable: true,
    get: function () {
      return _add.add;
    }
  });
});
;define("animations/helpers/and", ["exports", "ember-truth-helpers/helpers/and"], function (_exports, _and) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _and.default;
    }
  });
  Object.defineProperty(_exports, "and", {
    enumerable: true,
    get: function () {
      return _and.and;
    }
  });
});
;define("animations/helpers/app-version", ["exports", "animations/config/environment", "ember-cli-app-version/utils/regexp"], function (_exports, _environment, _regexp) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.appVersion = appVersion;
  _exports.default = void 0;

  function appVersion(_, hash = {}) {
    const version = _environment.default.APP.version; // e.g. 1.0.0-alpha.1+4jds75hf
    // Allow use of 'hideSha' and 'hideVersion' For backwards compatibility

    let versionOnly = hash.versionOnly || hash.hideSha;
    let shaOnly = hash.shaOnly || hash.hideVersion;
    let match = null;

    if (versionOnly) {
      if (hash.showExtended) {
        match = version.match(_regexp.versionExtendedRegExp); // 1.0.0-alpha.1
      } // Fallback to just version


      if (!match) {
        match = version.match(_regexp.versionRegExp); // 1.0.0
      }
    }

    if (shaOnly) {
      match = version.match(_regexp.shaRegExp); // 4jds75hf
    }

    return match ? match[0] : version;
  }

  var _default = Ember.Helper.helper(appVersion);

  _exports.default = _default;
});
;define("animations/helpers/append", ["exports", "ember-composable-helpers/helpers/append"], function (_exports, _append) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _append.default;
    }
  });
  Object.defineProperty(_exports, "append", {
    enumerable: true,
    get: function () {
      return _append.append;
    }
  });
});
;define("animations/helpers/asin", ["exports", "ember-math-helpers/helpers/asin"], function (_exports, _asin) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _asin.default;
    }
  });
  Object.defineProperty(_exports, "asin", {
    enumerable: true,
    get: function () {
      return _asin.asin;
    }
  });
});
;define("animations/helpers/asinh", ["exports", "ember-math-helpers/helpers/asinh"], function (_exports, _asinh) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _asinh.default;
    }
  });
  Object.defineProperty(_exports, "asinh", {
    enumerable: true,
    get: function () {
      return _asinh.asinh;
    }
  });
});
;define("animations/helpers/assign", ["exports", "ember-assign-helper/helpers/assign"], function (_exports, _assign) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _assign.default;
    }
  });
  Object.defineProperty(_exports, "assign", {
    enumerable: true,
    get: function () {
      return _assign.assign;
    }
  });
});
;define("animations/helpers/atan", ["exports", "ember-math-helpers/helpers/atan"], function (_exports, _atan) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _atan.default;
    }
  });
  Object.defineProperty(_exports, "atan", {
    enumerable: true,
    get: function () {
      return _atan.atan;
    }
  });
});
;define("animations/helpers/atan2", ["exports", "ember-math-helpers/helpers/atan2"], function (_exports, _atan) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _atan.default;
    }
  });
  Object.defineProperty(_exports, "atan2", {
    enumerable: true,
    get: function () {
      return _atan.atan2;
    }
  });
});
;define("animations/helpers/atanh", ["exports", "ember-math-helpers/helpers/atanh"], function (_exports, _atanh) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _atanh.default;
    }
  });
  Object.defineProperty(_exports, "atanh", {
    enumerable: true,
    get: function () {
      return _atanh.atanh;
    }
  });
});
;define("animations/helpers/call", ["exports", "ember-composable-helpers/helpers/call"], function (_exports, _call) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _call.default;
    }
  });
  Object.defineProperty(_exports, "call", {
    enumerable: true,
    get: function () {
      return _call.call;
    }
  });
});
;define("animations/helpers/camelize", ["exports", "ember-cli-string-helpers/helpers/camelize"], function (_exports, _camelize) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _camelize.default;
    }
  });
  Object.defineProperty(_exports, "camelize", {
    enumerable: true,
    get: function () {
      return _camelize.camelize;
    }
  });
});
;define("animations/helpers/cancel-all", ["exports", "ember-concurrency/helpers/cancel-all"], function (_exports, _cancelAll) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _cancelAll.default;
    }
  });
});
;define("animations/helpers/capitalize", ["exports", "ember-cli-string-helpers/helpers/capitalize"], function (_exports, _capitalize) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _capitalize.default;
    }
  });
  Object.defineProperty(_exports, "capitalize", {
    enumerable: true,
    get: function () {
      return _capitalize.capitalize;
    }
  });
});
;define("animations/helpers/cbrt", ["exports", "ember-math-helpers/helpers/cbrt"], function (_exports, _cbrt) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _cbrt.default;
    }
  });
  Object.defineProperty(_exports, "cbrt", {
    enumerable: true,
    get: function () {
      return _cbrt.cbrt;
    }
  });
});
;define("animations/helpers/ceil", ["exports", "ember-math-helpers/helpers/ceil"], function (_exports, _ceil) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _ceil.default;
    }
  });
  Object.defineProperty(_exports, "ceil", {
    enumerable: true,
    get: function () {
      return _ceil.ceil;
    }
  });
});
;define("animations/helpers/chunk", ["exports", "ember-composable-helpers/helpers/chunk"], function (_exports, _chunk) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _chunk.default;
    }
  });
  Object.defineProperty(_exports, "chunk", {
    enumerable: true,
    get: function () {
      return _chunk.chunk;
    }
  });
});
;define("animations/helpers/class-names", ["exports", "ember-class-names-helper/helpers/class-names"], function (_exports, _classNames) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _classNames.default;
    }
  });
});
;define("animations/helpers/classify", ["exports", "ember-cli-string-helpers/helpers/classify"], function (_exports, _classify) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _classify.default;
    }
  });
  Object.defineProperty(_exports, "classify", {
    enumerable: true,
    get: function () {
      return _classify.classify;
    }
  });
});
;define("animations/helpers/clz32", ["exports", "ember-math-helpers/helpers/clz32"], function (_exports, _clz) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _clz.default;
    }
  });
  Object.defineProperty(_exports, "clz32", {
    enumerable: true,
    get: function () {
      return _clz.clz32;
    }
  });
});
;define("animations/helpers/cn", ["exports", "ember-class-names-helper/helpers/class-names"], function (_exports, _classNames) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _classNames.default;
    }
  });
});
;define("animations/helpers/compact", ["exports", "ember-composable-helpers/helpers/compact"], function (_exports, _compact) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _compact.default;
    }
  });
});
;define("animations/helpers/compute", ["exports", "ember-composable-helpers/helpers/compute"], function (_exports, _compute) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _compute.default;
    }
  });
  Object.defineProperty(_exports, "compute", {
    enumerable: true,
    get: function () {
      return _compute.compute;
    }
  });
});
;define("animations/helpers/contains", ["exports", "ember-composable-helpers/helpers/contains"], function (_exports, _contains) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _contains.default;
    }
  });
  Object.defineProperty(_exports, "contains", {
    enumerable: true,
    get: function () {
      return _contains.contains;
    }
  });
});
;define("animations/helpers/cos", ["exports", "ember-math-helpers/helpers/cos"], function (_exports, _cos) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _cos.default;
    }
  });
  Object.defineProperty(_exports, "cos", {
    enumerable: true,
    get: function () {
      return _cos.cos;
    }
  });
});
;define("animations/helpers/cosh", ["exports", "ember-math-helpers/helpers/cosh"], function (_exports, _cosh) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _cosh.default;
    }
  });
  Object.defineProperty(_exports, "cosh", {
    enumerable: true,
    get: function () {
      return _cosh.cosh;
    }
  });
});
;define("animations/helpers/css-url", ["exports", "ember-css-url"], function (_exports, _emberCssUrl) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  function asHelper(params) {
    return (0, _emberCssUrl.default)(...params);
  }

  var _default = Ember.Helper.helper(asHelper);

  _exports.default = _default;
});
;define("animations/helpers/dasherize", ["exports", "ember-cli-string-helpers/helpers/dasherize"], function (_exports, _dasherize) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _dasherize.default;
    }
  });
  Object.defineProperty(_exports, "dasherize", {
    enumerable: true,
    get: function () {
      return _dasherize.dasherize;
    }
  });
});
;define("animations/helpers/dec", ["exports", "ember-composable-helpers/helpers/dec"], function (_exports, _dec) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _dec.default;
    }
  });
  Object.defineProperty(_exports, "dec", {
    enumerable: true,
    get: function () {
      return _dec.dec;
    }
  });
});
;define("animations/helpers/div", ["exports", "ember-math-helpers/helpers/div"], function (_exports, _div) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _div.default;
    }
  });
  Object.defineProperty(_exports, "div", {
    enumerable: true,
    get: function () {
      return _div.div;
    }
  });
});
;define("animations/helpers/drop", ["exports", "ember-composable-helpers/helpers/drop"], function (_exports, _drop) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _drop.default;
    }
  });
});
;define("animations/helpers/element", ["exports", "ember-element-helper/helpers/element"], function (_exports, _element) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _element.default;
    }
  });
});
;define("animations/helpers/ember-power-select-is-group", ["exports", "ember-power-select/helpers/ember-power-select-is-group"], function (_exports, _emberPowerSelectIsGroup) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _emberPowerSelectIsGroup.default;
    }
  });
  Object.defineProperty(_exports, "emberPowerSelectIsGroup", {
    enumerable: true,
    get: function () {
      return _emberPowerSelectIsGroup.emberPowerSelectIsGroup;
    }
  });
});
;define("animations/helpers/ember-power-select-is-selected", ["exports", "ember-power-select/helpers/ember-power-select-is-selected"], function (_exports, _emberPowerSelectIsSelected) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _emberPowerSelectIsSelected.default;
    }
  });
  Object.defineProperty(_exports, "emberPowerSelectIsSelected", {
    enumerable: true,
    get: function () {
      return _emberPowerSelectIsSelected.emberPowerSelectIsSelected;
    }
  });
});
;define("animations/helpers/ensure-safe-component", ["exports", "@embroider/util"], function (_exports, _util) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _util.EnsureSafeComponentHelper;
    }
  });
});
;define("animations/helpers/entries", ["exports", "ember-composable-helpers/helpers/entries"], function (_exports, _entries) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _entries.default;
    }
  });
  Object.defineProperty(_exports, "entries", {
    enumerable: true,
    get: function () {
      return _entries.entries;
    }
  });
});
;define("animations/helpers/eq", ["exports", "ember-truth-helpers/helpers/equal"], function (_exports, _equal) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _equal.default;
    }
  });
  Object.defineProperty(_exports, "equal", {
    enumerable: true,
    get: function () {
      return _equal.equal;
    }
  });
});
;define("animations/helpers/exp", ["exports", "ember-math-helpers/helpers/exp"], function (_exports, _exp) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _exp.default;
    }
  });
  Object.defineProperty(_exports, "exp", {
    enumerable: true,
    get: function () {
      return _exp.exp;
    }
  });
});
;define("animations/helpers/expm1", ["exports", "ember-math-helpers/helpers/expm1"], function (_exports, _expm) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _expm.default;
    }
  });
  Object.defineProperty(_exports, "expm1", {
    enumerable: true,
    get: function () {
      return _expm.expm1;
    }
  });
});
;define("animations/helpers/filter-by", ["exports", "ember-composable-helpers/helpers/filter-by"], function (_exports, _filterBy) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _filterBy.default;
    }
  });
});
;define("animations/helpers/filter", ["exports", "ember-composable-helpers/helpers/filter"], function (_exports, _filter) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _filter.default;
    }
  });
});
;define("animations/helpers/find-by", ["exports", "ember-composable-helpers/helpers/find-by"], function (_exports, _findBy) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _findBy.default;
    }
  });
});
;define("animations/helpers/flatten", ["exports", "ember-composable-helpers/helpers/flatten"], function (_exports, _flatten) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _flatten.default;
    }
  });
  Object.defineProperty(_exports, "flatten", {
    enumerable: true,
    get: function () {
      return _flatten.flatten;
    }
  });
});
;define("animations/helpers/floor", ["exports", "ember-math-helpers/helpers/floor"], function (_exports, _floor) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _floor.default;
    }
  });
  Object.defineProperty(_exports, "floor", {
    enumerable: true,
    get: function () {
      return _floor.floor;
    }
  });
});
;define("animations/helpers/from-entries", ["exports", "ember-composable-helpers/helpers/from-entries"], function (_exports, _fromEntries) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _fromEntries.default;
    }
  });
  Object.defineProperty(_exports, "fromEntries", {
    enumerable: true,
    get: function () {
      return _fromEntries.fromEntries;
    }
  });
});
;define("animations/helpers/fround", ["exports", "ember-math-helpers/helpers/fround"], function (_exports, _fround) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _fround.default;
    }
  });
  Object.defineProperty(_exports, "fround", {
    enumerable: true,
    get: function () {
      return _fround.fround;
    }
  });
});
;define("animations/helpers/gcd", ["exports", "ember-math-helpers/helpers/gcd"], function (_exports, _gcd) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _gcd.default;
    }
  });
  Object.defineProperty(_exports, "gcd", {
    enumerable: true,
    get: function () {
      return _gcd.gcd;
    }
  });
});
;define("animations/helpers/group-by", ["exports", "ember-composable-helpers/helpers/group-by"], function (_exports, _groupBy) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _groupBy.default;
    }
  });
});
;define("animations/helpers/gt", ["exports", "ember-truth-helpers/helpers/gt"], function (_exports, _gt) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _gt.default;
    }
  });
  Object.defineProperty(_exports, "gt", {
    enumerable: true,
    get: function () {
      return _gt.gt;
    }
  });
});
;define("animations/helpers/gte", ["exports", "ember-truth-helpers/helpers/gte"], function (_exports, _gte) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _gte.default;
    }
  });
  Object.defineProperty(_exports, "gte", {
    enumerable: true,
    get: function () {
      return _gte.gte;
    }
  });
});
;define("animations/helpers/has-next", ["exports", "ember-composable-helpers/helpers/has-next"], function (_exports, _hasNext) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _hasNext.default;
    }
  });
  Object.defineProperty(_exports, "hasNext", {
    enumerable: true,
    get: function () {
      return _hasNext.hasNext;
    }
  });
});
;define("animations/helpers/has-previous", ["exports", "ember-composable-helpers/helpers/has-previous"], function (_exports, _hasPrevious) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _hasPrevious.default;
    }
  });
  Object.defineProperty(_exports, "hasPrevious", {
    enumerable: true,
    get: function () {
      return _hasPrevious.hasPrevious;
    }
  });
});
;define("animations/helpers/html-safe", ["exports", "ember-cli-string-helpers/helpers/html-safe"], function (_exports, _htmlSafe) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _htmlSafe.default;
    }
  });
  Object.defineProperty(_exports, "htmlSafe", {
    enumerable: true,
    get: function () {
      return _htmlSafe.htmlSafe;
    }
  });
});
;define("animations/helpers/humanize", ["exports", "ember-cli-string-helpers/helpers/humanize"], function (_exports, _humanize) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _humanize.default;
    }
  });
  Object.defineProperty(_exports, "humanize", {
    enumerable: true,
    get: function () {
      return _humanize.humanize;
    }
  });
});
;define("animations/helpers/hypot", ["exports", "ember-math-helpers/helpers/hypot"], function (_exports, _hypot) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _hypot.default;
    }
  });
  Object.defineProperty(_exports, "hypot", {
    enumerable: true,
    get: function () {
      return _hypot.hypot;
    }
  });
});
;define("animations/helpers/if-key", ["exports", "ember-keyboard/helpers/if-key"], function (_exports, _ifKey) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _ifKey.default;
    }
  });
  Object.defineProperty(_exports, "ifKey", {
    enumerable: true,
    get: function () {
      return _ifKey.ifKey;
    }
  });
});
;define("animations/helpers/imul", ["exports", "ember-math-helpers/helpers/imul"], function (_exports, _imul) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _imul.default;
    }
  });
  Object.defineProperty(_exports, "imul", {
    enumerable: true,
    get: function () {
      return _imul.imul;
    }
  });
});
;define("animations/helpers/inc", ["exports", "ember-composable-helpers/helpers/inc"], function (_exports, _inc) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _inc.default;
    }
  });
  Object.defineProperty(_exports, "inc", {
    enumerable: true,
    get: function () {
      return _inc.inc;
    }
  });
});
;define("animations/helpers/includes", ["exports", "ember-composable-helpers/helpers/includes"], function (_exports, _includes) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _includes.default;
    }
  });
  Object.defineProperty(_exports, "includes", {
    enumerable: true,
    get: function () {
      return _includes.includes;
    }
  });
});
;define("animations/helpers/intersect", ["exports", "ember-composable-helpers/helpers/intersect"], function (_exports, _intersect) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _intersect.default;
    }
  });
});
;define("animations/helpers/invoke", ["exports", "ember-composable-helpers/helpers/invoke"], function (_exports, _invoke) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _invoke.default;
    }
  });
  Object.defineProperty(_exports, "invoke", {
    enumerable: true,
    get: function () {
      return _invoke.invoke;
    }
  });
});
;define("animations/helpers/is-after", ["exports", "ember-moment/helpers/is-after"], function (_exports, _isAfter) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _isAfter.default;
    }
  });
});
;define("animations/helpers/is-array", ["exports", "ember-truth-helpers/helpers/is-array"], function (_exports, _isArray) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _isArray.default;
    }
  });
  Object.defineProperty(_exports, "isArray", {
    enumerable: true,
    get: function () {
      return _isArray.isArray;
    }
  });
});
;define("animations/helpers/is-before", ["exports", "ember-moment/helpers/is-before"], function (_exports, _isBefore) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _isBefore.default;
    }
  });
});
;define("animations/helpers/is-between", ["exports", "ember-moment/helpers/is-between"], function (_exports, _isBetween) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _isBetween.default;
    }
  });
});
;define("animations/helpers/is-component", ["exports", "ember-cli-is-component/helpers/is-component"], function (_exports, _isComponent) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _isComponent.default;
    }
  });
});
;define("animations/helpers/is-empty", ["exports", "ember-truth-helpers/helpers/is-empty"], function (_exports, _isEmpty) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _isEmpty.default;
    }
  });
});
;define("animations/helpers/is-equal", ["exports", "ember-truth-helpers/helpers/is-equal"], function (_exports, _isEqual) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _isEqual.default;
    }
  });
  Object.defineProperty(_exports, "isEqual", {
    enumerable: true,
    get: function () {
      return _isEqual.isEqual;
    }
  });
});
;define("animations/helpers/is-same-or-after", ["exports", "ember-moment/helpers/is-same-or-after"], function (_exports, _isSameOrAfter) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _isSameOrAfter.default;
    }
  });
});
;define("animations/helpers/is-same-or-before", ["exports", "ember-moment/helpers/is-same-or-before"], function (_exports, _isSameOrBefore) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _isSameOrBefore.default;
    }
  });
});
;define("animations/helpers/is-same", ["exports", "ember-moment/helpers/is-same"], function (_exports, _isSame) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _isSame.default;
    }
  });
});
;define("animations/helpers/join", ["exports", "ember-composable-helpers/helpers/join"], function (_exports, _join) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _join.default;
    }
  });
});
;define("animations/helpers/keys", ["exports", "ember-composable-helpers/helpers/keys"], function (_exports, _keys) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _keys.default;
    }
  });
  Object.defineProperty(_exports, "keys", {
    enumerable: true,
    get: function () {
      return _keys.keys;
    }
  });
});
;define("animations/helpers/lcm", ["exports", "ember-math-helpers/helpers/lcm"], function (_exports, _lcm) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _lcm.default;
    }
  });
  Object.defineProperty(_exports, "lcm", {
    enumerable: true,
    get: function () {
      return _lcm.lcm;
    }
  });
});
;define("animations/helpers/link", ["exports", "ember-link/helpers/link"], function (_exports, _link) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _link.default;
    }
  });
});
;define("animations/helpers/loc", ["exports", "@ember/string/helpers/loc"], function (_exports, _loc) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _loc.default;
    }
  });
  Object.defineProperty(_exports, "loc", {
    enumerable: true,
    get: function () {
      return _loc.loc;
    }
  });
});
;define("animations/helpers/local-class", ["exports", "ember-css-modules/helpers/local-class"], function (_exports, _localClass) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _localClass.default;
    }
  });
  Object.defineProperty(_exports, "localClass", {
    enumerable: true,
    get: function () {
      return _localClass.localClass;
    }
  });
});
;define("animations/helpers/log-e", ["exports", "ember-math-helpers/helpers/log-e"], function (_exports, _logE) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _logE.default;
    }
  });
  Object.defineProperty(_exports, "logE", {
    enumerable: true,
    get: function () {
      return _logE.logE;
    }
  });
});
;define("animations/helpers/log10", ["exports", "ember-math-helpers/helpers/log10"], function (_exports, _log) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _log.default;
    }
  });
  Object.defineProperty(_exports, "log10", {
    enumerable: true,
    get: function () {
      return _log.log10;
    }
  });
});
;define("animations/helpers/log1p", ["exports", "ember-math-helpers/helpers/log1p"], function (_exports, _log1p) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _log1p.default;
    }
  });
  Object.defineProperty(_exports, "log1p", {
    enumerable: true,
    get: function () {
      return _log1p.log1p;
    }
  });
});
;define("animations/helpers/log2", ["exports", "ember-math-helpers/helpers/log2"], function (_exports, _log) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _log.default;
    }
  });
  Object.defineProperty(_exports, "log2", {
    enumerable: true,
    get: function () {
      return _log.log2;
    }
  });
});
;define("animations/helpers/lowercase", ["exports", "ember-cli-string-helpers/helpers/lowercase"], function (_exports, _lowercase) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _lowercase.default;
    }
  });
  Object.defineProperty(_exports, "lowercase", {
    enumerable: true,
    get: function () {
      return _lowercase.lowercase;
    }
  });
});
;define("animations/helpers/lt", ["exports", "ember-truth-helpers/helpers/lt"], function (_exports, _lt) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _lt.default;
    }
  });
  Object.defineProperty(_exports, "lt", {
    enumerable: true,
    get: function () {
      return _lt.lt;
    }
  });
});
;define("animations/helpers/lte", ["exports", "ember-truth-helpers/helpers/lte"], function (_exports, _lte) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _lte.default;
    }
  });
  Object.defineProperty(_exports, "lte", {
    enumerable: true,
    get: function () {
      return _lte.lte;
    }
  });
});
;define("animations/helpers/map-by", ["exports", "ember-composable-helpers/helpers/map-by"], function (_exports, _mapBy) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _mapBy.default;
    }
  });
});
;define("animations/helpers/map", ["exports", "ember-composable-helpers/helpers/map"], function (_exports, _map) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _map.default;
    }
  });
});
;define("animations/helpers/max", ["exports", "ember-math-helpers/helpers/max"], function (_exports, _max) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _max.default;
    }
  });
  Object.defineProperty(_exports, "max", {
    enumerable: true,
    get: function () {
      return _max.max;
    }
  });
});
;define("animations/helpers/min", ["exports", "ember-math-helpers/helpers/min"], function (_exports, _min) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _min.default;
    }
  });
  Object.defineProperty(_exports, "min", {
    enumerable: true,
    get: function () {
      return _min.min;
    }
  });
});
;define("animations/helpers/mod", ["exports", "ember-math-helpers/helpers/mod"], function (_exports, _mod) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _mod.default;
    }
  });
  Object.defineProperty(_exports, "mod", {
    enumerable: true,
    get: function () {
      return _mod.mod;
    }
  });
});
;define("animations/helpers/moment-add", ["exports", "ember-moment/helpers/moment-add"], function (_exports, _momentAdd) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _momentAdd.default;
    }
  });
});
;define("animations/helpers/moment-calendar", ["exports", "ember-moment/helpers/moment-calendar"], function (_exports, _momentCalendar) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _momentCalendar.default;
    }
  });
});
;define("animations/helpers/moment-diff", ["exports", "ember-moment/helpers/moment-diff"], function (_exports, _momentDiff) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _momentDiff.default;
    }
  });
});
;define("animations/helpers/moment-duration", ["exports", "ember-moment/helpers/moment-duration"], function (_exports, _momentDuration) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _momentDuration.default;
    }
  });
});
;define("animations/helpers/moment-format", ["exports", "ember-moment/helpers/moment-format"], function (_exports, _momentFormat) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _momentFormat.default;
    }
  });
});
;define("animations/helpers/moment-from-now", ["exports", "ember-moment/helpers/moment-from-now"], function (_exports, _momentFromNow) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _momentFromNow.default;
    }
  });
});
;define("animations/helpers/moment-from", ["exports", "ember-moment/helpers/moment-from"], function (_exports, _momentFrom) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _momentFrom.default;
    }
  });
});
;define("animations/helpers/moment-subtract", ["exports", "ember-moment/helpers/moment-subtract"], function (_exports, _momentSubtract) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _momentSubtract.default;
    }
  });
});
;define("animations/helpers/moment-to-date", ["exports", "ember-moment/helpers/moment-to-date"], function (_exports, _momentToDate) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _momentToDate.default;
    }
  });
});
;define("animations/helpers/moment-to-now", ["exports", "ember-moment/helpers/moment-to-now"], function (_exports, _momentToNow) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _momentToNow.default;
    }
  });
});
;define("animations/helpers/moment-to", ["exports", "ember-moment/helpers/moment-to"], function (_exports, _momentTo) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _momentTo.default;
    }
  });
});
;define("animations/helpers/moment-unix", ["exports", "ember-moment/helpers/unix"], function (_exports, _unix) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _unix.default;
    }
  });
});
;define("animations/helpers/moment", ["exports", "ember-moment/helpers/moment"], function (_exports, _moment) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _moment.default;
    }
  });
});
;define("animations/helpers/mult", ["exports", "ember-math-helpers/helpers/mult"], function (_exports, _mult) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _mult.default;
    }
  });
  Object.defineProperty(_exports, "mult", {
    enumerable: true,
    get: function () {
      return _mult.mult;
    }
  });
});
;define("animations/helpers/next", ["exports", "ember-composable-helpers/helpers/next"], function (_exports, _next) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _next.default;
    }
  });
  Object.defineProperty(_exports, "next", {
    enumerable: true,
    get: function () {
      return _next.next;
    }
  });
});
;define("animations/helpers/noop", ["exports", "ember-composable-helpers/helpers/noop"], function (_exports, _noop) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _noop.default;
    }
  });
  Object.defineProperty(_exports, "noop", {
    enumerable: true,
    get: function () {
      return _noop.noop;
    }
  });
});
;define("animations/helpers/not-eq", ["exports", "ember-truth-helpers/helpers/not-equal"], function (_exports, _notEqual) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _notEqual.default;
    }
  });
  Object.defineProperty(_exports, "notEqualHelper", {
    enumerable: true,
    get: function () {
      return _notEqual.notEqualHelper;
    }
  });
});
;define("animations/helpers/not", ["exports", "ember-truth-helpers/helpers/not"], function (_exports, _not) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _not.default;
    }
  });
  Object.defineProperty(_exports, "not", {
    enumerable: true,
    get: function () {
      return _not.not;
    }
  });
});
;define("animations/helpers/now", ["exports", "ember-moment/helpers/now"], function (_exports, _now) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _now.default;
    }
  });
});
;define("animations/helpers/object-at", ["exports", "ember-composable-helpers/helpers/object-at"], function (_exports, _objectAt) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _objectAt.default;
    }
  });
  Object.defineProperty(_exports, "objectAt", {
    enumerable: true,
    get: function () {
      return _objectAt.objectAt;
    }
  });
});
;define("animations/helpers/on-key", ["exports", "ember-keyboard/helpers/on-key"], function (_exports, _onKey) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _onKey.default;
    }
  });
});
;define("animations/helpers/optional", ["exports", "ember-composable-helpers/helpers/optional"], function (_exports, _optional) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _optional.default;
    }
  });
  Object.defineProperty(_exports, "optional", {
    enumerable: true,
    get: function () {
      return _optional.optional;
    }
  });
});
;define("animations/helpers/or", ["exports", "ember-truth-helpers/helpers/or"], function (_exports, _or) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _or.default;
    }
  });
  Object.defineProperty(_exports, "or", {
    enumerable: true,
    get: function () {
      return _or.or;
    }
  });
});
;define("animations/helpers/page-title", ["exports", "ember-page-title/helpers/page-title"], function (_exports, _pageTitle) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;
  var _default = _pageTitle.default;
  _exports.default = _default;
});
;define("animations/helpers/percent-complete", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.percentComplete = percentComplete;
  _exports.default = void 0;

  function percentComplete(_params, {
    total,
    completed
  }) {
    let result = Math.round(completed / total * 100);

    if (isNaN(result)) {
      return 0;
    }

    return result;
  }

  var _default = Ember.Helper.helper(function () {
    return percentComplete(...arguments);
  });

  _exports.default = _default;
});
;define("animations/helpers/perform", ["exports", "ember-concurrency/helpers/perform"], function (_exports, _perform) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _perform.default;
    }
  });
});
;define("animations/helpers/pick", ["exports", "ember-composable-helpers/helpers/pick"], function (_exports, _pick) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _pick.default;
    }
  });
  Object.defineProperty(_exports, "pick", {
    enumerable: true,
    get: function () {
      return _pick.pick;
    }
  });
});
;define("animations/helpers/pipe-action", ["exports", "ember-composable-helpers/helpers/pipe-action"], function (_exports, _pipeAction) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _pipeAction.default;
    }
  });
});
;define("animations/helpers/pipe", ["exports", "ember-composable-helpers/helpers/pipe"], function (_exports, _pipe) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _pipe.default;
    }
  });
  Object.defineProperty(_exports, "pipe", {
    enumerable: true,
    get: function () {
      return _pipe.pipe;
    }
  });
});
;define("animations/helpers/pluralize", ["exports", "ember-inflector/lib/helpers/pluralize"], function (_exports, _pluralize) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;
  var _default = _pluralize.default;
  _exports.default = _default;
});
;define("animations/helpers/pow", ["exports", "ember-math-helpers/helpers/pow"], function (_exports, _pow) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _pow.default;
    }
  });
  Object.defineProperty(_exports, "pow", {
    enumerable: true,
    get: function () {
      return _pow.pow;
    }
  });
});
;define("animations/helpers/previous", ["exports", "ember-composable-helpers/helpers/previous"], function (_exports, _previous) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _previous.default;
    }
  });
  Object.defineProperty(_exports, "previous", {
    enumerable: true,
    get: function () {
      return _previous.previous;
    }
  });
});
;define("animations/helpers/queue", ["exports", "ember-composable-helpers/helpers/queue"], function (_exports, _queue) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _queue.default;
    }
  });
  Object.defineProperty(_exports, "queue", {
    enumerable: true,
    get: function () {
      return _queue.queue;
    }
  });
});
;define("animations/helpers/random", ["exports", "ember-math-helpers/helpers/random"], function (_exports, _random) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _random.default;
    }
  });
  Object.defineProperty(_exports, "random", {
    enumerable: true,
    get: function () {
      return _random.random;
    }
  });
});
;define("animations/helpers/range", ["exports", "ember-composable-helpers/helpers/range"], function (_exports, _range) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _range.default;
    }
  });
  Object.defineProperty(_exports, "range", {
    enumerable: true,
    get: function () {
      return _range.range;
    }
  });
});
;define("animations/helpers/reduce", ["exports", "ember-composable-helpers/helpers/reduce"], function (_exports, _reduce) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _reduce.default;
    }
  });
});
;define("animations/helpers/reject-by", ["exports", "ember-composable-helpers/helpers/reject-by"], function (_exports, _rejectBy) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _rejectBy.default;
    }
  });
});
;define("animations/helpers/repeat", ["exports", "ember-composable-helpers/helpers/repeat"], function (_exports, _repeat) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _repeat.default;
    }
  });
  Object.defineProperty(_exports, "repeat", {
    enumerable: true,
    get: function () {
      return _repeat.repeat;
    }
  });
});
;define("animations/helpers/reverse", ["exports", "ember-composable-helpers/helpers/reverse"], function (_exports, _reverse) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _reverse.default;
    }
  });
});
;define("animations/helpers/round", ["exports", "ember-math-helpers/helpers/round"], function (_exports, _round) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _round.default;
    }
  });
  Object.defineProperty(_exports, "round", {
    enumerable: true,
    get: function () {
      return _round.round;
    }
  });
});
;define("animations/helpers/shuffle", ["exports", "ember-composable-helpers/helpers/shuffle"], function (_exports, _shuffle) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _shuffle.default;
    }
  });
  Object.defineProperty(_exports, "shuffle", {
    enumerable: true,
    get: function () {
      return _shuffle.shuffle;
    }
  });
});
;define("animations/helpers/sign", ["exports", "ember-math-helpers/helpers/sign"], function (_exports, _sign) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _sign.default;
    }
  });
  Object.defineProperty(_exports, "sign", {
    enumerable: true,
    get: function () {
      return _sign.sign;
    }
  });
});
;define("animations/helpers/sin", ["exports", "ember-math-helpers/helpers/sin"], function (_exports, _sin) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _sin.default;
    }
  });
  Object.defineProperty(_exports, "sin", {
    enumerable: true,
    get: function () {
      return _sin.sin;
    }
  });
});
;define("animations/helpers/singularize", ["exports", "ember-inflector/lib/helpers/singularize"], function (_exports, _singularize) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;
  var _default = _singularize.default;
  _exports.default = _default;
});
;define("animations/helpers/slice", ["exports", "ember-composable-helpers/helpers/slice"], function (_exports, _slice) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _slice.default;
    }
  });
});
;define("animations/helpers/sort-by", ["exports", "ember-composable-helpers/helpers/sort-by"], function (_exports, _sortBy) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _sortBy.default;
    }
  });
});
;define("animations/helpers/sqrt", ["exports", "ember-math-helpers/helpers/sqrt"], function (_exports, _sqrt) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _sqrt.default;
    }
  });
  Object.defineProperty(_exports, "sqrt", {
    enumerable: true,
    get: function () {
      return _sqrt.sqrt;
    }
  });
});
;define("animations/helpers/sub", ["exports", "ember-math-helpers/helpers/sub"], function (_exports, _sub) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _sub.default;
    }
  });
  Object.defineProperty(_exports, "sub", {
    enumerable: true,
    get: function () {
      return _sub.sub;
    }
  });
});
;define("animations/helpers/svg-jar", ["exports", "ember-svg-jar/utils/make-helper", "ember-svg-jar/utils/make-svg"], function (_exports, _makeHelper, _makeSvg) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.svgJar = svgJar;
  _exports.default = void 0;

  function getInlineAsset(assetId) {
    try {
      /* eslint-disable global-require */
      return require(`ember-svg-jar/inlined/${assetId}`).default;
    } catch (err) {
      return null;
    }
  }

  function svgJar(assetId, svgAttrs) {
    return (0, _makeSvg.default)(assetId, svgAttrs, getInlineAsset);
  }

  var _default = (0, _makeHelper.default)(svgJar);

  _exports.default = _default;
});
;define("animations/helpers/take", ["exports", "ember-composable-helpers/helpers/take"], function (_exports, _take) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _take.default;
    }
  });
});
;define("animations/helpers/tan", ["exports", "ember-math-helpers/helpers/tan"], function (_exports, _tan) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _tan.default;
    }
  });
  Object.defineProperty(_exports, "tan", {
    enumerable: true,
    get: function () {
      return _tan.tan;
    }
  });
});
;define("animations/helpers/tanh", ["exports", "ember-math-helpers/helpers/tanh"], function (_exports, _tanh) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _tanh.default;
    }
  });
  Object.defineProperty(_exports, "tanh", {
    enumerable: true,
    get: function () {
      return _tanh.tanh;
    }
  });
});
;define("animations/helpers/task", ["exports", "ember-concurrency/helpers/task"], function (_exports, _task) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _task.default;
    }
  });
});
;define("animations/helpers/titleize", ["exports", "ember-cli-string-helpers/helpers/titleize"], function (_exports, _titleize) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _titleize.default;
    }
  });
  Object.defineProperty(_exports, "titleize", {
    enumerable: true,
    get: function () {
      return _titleize.titleize;
    }
  });
});
;define("animations/helpers/toggle-action", ["exports", "ember-composable-helpers/helpers/toggle-action"], function (_exports, _toggleAction) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _toggleAction.default;
    }
  });
});
;define("animations/helpers/toggle", ["exports", "ember-composable-helpers/helpers/toggle"], function (_exports, _toggle) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _toggle.default;
    }
  });
  Object.defineProperty(_exports, "toggle", {
    enumerable: true,
    get: function () {
      return _toggle.toggle;
    }
  });
});
;define("animations/helpers/trim", ["exports", "ember-cli-string-helpers/helpers/trim"], function (_exports, _trim) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _trim.default;
    }
  });
  Object.defineProperty(_exports, "trim", {
    enumerable: true,
    get: function () {
      return _trim.trim;
    }
  });
});
;define("animations/helpers/trunc", ["exports", "ember-math-helpers/helpers/trunc"], function (_exports, _trunc) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _trunc.default;
    }
  });
  Object.defineProperty(_exports, "trunc", {
    enumerable: true,
    get: function () {
      return _trunc.trunc;
    }
  });
});
;define("animations/helpers/truncate", ["exports", "ember-cli-string-helpers/helpers/truncate"], function (_exports, _truncate) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _truncate.default;
    }
  });
  Object.defineProperty(_exports, "truncate", {
    enumerable: true,
    get: function () {
      return _truncate.truncate;
    }
  });
});
;define("animations/helpers/underscore", ["exports", "ember-cli-string-helpers/helpers/underscore"], function (_exports, _underscore) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _underscore.default;
    }
  });
  Object.defineProperty(_exports, "underscore", {
    enumerable: true,
    get: function () {
      return _underscore.underscore;
    }
  });
});
;define("animations/helpers/union", ["exports", "ember-composable-helpers/helpers/union"], function (_exports, _union) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _union.default;
    }
  });
});
;define("animations/helpers/unix", ["exports", "ember-moment/helpers/unix"], function (_exports, _unix) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _unix.default;
    }
  });
});
;define("animations/helpers/uppercase", ["exports", "ember-cli-string-helpers/helpers/uppercase"], function (_exports, _uppercase) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _uppercase.default;
    }
  });
  Object.defineProperty(_exports, "uppercase", {
    enumerable: true,
    get: function () {
      return _uppercase.uppercase;
    }
  });
});
;define("animations/helpers/utc", ["exports", "ember-moment/helpers/utc"], function (_exports, _utc) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _utc.default;
    }
  });
  Object.defineProperty(_exports, "utc", {
    enumerable: true,
    get: function () {
      return _utc.utc;
    }
  });
});
;define("animations/helpers/values", ["exports", "ember-composable-helpers/helpers/values"], function (_exports, _values) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _values.default;
    }
  });
  Object.defineProperty(_exports, "values", {
    enumerable: true,
    get: function () {
      return _values.values;
    }
  });
});
;define("animations/helpers/w", ["exports", "ember-cli-string-helpers/helpers/w"], function (_exports, _w) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _w.default;
    }
  });
  Object.defineProperty(_exports, "w", {
    enumerable: true,
    get: function () {
      return _w.w;
    }
  });
});
;define("animations/helpers/without", ["exports", "ember-composable-helpers/helpers/without"], function (_exports, _without) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _without.default;
    }
  });
  Object.defineProperty(_exports, "without", {
    enumerable: true,
    get: function () {
      return _without.without;
    }
  });
});
;define("animations/helpers/xor", ["exports", "ember-truth-helpers/helpers/xor"], function (_exports, _xor) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _xor.default;
    }
  });
  Object.defineProperty(_exports, "xor", {
    enumerable: true,
    get: function () {
      return _xor.xor;
    }
  });
});
;define("animations/initializers/app-version", ["exports", "ember-cli-app-version/initializer-factory", "animations/config/environment"], function (_exports, _initializerFactory, _environment) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;
  let name, version;

  if (_environment.default.APP) {
    name = _environment.default.APP.name;
    version = _environment.default.APP.version;
  }

  var _default = {
    name: 'App Version',
    initialize: (0, _initializerFactory.default)(name, version)
  };
  _exports.default = _default;
});
;define("animations/initializers/container-debug-adapter", ["exports", "ember-resolver/resolvers/classic/container-debug-adapter"], function (_exports, _containerDebugAdapter) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;
  var _default = {
    name: 'container-debug-adapter',

    initialize() {
      let app = arguments[1] || arguments[0];
      app.register('container-debug-adapter:main', _containerDebugAdapter.default);
      app.inject('container-debug-adapter:main', 'namespace', 'application:main');
    }

  };
  _exports.default = _default;
});
;define("animations/initializers/debug", ["exports", "@html-next/vertical-collection/-debug"], function (_exports, _debug) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;
  var _default = {
    name: 'vertical-collection-debug',

    initialize() {}

  };
  _exports.default = _default;
});
;define("animations/initializers/ember-data-data-adapter", ["exports", "@ember-data/debug/setup"], function (_exports, _setup) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _setup.default;
    }
  });
});
;define("animations/initializers/ember-data", ["exports", "ember-data", "ember-data/setup-container"], function (_exports, _emberData, _setupContainer) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  /*
    This code initializes EmberData in an Ember application.
  
    It ensures that the `store` service is automatically injected
    as the `store` property on all routes and controllers.
  */
  var _default = {
    name: 'ember-data',
    initialize: _setupContainer.default
  };
  _exports.default = _default;
});
;define("animations/initializers/ember-keyboard-first-responder-inputs", ["exports", "ember-keyboard/initializers/ember-keyboard-first-responder-inputs"], function (_exports, _emberKeyboardFirstResponderInputs) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _emberKeyboardFirstResponderInputs.default;
    }
  });
  Object.defineProperty(_exports, "initialize", {
    enumerable: true,
    get: function () {
      return _emberKeyboardFirstResponderInputs.initialize;
    }
  });
});
;define("animations/initializers/ensure-local-class-included", ["exports", "ember-css-modules/templates/static-helpers-hack"], function (_exports, _staticHelpersHack) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;
  var _default = {
    initialize() {// This file exists to support Embroider's `staticHelpers` option.
      // ECM relies on the existence of a `local-class` helper, but that
      // helper may never be statically referenced in an application template.
      // Instead, we reference it in our own template, and then import that
      // template from a file (an initializer) that we know must always
      // be loaded in order to boot the app and/or run tests.
    }

  };
  _exports.default = _default;
});
;define("animations/initializers/export-application-global", ["exports", "animations/config/environment"], function (_exports, _environment) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.initialize = initialize;
  _exports.default = void 0;

  function initialize() {
    var application = arguments[1] || arguments[0];

    if (_environment.default.exportApplicationGlobal !== false) {
      var theGlobal;

      if (typeof window !== 'undefined') {
        theGlobal = window;
      } else if (typeof global !== 'undefined') {
        theGlobal = global;
      } else if (typeof self !== 'undefined') {
        theGlobal = self;
      } else {
        // no reasonable global, just bail
        return;
      }

      var value = _environment.default.exportApplicationGlobal;
      var globalName;

      if (typeof value === 'string') {
        globalName = value;
      } else {
        globalName = Ember.String.classify(_environment.default.modulePrefix);
      }

      if (!theGlobal[globalName]) {
        theGlobal[globalName] = application;
        application.reopen({
          willDestroy: function () {
            this._super.apply(this, arguments);

            delete theGlobal[globalName];
          }
        });
      }
    }
  }

  var _default = {
    name: 'export-application-global',
    initialize: initialize
  };
  _exports.default = _default;
});
;define("animations/initializers/user-agent", ["exports", "ember-useragent/initializers/user-agent"], function (_exports, _userAgent) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _userAgent.default;
    }
  });
  Object.defineProperty(_exports, "initialize", {
    enumerable: true,
    get: function () {
      return _userAgent.initialize;
    }
  });
});
;define("animations/instance-initializers/ember-data", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  /* exists only for things that historically used "after" or "before" */
  var _default = {
    name: 'ember-data',

    initialize() {}

  };
  _exports.default = _default;
});
;define("animations/models/changeset", ["exports", "animations/models/sprite-factory", "animations/models/sprite", "animations/models/context-aware-bounds"], function (_exports, _spriteFactory, _sprite, _contextAwareBounds) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  function union(...sets) {
    switch (sets.length) {
      case 0:
        return new Set();

      case 1:
        return new Set(sets[0]);

      default:
        // eslint-disable-next-line no-case-declarations
        let result = new Set();

        for (let set of sets) {
          for (let item of set) {
            result.add(item);
          }
        }

        return result;
    }
  }

  class Changeset {
    constructor(animationContext, intent) {
      _defineProperty(this, "context", void 0);

      _defineProperty(this, "intent", void 0);

      _defineProperty(this, "insertedSprites", new Set());

      _defineProperty(this, "removedSprites", new Set());

      _defineProperty(this, "keptSprites", new Set());

      this.context = animationContext;
      this.intent = intent;
    }

    spritesFor(criteria) {
      (true && !(criteria.type || criteria.role || criteria.id) && Ember.assert('expect spritesFor to be called with some criteria', criteria.type || criteria.role || criteria.id));
      let result;

      if (criteria.type) {
        switch (criteria.type) {
          case _sprite.SpriteType.Inserted:
            result = new Set(this.insertedSprites);
            break;

          case _sprite.SpriteType.Removed:
            result = new Set(this.removedSprites);
            break;

          case _sprite.SpriteType.Kept:
            result = new Set(this.keptSprites);
            break;
        }
      }

      result = result || union(this.keptSprites, this.insertedSprites, this.removedSprites);

      if (criteria.id) {
        for (let sprite of result) {
          if (sprite.id !== criteria.id) {
            result.delete(sprite);
          }
        }
      }

      if (criteria.role) {
        for (let sprite of result) {
          if (sprite.role !== criteria.role) {
            result.delete(sprite);
          }
        }
      }

      return result;
    }

    spriteFor(criteria) {
      let set = this.spritesFor(criteria);

      if (set.size > 1) {
        throw new Error(`More than one sprite found matching criteria ${criteria}`);
      }

      if (set.size === 0) {
        return null;
      }

      return [...set][0];
    }

    addInsertedSprites(freshlyAdded) {
      for (let spriteModifier of freshlyAdded) {
        this.insertedSprites.add(_spriteFactory.default.createInsertedSprite(spriteModifier, this.context));
      }
    }

    addRemovedSprites(freshlyRemoved) {
      for (let spriteModifier of freshlyRemoved) {
        this.removedSprites.add(_spriteFactory.default.createRemovedSprite(spriteModifier, this.context));
      }
    }

    addKeptSprites(freshlyChanged) {
      for (let spriteModifier of freshlyChanged) {
        this.keptSprites.add(_spriteFactory.default.createKeptSprite(spriteModifier, this.context));
      }
    }

    finalizeSpriteCategories() {
      let insertedSpritesArr = [...this.insertedSprites];
      let removedSpritesArr = [...this.removedSprites];
      let insertedIds = insertedSpritesArr.map(s => s.identifier);
      let removedIds = removedSpritesArr.map(s => s.identifier);
      let intersectingIds = insertedIds.filter(identifier => !!removedIds.find(o => o.equals(identifier)));

      for (let intersectingId of intersectingIds) {
        let removedSprites = removedSpritesArr.filter(s => s.identifier.equals(intersectingId));
        let insertedSprite = insertedSpritesArr.find(s => s.identifier.equals(intersectingId));

        if (!insertedSprite || removedSprites.length === 0) {
          throw new Error('intersection check should always result in removedSprite and insertedSprite being found');
        }

        this.insertedSprites.delete(insertedSprite); // TODO: verify if this is correct, we might need to handle it on a different level.
        //  We only get multiple ones in case of an interruption.

        (true && !(removedSprites.length < 2) && Ember.assert('Multiple matching removedSprites found', removedSprites.length < 2));
        let removedSprite = removedSprites[0];

        if (this.context.hasOrphan(removedSprite.element)) {
          this.context.removeOrphan(removedSprite.element);
        }

        this.removedSprites.delete(removedSprite);
        insertedSprite.type = _sprite.SpriteType.Kept;
        insertedSprite.initialBounds = removedSprite.initialBounds;
        insertedSprite.initialComputedStyle = removedSprite.initialComputedStyle;
        removedSprite.finalBounds = insertedSprite.finalBounds;
        removedSprite.finalComputedStyle = insertedSprite.finalComputedStyle;
        insertedSprite.counterpart = removedSprite;
        this.keptSprites.add(insertedSprite);
      }
    }

    addIntermediateSprites(intermediateSprites) {
      if (intermediateSprites.size) {
        for (let sprite of [...this.insertedSprites, ...this.removedSprites, ...this.keptSprites]) {
          let interruptedSprites = [...intermediateSprites].filter(is => is.identifier.equals(sprite.identifier)); // If more than 1 matching IntermediateSprite is found, we warn but also guess the last one is correct

          if (interruptedSprites.length > 1) {
            console.warn(`${interruptedSprites.length} matching interruptedSprites found where 1 was expected`, interruptedSprites);
          }

          let interruptedSprite = interruptedSprites[interruptedSprites.length - 1]; // TODO: we might need to set the bounds on the counterpart of
          //  keptSprites only, not magically modify them for "new" sprites.

          if (interruptedSprite) {
            // TODO: fix this
            if (!interruptedSprite.initialBounds) {
              (true && !(false) && Ember.assert('interruptedSprite should always have initialBounds'));
              return;
            }

            if (!sprite.initialBounds?.parent) {
              (true && !(false) && Ember.assert('sprite should always have initialBounds'));
              return;
            }

            if (sprite.counterpart) {
              (true && !(sprite.counterpart?.initialBounds) && Ember.assert('sprite counterpart should always have initialBounds', sprite.counterpart?.initialBounds)); // set the interrupted state as the initial state of the counterpart

              sprite.counterpart.initialBounds = new _contextAwareBounds.default({
                element: interruptedSprite.initialBounds.element,
                contextElement: sprite.counterpart.initialBounds.parent
              });
              sprite.initialComputedStyle = interruptedSprite.initialComputedStyle;
            } else {
              sprite.initialBounds = interruptedSprite.initialBounds;
              sprite.initialComputedStyle = interruptedSprite.initialComputedStyle;
            }
          }
        }
      }
    }

  }

  _exports.default = Changeset;
});
;define("animations/models/context-aware-bounds", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  class ContextAwareBounds {
    constructor({
      element,
      contextElement
    }) {
      _defineProperty(this, "element", void 0);

      _defineProperty(this, "parent", void 0);

      _defineProperty(this, "velocity", {
        x: 0,
        y: 0,
        width: 0,
        height: 0
      });

      this.element = element;
      this.parent = contextElement;
    }

    get relativeToContext() {
      let {
        element,
        parent
      } = this;
      return new DOMRect(element.left - parent.left, element.top - parent.top, element.width, element.height);
    }

    relativeToPosition({
      left,
      top
    }) {
      let {
        element
      } = this;
      return new DOMRect(this.element.left - left, this.element.top - top, element.width, element.height);
    }

    isEqualTo(other) {
      let parentLeftChange = other.parent.left - this.parent.left;
      let parentTopChange = other.parent.top - this.parent.top;
      return other.element.left - this.element.left - parentLeftChange === 0 && other.element.top - this.element.top - parentTopChange === 0 && other.element.width - this.element.width === 0 && other.element.height - this.element.height === 0;
    }

  }

  _exports.default = ContextAwareBounds;
});
;define("animations/models/sprite-animation", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.SpriteAnimation = void 0;

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  /**
   * Animates a sprite. By default, the animation is paused and must be started manually by calling `play()`.
   */
  class SpriteAnimation {
    constructor(sprite, keyframes, keyframeAnimationOptions) {
      _defineProperty(this, "animation", void 0);

      this.animation = sprite.element.animate(keyframes, keyframeAnimationOptions);
      this.animation.pause(); // TODO: we likely don't need this anymore now that we measure beforehand

      /*if (sprite.type === SpriteType.Removed && keyframes.length) {
        let lastKeyframe: Keyframe = keyframes[keyframes.length - 1];
        for (let [property, value] of Object.entries(lastKeyframe)) {
          // TODO: fix typescript issue, lib.dom.d.ts seems to only accept numbers here
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          sprite.element.style[property] = value;
          console.log(property, value);
        }
      }*/
    }

    play() {
      this.animation.play();
    }

    get finished() {
      return this.animation.finished;
    }

  }

  _exports.SpriteAnimation = SpriteAnimation;
});
;define("animations/models/sprite-factory", ["exports", "animations/models/sprite", "animations/models/context-aware-bounds"], function (_exports, _sprite, _contextAwareBounds) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;
  var _default = {
    createInsertedSprite(spriteModifier, context) {
      let sprite = new _sprite.default(spriteModifier.element, spriteModifier.id, spriteModifier.role, _sprite.SpriteType.Inserted);
      (true && !(spriteModifier.currentBounds && context.currentBounds) && Ember.assert('inserted sprite should have currentBounds', spriteModifier.currentBounds && context.currentBounds));
      sprite.finalBounds = new _contextAwareBounds.default({
        element: spriteModifier.currentBounds,
        contextElement: context.currentBounds
      });
      sprite.finalComputedStyle = spriteModifier.currentComputedStyle;
      return sprite;
    },

    createRemovedSprite(spriteModifier, context) {
      let sprite = new _sprite.default(spriteModifier.element, spriteModifier.id, spriteModifier.role, _sprite.SpriteType.Removed);
      (true && !(spriteModifier.currentBounds && context.lastBounds) && Ember.assert('removed sprite should have currentBounds', spriteModifier.currentBounds && context.lastBounds));
      sprite.initialBounds = new _contextAwareBounds.default({
        element: spriteModifier.currentBounds,
        contextElement: context.lastBounds
      });
      sprite.initialComputedStyle = spriteModifier.currentComputedStyle;
      return sprite;
    },

    createKeptSprite(spriteModifier, context) {
      let sprite = new _sprite.default(spriteModifier.element, spriteModifier.id, spriteModifier.role, _sprite.SpriteType.Kept);
      (true && !(spriteModifier.lastBounds && context.lastBounds && spriteModifier.currentBounds && context.currentBounds) && Ember.assert('kept sprite should have lastBounds and currentBounds', spriteModifier.lastBounds && context.lastBounds && spriteModifier.currentBounds && context.currentBounds));
      sprite.initialBounds = new _contextAwareBounds.default({
        element: spriteModifier.lastBounds,
        contextElement: context.lastBounds
      });
      sprite.finalBounds = new _contextAwareBounds.default({
        element: spriteModifier.currentBounds,
        contextElement: context.currentBounds
      });
      sprite.initialComputedStyle = spriteModifier.lastComputedStyle;
      sprite.finalComputedStyle = spriteModifier.currentComputedStyle;
      return sprite;
    },

    createIntermediateSprite(spriteModifier) {
      return new _sprite.default(spriteModifier.element, spriteModifier.id, spriteModifier.role, _sprite.SpriteType.Intermediate);
    }

  };
  _exports.default = _default;
});
;define("animations/models/sprite-tree", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = _exports.SpriteTreeNode = _exports.SpriteTreeNodeType = void 0;

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  let SpriteTreeNodeType;
  _exports.SpriteTreeNodeType = SpriteTreeNodeType;

  (function (SpriteTreeNodeType) {
    SpriteTreeNodeType[SpriteTreeNodeType["Root"] = 0] = "Root";
    SpriteTreeNodeType[SpriteTreeNodeType["Context"] = 1] = "Context";
    SpriteTreeNodeType[SpriteTreeNodeType["Sprite"] = 2] = "Sprite";
  })(SpriteTreeNodeType || (_exports.SpriteTreeNodeType = SpriteTreeNodeType = {}));

  class SpriteTreeNode {
    constructor(model, nodeType, parentNode) {
      _defineProperty(this, "model", void 0);

      _defineProperty(this, "parent", void 0);

      _defineProperty(this, "children", new Set());

      _defineProperty(this, "freshlyRemovedChildren", new Set());

      _defineProperty(this, "nodeType", void 0);

      this.model = model;
      this.nodeType = nodeType;
      this.parent = parentNode;
      parentNode.addChild(this);
    }

    get isRoot() {
      return this.parent instanceof SpriteTree;
    }

    get element() {
      return this.model.element;
    }

    get ancestors() {
      let result = [];
      let node = this;

      while (node.parent) {
        if (node.parent instanceof SpriteTree) break;
        (true && !(node instanceof SpriteTreeNode) && Ember.assert('if not the tree, it is a node', node instanceof SpriteTreeNode));
        result.push(node.parent);
        node = node.parent;
      }

      return result;
    }

    getDescendantNodes(opts = {
      includeFreshlyRemoved: false
    }) {
      let result = [];
      let children = this.children;

      if (opts.includeFreshlyRemoved) {
        children = new Set([...children, ...this.freshlyRemovedChildren]);
      }

      for (let childNode of children) {
        result.push(childNode);
        result = result.concat(childNode.getDescendantNodes(opts));
      }

      return result;
    }

    freshlyRemovedDescendants(stopNode) {
      let result = [];

      for (let childNode of this.freshlyRemovedChildren) {
        result.push(childNode.model);
      }

      let allChildren = [...this.children].concat([...this.freshlyRemovedChildren]);

      for (let childNode of allChildren) {
        if (childNode === stopNode) continue;
        result = result.concat(childNode.freshlyRemovedDescendants(stopNode));
      }

      return result;
    }

    clearFreshlyRemovedChildren() {
      for (let rootNode of this.children) {
        rootNode.freshlyRemovedChildren.clear();
        rootNode.clearFreshlyRemovedChildren();
      }
    }

    addChild(childNode) {
      this.children.add(childNode);
    }

    removeChild(childNode) {
      this.children.delete(childNode);
      this.freshlyRemovedChildren.add(childNode);
    }

  }

  _exports.SpriteTreeNode = SpriteTreeNode;

  class SpriteTree {
    constructor() {
      _defineProperty(this, "model", null);

      _defineProperty(this, "nodeType", SpriteTreeNodeType.Root);

      _defineProperty(this, "nodesByElement", new WeakMap());

      _defineProperty(this, "rootNodes", new Set());
    }

    addAnimationContext(context) {
      let parentNode = this.findParentNode(context.element);
      let node = new SpriteTreeNode(context, SpriteTreeNodeType.Context, parentNode || this);
      this.nodesByElement.set(context.element, node);
      return node;
    }

    removeAnimationContext(context) {
      let node = this.lookupNodeByElement(context.element);

      if (node) {
        node.parent?.removeChild(node);
        this.nodesByElement.delete(context.element);
      }
    }

    addSpriteModifier(spriteModifier) {
      let parentNode = this.findParentNode(spriteModifier.element);
      let node = new SpriteTreeNode(spriteModifier, SpriteTreeNodeType.Sprite, parentNode || this);
      this.nodesByElement.set(spriteModifier.element, node);
      return node;
    }

    removeSpriteModifier(spriteModifer) {
      let node = this.lookupNodeByElement(spriteModifer.element);

      if (node) {
        node.parent?.removeChild(node);
        this.nodesByElement.delete(spriteModifer.element);
      }
    }

    lookupNodeByElement(element) {
      return this.nodesByElement.get(element);
    }

    descendantsOf(model, opts = {
      includeFreshlyRemoved: false
    }) {
      let node = this.lookupNodeByElement(model.element);

      if (node) {
        return node.getDescendantNodes(opts).map(n => n.model);
      } else {
        return [];
      }
    }

    farMatchCandidatesFor(context) {
      // all freshlyRemovedChildren except those under given context node
      let result = [];
      let contextNode = this.lookupNodeByElement(context.element);

      if (!contextNode) {
        return [];
      }

      for (let rootNode of this.rootNodes) {
        if (rootNode === contextNode) continue;
        result = result.concat(rootNode.freshlyRemovedDescendants(contextNode));
      }

      return result;
    }

    getContextRunList(requestedContexts) {
      let result = [];

      for (let context of requestedContexts) {
        if (result.indexOf(context) !== -1) continue;
        result.unshift(context);
        let node = this.lookupNodeByElement(context.element);
        let ancestor = node && node.parent;

        while (ancestor) {
          if (ancestor.nodeType === SpriteTreeNodeType.Context) {
            if (result.indexOf(ancestor.model) === -1) {
              result.push(ancestor.model);
            }
          }

          ancestor = ancestor.parent;
        }
      }

      return result;
    }

    clearFreshlyRemovedChildren() {
      for (let rootNode of this.rootNodes) {
        rootNode.freshlyRemovedChildren.clear();
        rootNode.clearFreshlyRemovedChildren();
      }
    }

    addChild(rootNode) {
      for (let existingRootNode of this.rootNodes) {
        if (rootNode.element.contains(existingRootNode.element)) {
          this.removeChild(existingRootNode);
          existingRootNode.parent = rootNode;
          rootNode.addChild(existingRootNode);
        }
      }

      this.rootNodes.add(rootNode);
    }

    removeChild(rootNode) {
      this.rootNodes.delete(rootNode);
    }

    findParentNode(element) {
      while (element.parentElement) {
        let node = this.lookupNodeByElement(element.parentElement);

        if (node) {
          return node;
        }

        element = element.parentElement;
      }

      return null;
    }

  }

  _exports.default = SpriteTree;
});
;define("animations/models/sprite", ["exports", "animations/models/context-aware-bounds", "animations/utils/measurement", "animations/models/sprite-animation", "animations/motions/opacity", "animations/motions/move", "animations/motions/resize", "animations/motions/css-motion", "animations/behaviors/base", "animations/behaviors/spring", "animations/behaviors/linear"], function (_exports, _contextAwareBounds, _measurement, _spriteAnimation, _opacity, _move, _resize, _cssMotion, _base, _spring, _linear) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.SpriteType = _exports.default = void 0;

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  class SpriteIdentifier {
    constructor(id, role) {
      _defineProperty(this, "id", void 0);

      _defineProperty(this, "role", void 0);

      this.id = id;
      this.role = role;
    }

    equals(other) {
      return this.id === other.id && this.role === other.role;
    }

  }

  class Sprite {
    // the sent sprite if this is the received sprite, or vice versa
    constructor(element, id, role, type) {
      _defineProperty(this, "element", void 0);

      _defineProperty(this, "identifier", void 0);

      _defineProperty(this, "type", null);

      _defineProperty(this, "initialBounds", void 0);

      _defineProperty(this, "finalBounds", void 0);

      _defineProperty(this, "initialComputedStyle", void 0);

      _defineProperty(this, "finalComputedStyle", void 0);

      _defineProperty(this, "counterpart", null);

      _defineProperty(this, "motions", []);

      _defineProperty(this, "time", void 0);

      _defineProperty(this, "hidden", false);

      this.element = element;
      this.identifier = new SpriteIdentifier(id, role);
      this.type = type;
      this.time = new Date().getTime();
    }

    get id() {
      return this.identifier.id;
    }

    get role() {
      return this.identifier.role;
    }

    get initialWidth() {
      return this.initialBounds?.element.width;
    }

    get initialHeight() {
      return this.initialBounds?.element.height;
    }

    get finalHeight() {
      return this.finalBounds?.element.height;
    }

    get finalWidth() {
      return this.finalBounds?.element.width;
    }

    get boundsDelta() {
      if (!this.initialBounds || !this.finalBounds) {
        return undefined;
      }

      let initialBounds = this.initialBounds.relativeToContext;
      let finalBounds = this.finalBounds.relativeToContext;
      return {
        x: finalBounds.left - initialBounds.left,
        y: finalBounds.top - initialBounds.top,
        width: finalBounds.width - initialBounds.width,
        height: finalBounds.height - initialBounds.height
      };
    }

    get canBeGarbageCollected() {
      return this.type === SpriteType.Removed && this.hidden;
    }

    captureAnimatingBounds(contextElement) {
      let result = new _contextAwareBounds.default({
        element: (0, _measurement.getDocumentPosition)(this.element, {
          withAnimations: true
        }),
        contextElement: (0, _measurement.getDocumentPosition)(contextElement, {
          withAnimations: true
        })
      });
      let priorElementBounds = (0, _measurement.getDocumentPosition)(this.element, {
        withAnimationOffset: -100
      }); // TODO: extract actual precalculated velocity instead of guesstimating

      result.velocity = (0, _measurement.calculateBoundsVelocity)(priorElementBounds, result.element, 100);
      return result;
    }

    lockStyles(bounds = null) {
      if (!bounds) {
        if (this.initialBounds) {
          bounds = this.initialBounds.relativeToContext;
        } else {
          bounds = {
            left: 0,
            top: 0,
            width: 0,
            height: 0
          };
        }
      }

      this.element.style.position = 'absolute';
      this.element.style.left = bounds.left + 'px';
      this.element.style.top = bounds.top + 'px';

      if (bounds.width) {
        this.element.style.width = bounds.width + 'px';
      }

      if (bounds.height) {
        this.element.style.height = bounds.height + 'px';
      }
    }

    unlockStyles() {
      this.element.style.removeProperty('position');
      this.element.style.removeProperty('left');
      this.element.style.removeProperty('top');
      this.element.style.removeProperty('width');
      this.element.style.removeProperty('height');
      this.element.style.removeProperty('opacity');
    } // hidden things get dropped at interruption


    hide() {
      this.hidden = true;
      this.element.style.opacity = '0';
      this.element.setAttribute('data-sprite-hidden', 'true');
      this.element.getAnimations().forEach(a => a.cancel());
      this.motions = [];
    }

    setupAnimation(property, opts) {
      // TODO: this applies to any "non-Tween" based behavior, currently only Spring
      (true && !(opts.duration === undefined && opts.behavior instanceof _spring.default || !(opts.behavior instanceof _spring.default)) && Ember.assert('Passing a duration is not necessary when using a Spring behavior', opts.duration === undefined && opts.behavior instanceof _spring.default || !(opts.behavior instanceof _spring.default))); // TODO: this applies to any "Tween" based behavior, currently only Linear

      (true && !(opts.duration !== undefined && opts.behavior instanceof _linear.default || !(opts.behavior instanceof _linear.default)) && Ember.assert('You must pass a duration when using a Linear behavior', opts.duration !== undefined && opts.behavior instanceof _linear.default || !(opts.behavior instanceof _linear.default)));

      switch (property) {
        case 'opacity':
          this.motions.push(new _opacity.Opacity(this, opts));
          break;

        case 'position':
          this.motions.push(new _move.Move(this, opts));
          break;

        case 'size':
          this.motions.push(new _resize.Resize(this, opts));
          break;

        case 'style':
          this.motions.push(new _cssMotion.CssMotion(this, opts));
          break;

        default:
          // noop
          break;
      }
    }

    compileAnimation({
      time
    } = {}) {
      if (!this.motions.length) {
        return;
      }

      (true && !(!this.hidden) && Ember.assert('Hidden sprite cannot be animated', !this.hidden));
      let keyframes = this.motions.reduce((previousKeyframes, motion) => {
        motion.applyBehavior(time);
        let count = Math.max(previousKeyframes.length, motion.keyframes.length);
        let result = [];

        for (let i = 0; i < count; i++) {
          // TODO: this merge algorithm is too naïve, it implies we can have only 1 of each CSS property or it will be overridden
          // we copy the final frame of a motion if there is another motion that takes longer
          result.push({ ...(previousKeyframes?.[i] ?? previousKeyframes[previousKeyframes.length - 1]),
            ...(motion.keyframes?.[i] ?? motion.keyframes[motion.keyframes.length - 1])
          });
        }

        return result;
      }, []); // We can clear these as we've compiled them already.

      this.motions = []; // calculate "real" duration based on amount of keyframes at the given FPS

      let duration = Math.max(0, (keyframes.length - 1) / _base.FPS);
      let keyframeAnimationOptions = {
        easing: 'linear',
        duration
      };
      return new _spriteAnimation.SpriteAnimation(this, keyframes, keyframeAnimationOptions);
    }

    startAnimation({
      time
    } = {}) {
      console.warn('Calling Sprite.startAnimation is deprecated, please use the runAnimations util.');
      let spriteAnimation = this.compileAnimation({
        time
      });
      spriteAnimation.play();
      return spriteAnimation;
    }

  }

  _exports.default = Sprite;
  let SpriteType;
  _exports.SpriteType = SpriteType;

  (function (SpriteType) {
    SpriteType["Inserted"] = "inserted";
    SpriteType["Removed"] = "removed";
    SpriteType["Kept"] = "kept";
    SpriteType["Intermediate"] = "intermediate";
  })(SpriteType || (_exports.SpriteType = SpriteType = {}));
});
;define("animations/models/transition-runner", ["exports", "ember-concurrency-decorators", "animations/models/changeset", "animations/models/sprite", "animations/modifiers/sprite"], function (_exports, _emberConcurrencyDecorators, _changeset, _sprite, _sprite2) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _class, _temp;

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  function _applyDecoratedDescriptor(target, property, decorators, descriptor, context) { var desc = {}; Object.keys(descriptor).forEach(function (key) { desc[key] = descriptor[key]; }); desc.enumerable = !!desc.enumerable; desc.configurable = !!desc.configurable; if ('value' in desc || desc.initializer) { desc.writable = true; } desc = decorators.slice().reverse().reduce(function (desc, decorator) { return decorator(target, property, desc) || desc; }, desc); if (context && desc.initializer !== void 0) { desc.value = desc.initializer ? desc.initializer.call(context) : void 0; desc.initializer = undefined; } if (desc.initializer === void 0) { Object.defineProperty(target, property, desc); desc = null; } return desc; }

  function checkForChanges(spriteModifier, animationContext) {
    spriteModifier.captureSnapshot();
    let spriteCurrent = spriteModifier.currentBounds;
    let spriteLast = spriteModifier.lastBounds;
    let contextCurrent = animationContext.currentBounds;
    let contextLast = animationContext.lastBounds;

    if (spriteCurrent && spriteLast && contextCurrent && contextLast) {
      let parentLeftChange = contextCurrent.left - contextLast.left;
      let parentTopChange = contextCurrent.top - contextLast.top;
      return spriteCurrent.left - spriteLast.left - parentLeftChange !== 0 || spriteCurrent.top - spriteLast.top - parentTopChange !== 0 || spriteCurrent.width - spriteLast.width !== 0 || spriteCurrent.height - spriteLast.height !== 0;
    }

    return true;
  }

  let TransitionRunner = (_class = (_temp = class TransitionRunner {
    constructor(animationContext, opts) {
      _defineProperty(this, "animationContext", void 0);

      _defineProperty(this, "spriteTree", void 0);

      _defineProperty(this, "freshlyAdded", void 0);

      _defineProperty(this, "freshlyRemoved", void 0);

      _defineProperty(this, "intent", void 0);

      _defineProperty(this, "freshlyChanged", new Set());

      _defineProperty(this, "intermediateSprites", void 0);

      this.animationContext = animationContext;
      this.spriteTree = opts.spriteTree;
      this.freshlyAdded = opts.freshlyAdded;
      this.freshlyRemoved = opts.freshlyRemoved;
      this.intent = opts.intent;
      this.intermediateSprites = opts.intermediateSprites ?? new Set();
    }

    filterToContext(spriteModifiers, opts = {
      includeFreshlyRemoved: false
    }) {
      let contextDescendants = this.spriteTree.descendantsOf(this.animationContext, opts);
      let result = new Set([...spriteModifiers].filter(m => contextDescendants.includes(m)));
      return result;
    } // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types


    *maybeTransitionTask() {
      let {
        animationContext
      } = this;
      animationContext.captureSnapshot();
      let contextDescendants = this.spriteTree.descendantsOf(animationContext);

      for (let contextDescendant of contextDescendants) {
        if (contextDescendant instanceof _sprite2.default) {
          let spriteModifier = contextDescendant;

          if (checkForChanges(spriteModifier, animationContext)) {
            this.freshlyChanged.add(spriteModifier);
          }
        }
      }

      let freshlyAdded = this.filterToContext(this.freshlyAdded);
      let freshlyRemoved = this.filterToContext(this.freshlyRemoved, {
        includeFreshlyRemoved: true
      });

      if (this.freshlyChanged.size === 0 && freshlyAdded.size === 0 && freshlyRemoved.size === 0) {
        return;
      }

      let changeset = new _changeset.default(animationContext, this.intent);
      changeset.addInsertedSprites(freshlyAdded);
      changeset.addRemovedSprites(freshlyRemoved);
      changeset.addKeptSprites(this.freshlyChanged);
      changeset.finalizeSpriteCategories();
      changeset.addIntermediateSprites(this.intermediateSprites);

      if (animationContext.shouldAnimate(changeset)) {
        this.logChangeset(changeset, animationContext); // For debugging

        let animation = animationContext.args.use?.(changeset);

        try {
          yield Promise.resolve(animation);
        } catch (error) {
          console.error(error);
          throw error;
        }

        animationContext.clearOrphans();
        animationContext.captureSnapshot(); // TODO: This is likely not needed anymore now that we measure beforehand

        /*let contextDescendants = this.spriteTree.descendantsOf(animationContext);
        for (let contextDescendant of contextDescendants) {
          if (contextDescendant instanceof SpriteModifier) {
            (contextDescendant as SpriteModifier).captureSnapshot();
          }
        }*/
      }

      animationContext.isInitialRenderCompleted = true;
    }

    logChangeset(changeset, animationContext) {
      let contextId = animationContext.args.id;

      function row(type, sprite) {
        return {
          intent: changeset.intent,
          context: contextId,
          type,
          spriteRole: sprite.role,
          spriteId: sprite.id,
          initialBounds: sprite.initialBounds ? JSON.stringify(sprite.initialBounds) : null,
          finalBounds: sprite.finalBounds ? JSON.stringify(sprite.finalBounds) : null
        };
      }

      let tableRows = [];

      for (let type of [_sprite.SpriteType.Inserted, _sprite.SpriteType.Removed, _sprite.SpriteType.Kept]) {
        for (let sprite of changeset.spritesFor({
          type
        })) {
          tableRows.push(row(type, sprite));
        }
      }

      console.table(tableRows);
    }

  }, _temp), (_applyDecoratedDescriptor(_class.prototype, "maybeTransitionTask", [_emberConcurrencyDecorators.task], Object.getOwnPropertyDescriptor(_class.prototype, "maybeTransitionTask"), _class.prototype)), _class);
  _exports.default = TransitionRunner;
});
;define("animations/modifiers/did-insert", ["exports", "@ember/render-modifiers/modifiers/did-insert"], function (_exports, _didInsert) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _didInsert.default;
    }
  });
});
;define("animations/modifiers/did-update", ["exports", "@ember/render-modifiers/modifiers/did-update"], function (_exports, _didUpdate) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _didUpdate.default;
    }
  });
});
;define("animations/modifiers/keyboard-shortcut", ["exports", "ember-keyboard/deprecated/modifiers/keyboard-shortcut"], function (_exports, _keyboardShortcut) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _keyboardShortcut.default;
    }
  });
});
;define("animations/modifiers/observe-mutation", ["exports", "ember-mutation-observer-modifier/modifiers/observe-mutation"], function (_exports, _observeMutation) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _observeMutation.default;
    }
  });
});
;define("animations/modifiers/on-key", ["exports", "ember-keyboard/modifiers/on-key"], function (_exports, _onKey) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _onKey.default;
    }
  });
});
;define("animations/modifiers/on-keyboard", ["exports", "ember-keyboard/deprecated/modifiers/on-keyboard"], function (_exports, _onKeyboard) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _onKeyboard.default;
    }
  });
});
;define("animations/modifiers/sprite", ["exports", "ember-modifier", "animations/utils/measurement"], function (_exports, _emberModifier, _measurement) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _dec, _class, _descriptor, _temp;

  function _initializerDefineProperty(target, property, descriptor, context) { if (!descriptor) return; Object.defineProperty(target, property, { enumerable: descriptor.enumerable, configurable: descriptor.configurable, writable: descriptor.writable, value: descriptor.initializer ? descriptor.initializer.call(context) : void 0 }); }

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  function _applyDecoratedDescriptor(target, property, decorators, descriptor, context) { var desc = {}; Object.keys(descriptor).forEach(function (key) { desc[key] = descriptor[key]; }); desc.enumerable = !!desc.enumerable; desc.configurable = !!desc.configurable; if ('value' in desc || desc.initializer) { desc.writable = true; } desc = decorators.slice().reverse().reduce(function (desc, decorator) { return decorator(target, property, desc) || desc; }, desc); if (context && desc.initializer !== void 0) { desc.value = desc.initializer ? desc.initializer.call(context) : void 0; desc.initializer = undefined; } if (desc.initializer === void 0) { Object.defineProperty(target, property, desc); desc = null; } return desc; }

  function _initializerWarningHelper(descriptor, context) { throw new Error('Decorating class property failed. Please ensure that ' + 'proposal-class-properties is enabled and runs after the decorators transform.'); }

  let SpriteModifier = (_dec = Ember.inject.service, (_class = (_temp = class SpriteModifier extends _emberModifier.default {
    constructor(...args) {
      super(...args);

      _defineProperty(this, "id", null);

      _defineProperty(this, "role", null);

      _defineProperty(this, "lastBounds", void 0);

      _defineProperty(this, "currentBounds", void 0);

      _defineProperty(this, "lastComputedStyle", void 0);

      _defineProperty(this, "currentComputedStyle", void 0);

      _defineProperty(this, "farMatch", void 0);

      _defineProperty(this, "alreadyTracked", false);

      _initializerDefineProperty(this, "animations", _descriptor, this);
    }

    didReceiveArguments() {
      this.id = this.args.named.id;
      this.role = this.args.named.role;
      this.animations.registerSpriteModifier(this);
      this.captureSnapshot();
    }

    captureSnapshot() {
      if (!this.alreadyTracked) {
        let {
          element
        } = this;
        (true && !(element instanceof HTMLElement) && Ember.assert('sprite modifier can only be installed on HTML elements', element instanceof HTMLElement));
        this.lastBounds = this.currentBounds;
        this.lastComputedStyle = this.currentComputedStyle;
        this.currentBounds = (0, _measurement.getDocumentPosition)(element);
        this.currentComputedStyle = (0, _measurement.copyComputedStyle)(element);
        this.alreadyTracked = true;
      }

      Ember.run.once(this, 'clearTrackedPosition');
    }

    clearTrackedPosition() {
      this.alreadyTracked = false;
    }

    willRemove() {
      this.animations.unregisterSpriteModifier(this);
    }

  }, _temp), (_descriptor = _applyDecoratedDescriptor(_class.prototype, "animations", [_dec], {
    configurable: true,
    enumerable: true,
    writable: true,
    initializer: null
  })), _class));
  _exports.default = SpriteModifier;
});
;define("animations/modifiers/style", ["exports", "ember-style-modifier/modifiers/style"], function (_exports, _style) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _style.default;
    }
  });
});
;define("animations/modifiers/will-destroy", ["exports", "@ember/render-modifiers/modifiers/will-destroy"], function (_exports, _willDestroy) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _willDestroy.default;
    }
  });
});
;define("animations/motions/base", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  class Motion {
    constructor(sprite, opts = {}) {
      _defineProperty(this, "keyframes", void 0);

      this.sprite = sprite;
      this.opts = opts;
    }

  }

  _exports.default = Motion;
});
;define("animations/motions/css-motion", ["exports", "animations/motions/base", "animations/value", "animations/behaviors/linear"], function (_exports, _base, _value, _linear) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.CssMotion = void 0;

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  const DEFAULT_DURATION = 300;
  const DEFAULT_BEHAVIOR = _linear.default;

  class CssMotion extends _base.default {
    constructor(sprite, opts) {
      super(sprite, opts);

      _defineProperty(this, "keyframeValues", void 0);

      _defineProperty(this, "property", void 0);

      _defineProperty(this, "value", void 0);

      _defineProperty(this, "duration", void 0);

      _defineProperty(this, "behavior", void 0);

      (true && !(opts.property) && Ember.assert('required opts property and keyframeValues are passed', opts.property));
      this.property = opts.property;
      this.keyframeValues = opts.keyframeValues ?? this.defaultKeyframeValuesFromSprite;
      this.value = new _value.default(opts.property, this.from);
      this.duration = opts.duration ?? DEFAULT_DURATION;
      this.behavior = opts.behavior ?? new DEFAULT_BEHAVIOR();
      (true && !(this.keyframeValues?.length === 2) && Ember.assert('keyframeValues must be an array of length 2', this.keyframeValues?.length === 2));
    }

    get from() {
      return this.keyframeValues[0];
    }

    get to() {
      return this.keyframeValues[1];
    }

    get defaultKeyframeValuesFromSprite() {
      let dasherizedProperty = Ember.String.dasherize(this.property);
      let {
        initialComputedStyle,
        finalComputedStyle
      } = this.sprite;

      if (initialComputedStyle && initialComputedStyle[dasherizedProperty] && finalComputedStyle && finalComputedStyle[dasherizedProperty]) {
        return [initialComputedStyle[dasherizedProperty], finalComputedStyle[dasherizedProperty]];
      }

      return [];
    }

    get keyframes() {
      return this.value.keyframes;
    } // eslint-disable-next-line @typescript-eslint/no-empty-function


    applyBehavior(time) {
      this.value.applyBehavior(this.behavior, this.to, this.duration, this.opts.delay, time);
    }

  }

  _exports.CssMotion = CssMotion;
});
;define("animations/motions/move", ["exports", "animations/motions/base", "animations/models/sprite", "animations/behaviors/spring", "animations/value"], function (_exports, _base, _sprite, _spring, _value) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = move;
  _exports.Move = void 0;

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  const DEFAULT_DURATION = 300;
  const DEFAULT_BEHAVIOR = _spring.default;

  function move(sprite, opts) {
    return new Move(sprite, opts);
  }

  class Move extends _base.default {
    constructor(sprite, opts) {
      super(sprite, opts);

      _defineProperty(this, "boundsDelta", void 0);

      _defineProperty(this, "behavior", void 0);

      _defineProperty(this, "duration", void 0);

      _defineProperty(this, "x", void 0);

      _defineProperty(this, "y", void 0);

      _defineProperty(this, "keyframes", []);

      this.boundsDelta = sprite.boundsDelta;
      this.behavior = opts.behavior || new DEFAULT_BEHAVIOR();
      this.duration = opts.duration ?? DEFAULT_DURATION;
      this.x = new _value.default('x', this.startPosition.x);
      this.y = new _value.default('y', this.startPosition.y);
      this.updateKeyframes();
    }

    get startPosition() {
      let {
        boundsDelta,
        opts,
        sprite
      } = this;
      let defaultStartX = boundsDelta ? -boundsDelta?.x : undefined;
      let defaultStartY = boundsDelta ? -boundsDelta?.y : undefined;

      if (sprite.type === _sprite.SpriteType.Removed) {
        defaultStartX = 0;
        defaultStartY = 0;
      }

      return {
        x: opts.startX ?? defaultStartX ?? 0,
        y: opts.startY ?? defaultStartY ?? 0
      };
    }

    get endPosition() {
      let {
        boundsDelta,
        opts,
        sprite
      } = this;
      let defaultEndX = 0;
      let defaultEndY = 0;

      if (sprite.type === _sprite.SpriteType.Removed) {
        defaultEndX = boundsDelta ? boundsDelta?.x : undefined;
        defaultEndY = boundsDelta ? boundsDelta?.y : undefined;
      }

      return {
        x: opts.endX ?? defaultEndX ?? 0,
        y: opts.endY ?? defaultEndY ?? 0
      };
    }

    updateKeyframes() {
      let xFrames = this.x.frames;
      let yFrames = this.y.frames;
      let count = Math.max(xFrames.length, yFrames.length);
      let keyframes = [];

      for (let i = 0; i < count; i++) {
        let x = xFrames[i]?.value ?? xFrames[xFrames.length - 1]?.value ?? 0;
        let y = yFrames[i]?.value ?? yFrames[yFrames.length - 1]?.value ?? 0;
        keyframes.push({
          transform: `translate(${x}px, ${y}px)`
        });
      }

      this.keyframes = keyframes;
    }

    applyBehavior(time) {
      this.x.applyBehavior(this.behavior, this.endPosition.x, this.duration, this.opts.delay, time, (this.opts.velocity?.x ?? 0) / -1000 // TODO: the behaviors take velocity in units per ms instead of per second
      );
      this.y.applyBehavior(this.behavior, this.endPosition.y, this.duration, this.opts.delay, time, (this.opts.velocity?.y ?? 0) / -1000);
      this.updateKeyframes();
    }

  }

  _exports.Move = Move;
});
;define("animations/motions/opacity", ["exports", "animations/motions/base", "animations/behaviors/linear", "animations/value"], function (_exports, _base, _linear, _value) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.Opacity = void 0;

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  const DEFAULT_DURATION = 300;
  const DEFAULT_BEHAVIOR = _linear.default;

  function safeParseInt(val) {
    return val == undefined ? undefined : parseInt(val);
  }

  class Opacity extends _base.default {
    constructor(sprite, opts) {
      super(sprite, opts);

      _defineProperty(this, "behavior", void 0);

      _defineProperty(this, "duration", void 0);

      _defineProperty(this, "value", void 0);

      _defineProperty(this, "keyframes", []);

      this.behavior = opts.behavior || new DEFAULT_BEHAVIOR();
      this.duration = opts.duration ?? DEFAULT_DURATION;
      this.value = new _value.default('opacity', this.from);
      this.updateKeyframes();
    }

    get from() {
      let initialSpriteValue = safeParseInt(this.sprite.initialComputedStyle?.opacity);
      return this.opts.from ?? initialSpriteValue ?? 0;
    }

    get to() {
      let finalSpriteValue = safeParseInt(this.sprite.finalComputedStyle?.opacity);
      return this.opts.to ?? finalSpriteValue ?? 1;
    }

    updateKeyframes() {
      let frames = this.value.frames;
      let keyframes = [];

      for (let frame of frames) {
        keyframes.push({
          opacity: `${frame.value ?? 0}`
        });
      }

      this.keyframes = keyframes;
    }

    applyBehavior(time) {
      this.value.applyBehavior(this.behavior, this.to, this.duration, this.opts.delay, time);
      this.updateKeyframes();
    }

  }

  _exports.Opacity = Opacity;
});
;define("animations/motions/resize", ["exports", "animations/motions/base", "animations/value", "animations/behaviors/spring"], function (_exports, _base, _value, _spring) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.Resize = void 0;

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  const DEFAULT_DURATION = 300;
  const DEFAULT_BEHAVIOR = _spring.default;

  class Resize extends _base.default {
    constructor(sprite, opts) {
      super(sprite, opts);

      _defineProperty(this, "behavior", void 0);

      _defineProperty(this, "duration", void 0);

      _defineProperty(this, "height", void 0);

      _defineProperty(this, "width", void 0);

      _defineProperty(this, "keyframes", []);

      this.behavior = opts.behavior || new DEFAULT_BEHAVIOR();
      this.duration = opts.duration ?? DEFAULT_DURATION;
      this.width = new _value.default('width', this.startSize.width);
      this.height = new _value.default('height', this.startSize.height);
      this.updateKeyframes();
    }

    get startSize() {
      let {
        opts,
        sprite
      } = this;
      return {
        width: opts.startWidth ?? sprite.initialWidth ?? 0,
        height: opts.startHeight ?? sprite.initialHeight ?? 0
      };
    }

    get endSize() {
      let {
        opts,
        sprite
      } = this;
      return {
        width: opts.endWidth ?? sprite.finalWidth ?? 0,
        height: opts.endHeight ?? sprite.finalHeight ?? 0
      };
    }

    updateKeyframes() {
      let widthFrames = this.width.frames;
      let heightFrames = this.height.frames;
      let count = Math.max(widthFrames.length, heightFrames.length);
      let keyframes = [];

      for (let i = 0; i < count; i++) {
        let keyframe = {}; // only add height/width to this keyframe if we need to animate the property, we could only be animating one of them.

        if (widthFrames.length) {
          let width = widthFrames[i]?.value ?? widthFrames[widthFrames.length - 1]?.value;
          keyframe.width = `${width}px`;
        }

        if (heightFrames.length) {
          let height = heightFrames[i]?.value ?? heightFrames[heightFrames.length - 1]?.value;
          keyframe.height = `${height}px`;
        }

        keyframes.push(keyframe);
      }

      this.keyframes = keyframes;
    }

    applyBehavior(time) {
      this.width.applyBehavior(this.behavior, this.endSize.width, this.duration, this.opts.delay, time, (this.opts.velocity?.width ?? 0) / -1000 // TODO: the behaviors take velocity in units per ms instead of per second
      );
      this.height.applyBehavior(this.behavior, this.endSize.height, this.duration, this.opts.delay, time, (this.opts.velocity?.height ?? 0) / -1000);
      this.updateKeyframes();
    }

  }

  _exports.Resize = Resize;
});
;define("animations/router", ["exports", "animations/config/environment"], function (_exports, _environment) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  class Router extends Ember.Router {
    constructor(...args) {
      super(...args);

      _defineProperty(this, "location", _environment.default.locationType);

      _defineProperty(this, "rootURL", _environment.default.rootURL);
    }

  }

  _exports.default = Router;
  Router.map(function () {
    this.route('ea-demos');
    this.route('list-detail');
    this.route('interruption');
    this.route('boxel');
    this.route('routes', function () {
      this.route('other');
    });
    this.route('motion-study', function () {
      this.route('details', {
        path: '/:id'
      });
    });
    this.route('accordion');
  });
});
;define("animations/routes/motion-study", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  class MotionStudy extends Ember.Route {}

  _exports.default = MotionStudy;
});
;define("animations/routes/motion-study/details", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  class MotionStudyDetails extends Ember.Route {
    model(params) {
      return Number(params.id);
    }

  }

  _exports.default = MotionStudyDetails;
});
;define("animations/routes/motion-study/index", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  class MotionStudyIndex extends Ember.Route {}

  _exports.default = MotionStudyIndex;
});
;define("animations/serializers/-default", ["exports", "@ember-data/serializer/json"], function (_exports, _json) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _json.default;
    }
  });
});
;define("animations/serializers/-json-api", ["exports", "@ember-data/serializer/json-api"], function (_exports, _jsonApi) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _jsonApi.default;
    }
  });
});
;define("animations/serializers/-rest", ["exports", "@ember-data/serializer/rest"], function (_exports, _rest) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _rest.default;
    }
  });
});
;define("animations/services/-ea-motion", ["exports", "ember-animated/services/motion"], function (_exports, _motion) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _motion.default;
    }
  });
});
;define("animations/services/-ensure-registered", ["exports", "@embroider/util/services/ensure-registered"], function (_exports, _ensureRegistered) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _ensureRegistered.default;
    }
  });
});
;define("animations/services/animations", ["exports", "animations/models/sprite-tree", "animations/models/transition-runner", "ember-concurrency-ts", "animations/utils/measurement", "animations/models/sprite-factory", "ember-concurrency"], function (_exports, _spriteTree, _transitionRunner, _emberConcurrencyTs, _measurement, _spriteFactory, _emberConcurrency) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _class, _temp;

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  function _applyDecoratedDescriptor(target, property, decorators, descriptor, context) { var desc = {}; Object.keys(descriptor).forEach(function (key) { desc[key] = descriptor[key]; }); desc.enumerable = !!desc.enumerable; desc.configurable = !!desc.configurable; if ('value' in desc || desc.initializer) { desc.writable = true; } desc = decorators.slice().reverse().reduce(function (desc, decorator) { return decorator(target, property, desc) || desc; }, desc); if (context && desc.initializer !== void 0) { desc.value = desc.initializer ? desc.initializer.call(context) : void 0; desc.initializer = undefined; } if (desc.initializer === void 0) { Object.defineProperty(target, property, desc); desc = null; } return desc; }

  let AnimationsService = (_class = (_temp = class AnimationsService extends Ember.Service {
    constructor(...args) {
      super(...args);

      _defineProperty(this, "spriteTree", new _spriteTree.default());

      _defineProperty(this, "freshlyAdded", new Set());

      _defineProperty(this, "freshlyRemoved", new Set());

      _defineProperty(this, "eligibleContexts", new Set());

      _defineProperty(this, "intent", void 0);

      _defineProperty(this, "currentChangesets", []);

      _defineProperty(this, "intermediateSprites", new WeakMap());

      _defineProperty(this, "_notifiedContextRendering", new Set());
    }

    registerContext(context) {
      this.spriteTree.addAnimationContext(context);
    }

    unregisterContext(context) {
      this.eligibleContexts.delete(context);
      this.spriteTree.removeAnimationContext(context);
    }

    registerSpriteModifier(spriteModifier) {
      this.spriteTree.addSpriteModifier(spriteModifier);
      this.freshlyAdded.add(spriteModifier);
    }

    unregisterSpriteModifier(spriteModifier) {
      this.spriteTree.removeSpriteModifier(spriteModifier);
      this.freshlyRemoved.add(spriteModifier);
    }

    notifyContextRendering(animationContext) {
      if (!this._notifiedContextRendering.has(animationContext)) {
        this._notifiedContextRendering.add(animationContext);

        this.eligibleContexts.add(animationContext); // we can't schedule this, if we don't deal with it immediately the animations will already be gone

        this.willTransition(animationContext);
        Ember.run.scheduleOnce('afterRender', this, this.maybeTransition);
      }
    }

    filterToContext(animationContext, spriteModifiers, opts = {
      includeFreshlyRemoved: false
    }) {
      let contextDescendants = this.spriteTree.descendantsOf(animationContext, opts);
      let result = new Set([...spriteModifiers].filter(m => contextDescendants.includes(m)));
      return result;
    } // When we interrupt, we can clean certain sprites marked for garbage collection


    cleanupSprites(context) {
      let removedSprites = this.filterToContext(context, this.freshlyRemoved, {
        includeFreshlyRemoved: true
      }); // cleanup removedSprites

      removedSprites.forEach(sm => {
        if (sm.element.getAttribute('data-sprite-hidden') === 'true') {
          if (context.hasOrphan(sm.element)) {
            context.removeOrphan(sm.element);
          }

          this.freshlyRemoved.delete(sm);
        }
      });
    } // TODO: as this is called once per context, we could probably pass the context as an argument and forego the loop


    willTransition(context) {
      // TODO: what about intents
      this.cleanupSprites(context); // We need to measure if this was an already rendered context in case the window has resized.
      // The element check is there because the renderDetector may fire this before the actual element exists.

      if (context.element) {
        context.captureSnapshot();
      }

      let spriteModifiers = this.filterToContext(context, this.freshlyRemoved, {
        includeFreshlyRemoved: true
      }); // TODO: we only look at direct descendants here, not all

      let contextNodeChildren = this.spriteTree.lookupNodeByElement(context.element)?.children;

      if (contextNodeChildren) {
        for (let child of contextNodeChildren) {
          if (child.nodeType === _spriteTree.SpriteTreeNodeType.Sprite) {
            spriteModifiers.add(child.model);
          }
        }
      }

      let intermediateSprites = new Set();

      for (let spriteModifier of spriteModifiers) {
        let sprite = _spriteFactory.default.createIntermediateSprite(spriteModifier); // TODO: we could leave these measurements to the SpriteFactory as they are unique to the SpriteType


        let bounds = sprite.captureAnimatingBounds(context.element);
        let styles = (0, _measurement.copyComputedStyle)(sprite.element); // TODO: check if we need to pause the animation, is so we want to integrate this with captureAnimatingBounds to only pause/play once.
        // console.log(styles['background-color']);

        sprite.initialBounds = bounds;
        sprite.initialComputedStyle = styles;
        sprite.element.getAnimations().forEach(a => a.cancel());
        intermediateSprites.add(sprite);
      }

      (true && !(!this.intermediateSprites.has(context)) && Ember.assert('Context already present in intermediateSprites', !this.intermediateSprites.has(context)));
      this.intermediateSprites.set(context, intermediateSprites);
    }

    async maybeTransition() {
      return (0, _emberConcurrencyTs.taskFor)(this.maybeTransitionTask).perform().catch(error => {
        if (!(0, _emberConcurrency.didCancel)(error)) {
          console.error(error);
          throw error;
        } else {
          console.warn('maybeTransition cancelled, animations interrupted');
        }
      });
    }

    *maybeTransitionTask() {
      this._notifiedContextRendering.clear();

      let contexts = this.spriteTree.getContextRunList(this.eligibleContexts);
      let intermediateSprites = this.intermediateSprites;
      this.intermediateSprites = new WeakMap();
      let promises = [];

      for (let context of contexts) {
        // TODO: Should we keep a "current" transition runner while it is running so we can actually interrupt it?
        //  It may also be good enough to rewrite maybeTransition into a Task.
        let transitionRunner = new _transitionRunner.default(context, {
          spriteTree: this.spriteTree,
          freshlyAdded: this.freshlyAdded,
          freshlyRemoved: this.freshlyRemoved,
          intent: this.intent,
          intermediateSprites: intermediateSprites.get(context)
        });
        let task = (0, _emberConcurrencyTs.taskFor)(transitionRunner.maybeTransitionTask);
        promises.push(task.perform());
      }

      yield (0, _emberConcurrency.all)(promises); // TODO: check for async leaks

      this.freshlyAdded.clear();
      this.freshlyRemoved.clear();
      this.spriteTree.clearFreshlyRemovedChildren();
      this.intent = undefined;
    }

    setIntent(intentDescription) {
      this.intent = intentDescription;
    }

  }, _temp), (_applyDecoratedDescriptor(_class.prototype, "maybeTransitionTask", [_emberConcurrency.restartableTask], Object.getOwnPropertyDescriptor(_class.prototype, "maybeTransitionTask"), _class.prototype)), _class);
  _exports.default = AnimationsService;
});
;define("animations/services/is-component", ["exports", "ember-cli-is-component/services/is-component"], function (_exports, _isComponent) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _isComponent.default;
    }
  });
});
;define("animations/services/keyboard", ["exports", "ember-keyboard/services/keyboard"], function (_exports, _keyboard) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _keyboard.default;
    }
  });
});
;define("animations/services/link-manager", ["exports", "ember-link/services/link-manager"], function (_exports, _linkManager) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _linkManager.default;
    }
  });
});
;define("animations/services/moment", ["exports", "ember-moment/services/moment", "animations/config/environment"], function (_exports, _moment, _environment) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;
  const {
    get
  } = Ember;

  var _default = _moment.default.extend({
    defaultFormat: get(_environment.default, 'moment.outputFormat')
  });

  _exports.default = _default;
});
;define("animations/services/page-title-list", ["exports", "ember-page-title/services/page-title-list"], function (_exports, _pageTitleList) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _pageTitleList.default;
    }
  });
});
;define("animations/services/page-title", ["exports", "ember-page-title/services/page-title"], function (_exports, _pageTitle) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _pageTitle.default;
    }
  });
});
;define("animations/services/store", ["exports", "ember-data/store"], function (_exports, _store) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _store.default;
    }
  });
});
;define("animations/services/text-measurer", ["exports", "ember-text-measurer/services/text-measurer"], function (_exports, _textMeasurer) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _textMeasurer.default;
    }
  });
});
;define("animations/services/user-agent", ["exports", "ember-useragent/services/user-agent"], function (_exports, _userAgent) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _userAgent.default;
    }
  });
});
;define("animations/styles/app", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;
  var _default = {};
  _exports.default = _default;
});
;define("animations/styles/motion-study/details", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;
  var _default = {
    "container": "_container_r6m2yf",
    "card": "_card_r6m2yf",
    "title": "_title_r6m2yf"
  };
  _exports.default = _default;
});
;define("animations/styles/motion-study/index", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;
  var _default = {
    "grid": "_grid_1mnhn6"
  };
  _exports.default = _default;
});
;define("animations/templates/accordion", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _default = Ember.HTMLBars.template({
    "id": "JyIc2s4/",
    "block": "{\"symbols\":[],\"statements\":[[8,\"accordion\",[],[[],[]],null]],\"hasEval\":false,\"upvars\":[]}",
    "moduleName": "animations/templates/accordion.hbs"
  });

  _exports.default = _default;
});
;define("animations/templates/application", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _default = Ember.HTMLBars.template({
    "id": "KkgGXUqQ",
    "block": "{\"symbols\":[],\"statements\":[[1,[30,[36,0],[\"Animations\"],null]],[2,\"\\n\\n\"],[10,\"ul\"],[14,0,\"list-reset flex\"],[12],[2,\"\\n  \"],[10,\"li\"],[14,0,\"mr-3\"],[12],[2,\"\\n    \"],[8,\"link-to\",[[24,0,\"inline-block border border-white rounded hover:border-grey-lighter text-blue hover:bg-grey-lighter py-1 px-3\"]],[[\"@route\"],[\"index\"]],[[\"default\"],[{\"statements\":[[2,\"\\n      Basics\\n    \"]],\"parameters\":[]}]]],[2,\"\\n  \"],[13],[2,\"\\n  \"],[10,\"li\"],[14,0,\"mr-3\"],[12],[2,\"\\n    \"],[8,\"link-to\",[[24,0,\"inline-block border border-white rounded hover:border-grey-lighter text-blue hover:bg-grey-lighter py-1 px-3\"]],[[\"@route\"],[\"list-detail\"]],[[\"default\"],[{\"statements\":[[2,\"\\n      List Detail\\n    \"]],\"parameters\":[]}]]],[2,\"\\n  \"],[13],[2,\"\\n  \"],[10,\"li\"],[14,0,\"mr-3\"],[12],[2,\"\\n    \"],[8,\"link-to\",[[24,0,\"inline-block border border-white rounded hover:border-grey-lighter text-blue hover:bg-grey-lighter py-1 px-3\"]],[[\"@route\"],[\"ea-demos\"]],[[\"default\"],[{\"statements\":[[2,\"\\n      e-animated Demos\\n    \"]],\"parameters\":[]}]]],[2,\"\\n  \"],[13],[2,\"\\n  \"],[10,\"li\"],[14,0,\"mr-3\"],[12],[2,\"\\n    \"],[8,\"link-to\",[[24,0,\"inline-block border border-white rounded hover:border-grey-lighter text-blue hover:bg-grey-lighter py-1 px-3\"]],[[\"@route\"],[\"interruption\"]],[[\"default\"],[{\"statements\":[[2,\"\\n      Interruptions\\n    \"]],\"parameters\":[]}]]],[2,\"\\n  \"],[13],[2,\"\\n  \"],[10,\"li\"],[14,0,\"mr-3\"],[12],[2,\"\\n    \"],[8,\"link-to\",[[24,0,\"inline-block border border-white rounded hover:border-grey-lighter text-blue hover:bg-grey-lighter py-1 px-3\"]],[[\"@route\"],[\"boxel\"]],[[\"default\"],[{\"statements\":[[2,\"\\n      Boxel Demos\\n    \"]],\"parameters\":[]}]]],[2,\"\\n  \"],[13],[2,\"\\n  \"],[10,\"li\"],[14,0,\"mr-3\"],[12],[2,\"\\n    \"],[8,\"link-to\",[[24,0,\"inline-block border border-white rounded hover:border-grey-lighter text-blue hover:bg-grey-lighter py-1 px-3\"]],[[\"@route\"],[\"routes\"]],[[\"default\"],[{\"statements\":[[2,\"\\n      Route Transition\\n    \"]],\"parameters\":[]}]]],[2,\"\\n  \"],[13],[2,\"\\n  \"],[10,\"li\"],[14,0,\"mr-3\"],[12],[2,\"\\n    \"],[8,\"link-to\",[[24,0,\"inline-block border border-white rounded hover:border-grey-lighter text-blue hover:bg-grey-lighter py-1 px-3\"]],[[\"@route\"],[\"motion-study\"]],[[\"default\"],[{\"statements\":[[2,\"\\n      Motion Study\\n    \"]],\"parameters\":[]}]]],[2,\"\\n  \"],[13],[2,\"\\n  \"],[10,\"li\"],[14,0,\"mr-3\"],[12],[2,\"\\n    \"],[8,\"link-to\",[[24,0,\"inline-block border border-white rounded hover:border-grey-lighter text-blue hover:bg-grey-lighter py-1 px-3\"]],[[\"@route\"],[\"accordion\"]],[[\"default\"],[{\"statements\":[[2,\"\\n      Accordion\\n    \"]],\"parameters\":[]}]]],[2,\"\\n  \"],[13],[2,\"\\n\"],[13],[2,\"\\n\\n\"],[1,[30,[36,2],[[30,[36,1],null,null]],null]]],\"hasEval\":false,\"upvars\":[\"page-title\",\"-outlet\",\"component\"]}",
    "moduleName": "animations/templates/application.hbs"
  });

  _exports.default = _default;
});
;define("animations/templates/boxel", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _default = Ember.HTMLBars.template({
    "id": "/Wl3IcRZ",
    "block": "{\"symbols\":[\"model\"],\"statements\":[[10,\"div\"],[14,0,\"my-20 w-full max-w-md lg:max-w-2xl mx-auto px-4\"],[12],[2,\"\\n  \"],[10,\"div\"],[14,0,\"text-center max-w-lg mx-auto\"],[12],[2,\"\\n    \"],[10,\"h2\"],[14,0,\"text-4xl font-semibold leading-tight\"],[12],[2,\"\\n      Animating Cards\\n    \"],[13],[2,\"\\n    \"],[10,\"p\"],[14,0,\"mt-4 text-lg\"],[12],[2,\"\\n      Experiments for anticipated Boxel animation needs.\\n    \"],[13],[2,\"\\n  \"],[13],[2,\"\\n\\n  \"],[8,\"animation-context\",[],[[\"@id\",\"@use\"],[\"card-isolation-context\",[32,0,[\"isolatedCardTransition\"]]]],[[\"default\"],[{\"statements\":[[2,\"\\n\\n    \"],[10,\"div\"],[14,0,\"mt-16 w-1/3\"],[12],[2,\"\\n      \"],[10,\"div\"],[14,0,\"my-4\"],[12],[2,\"\\n        Click expand icon to isolate card. Adjust sorting:\\n        \"],[8,\"boxel/button\",[[4,[38,4],[\"click\",[32,0,[\"reverseSort\"]]],null]],[[],[]],[[\"default\"],[{\"statements\":[[2,\"\\n          \"],[1,[30,[36,3],[[32,0,[\"ascendingSort\"]],\"A-Z\",\"Z-A\"],null]],[2,\" (click to reverse)\\n        \"]],\"parameters\":[]}]]],[2,\"\\n      \"],[13],[2,\"\\n      \"],[8,\"animation-context\",[],[[\"@id\",\"@use\"],[\"card-sorting-context\",[32,0,[\"cardSortingTransition\"]]]],[[\"default\"],[{\"statements\":[[2,\"\\n        \"],[10,\"div\"],[14,0,\"stack\"],[12],[2,\"\\n\"],[6,[37,6],[[30,[36,5],[[30,[36,5],[[32,0,[\"sortedCardModels\"]]],null]],null]],null,[[\"default\"],[{\"statements\":[[6,[37,3],[[30,[36,2],[[32,1],[32,0,[\"isolatedCard\"]]],null]],null,[[\"default\",\"else\"],[{\"statements\":[[2,\"              \"],[11,\"div\"],[24,0,\"card-placeholder\"],[4,[38,0],null,[[\"role\",\"id\"],[\"card-placeholder\",[32,1,[\"id\"]]]]],[12],[13],[2,\"\\n\"]],\"parameters\":[]},{\"statements\":[[2,\"              \"],[8,\"card\",[[4,[38,0],null,[[\"role\",\"id\"],[\"card\",[32,1,[\"id\"]]]]]],[[\"@model\",\"@expandAction\"],[[32,1],[30,[36,1],[[32,0,[\"isolateCard\"]],[32,1]],null]]],null],[2,\"\\n\"]],\"parameters\":[]}]]]],\"parameters\":[1]}]]],[2,\"        \"],[13],[2,\"\\n      \"]],\"parameters\":[]}]]],[2,\"\\n    \"],[13],[2,\"\\n\\n    \"],[10,\"div\"],[15,0,[31,[\"isolation-layer absolute \",[30,[36,7],[[32,0,[\"isolatedCard\"]],\"hidden\"],null]]]],[12],[2,\"\\n\"],[6,[37,3],[[32,0,[\"isolatedCard\"]]],null,[[\"default\"],[{\"statements\":[[2,\"        \"],[8,\"card\",[[4,[38,0],null,[[\"role\",\"id\"],[\"card\",[32,0,[\"isolatedCard\",\"id\"]]]]]],[[\"@model\",\"@expandAction\"],[[32,0,[\"isolatedCard\"]],[32,0,[\"dismissIsolatedCard\"]]]],[[\"default\"],[{\"statements\":[[2,\"\\n          \"],[10,\"p\"],[14,0,\"mt-2 mb-2\"],[12],[2,\"\\n            Id Lorem laborum mollit labore. Et et est ipsum consequat est eiusmod amet quis. Est cillum velit et sunt ad occaecat enim eu eiusmod do. Sint ea fugiat nisi minim eu est ullamco proident aliqua. Non aliquip mollit quis elit Lorem fugiat est culpa exercitation voluptate commodo commodo. Duis ex sint enim cillum proident est esse. Est consequat reprehenderit enim laborum pariatur aute quis consequat quis cupidatat et voluptate.\\n          \"],[13],[2,\"\\n\\n          \"],[10,\"p\"],[14,0,\"mb-2\"],[12],[2,\"\\n    Irure non dolore occaecat fugiat. Tempor proident occaecat eiusmod do ex in nisi amet do laboris. Exercitation enim reprehenderit elit eu nulla ad laboris culpa sunt voluptate deserunt culpa sint. Laboris dolore laborum nisi anim aliquip id quis. Sint dolore nulla nisi ea voluptate irure exercitation duis sit do tempor voluptate qui ipsum. Do labore sint veniam consectetur velit ad non ipsum et adipisicing. Consequat duis exercitation dolor nostrud eu commodo culpa pariatur.\\n          \"],[13],[2,\"\\n\\n          \"],[10,\"p\"],[14,0,\"mb-2\"],[12],[2,\"\\n    Deserunt aliqua ex anim occaecat nulla velit ullamco Lorem irure. Ad magna aute ut anim sit non labore cupidatat quis adipisicing dolore aute. Non nulla velit voluptate consequat sunt eu ut non aliquip labore excepteur.\\n          \"],[13],[2,\"\\n\\n          \"],[10,\"p\"],[12],[2,\"\\n    Culpa elit quis velit ad laboris sunt et et Lorem aliquip eiusmod. Et aliquip mollit nisi aliquip quis labore est. Quis laboris nulla aliqua pariatur ex non nisi. Eu adipisicing est sint excepteur ad occaecat ea mollit adipisicing laboris quis. Ipsum esse dolor exercitation eiusmod. Ad quis duis aliqua nostrud cillum.\\n          \"],[13],[2,\"\\n        \"]],\"parameters\":[]}]]],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"    \"],[13],[2,\"\\n  \"]],\"parameters\":[]}]]],[2,\"\\n\"],[13]],\"hasEval\":false,\"upvars\":[\"sprite\",\"fn\",\"eq\",\"if\",\"on\",\"-track-array\",\"each\",\"unless\"]}",
    "moduleName": "animations/templates/boxel.hbs"
  });

  _exports.default = _default;
});
;define("animations/templates/components/basic-dropdown-content", ["exports", "ember-basic-dropdown/templates/components/basic-dropdown-content"], function (_exports, _basicDropdownContent) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _basicDropdownContent.default;
    }
  });
});
;define("animations/templates/components/basic-dropdown-trigger", ["exports", "ember-basic-dropdown/templates/components/basic-dropdown-trigger"], function (_exports, _basicDropdownTrigger) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _basicDropdownTrigger.default;
    }
  });
});
;define("animations/templates/components/basic-dropdown", ["exports", "ember-basic-dropdown/templates/components/basic-dropdown"], function (_exports, _basicDropdown) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _basicDropdown.default;
    }
  });
});
;define("animations/templates/components/link", ["exports", "ember-link/components/link/template"], function (_exports, _template) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _template.default;
    }
  });
});
;define("animations/templates/ea-demos", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _default = Ember.HTMLBars.template({
    "id": "CAfewHNp",
    "block": "{\"symbols\":[],\"statements\":[[10,\"div\"],[14,0,\"my-20 w-full max-w-md lg:max-w-2xl mx-auto px-4\"],[12],[2,\"\\n  \"],[10,\"div\"],[14,0,\"text-center max-w-lg mx-auto\"],[12],[2,\"\\n    \"],[10,\"h2\"],[14,0,\"text-4xl font-semibold leading-tight\"],[12],[2,\"\\n      Use your existing business logic\\n    \"],[13],[2,\"\\n    \"],[10,\"p\"],[14,0,\"mt-4 text-lg\"],[12],[2,\"\\n      Add animation with minimal changes to your existing application code.\\n    \"],[13],[2,\"\\n  \"],[13],[2,\"\\n\\n  \"],[10,\"div\"],[14,0,\"mt-16\"],[12],[2,\"\\n    \"],[8,\"demo1\",[],[[],[]],null],[2,\"\\n  \"],[13],[2,\"\\n\\n\"],[13],[2,\"\\n\\n\"]],\"hasEval\":false,\"upvars\":[]}",
    "moduleName": "animations/templates/ea-demos.hbs"
  });

  _exports.default = _default;
});
;define("animations/templates/index", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _default = Ember.HTMLBars.template({
    "id": "CqkD7qjI",
    "block": "{\"symbols\":[],\"statements\":[[2,\"\\n\"],[10,\"div\"],[14,0,\"controls m-5 text-sm\"],[12],[2,\"\\n  \"],[10,\"h2\"],[14,0,\"text-lg font-bold\"],[12],[2,\"Controls\"],[13],[2,\"\\n  \"],[10,\"p\"],[12],[2,\"\\n    \"],[10,\"label\"],[12],[2,\"\\n\"],[2,\"      \"],[10,\"input\"],[15,\"checked\",[32,0,[\"showContentBeforeContext\"]]],[15,\"onclick\",[30,[36,2],[[32,0],[30,[36,1],[[32,0,[\"showContentBeforeContext\"]]],null]],[[\"value\"],[\"target.checked\"]]]],[14,4,\"checkbox\"],[12],[13],[2,\"\\n      Show content before AnimationContext 1\\n    \"],[13],[2,\"\\n  \"],[13],[2,\"\\n  \"],[10,\"p\"],[12],[2,\"\\n    \"],[10,\"label\"],[12],[2,\"\\n\"],[2,\"      \"],[10,\"input\"],[15,\"checked\",[32,0,[\"showContentBefore\"]]],[15,\"onclick\",[30,[36,2],[[32,0],[30,[36,1],[[32,0,[\"showContentBefore\"]]],null]],[[\"value\"],[\"target.checked\"]]]],[14,4,\"checkbox\"],[12],[13],[2,\"\\n      Show content before sprites in AnimationContext 1\\n    \"],[13],[2,\"\\n  \"],[13],[2,\"\\n  \"],[10,\"p\"],[12],[2,\"\\n    \"],[10,\"label\"],[12],[2,\"\\n\"],[2,\"      \"],[10,\"input\"],[15,\"checked\",[32,0,[\"showSpriteA\"]]],[15,\"onclick\",[30,[36,2],[[32,0],[30,[36,1],[[32,0,[\"showSpriteA\"]]],null]],[[\"value\"],[\"target.checked\"]]]],[14,4,\"checkbox\"],[12],[13],[2,\"\\n      Include Sprite A\\n    \"],[13],[2,\"\\n    |\\n    \"],[10,\"label\"],[12],[2,\"\\n\"],[2,\"      \"],[10,\"input\"],[15,\"checked\",[32,0,[\"spriteAPositionBottom\"]]],[15,\"onclick\",[30,[36,2],[[32,0],[30,[36,1],[[32,0,[\"spriteAPositionBottom\"]]],null]],[[\"value\"],[\"target.checked\"]]]],[14,4,\"checkbox\"],[12],[13],[2,\"\\n      Sprite A appears at bottom\\n    \"],[13],[2,\"\\n  \"],[13],[2,\"\\n  \"],[10,\"p\"],[12],[2,\"\\n    \"],[10,\"label\"],[12],[2,\"\\n\"],[2,\"      \"],[10,\"input\"],[15,\"checked\",[32,0,[\"showSpriteB\"]]],[15,\"onclick\",[30,[36,2],[[32,0],[30,[36,1],[[32,0,[\"showSpriteB\"]]],null]],[[\"value\"],[\"target.checked\"]]]],[14,4,\"checkbox\"],[12],[13],[2,\"\\n      Include Sprite B\\n    \"],[13],[2,\"\\n  \"],[13],[2,\"\\n  \"],[10,\"p\"],[14,0,\"my-2\"],[12],[2,\"\\n    \"],[11,\"button\"],[24,0,\"border-2 p-1 px-4 rounded-lg\"],[24,4,\"button\"],[4,[38,3],[\"click\",[32,0,[\"toggleSpritesAandB\"]]],null],[12],[2,\"\\n      Toggle Inclusion of A and B\\n    \"],[13],[2,\"\\n     \"],[11,\"button\"],[24,0,\"border-2 p-1 px-4 rounded-lg\"],[24,4,\"button\"],[4,[38,3],[\"click\",[32,0,[\"moveSpriteC\"]]],null],[12],[2,\"\\n      Move C to Other Context\\n    \"],[13],[2,\"\\n  \"],[13],[2,\"\\n  \"],[10,\"p\"],[12],[2,\"\\n    \"],[10,\"label\"],[12],[2,\"\\n\"],[2,\"      \"],[10,\"input\"],[15,\"checked\",[32,0,[\"showContentAfter\"]]],[15,\"onclick\",[30,[36,2],[[32,0],[30,[36,1],[[32,0,[\"showContentAfter\"]]],null]],[[\"value\"],[\"target.checked\"]]]],[14,4,\"checkbox\"],[12],[13],[2,\"\\n      Show content after sprite\\n    \"],[13],[2,\"\\n  \"],[13],[2,\"\\n  \"],[10,\"p\"],[12],[2,\"\\n    \"],[10,\"label\"],[12],[2,\"\\n\"],[2,\"      \"],[10,\"input\"],[15,\"checked\",[32,0,[\"contextHasPadding\"]]],[15,\"onclick\",[30,[36,2],[[32,0],[30,[36,1],[[32,0,[\"contextHasPadding\"]]],null]],[[\"value\"],[\"target.checked\"]]]],[14,4,\"checkbox\"],[12],[13],[2,\"\\n      AnimationContext has padding\\n    \"],[13],[2,\"\\n  \"],[13],[2,\"\\n\"],[13],[2,\"\\n\\n\"],[8,\"animation-context\",[],[[\"@id\",\"@use\"],[\"outer\",[32,0,[\"outerTransition\"]]]],[[\"default\"],[{\"statements\":[[2,\"\\n  \"],[10,\"div\"],[14,0,\"flex w-full m-4\"],[12],[2,\"\\n    \"],[10,\"div\"],[14,0,\"flex-none w-1/2\"],[12],[2,\"\\n      \"],[10,\"h2\"],[14,0,\"p-2 bg-grey-lightest mr-2\"],[12],[2,\"Inner Animation Context\"],[13],[2,\"\\n\\n\"],[6,[37,4],[[32,0,[\"showContentBeforeContext\"]]],null,[[\"default\"],[{\"statements\":[[2,\"        \"],[10,\"p\"],[12],[2,\"Here is some content before AnimationContext 1\"],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"      \"],[10,\"div\"],[15,0,[31,[\"some-container \",[30,[36,4],[[32,0,[\"contextHasPadding\"]],\"with-padded-animation-context\"],null]]]],[12],[2,\"\\n        \"],[8,\"animation-context\",[],[[\"@id\",\"@use\"],[\"inner\",[32,0,[\"innerTransition\"]]]],[[\"default\"],[{\"statements\":[[2,\"\\n          \"],[11,\"div\"],[4,[38,0],null,[[\"role\"],[\"container\"]]],[12],[2,\"\\n\"],[6,[37,4],[[32,0,[\"showContentBefore\"]]],null,[[\"default\"],[{\"statements\":[[2,\"              \"],[10,\"p\"],[12],[2,\"Here is some content before the sprite\"],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"\\n\"],[6,[37,4],[[30,[36,6],[[32,0,[\"showSpriteA\"]],[30,[36,5],[[32,0,[\"spriteAPositionBottom\"]]],null]],null]],null,[[\"default\"],[{\"statements\":[[2,\"              \"],[11,\"div\"],[24,0,\"sprite\"],[4,[38,0],null,[[\"id\"],[\"A\"]]],[12],[2,\"\\n                Hello, I am a sprite A\\n              \"],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"\\n\"],[6,[37,4],[[32,0,[\"showSpriteB\"]]],null,[[\"default\"],[{\"statements\":[[2,\"              \"],[11,\"div\"],[24,0,\"sprite\"],[4,[38,0],null,[[\"id\"],[\"B\"]]],[12],[2,\"\\n                Hello, I am a sprite B\\n              \"],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"\\n\"],[6,[37,4],[[30,[36,7],[[32,0,[\"spriteCPosition\"]],0],null]],null,[[\"default\"],[{\"statements\":[[2,\"              \"],[11,\"div\"],[24,0,\"sprite\"],[4,[38,0],null,[[\"id\"],[\"C\"]]],[12],[2,\"\\n                Hello, I am a sprite C\\n              \"],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"\\n\"],[6,[37,4],[[30,[36,6],[[32,0,[\"showSpriteA\"]],[32,0,[\"spriteAPositionBottom\"]]],null]],null,[[\"default\"],[{\"statements\":[[2,\"              \"],[11,\"div\"],[24,0,\"sprite\"],[4,[38,0],null,[[\"id\"],[\"A\"]]],[12],[2,\"\\n                Hello, I am a sprite A\\n              \"],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"\\n\"],[6,[37,4],[[32,0,[\"showContentAfter\"]]],null,[[\"default\"],[{\"statements\":[[2,\"              \"],[10,\"p\"],[12],[2,\"Here is some content after the sprite\"],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"          \"],[13],[2,\"\\n        \"]],\"parameters\":[]}]]],[2,\"\\n      \"],[13],[2,\"\\n    \"],[13],[2,\"\\n    \"],[10,\"div\"],[14,0,\"flex-none w-1/2\"],[14,\"data-right-side\",\"\"],[12],[2,\"\\n      \"],[10,\"h2\"],[14,0,\"p-2 bg-grey-lightest\"],[12],[2,\"Within Outer Animation Context\"],[13],[2,\"\\n\"],[6,[37,4],[[30,[36,7],[[32,0,[\"spriteCPosition\"]],1],null]],null,[[\"default\"],[{\"statements\":[[2,\"        \"],[11,\"div\"],[24,0,\"sprite\"],[4,[38,0],null,[[\"id\"],[\"C\"]]],[12],[2,\"\\n          Hello, I am a sprite C\\n        \"],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"    \"],[13],[2,\"\\n  \"],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"\\n\\n\"],[10,\"h3\"],[14,0,\"font-bold mx-4 text-sm\"],[12],[2,\"Notes\"],[13],[2,\"\\n\"],[10,\"ol\"],[14,0,\"px-8 text-sm\"],[12],[2,\"\\n  \"],[10,\"li\"],[12],[2,\"ℹ Open the inspector to observe logging as you interact with this page.\"],[13],[2,\"\\n  \"],[10,\"li\"],[12],[2,\"✔ Changing content before AnimationContext DOES NOT trigger sprite changes.\"],[13],[2,\"\\n  \"],[10,\"li\"],[12],[2,\"✔ Changing content within AnimationContext above sprites DOES trigger sprite changes.\"],[13],[2,\"\\n  \"],[10,\"li\"],[12],[2,\"✔ Changing content within AnimationContext below sprites DOES NOT trigger sprite changes.\"],[13],[2,\"\\n  \"],[10,\"li\"],[12],[2,\"✔ Insertions, removals and changes are batched into one changeset.\"],[13],[2,\"\\n  \"],[10,\"li\"],[12],[2,\"✔ Changing padding on AnimationContext triggers sprite changes.\"],[13],[2,\"\\n\"],[13],[2,\"\\n\"]],\"hasEval\":false,\"upvars\":[\"sprite\",\"mut\",\"action\",\"on\",\"if\",\"not\",\"and\",\"eq\"]}",
    "moduleName": "animations/templates/index.hbs"
  });

  _exports.default = _default;
});
;define("animations/templates/interruption", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _default = Ember.HTMLBars.template({
    "id": "WVwWrD75",
    "block": "{\"symbols\":[],\"statements\":[[10,\"div\"],[14,0,\"my-20 w-full max-w-md lg:max-w-2xl mx-auto px-4\"],[12],[2,\"\\n  \"],[10,\"div\"],[14,0,\"text-center max-w-lg mx-auto\"],[12],[2,\"\\n    \"],[10,\"h2\"],[14,0,\"text-4xl font-semibold leading-tight\"],[12],[2,\"\\n      Transitions can be interrupted\\n    \"],[13],[2,\"\\n    \"],[10,\"p\"],[14,0,\"mt-4 text-lg\"],[12],[2,\"\\n      Click one of the four targets to initiate a transition of the circle to the target.\\n    \"],[13],[2,\"\\n\\n    \"],[10,\"p\"],[14,0,\"text-lg mt-16\"],[12],[2,\"1 ball sprite\"],[13],[2,\"\\n    \"],[8,\"animation-context\",[[24,0,\"mt-8 h-64 w-64 m-auto\"]],[[\"@use\"],[[32,0,[\"transition\"]]]],[[\"default\"],[{\"statements\":[[2,\"\\n      \"],[10,\"div\"],[14,0,\"bg-grey-lightest relative h-64 w-64\"],[12],[2,\"\\n        \"],[11,\"button\"],[24,0,\"absolute rounded-full w-12 h-12 border-2 p-2 cursor-pointer focus:outline-none focus:shadow-outline\"],[24,5,\"top: 0; left: 0\"],[24,4,\"button\"],[4,[38,3],[\"click\",[30,[36,2],[[30,[36,1],[[32,0,[\"ballGoWhere\"]]],null],\"A\"],null]],null],[4,[38,4],[\"a\"],null],[12],[2,\"\\n          A\\n        \"],[13],[2,\"\\n        \"],[11,\"button\"],[24,5,\"top: 0; right: 0\"],[24,0,\"absolute rounded-full w-12 h-12 border-2 p-2 cursor-pointer focus:outline-none focus:shadow-outline\"],[24,4,\"button\"],[4,[38,3],[\"click\",[30,[36,2],[[30,[36,1],[[32,0,[\"ballGoWhere\"]]],null],\"B\"],null]],null],[4,[38,4],[\"b\"],null],[12],[2,\"\\n          B\\n        \"],[13],[2,\"\\n        \"],[11,\"button\"],[24,5,\"bottom: 0; left: 0\"],[24,0,\"absolute rounded-full w-12 h-12 border-2 p-2 cursor-pointer focus:outline-none focus:shadow-outline\"],[24,4,\"button\"],[4,[38,3],[\"click\",[30,[36,2],[[30,[36,1],[[32,0,[\"ballGoWhere\"]]],null],\"C\"],null]],null],[4,[38,4],[\"c\"],null],[12],[2,\"\\n          C\\n        \"],[13],[2,\"\\n        \"],[11,\"button\"],[24,5,\"bottom: 0; right: 0\"],[24,0,\"absolute rounded-full w-12 h-12 border-2 p-2 cursor-pointer focus:outline-none focus:shadow-outline\"],[24,4,\"button\"],[4,[38,3],[\"click\",[30,[36,2],[[30,[36,1],[[32,0,[\"ballGoWhere\"]]],null],\"D\"],null]],null],[4,[38,4],[\"d\"],null],[12],[2,\"\\n          D\\n        \"],[13],[2,\"\\n        \"],[11,\"div\"],[16,0,[31,[\"absolute rounded-full bg-red w-10 h-10 opacity-75 z-10 ball-position-\",[32,0,[\"ballGoWhere\"]]]]],[4,[38,0],null,[[\"id\"],[\"single-ball\"]]],[12],[13],[2,\"\\n      \"],[13],[2,\"\\n    \"]],\"parameters\":[]}]]],[2,\"\\n\\n    \"],[10,\"p\"],[14,0,\"text-lg mt-16\"],[12],[2,\"4 ball sprites\"],[13],[2,\"\\n    \"],[8,\"animation-context\",[[24,0,\"mt-8 h-64 w-64 m-auto\"]],[[\"@use\"],[[32,0,[\"transition\"]]]],[[\"default\"],[{\"statements\":[[2,\"\\n      \"],[10,\"div\"],[14,0,\"bg-grey-lightest relative h-64 w-64\"],[12],[2,\"\\n        \"],[11,\"button\"],[24,0,\"absolute rounded-full w-12 h-12 border-2 p-2 cursor-pointer focus:outline-none focus:shadow-outline\"],[24,5,\"top: 0; left: 0\"],[24,4,\"button\"],[4,[38,3],[\"click\",[30,[36,2],[[30,[36,1],[[32,0,[\"ballGoWhere\"]]],null],\"A\"],null]],null],[4,[38,4],[\"a\"],null],[12],[2,\"\\n\"],[6,[37,6],[[30,[36,5],[[32,0,[\"ballGoWhere\"]],\"A\"],null]],null,[[\"default\"],[{\"statements\":[[2,\"            \"],[11,\"div\"],[24,0,\"absolute pin rounded-full bg-red w-full h-full opacity-75 z-10 ball\"],[4,[38,0],null,[[\"id\"],[\"ball\"]]],[12],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"          A\\n        \"],[13],[2,\"\\n        \"],[11,\"button\"],[24,5,\"top: 0; right: 0\"],[24,0,\"absolute rounded-full w-24 h-24 border-2 p-2 cursor-pointer focus:outline-none focus:shadow-outline\"],[24,4,\"button\"],[4,[38,3],[\"click\",[30,[36,2],[[30,[36,1],[[32,0,[\"ballGoWhere\"]]],null],\"B\"],null]],null],[4,[38,4],[\"b\"],null],[12],[2,\"\\n\"],[6,[37,6],[[30,[36,5],[[32,0,[\"ballGoWhere\"]],\"B\"],null]],null,[[\"default\"],[{\"statements\":[[2,\"            \"],[11,\"div\"],[24,0,\"absolute pin rounded-full bg-red w-full h-full opacity-75 z-10 ball\"],[4,[38,0],null,[[\"id\"],[\"ball\"]]],[12],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"          B\\n        \"],[13],[2,\"\\n        \"],[11,\"button\"],[24,5,\"bottom: 0; left: 0\"],[24,0,\"absolute rounded-full w-24 h-12 border-2 p-2 cursor-pointer focus:outline-none focus:shadow-outline\"],[24,4,\"button\"],[4,[38,3],[\"click\",[30,[36,2],[[30,[36,1],[[32,0,[\"ballGoWhere\"]]],null],\"C\"],null]],null],[4,[38,4],[\"c\"],null],[12],[2,\"\\n\"],[6,[37,6],[[30,[36,5],[[32,0,[\"ballGoWhere\"]],\"C\"],null]],null,[[\"default\"],[{\"statements\":[[2,\"            \"],[11,\"div\"],[24,0,\"absolute pin rounded-full bg-red w-full h-full opacity-75 z-10 ball\"],[4,[38,0],null,[[\"id\"],[\"ball\"]]],[12],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"          C\\n        \"],[13],[2,\"\\n        \"],[11,\"button\"],[24,5,\"bottom: 0; right: 0\"],[24,0,\"absolute rounded-full w-12 h-24 border-2 p-2 cursor-pointer focus:outline-none focus:shadow-outline\"],[24,4,\"button\"],[4,[38,3],[\"click\",[30,[36,2],[[30,[36,1],[[32,0,[\"ballGoWhere\"]]],null],\"D\"],null]],null],[4,[38,4],[\"d\"],null],[12],[2,\"\\n\"],[6,[37,6],[[30,[36,5],[[32,0,[\"ballGoWhere\"]],\"D\"],null]],null,[[\"default\"],[{\"statements\":[[2,\"            \"],[11,\"div\"],[24,0,\"absolute pin rounded-full bg-red w-full h-full opacity-75 z-10 ball\"],[4,[38,0],null,[[\"id\"],[\"ball\"]]],[12],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"          D\\n        \"],[13],[2,\"\\n      \"],[13],[2,\"\\n    \"]],\"parameters\":[]}]]],[2,\"\\n  \"],[13],[2,\"\\n\"],[13]],\"hasEval\":false,\"upvars\":[\"sprite\",\"mut\",\"fn\",\"on\",\"on-key\",\"eq\",\"if\"]}",
    "moduleName": "animations/templates/interruption.hbs"
  });

  _exports.default = _default;
});
;define("animations/templates/list-detail", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _default = Ember.HTMLBars.template({
    "id": "EuPKdS93",
    "block": "{\"symbols\":[\"person\"],\"statements\":[[10,\"h2\"],[14,0,\"m-4 text-lg font-bold\"],[12],[2,\"\\n  List Detail\\n\"],[13],[2,\"\\n\\n\"],[8,\"animation-context\",[],[[\"@id\",\"@use\"],[\"List-Detail\",[32,0,[\"listDetailTransition\"]]]],[[\"default\"],[{\"statements\":[[2,\"\\n  \"],[10,\"div\"],[14,0,\"m-4\"],[12],[2,\"\\n\"],[6,[37,7],[[32,0,[\"selectedPerson\"]]],null,[[\"default\"],[{\"statements\":[[2,\"      \"],[11,\"ul\"],[24,0,\"person-list\"],[4,[38,1],null,[[\"role\"],[\"list\"]]],[12],[2,\"\\n\"],[6,[37,6],[[30,[36,5],[[30,[36,5],[[32,0,[\"people\"]]],null]],null]],null,[[\"default\"],[{\"statements\":[[2,\"          \"],[10,\"li\"],[12],[2,\"\\n            \"],[11,\"span\"],[24,0,\"inline-block font-bold\"],[4,[38,1],null,[[\"role\",\"id\"],[\"person-name\",[30,[36,0],[\"person:\",[32,1,[\"id\"]]],null]]]],[12],[2,\"\\n              \"],[1,[32,1,[\"name\"]]],[2,\"\\n            \"],[13],[2,\"\\n            \"],[11,\"span\"],[24,0,\"inline-block\"],[4,[38,1],null,[[\"role\",\"id\"],[\"person-title\",[30,[36,0],[\"person:\",[32,1,[\"id\"]]],null]]]],[12],[2,\"\\n              \"],[1,[32,1,[\"title\"]]],[2,\"\\n            \"],[13],[2,\"\\n            \"],[11,\"button\"],[24,0,\"border px-2 rounded-lg text-sm\"],[24,4,\"button\"],[4,[38,1],null,[[\"role\"],[\"person-button\"]]],[4,[38,4],[\"click\",[30,[36,3],[[30,[36,2],[[32,0,[\"selectedPerson\"]]],null],[32,1]],null]],null],[12],[2,\"\\n              Details >\\n            \"],[13],[2,\"\\n          \"],[13],[2,\"\\n\"]],\"parameters\":[1]}]]],[2,\"      \"],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"\\n\"],[6,[37,8],[[32,0,[\"selectedPerson\"]]],null,[[\"default\"],[{\"statements\":[[2,\"      \"],[11,\"div\"],[24,0,\"detail-card\"],[4,[38,1],null,[[\"role\",\"id\"],[\"card\",[30,[36,0],[\"person:\",[32,0,[\"selectedPerson\",\"id\"]]],null]]]],[12],[2,\"\\n        \"],[11,\"button\"],[24,0,\"border px-2 rounded-lg text-sm\"],[24,4,\"button\"],[4,[38,4],[\"click\",[30,[36,3],[[30,[36,2],[[32,0,[\"selectedPerson\"]]],null],null],null]],null],[12],[2,\"\\n          < Back\\n        \"],[13],[2,\"\\n        \"],[11,\"div\"],[4,[38,1],null,[[\"role\"],[\"spaceholder\"]]],[12],[2,\"\\n          \"],[11,\"h2\"],[24,0,\"detail-person-name font-bold\"],[4,[38,1],null,[[\"role\",\"id\"],[\"person-name\",[30,[36,0],[\"person:\",[32,0,[\"selectedPerson\",\"id\"]]],null]]]],[12],[2,\"\\n            \"],[1,[32,0,[\"selectedPerson\",\"name\"]]],[2,\"\\n          \"],[13],[2,\"\\n          \"],[11,\"h3\"],[24,0,\"detail-person-title\"],[4,[38,1],null,[[\"role\",\"id\"],[\"person-title\",[30,[36,0],[\"person:\",[32,0,[\"selectedPerson\",\"id\"]]],null]]]],[12],[2,\"\\n            \"],[1,[32,0,[\"selectedPerson\",\"title\"]]],[2,\"\\n          \"],[13],[2,\"\\n        \"],[13],[2,\"\\n        \"],[10,\"p\"],[12],[1,[32,0,[\"selectedPerson\",\"bio\"]]],[13],[2,\"\\n      \"],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"  \"],[13],[2,\"\\n\"]],\"parameters\":[]}]]],[2,\"\\n\"]],\"hasEval\":false,\"upvars\":[\"concat\",\"sprite\",\"mut\",\"fn\",\"on\",\"-track-array\",\"each\",\"unless\",\"if\"]}",
    "moduleName": "animations/templates/list-detail.hbs"
  });

  _exports.default = _default;
});
;define("animations/templates/motion-study", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _default = Ember.HTMLBars.template({
    "id": "mmbnUMcL",
    "block": "{\"symbols\":[],\"statements\":[[8,\"animation-context\",[[24,0,\"root-context\"]],[[\"@use\"],[[32,0,[\"transition\"]]]],[[\"default\"],[{\"statements\":[[2,\"\\n  \"],[1,[30,[36,1],[[30,[36,0],null,null]],null]],[2,\"\\n\"]],\"parameters\":[]}]]]],\"hasEval\":false,\"upvars\":[\"-outlet\",\"component\"]}",
    "moduleName": "animations/templates/motion-study.hbs"
  });

  _exports.default = _default;
});
;define("animations/templates/motion-study/details", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _default = Ember.HTMLBars.template({
    "id": "iyke/X9E",
    "block": "{\"symbols\":[\"@model\"],\"statements\":[[10,\"div\"],[15,0,[31,[[30,[36,0],[\"container\"],[[\"from\"],[\"animations/styles/motion-study/details\"]]]]]],[12],[2,\"\\n  \"],[8,\"motion-card\",[[16,0,[31,[[30,[36,0],[\"card\"],[[\"from\"],[\"animations/styles/motion-study/details\"]]]]]]],[[\"@identifier\"],[[32,1]]],[[\"default\"],[{\"statements\":[[2,\"\\n    \"],[10,\"h2\"],[15,0,[31,[[30,[36,0],[\"title\"],[[\"from\"],[\"animations/styles/motion-study/details\"]]]]]],[12],[2,\"Card Title\"],[13],[2,\"\\n    \"],[10,\"p\"],[12],[2,\"\\n      Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.\\n    \"],[13],[2,\"\\n  \"]],\"parameters\":[]}]]],[2,\"\\n\"],[13]],\"hasEval\":false,\"upvars\":[\"local-class\"]}",
    "moduleName": "animations/templates/motion-study/details.hbs"
  });

  _exports.default = _default;
});
;define("animations/templates/motion-study/index", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _default = Ember.HTMLBars.template({
    "id": "hgDaPgkg",
    "block": "{\"symbols\":[],\"statements\":[[10,\"div\"],[15,0,[31,[[30,[36,0],[\"grid\"],[[\"from\"],[\"animations/styles/motion-study/index\"]]]]]],[12],[2,\"\\n  \"],[8,\"motion-card\",[],[[\"@identifier\"],[1]],null],[2,\"\\n  \"],[8,\"motion-card\",[],[[\"@identifier\"],[2]],null],[2,\"\\n  \"],[8,\"motion-card\",[],[[\"@identifier\"],[3]],null],[2,\"\\n\"],[13]],\"hasEval\":false,\"upvars\":[\"local-class\"]}",
    "moduleName": "animations/templates/motion-study/index.hbs"
  });

  _exports.default = _default;
});
;define("animations/templates/routes", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _default = Ember.HTMLBars.template({
    "id": "nfNGt38c",
    "block": "{\"symbols\":[],\"statements\":[[10,\"div\"],[14,0,\"my-20 w-full max-w-md lg:max-w-2xl mx-auto px-4\"],[12],[2,\"\\n  \"],[10,\"div\"],[14,0,\"text-center max-w-lg mx-auto\"],[12],[2,\"\\n    \"],[10,\"h2\"],[14,0,\"text-4xl font-semibold leading-tight\"],[12],[2,\"\\n      Cross-route transitions\\n    \"],[13],[2,\"\\n\\n    \"],[10,\"p\"],[14,0,\"mt-4 text-lg\"],[12],[2,\"\\n      Place an <AnimationContext> around your outlet and \"],[2,\"{{sprite}} modifiers on the elements in the child templates that you want to animate.\\n    \"],[13],[2,\"\\n\\n    \"],[10,\"h3\"],[14,0,\"text-3xl font-semibold leading-tight mt-16\"],[12],[2,\"\\n      Demo\\n    \"],[13],[2,\"\\n\\n    \"],[10,\"p\"],[14,0,\"mt-4 text-lg\"],[12],[2,\"\\n      Notice that the URL changes when you click the links — these are real route transitions.\\n    \"],[13],[2,\"\\n\\n    \"],[8,\"animation-context\",[[24,0,\"w-1/4 m-auto mt-5 overflow-hidden\"]],[[\"@id\",\"@use\"],[\"routes-context\",[32,0,[\"transition\"]]]],[[\"default\"],[{\"statements\":[[2,\"\\n      \"],[1,[30,[36,1],[[30,[36,0],null,null]],null]],[2,\"\\n    \"]],\"parameters\":[]}]]],[2,\"\\n  \"],[13],[2,\"\\n\"],[13]],\"hasEval\":false,\"upvars\":[\"-outlet\",\"component\"]}",
    "moduleName": "animations/templates/routes.hbs"
  });

  _exports.default = _default;
});
;define("animations/templates/routes/index", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _default = Ember.HTMLBars.template({
    "id": "9N+use3C",
    "block": "{\"symbols\":[],\"statements\":[[11,\"div\"],[24,0,\"h-12 bg-indigo\"],[4,[38,0],null,[[\"id\"],[\"route-content-index\"]]],[12],[2,\"\\n  \"],[8,\"link-to\",[[24,0,\"text-white font-semibold flex items-center justify-center h-full\"]],[[\"@route\"],[\"routes.other\"]],[[\"default\"],[{\"statements\":[[2,\"\\n    Click me!\\n  \"]],\"parameters\":[]}]]],[2,\"\\n\"],[13],[2,\"\\n\"]],\"hasEval\":false,\"upvars\":[\"sprite\"]}",
    "moduleName": "animations/templates/routes/index.hbs"
  });

  _exports.default = _default;
});
;define("animations/templates/routes/other", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  var _default = Ember.HTMLBars.template({
    "id": "pD8bdE8A",
    "block": "{\"symbols\":[],\"statements\":[[11,\"div\"],[24,0,\"h-12 bg-green-light\"],[4,[38,0],null,[[\"id\"],[\"route-content-other\"]]],[12],[2,\"\\n  \"],[8,\"link-to\",[[24,0,\"text-white font-semibold flex items-center justify-center h-full\"]],[[\"@route\"],[\"routes.index\"]],[[\"default\"],[{\"statements\":[[2,\"\\n    Go back!\\n  \"]],\"parameters\":[]}]]],[2,\"\\n\"],[13]],\"hasEval\":false,\"upvars\":[\"sprite\"]}",
    "moduleName": "animations/templates/routes/other.hbs"
  });

  _exports.default = _default;
});
;define("animations/transforms/boolean", ["exports", "@ember-data/serializer/-private"], function (_exports, _private) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _private.BooleanTransform;
    }
  });
});
;define("animations/transforms/date", ["exports", "@ember-data/serializer/-private"], function (_exports, _private) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _private.DateTransform;
    }
  });
});
;define("animations/transforms/number", ["exports", "@ember-data/serializer/-private"], function (_exports, _private) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _private.NumberTransform;
    }
  });
});
;define("animations/transforms/string", ["exports", "@ember-data/serializer/-private"], function (_exports, _private) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _private.StringTransform;
    }
  });
});
;define("animations/transitions/fade", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = _default;

  /**
    Fades inserted, removed, and kept sprites.
  
    @function fade
    @export default
  */
  async function _default({
    context,
    removedSprites,
    insertedSprites,
    keptSprites
  }, options = {}) {
    let {
      behavior,
      duration
    } = options;

    for (let s of [...removedSprites]) {
      context.appendOrphan(s);
      s.lockStyles();
      s.setupAnimation('opacity', {
        to: 0,
        behavior,
        duration
      });
    } // TODO: if we get keptSprites of some things
    // were fading out and then we should get interrupted and decide to
    // keep them around after all.


    for (let s of [...insertedSprites, ...keptSprites]) {
      s.setupAnimation('opacity', {
        from: 0,
        behavior,
        duration
      });
    }
  }
});
;define("animations/transitions/list-detail", ["exports", "animations/models/sprite", "animations/behaviors/linear"], function (_exports, _sprite, _linear) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = listTransition;
  // FADE OUT : ----------
  // TRANSLATE:     ----------
  // FADE IN  :          ----------
  // const FADE_OUT_START = 0;
  const FADE_OUT_DURATION = 400;
  const TRANSLATE_DURATION = 600;
  const TRANSLATE_START = 400;
  const FADE_IN_DURATION = 100;
  const FADE_IN_START = 900; // const TOTAL_DURATION = FADE_IN_START + FADE_IN_DURATION;

  const LINEAR_BEHAVIOR = new _linear.default();

  function listTransition(changeset) {
    let {
      context,
      insertedSprites,
      keptSprites,
      removedSprites
    } = changeset;
    let animations = [];
    let direction = 'to-list';

    if (changeset.spriteFor({
      type: _sprite.SpriteType.Inserted,
      role: 'card'
    })) {
      direction = 'to-detail';
    }

    if (direction === 'to-list') {
      let nameSprite = changeset.spriteFor({
        role: 'person-name',
        type: _sprite.SpriteType.Kept
      });
      let titleSprite = changeset.spriteFor({
        role: 'person-title',
        type: _sprite.SpriteType.Kept
      });
      let spaceholderSprite = changeset.spriteFor({
        role: 'spaceholder'
      });
      let cardSprite = changeset.spriteFor({
        role: 'card'
      });
      (true && !(nameSprite && titleSprite && spaceholderSprite && spaceholderSprite.initialBounds && cardSprite) && Ember.assert('sprites are present', nameSprite && titleSprite && spaceholderSprite && spaceholderSprite.initialBounds && cardSprite));
      spaceholderSprite.element.style.height = `${spaceholderSprite.initialBounds.element.height}px`;

      for (let keptSprite of [nameSprite, titleSprite]) {
        let delta = keptSprite.boundsDelta;
        (true && !(keptSprite && keptSprite.initialBounds && keptSprite.finalBounds && keptSprite.counterpart && delta) && Ember.assert('keptSprite always have finalBounds and counterpart', keptSprite && keptSprite.initialBounds && keptSprite.finalBounds && keptSprite.counterpart && delta));
        context.appendOrphan(keptSprite.counterpart);
        keptSprite.counterpart.lockStyles(keptSprite.finalBounds.relativeToPosition(keptSprite.finalBounds.parent));
        keptSprite.hide();
        keptSprite.counterpart.setupAnimation('style', {
          property: 'fontSize',
          delay: TRANSLATE_START,
          duration: TRANSLATE_DURATION
        });
        keptSprite.counterpart.setupAnimation('position', {
          startX: -delta.x,
          startY: -delta.y,
          endX: 0,
          endY: 0,
          delay: TRANSLATE_START,
          duration: TRANSLATE_DURATION,
          behavior: LINEAR_BEHAVIOR
        });
        keptSprite.counterpart.setupAnimation('size', {
          delay: TRANSLATE_START,
          duration: TRANSLATE_DURATION,
          behavior: LINEAR_BEHAVIOR
        });
        let animation = keptSprite.counterpart.startAnimation();
        animations.push(animation);
      }

      context.appendOrphan(cardSprite);
      cardSprite.lockStyles();
      cardSprite.setupAnimation('opacity', {
        to: 0,
        duration: FADE_OUT_DURATION
      });
      animations.push(cardSprite.startAnimation());

      for (let insertedSprite of [...insertedSprites]) {
        insertedSprite.setupAnimation('opacity', {
          delay: FADE_IN_START,
          duration: FADE_IN_DURATION
        });
        let animation = insertedSprite.startAnimation();
        animations.push(animation);
      }

      return Promise.all(animations.map(a => a.finished)).then(() => {
        for (let keptSprite of [...keptSprites]) {
          keptSprite.unlockStyles();
        }
      });
    } else {
      let cardSprite = changeset.spriteFor({
        type: _sprite.SpriteType.Inserted,
        role: 'card'
      });
      (true && !(!!cardSprite) && Ember.assert('cardSprite is found', !!cardSprite));
      cardSprite.setupAnimation('opacity', {
        delay: FADE_IN_START,
        duration: FADE_IN_DURATION
      });
      let animation = cardSprite.startAnimation();
      animations.push(animation);

      for (let keptSprite of [...keptSprites]) {
        (true && !(keptSprite.counterpart && keptSprite.initialBounds && keptSprite.finalBounds) && Ember.assert('keptSprite always has an counterpart, initialBounds and finalBounds', keptSprite.counterpart && keptSprite.initialBounds && keptSprite.finalBounds));
        let initialBounds = keptSprite.initialBounds.relativeToPosition(keptSprite.finalBounds.parent);
        let finalBounds = keptSprite.finalBounds.relativeToPosition(keptSprite.finalBounds.parent);
        keptSprite.hide();
        let deltaX = initialBounds.left - finalBounds.left;
        let deltaY = initialBounds.top - finalBounds.top;
        context.appendOrphan(keptSprite.counterpart);
        keptSprite.counterpart.lockStyles(keptSprite.finalBounds.relativeToPosition(keptSprite.finalBounds.parent));
        keptSprite.counterpart.setupAnimation('position', {
          startX: deltaX,
          startY: deltaY,
          endX: 0,
          endY: 0,
          delay: TRANSLATE_START,
          duration: TRANSLATE_DURATION,
          behavior: LINEAR_BEHAVIOR
        });
        keptSprite.counterpart.setupAnimation('style', {
          property: 'fontSize',
          delay: TRANSLATE_START,
          duration: TRANSLATE_DURATION
        });
        let animation = keptSprite.counterpart.startAnimation();
        animations.push(animation);
      }

      for (let removedSprite of [...removedSprites]) {
        removedSprite.lockStyles();
        context.appendOrphan(removedSprite);
        removedSprite.setupAnimation('opacity', {
          to: 0,
          duration: FADE_OUT_DURATION
        });
        let animation = removedSprite.startAnimation();
        animations.push(animation);
      }

      return Promise.all(animations.map(a => a.finished)).then(() => {
        for (let keptSprite of [...keptSprites]) {
          keptSprite.unlockStyles();
        }
      });
    }
  }
});
;define("animations/transitions/magic-move", ["exports", "animations/behaviors/linear", "animations/utils/approximately-equal"], function (_exports, _linear, _approximatelyEqual) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = _default;

  /**
    Moves, scales and transforms kept sprites.
  
    @function magicMove
    @export default
  */
  function _default(changeset, options = {}) {
    let {
      keptSprites
    } = changeset;
    let {
      behavior = new _linear.default(),
      duration,
      delay
    } = options;

    for (let s of keptSprites) {
      (true && !(s.initialBounds && s.finalBounds) && Ember.assert('kept sprite should always have initialBounds & finalBounds', s.initialBounds && s.finalBounds));
      let initialBounds = s.initialBounds.relativeToContext;
      let initialStyles = s.initialComputedStyle;
      let initialVelocity = s.initialBounds.velocity; // TODO "oldInitialBounds" when interrupting to calculate Tween duration proportionally

      if (s.counterpart) {
        // This is a Sprite that has changed places in the DOM
        let counterpart = s.counterpart;
        counterpart.hide();
        (true && !(counterpart.initialBounds) && Ember.assert('counterpart sprite should always have initialBounds', counterpart.initialBounds));
        initialBounds = counterpart.initialBounds.relativeToContext;
        initialStyles = counterpart.initialComputedStyle;
      } else {
        // This is the same Sprite moving elsewhere
        initialBounds = s.initialBounds.relativeToContext;
        initialStyles = s.initialComputedStyle;
      }

      (true && !(s.finalBounds) && Ember.assert('kept sprite should always have finalBounds', s.finalBounds));
      let finalBounds = s.finalBounds.relativeToContext;
      let deltaX = finalBounds.left - initialBounds.left;
      let deltaY = finalBounds.top - initialBounds.top;
      let velocity = initialVelocity;

      if (!((0, _approximatelyEqual.default)(deltaX, 0) && (0, _approximatelyEqual.default)(deltaY, 0))) {
        s.setupAnimation('position', {
          startX: -deltaX,
          startY: -deltaY,
          duration,
          velocity,
          behavior,
          delay
        });
      } // TODO: we probably do not want to animate extremely tiny difference (i.e. decimals in the measurements)


      if (!(0, _approximatelyEqual.default)(initialBounds?.width, finalBounds.width) || !(0, _approximatelyEqual.default)(initialBounds?.height, finalBounds.height)) {
        s.setupAnimation('size', {
          startWidth: initialBounds?.width,
          startHeight: initialBounds?.height,
          duration,
          velocity,
          behavior,
          delay
        });
      } // TODO: we don't support this yet

      /*s.setupAnimation('style', {
          property: 'backgroundColor',
          from: initialStyles['backgroundColor'],
        });*/

    }
  }
});
;define("animations/utils/approximately-equal", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = approximatelyEqual;

  function approximatelyEqual(a, b, precision = 0.01) {
    return Math.abs(a - b) < precision;
  }
});
;define("animations/utils/calculate-position", ["exports", "ember-basic-dropdown/utils/calculate-position"], function (_exports, _calculatePosition) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _calculatePosition.default;
    }
  });
});
;define("animations/utils/compile-markdown", ["exports", "marked", "highlight.js/lib/core", "highlight.js/lib/languages/javascript", "highlight.js/lib/languages/css", "highlight.js/lib/languages/handlebars", "highlight.js/lib/languages/htmlbars", "highlight.js/lib/languages/json", "highlight.js/lib/languages/xml", "highlight.js/lib/languages/diff", "highlight.js/lib/languages/shell", "highlight.js/lib/languages/typescript"], function (_exports, _marked, _core, _javascript, _css, _handlebars, _htmlbars, _json, _xml, _diff, _shell, _typescript) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.highlightCode = highlightCode;
  _exports.default = compileMarkdown;

  /* eslint-disable @typescript-eslint/explicit-module-boundary-types */
  // Installed languages
  _core.default.registerLanguage('javascript', _javascript.default);

  _core.default.registerLanguage('js', _javascript.default);

  _core.default.registerLanguage('css', _css.default);

  _core.default.registerLanguage('handlebars', _handlebars.default);

  _core.default.registerLanguage('htmlbars', _htmlbars.default);

  _core.default.registerLanguage('hbs', _htmlbars.default);

  _core.default.registerLanguage('json', _json.default);

  _core.default.registerLanguage('xml', _xml.default);

  _core.default.registerLanguage('diff', _diff.default);

  _core.default.registerLanguage('shell', _shell.default);

  _core.default.registerLanguage('sh', _shell.default);

  _core.default.registerLanguage('typescript', _typescript.default);

  _core.default.registerLanguage('ts', _typescript.default);
  /**
    This function is used when `compileMarkdown` encounters code blocks while
    rendering Markdown source.
  
    You can use this function on its own if you have code snippets you want
    to highlight at run-time, for example snippets that change based on some
    user interaction.
  
    ```js
    import Component from '@ember/component';
    import dedent from 'dedent';
    import { highlightCode } from 'ember-cli-addon-docs/utils/compile-markdown';
  
    export default Component.extend({
      snippet: dedent`
        let { foo } = bar;
      `,
  
      highlightedSnippet: computed(function() {
        return highlightCode(this.snippet, 'js');
      })
    });
    ```
  
    ```hbs
    <div class='docs-bg-code-base text-grey overflow-x-scroll'>
      <div class="p-4 w-full">
        <pre>{{{highlightedSnippet}}}</pre>
      </div>
    </div>
    ```
  
    @function highlightCode
    @param {string} snippet Snippet of code
    @param {string} lang Language to use for syntax highlighting
  */


  function highlightCode(code, lang) {
    return _core.default.getLanguage(lang) ? _core.default.highlight(lang, code).value : code;
  }
  /**
    This is the function used by AddonDocs to compile Markdown into HTML, for
    example when turning `template.md` files into `template.hbs`. It includes
    some parsing options, as well as syntax highlighting for code blocks.
  
    You can use it in your own code, so your Markdown-rendered content shares the
    same styling & syntax highlighting as the content AddonDocs already handles.
  
    For example, you can use it if your Ember App has Markdown data that is
    fetched at runtime from an API:
  
    ```js
    import Component from '@ember/component';
    import compileMarkdown from 'ember-cli-addon-docs/utils/compile-markdown';
    import { htmlSafe } from '@ember/string';
  
    export default Component.extend({
      htmlBody: computed('post.body', function() {
        return htmlSafe(compileMarkdown(this.post.body));
      });
    });
    ```
  
    @function compileMarkdown
    @export default
    @param {string} source Markdown string representing the source content
    @param {object} options? Options. Pass `targetHandlebars: true` if turning MD into HBS
  */


  function compileMarkdown(source, config) {
    let tokens = _marked.default.lexer(source);

    let markedOptions = {
      highlight: highlightCode,
      renderer: new HBSRenderer(config)
    };

    if (config && config.targetHandlebars) {
      tokens = compactParagraphs(tokens);
    }

    return `<div class="docs-md">${_marked.default.parser(tokens, markedOptions).trim()}</div>`;
  } // Whitespace can imply paragraphs in Markdown, which can result
  // in interleaving between <p> tags and block component invocations,
  // so this scans the Marked tokens to turn things like this:
  //    <p>{{#my-component}}<p>
  //    <p>{{/my-component}}</p>
  // Into this:
  //    <p>{{#my-component}} {{/my-component}}</p>


  function compactParagraphs(tokens) {
    let compacted = [];
    compacted.links = tokens.links;
    let balance = 0;

    for (let token of tokens) {
      if (balance === 0) {
        compacted.push(token);
      } else if (token.text) {
        let last = compacted[compacted.length - 1];
        last.text = `${last.text} ${token.text}`;
      }

      let tokenText = token.text || '';
      let textWithoutCode = tokenText.replace(/`[\s\S]*?`/g, '');

      if (token.type === 'code') {
        textWithoutCode = '';
      }

      balance += count(/{{#/g, textWithoutCode);
      balance += count(/<[A-Z]/g, textWithoutCode);
      balance -= count(/[A-Z][^<>]+\/>/g, textWithoutCode);
      balance -= count(/{{\//g, textWithoutCode);
      balance -= count(/<\/[A-Z]/g, textWithoutCode);
    }

    return compacted;
  }

  function count(regex, string) {
    let total = 0;

    while (regex.exec(string)) total++;

    return total;
  }

  class HBSRenderer extends _marked.default.Renderer {
    constructor(config) {
      super();
      this.config = config || {};
    }

    codespan() {
      return this._processCode(super.codespan.apply(this, arguments));
    }

    code() {
      let code = this._processCode(super.code.apply(this, arguments));

      return code.replace(/^<pre>/, '<pre class="docs-md__code">');
    } // Unescape markdown escaping in general, since it can interfere with
    // Handlebars templating


    text() {
      let text = super.text.apply(this, arguments);

      if (this.config.targetHandlebars) {
        text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;|&#34;/g, '"').replace(/&apos;|&#39;/g, "'");
      }

      return text;
    } // Escape curlies in code spans/blocks to avoid treating them as Handlebars


    _processCode(string) {
      if (this.config.targetHandlebars) {
        string = this._escapeCurlies(string);
      }

      return string;
    }

    _escapeCurlies(string) {
      return string.replace(/{{/g, '&#123;&#123;').replace(/}}/g, '&#125;&#125;');
    }

    heading(text, level) {
      let id = text.toLowerCase().replace(/<\/?.*?>/g, '').replace(/[^\w]+/g, '-');
      let inner = level === 1 ? text : `<a href="#${id}" class="heading-anchor">${text}</a>`;
      return `
      <h${level} id="${id}" class="docs-md__h${level}">${inner}</h${level}>
    `;
    }

    list(text, ordered) {
      if (ordered) {
        return `
        <ol class="docs-list-decimal">${text}</ol>
      `;
      } else {
        return `
        <ul class="docs-list-disc">${text}</ul>
      `;
      }
    }

    table(header, body) {
      if (body) body = '<tbody>' + body + '</tbody>';
      return '<table class="docs-table-auto">\n' + '<thead>\n' + header + '</thead>\n' + body + '</table>\n';
    }

    tablerow(content) {
      return '<tr class="docs-table-row">\n' + content + '</tr>\n';
    }

    tablecell(content, flags) {
      let type = flags.header ? 'th' : 'td';
      let tag = flags.align ? '<' + type + ' align="' + flags.align + '" class="docs-border docs-px-4 docs-py-2">' : '<' + type + ' class="docs-border docs-px-4 docs-py-2">';
      return tag + content + '</' + type + '>\n';
    }

    hr() {
      return `<hr class="docs-md__hr">`;
    }

    blockquote(text) {
      return `<blockquote class="docs-md__blockquote">${text}</blockquote>`;
    }

    link(href, title, text) {
      let titleAttribute = title ? `title="${title}"` : '';
      return `<a href="${href}" ${titleAttribute} class="docs-md__a">${text}</a>`;
    }

  }
});
;define("animations/utils/css-to-unit-value", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.parse = parse;
  _exports.default = void 0;

  function parse(value) {
    let [, _value, unit] = `${value}`.match(/^([+-]?(?:\d+|\d*\.\d+))([a-z]*|%)$/) ?? [];
    return {
      value: Number.parseFloat(_value),
      unit: unit ?? ''
    };
  }

  var _default = {
    parse
  };
  _exports.default = _default;
});
;define("animations/utils/dedent", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = dedent;

  /* eslint-disable @typescript-eslint/explicit-module-boundary-types */
  function dedent(strings) {
    // $FlowFixMe: Flow doesn't undestand .raw
    let raw = typeof strings === 'string' ? [strings] : strings.raw; // first, perform interpolation

    let result = '';

    for (let i = 0; i < raw.length; i++) {
      result += raw[i] // join lines when there is a suppressed newline
      .replace(/\\\n[ \t]*/g, '') // handle escaped backticks
      .replace(/\\`/g, '`');

      if (i < (arguments.length <= 1 ? 0 : arguments.length - 1)) {
        result += arguments.length <= i + 1 ? undefined : arguments[i + 1];
      }
    } // now strip indentation


    let lines = result.split('\n');
    let mindent = null;
    lines.forEach(function (l) {
      let m = l.match(/^(\s+)\S+/);

      if (m) {
        let indent = m[1].length;

        if (!mindent) {
          // this is the first indented line
          mindent = indent;
        } else {
          mindent = Math.min(mindent, indent);
        }
      }
    });

    if (mindent !== null) {
      (function () {
        let m = mindent; // appease Flow

        result = lines.map(function (l) {
          return l[0] === ' ' ? l.slice(m) : l;
        }).join('\n');
      })();
    }

    return result // dedent eats leading and trailing whitespace too
    .trim() // handle escaped newlines at the end to ensure they don't get stripped too
    .replace(/\\n/g, '\n');
  }
});
;define("animations/utils/instantaneous-velocity", ["exports", "animations/behaviors/base"], function (_exports, _base) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = instantaneousVelocity;

  /**
   * Calculates an approximation of the instantaneous velocity (per second) for the given frame.
   *
   * @param index
   * @param frames
   */
  function instantaneousVelocity(index, frames) {
    let frame = frames[index].value;
    let previousFrame = index > 0 ? frames[index - 1].value : undefined;
    let nextFrame = index < frames.length - 1 ? frames[index + 1].value : undefined;

    if (previousFrame !== undefined && nextFrame !== undefined) {
      let frameDuration = 1 / _base.FPS;
      let leftVelocity = (frame - previousFrame) / frameDuration / 1000;
      let rightVelocity = (nextFrame - frame) / frameDuration / 1000;
      return (leftVelocity + rightVelocity) / 2;
    } else {
      return 0;
    }
  }
});
;define("animations/utils/keyframe-generator", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  class KeyframeGenerator {
    constructor(motions) {
      _defineProperty(this, "copiedKeyframes", new Map());

      _defineProperty(this, "copiedKeyframeAnimationOptions", new Map());

      this.motions = motions;
      this.copyMotionData();
      this.normalizeDelays();
      this.normalizeDurations();
      this.labelKeyframeOffsets();
    }

    get keyframes() {
      let result = [];

      for (let offset of this.uniqueKeyframeOffsets) {
        let keyframe = {
          offset
        };

        for (let motion of this.motions) {
          // if motion has a keyframe for this offset, add it's prop/value to the keyframe
          let motionKeyframes = this.keyframesFor(motion);
          (true && !(motionKeyframes) && Ember.assert('we have keyframes for each motion', motionKeyframes));
          let motionKeyframe = motionKeyframes.find(k => k.offset === offset);

          for (let prop in motionKeyframe) {
            if (Object.prototype.hasOwnProperty.call(motionKeyframe, prop)) {
              let value = motionKeyframe[prop];
              keyframe[prop] = value;
            }
          }
        }

        result.push(keyframe);
      }

      return result;
    }

    get keyframeAnimationOptions() {
      let result = {};

      for (let motion of this.motions) {
        let motionOptions = this.keyframeAnimationOptionsFor(motion);

        for (let prop in motionOptions) {
          if (Object.prototype.hasOwnProperty.call(motionOptions, prop)) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            result[prop] = motionOptions[prop];
          }
        }
      }

      return result;
    }

    copyMotionData() {
      for (let motion of this.motions) {
        this.copiedKeyframes.set(motion, motion.keyframes.map(k => {
          return { ...k
          };
        }));
        this.copiedKeyframeAnimationOptions.set(motion, Object.assign({}, motion.keyframeAnimationOptions));
      }
    }

    keyframesFor(motion) {
      let result = this.copiedKeyframes.get(motion);
      (true && !(result) && Ember.assert('We have a mapping of each motions keyframes', result));
      return result;
    }

    keyframeAnimationOptionsFor(motion) {
      let result = this.copiedKeyframeAnimationOptions.get(motion);
      (true && !(result) && Ember.assert('We have a mapping of each motions keyframeAnimationOptions', result));
      return result;
    }

    labelKeyframeOffsets() {
      for (let motion of this.motions) {
        let keyframes = this.keyframesFor(motion);
        keyframes[0].offset = 0;
        keyframes[keyframes.length - 1].offset = 1;

        for (let i = 0; i < keyframes.length; i++) {
          let keyframe = keyframes[i];

          if (keyframe.offset === undefined) {
            keyframe.offset = calculateOffset(keyframes, i);
          }
        }

        for (let keyframe of keyframes) {
          (true && !(keyframe.offset != null) && Ember.assert('offset has been set', keyframe.offset != null));
          keyframe.offset = Math.round(keyframe.offset * 100) / 100;
        }
      }
    }

    get uniqueKeyframeOffsets() {
      let result = new Set();

      for (let motion of this.motions) {
        let keyframes = this.keyframesFor(motion);

        for (let keyframe of keyframes) {
          (true && !(keyframe.offset != undefined) && Ember.assert('We have previously assigned an offset to every keyframe', keyframe.offset != undefined));
          result.add(keyframe.offset);
        }
      }

      return [...result].sort();
    }

    normalizeDelays() {
      for (let motion of this.motions) {
        let keyframeAnimationOptions = this.keyframeAnimationOptionsFor(motion);

        if (keyframeAnimationOptions.delay == null) {
          continue;
        }

        let keyframes = this.keyframesFor(motion);
        let delay = keyframeAnimationOptions.delay;
        let originalDuration = keyframeAnimationOptions.duration;
        let newDuration = delay + originalDuration;
        delete keyframeAnimationOptions.delay;
        keyframeAnimationOptions.duration = newDuration;
        let firstKeyframe = keyframes[0];
        let extraKeyframe = { ...firstKeyframe
        };
        keyframes.unshift(extraKeyframe);
        firstKeyframe.offset = delay / newDuration;

        for (let i = 2; i < keyframes.length - 1; i++) {
          let keyframe = keyframes[i];

          if (keyframe.offset) {
            keyframe.offset = (keyframe.offset * originalDuration + delay) / newDuration;
          }
        }
      }
    }

    normalizeDurations() {
      let durations = this.motions.map(m => this.keyframeAnimationOptionsFor(m).duration).compact();
      let maxDuration = Math.max(...durations);

      for (let motion of this.motions) {
        let keyframes = this.keyframesFor(motion);
        let keyframeAnimationOptions = this.keyframeAnimationOptionsFor(motion);

        if (keyframeAnimationOptions.duration == null) {
          keyframeAnimationOptions.duration = maxDuration;
        }

        if (keyframeAnimationOptions.duration !== maxDuration) {
          let lastKeyframe = keyframes[keyframes.length - 1];
          let extraKeyframe = { ...lastKeyframe
          };
          let originalDuration = keyframeAnimationOptions.duration;
          lastKeyframe.offset = originalDuration / maxDuration;
          keyframes.push(extraKeyframe);

          for (let i = 1; i < keyframes.length - 2; i++) {
            let keyframe = keyframes[i];

            if (keyframe.offset) {
              keyframe.offset = keyframe.offset * (originalDuration / maxDuration);
            }
          }

          keyframeAnimationOptions.duration = maxDuration;
        }
      }
    }

  }

  _exports.default = KeyframeGenerator;

  function calculateOffset(keyframes, i) {
    let previousOffset = keyframes[i - 1].offset;
    (true && !(previousOffset != null) && Ember.assert('previous offset has already been set', previousOffset != null));
    let indexOfNextKnownOffset;
    let j = i + 1;

    while (!indexOfNextKnownOffset) {
      if (keyframes[j].offset) {
        indexOfNextKnownOffset = j;
      }

      j++;
    }

    (true && !(indexOfNextKnownOffset !== undefined) && Ember.assert('There is always an indexOfNextKnownOffset', indexOfNextKnownOffset !== undefined));
    let numFrames = indexOfNextKnownOffset - (i - 1);
    let nextKnownOffset = keyframes[indexOfNextKnownOffset].offset;
    (true && !(nextKnownOffset) && Ember.assert('nextKnownOffset is defined', nextKnownOffset));
    return (nextKnownOffset - previousOffset) / numFrames + previousOffset;
  }
});
;define("animations/utils/measurement", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.getDocumentPosition = getDocumentPosition;
  _exports.calculateBoundsVelocity = calculateBoundsVelocity;
  _exports.copyComputedStyle = copyComputedStyle;
  _exports.COPIED_CSS_PROPERTIES = _exports.CopiedCSS = void 0;

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  function runWithoutAnimations(element, f) {
    let animations = element.getAnimations();
    let currentTimes = [];
    animations.forEach(a => {
      a.pause();
      currentTimes.push(a.currentTime || 0);
      let timing = a.effect && a.effect.getComputedTiming();

      if (timing) {
        a.currentTime = (timing.delay || 0) + (timing.activeDuration || 0);
      }
    });
    let result = f();

    for (let i = 0; i < animations.length; i++) {
      animations[i].currentTime = currentTimes[i];
      animations[i].play();
    }

    return result;
  }

  function runWithAnimations(element, f) {
    let animations = element.getAnimations();
    animations.forEach(a => {
      a.pause();
    });
    let result = f();

    for (let i = 0; i < animations.length; i++) {
      animations[i].play();
    }

    return result;
  }

  function runWithAnimationOffset(offset) {
    return function (element, f) {
      let animations = element.getAnimations();
      let currentTimes = [];
      animations.forEach(a => {
        a.pause();
        currentTimes.push(a.currentTime || 0);
        let timing = a.effect && a.effect.getComputedTiming();

        if (timing) {
          a.currentTime = (timing.localTime || 0) + offset;
        }
      });
      let result = f();

      for (let i = 0; i < animations.length; i++) {
        animations[i].currentTime = currentTimes[i];
        animations[i].play();
      }

      return result;
    };
  }

  function getDocumentPosition(element, opts = {
    withAnimations: false,
    withAnimationOffset: undefined
  }) {
    let wrapper = (_el, f) => f();

    (true && !(!(opts.withAnimations && opts.withAnimationOffset)) && Ember.assert('cannot set withAnimations true and withAnimationOffset', !(opts.withAnimations && opts.withAnimationOffset)));

    if (opts.withAnimations === false) {
      wrapper = runWithoutAnimations;
    } else {
      wrapper = runWithAnimations;
    }

    if (opts.withAnimationOffset) {
      wrapper = runWithAnimationOffset(opts.withAnimationOffset);
    }

    return wrapper(element, () => {
      let rect = element.getBoundingClientRect();
      return new DOMRect(rect.left + window.scrollX, rect.top + window.scrollY, rect.width, rect.height);
    });
  }

  function calculateBoundsVelocity(startBounds, endBounds, diffMs) {
    let seconds = diffMs / 1000;
    return {
      x: (endBounds.x - startBounds.x) / seconds,
      y: (endBounds.y - startBounds.y) / seconds,
      width: (endBounds.width - startBounds.width) / seconds,
      height: (endBounds.height - startBounds.height) / seconds
    };
  } // getComputedStyle returns a *live* CSSStyleDeclaration that will
  // keep changing as the element changes. So we use this to copy off a
  // snapshot of the properties we potentially care about.


  function copyComputedStyle(element) {
    let computed = getComputedStyle(element);
    let output = new CopiedCSS();

    for (let property of COPIED_CSS_PROPERTIES) {
      output[property] = computed.getPropertyValue(property);
    }

    return output;
  }

  class CopiedCSS {
    constructor() {
      _defineProperty(this, 'opacity', void 0);

      _defineProperty(this, 'font-size', void 0);

      _defineProperty(this, 'font-family', void 0);

      _defineProperty(this, 'font-weight', void 0);

      _defineProperty(this, 'color', void 0);

      _defineProperty(this, 'background-color', void 0);

      _defineProperty(this, 'border-color', void 0);

      _defineProperty(this, 'letter-spacing', void 0);

      _defineProperty(this, 'line-height', void 0);

      _defineProperty(this, 'text-align', void 0);

      _defineProperty(this, 'text-transform', void 0);

      _defineProperty(this, 'padding', void 0);

      _defineProperty(this, 'padding-top', void 0);

      _defineProperty(this, 'padding-bottom', void 0);

      _defineProperty(this, 'padding-left', void 0);

      _defineProperty(this, 'padding-right', void 0);

      _defineProperty(this, 'border-radius', void 0);

      _defineProperty(this, 'border-top-left-radius', void 0);

      _defineProperty(this, 'border-top-right-radius', void 0);

      _defineProperty(this, 'border-bottom-left-radius', void 0);

      _defineProperty(this, 'border-bottom-right-radius', void 0);

      _defineProperty(this, 'box-shadow', void 0);
    }

  }

  _exports.CopiedCSS = CopiedCSS;
  const COPIED_CSS_PROPERTIES = Object.keys(new CopiedCSS());
  _exports.COPIED_CSS_PROPERTIES = COPIED_CSS_PROPERTIES;
});
;define("animations/utils/run-animations", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = runAnimations;

  /**
   * Utility to compile & run all animations that were setup for a given changeset.
   *
   * @param sprites
   * @param time
   */
  async function runAnimations(sprites, time) {
    let animations = [];
    let promises = [];

    for (let sprite of sprites) {
      let animation = sprite.compileAnimation({
        time
      });

      if (animation) {
        animations.push(animation);
        promises.push(animation.finished);
      }
    }

    animations.forEach(a => {
      a.play();
    });
    return Promise.all(promises);
  }
});
;define("animations/utils/scheduling", ["exports"], function (_exports) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.registerCancellation = registerCancellation;
  _exports.afterRender = afterRender;
  _exports.microwait = microwait;
  const cancellation = new WeakMap();

  function registerCancellation(promise, handler) {
    cancellation.set(promise, handler);
  }

  function afterRender() {
    let ticket;
    let promise = new Promise(resolve => {
      ticket = Ember.run.schedule('afterRender', resolve);
    });
    registerCancellation(promise, () => {
      Ember.run.cancel(ticket);
    });
    return promise;
  }

  function microwait() {
    return new Promise(resolve => resolve());
  }
});
;define("animations/utils/titleize", ["exports", "ember-cli-string-helpers/utils/titleize"], function (_exports, _titleize) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  Object.defineProperty(_exports, "default", {
    enumerable: true,
    get: function () {
      return _titleize.default;
    }
  });
});
;define("animations/value/index", ["exports", "animations/behaviors/base", "animations/utils/css-to-unit-value"], function (_exports, _base, _cssToUnitValue) {
  "use strict";

  Object.defineProperty(_exports, "__esModule", {
    value: true
  });
  _exports.default = void 0;

  function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

  class BaseValue {
    // velocity between behaviors
    constructor(property, value, {
      transferVelocity
    } = {
      transferVelocity: true
    }) {
      _defineProperty(this, "previousValue", void 0);

      _defineProperty(this, "currentValue", void 0);

      _defineProperty(this, "velocity", 0);

      _defineProperty(this, "lastFrame", void 0);

      _defineProperty(this, "previousFramesFromTime", void 0);

      _defineProperty(this, "property", void 0);

      _defineProperty(this, "behavior", void 0);

      _defineProperty(this, "delay", 0);

      _defineProperty(this, "duration", 0);

      _defineProperty(this, "transferVelocity", true);

      this.property = property;
      this.previousValue = this.currentValue = value;
      this.transferVelocity = transferVelocity;
    }
    /**
     * E.g. spring, easing function
     * @param behavior
     * @param value
     * @param duration
     * @param delay
     * @param time
     */


    applyBehavior(behavior, value, duration, delay, time, velocity, _previousFrames = this.frames) {
      let previousFrames = _previousFrames ?? this.frames;
      this.velocity = velocity ?? 0;

      if (time) {
        // we don't currently interpolate between frames, we find the closest frame
        let frame = Math.min(previousFrames.length - 1, (0, _base.timeToFrame)(time));

        if (previousFrames[frame]) {
          this.currentValue = previousFrames[frame].value;
          this.velocity = previousFrames[frame].velocity;

          if (this.transferVelocity) {
            this.lastFrame = previousFrames[frame - 1];
            this.previousFramesFromTime = previousFrames.slice(frame, previousFrames.length);
          }
        }
      } else {
        this.previousFramesFromTime = undefined;
      }

      this.previousValue = this.currentValue;
      this.currentValue = value;
      this.duration = duration;
      this.behavior = behavior;
      this.delay = delay ?? 0;
    }

    get previousAsNumber() {
      if (typeof this.previousValue === 'number') {
        return this.previousValue;
      }

      return Number.parseFloat(this.previousValue);
    }

    get currentAsNumber() {
      if (typeof this.currentValue === 'number') {
        return this.currentValue;
      }

      return Number.parseFloat(this.currentValue);
    }

    get currentUnit() {
      return (0, _cssToUnitValue.parse)(this.currentValue).unit;
    }

    get frames() {
      return this.behavior?.toFrames({
        from: this.previousAsNumber,
        to: this.currentAsNumber,
        duration: this.duration,
        velocity: this.velocity,
        delay: this.delay,
        lastFrame: this.lastFrame,
        previousFramesFromTime: this.previousFramesFromTime
      }) ?? [];
    }

    get keyframes() {
      return this.frames.map(({
        value
      }) => ({
        [this.property]: this.currentUnit ? `${value}${this.currentUnit}` : value
      }));
    }

  }

  _exports.default = BaseValue;
});
;

;define('animations/config/environment', [], function() {
  var prefix = 'animations';
try {
  var metaName = prefix + '/config/environment';
  var rawConfig = document.querySelector('meta[name="' + metaName + '"]').getAttribute('content');
  var config = JSON.parse(decodeURIComponent(rawConfig));

  var exports = { 'default': config };

  Object.defineProperty(exports, '__esModule', { value: true });

  return exports;
}
catch(err) {
  throw new Error('Could not read config from meta tag with name "' + metaName + '".');
}

});

;
          if (!runningTests) {
            require("animations/app")["default"].create({"name":"animations","version":"0.0.0+e9c40a7f"});
          }
        
//# sourceMappingURL=animations.map
