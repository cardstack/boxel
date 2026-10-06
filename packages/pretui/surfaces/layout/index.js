import Component from "@glimmer/component";
import { consume, provide } from "ember-provide-consume-context";
import { modifier } from "ember-modifier";
import { precompileTemplate } from "@ember/template-compilation";
import { setComponentTemplate } from "@ember/component";
import { fn } from "@ember/helper";
import { on } from "@ember/modifier";
import { add, element, eq, lt } from "@cardstack/boxel-ui/helpers";
import { ExclamationCircle, FailureBordered, LoadingIndicator, SuccessBordered, Warning } from "@cardstack/boxel-ui/icons";
import { guidFor } from "@ember/object/internals";
import { cached, tracked } from "@glimmer/tracking";
import ContextProvider from "ember-provide-consume-context/components/context-provider";
import { action } from "@ember/object";
import { autoUpdate, computePosition, flip, hide, offset, shift } from "@floating-ui/dom";
//#region dist/coordinate-debugger-DMx2ibI_.js
function _applyDecoratedDescriptor$1(i, e, r, n, l) {
	var a = {};
	return Object.keys(n).forEach(function(i) {
		a[i] = n[i];
	}), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = true), a = r.slice().reverse().reduce(function(r, n) {
		return n(i, e, r) || r;
	}, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a;
}
function _defineProperty(e, r, t) {
	return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
		value: t,
		enumerable: true,
		configurable: true,
		writable: true
	}) : e[r] = t, e;
}
function _initializerDefineProperty$1(e, i, r, l) {
	r && Object.defineProperty(e, i, {
		enumerable: r.enumerable,
		configurable: r.configurable,
		writable: r.writable,
		value: r.initializer ? r.initializer.call(l) : void 0
	});
}
function _toPrimitive(t, r) {
	if ("object" != typeof t || !t) return t;
	var e = t[Symbol.toPrimitive];
	if (void 0 !== e) {
		var i = e.call(t, r);
		if ("object" != typeof i) return i;
		throw new TypeError("@@toPrimitive must return a primitive value.");
	}
	return ("string" === r ? String : Number)(t);
}
function _toPropertyKey(t) {
	var i = _toPrimitive(t, "string");
	return "symbol" == typeof i ? i : i + "";
}
var SCOPED_CSS_ATTRIBUTE = /^data-scopedcss-[0-9a-f]{10}-[0-9a-f]{10}$/;
var SurfaceScopeContextName = "boxel-surface:scope";
var SurfaceScopeRelay = class {
	constructor(parent) {
		_defineProperty(this, "local", /* @__PURE__ */ new Map());
		this.parent = parent;
	}
	get attributes() {
		return mergeSurfaceScopeAttributes(this.parent?.attributes ?? [], [...this.local].map(([name, value]) => ({
			name,
			value
		})));
	}
	adopt(attributes) {
		for (const attribute of attributes) this.local.set(attribute.name, attribute.value);
	}
	stamp(root) {
		stampSurfaceScope(root, this.attributes);
	}
};
function createSurfaceScopeRelay(parent) {
	return new SurfaceScopeRelay(parent);
}
function isSurfaceScopeAttribute(name) {
	return SCOPED_CSS_ATTRIBUTE.test(name);
}
function surfaceScopeAttributesForElement(element) {
	return [...element.attributes].filter((attribute) => isSurfaceScopeAttribute(attribute.name)).map((attribute) => ({
		name: attribute.name,
		value: attribute.value
	}));
}
function surfaceScopeAttributesForTree(element) {
	const scopes = [];
	let current = element;
	while (current) {
		scopes.push(...surfaceScopeAttributesForElement(current));
		current = current.parentElement;
	}
	return mergeSurfaceScopeAttributes(scopes.reverse());
}
function mergeSurfaceScopeAttributes(...attributeSets) {
	const merged = /* @__PURE__ */ new Map();
	for (const attributes of attributeSets) for (const attribute of attributes) merged.set(attribute.name, attribute.value);
	return [...merged].map(([name, value]) => ({
		name,
		value
	}));
}
function stampSurfaceScope(root, attributes) {
	if (!root || attributes.length === 0) return;
	if (isElement(root)) stampElement(root, attributes);
	for (const element of root.querySelectorAll?.("*") ?? []) stampElement(element, attributes);
}
function isElement(value) {
	return !!(value && typeof value === "object" && "nodeType" in value && value.nodeType === 1);
}
function stampElement(element, attributes) {
	for (const attribute of attributes) if (element.getAttribute(attribute.name) !== attribute.value) element.setAttribute(attribute.name, attribute.value);
}
var roots = /* @__PURE__ */ new WeakMap();
var runtimeRoots = /* @__PURE__ */ new WeakMap();
var liftRoots = /* @__PURE__ */ new WeakMap();
var surfaceElements = /* @__PURE__ */ new WeakMap();
function registerSurfaceDomRoot(element, ladder, runtime) {
	roots.set(element, ladder);
	if (runtime) runtimeRoots.set(element, runtime);
	return () => {
		roots.delete(element);
		runtimeRoots.delete(element);
	};
}
function ladderForSurfaceElement(element) {
	let current = element;
	while (current) {
		const ladder = roots.get(current);
		if (ladder) return ladder;
		current = current.parentElement;
	}
}
function surfaceRuntimeForElement(element) {
	let current = element;
	while (current) {
		const runtime = runtimeRoots.get(current);
		if (runtime) return runtime;
		current = current.parentElement;
	}
}
function registerSurfaceDomNode(runtime, id, element) {
	let elementsById = surfaceElements.get(runtime);
	if (!elementsById) {
		elementsById = /* @__PURE__ */ new Map();
		surfaceElements.set(runtime, elementsById);
	}
	let elements = elementsById.get(id);
	if (!elements) {
		elements = /* @__PURE__ */ new Set();
		elementsById.set(id, elements);
	}
	elements.add(element);
	return () => {
		elements?.delete(element);
		if (elements?.size === 0) elementsById?.delete(id);
	};
}
function registerSurfaceLiftDomRoot(element, manager) {
	liftRoots.set(element, manager);
	return () => liftRoots.delete(element);
}
function liftManagerForSurfaceElement(element) {
	let current = element;
	while (current) {
		const manager = liftRoots.get(current);
		if (manager) return manager;
		current = current.parentElement;
	}
}
function parentSurfaceIdForElement(element) {
	const parent = element.parentElement?.closest("[data-ladder-id], [data-surface-component][id]");
	return parent?.getAttribute("data-ladder-id") ?? parent?.id ?? null;
}
var textInputTypes = new Set([
	"",
	"date",
	"datetime-local",
	"email",
	"month",
	"number",
	"password",
	"search",
	"tel",
	"text",
	"time",
	"url",
	"week"
]);
var keyboardOwnerSelector = ["[data-surface-keyboard-owner]", "[data-surface-key-scope]"].join(", ");
var nativeInteractiveSelector = [
	"input",
	"textarea",
	"select",
	"button",
	"a[href]",
	"[contenteditable]:not([contenteditable=false])",
	"[role=\"button\"]",
	"[role=\"checkbox\"]",
	"[role=\"link\"]",
	"[role=\"listbox\"]",
	"[role=\"menu\"]",
	"[role=\"menuitem\"]",
	"[role=\"menuitemcheckbox\"]",
	"[role=\"menuitemradio\"]",
	"[role=\"option\"]",
	"[role=\"radio\"]",
	"[role=\"slider\"]",
	"[role=\"switch\"]",
	"[role=\"textbox\"]"
].join(", ");
var focusRetainingSelectionTargetSelector = [
	"[data-bx-lift]",
	"[data-surface-key-scope]",
	"[data-surface-preserve-focus]",
	"select",
	"textarea",
	"[contenteditable]:not([contenteditable=false])",
	"[role=\"listbox\"]",
	"[role=\"menu\"]",
	"[role=\"menuitem\"]",
	"[role=\"menuitemcheckbox\"]",
	"[role=\"menuitemradio\"]",
	"[role=\"option\"]",
	"[role=\"textbox\"]"
].join(", ");
var pointerOwnedControlSelector = [
	"[data-surface-atom-editor]",
	"[data-surface-keyboard-owner]",
	"[data-surface-key-scope]",
	"[data-surface-preserve-focus]",
	"input",
	"textarea",
	"select",
	"[contenteditable]:not([contenteditable=false])",
	"[role=\"listbox\"]",
	"[role=\"menu\"]",
	"[role=\"menuitem\"]",
	"[role=\"menuitemcheckbox\"]",
	"[role=\"menuitemradio\"]",
	"[role=\"option\"]",
	"[role=\"slider\"]",
	"[role=\"textbox\"]"
].join(", ");
var activationKeys = new Set(["Enter", " "]);
var inputOwnedRoles = new Set([
	"listbox",
	"menu",
	"menuitem",
	"menuitemcheckbox",
	"menuitemradio",
	"option",
	"slider",
	"textbox"
]);
function isSurfaceTextEntryTarget(target) {
	const control = (target instanceof Element ? target : null)?.closest("input, textarea, [contenteditable]:not([contenteditable=false]), [role=\"textbox\"]");
	if (!control) return false;
	if (control instanceof HTMLTextAreaElement) return true;
	if (control instanceof HTMLInputElement) return textInputTypes.has(control.type.toLowerCase());
	return true;
}
function surfaceTargetOwnsKeyboardEvent(event) {
	return surfaceElementOwnsKeyboardEvent(event.target instanceof Element ? event.target : null, event.key);
}
function surfaceTargetOwnsPointerEvent(target) {
	const element = target instanceof Element ? target : null;
	return Boolean(element?.closest(pointerOwnedControlSelector));
}
function surfaceElementOwnsKeyboardEvent(target, key) {
	if (!target) return false;
	if (target.closest(keyboardOwnerSelector)) return true;
	const control = target.closest(nativeInteractiveSelector);
	if (!control) return false;
	if (isSurfaceTextEntryTarget(control)) return true;
	if (control instanceof HTMLSelectElement) return true;
	if (control instanceof HTMLInputElement) {
		const type = control.type.toLowerCase();
		if (type === "range") return true;
		if (type === "checkbox" || type === "radio") return activationKeys.has(key);
		return false;
	}
	const role = control.getAttribute("role");
	if (role && inputOwnedRoles.has(role)) return true;
	if (control instanceof HTMLButtonElement || control instanceof HTMLAnchorElement || role === "button" || role === "checkbox" || role === "radio" || role === "switch") return activationKeys.has(key);
	return false;
}
function surfaceTargetRetainsBrowserFocusAfterSelection(target) {
	const element = target instanceof Element ? target : null;
	if (!element) return false;
	if (surfaceTargetOwnsPointerEvent(element)) return true;
	if (element.closest(focusRetainingSelectionTargetSelector)) return true;
	const input = element.closest("input");
	return input ? isSurfaceTextEntryTarget(input) : false;
}
var actionRoles = new Set([
	"button",
	"link",
	"menuitem",
	"menuitemcheckbox",
	"menuitemradio",
	"option",
	"switch",
	"tab"
]);
var fieldRoles = new Set([
	"checkbox",
	"combobox",
	"radio",
	"searchbox",
	"slider",
	"spinbutton",
	"textbox"
]);
var rangeItemRoles = new Set([
	"cell",
	"columnheader",
	"gridcell",
	"listitem",
	"row",
	"rowheader",
	"treeitem"
]);
var objectRoles = new Set([
	"article",
	"document",
	"figure",
	"img",
	"region"
]);
var chromeRoles = new Set([
	"banner",
	"complementary",
	"contentinfo",
	"navigation",
	"search",
	"status",
	"toolbar"
]);
var backgroundDeselectSurfaces$1 = new Set([
	"space",
	"layout",
	"canvas",
	"scene",
	"grid",
	"scroll",
	"flow",
	"outline",
	"frame",
	"pane",
	"plane"
]);
function isNativeFocusable(element) {
	return element.matches("button, a[href], input, textarea, select, [contenteditable]:not([contenteditable=false])");
}
function ariaDerivedTarget(element) {
	const role = element.getAttribute("role")?.trim().toLowerCase();
	if (role) {
		if (actionRoles.has(role)) return "action";
		if (fieldRoles.has(role)) return "field";
		if (rangeItemRoles.has(role)) return "range-item";
		if (objectRoles.has(role)) return "object";
		if (chromeRoles.has(role)) return "chrome";
		if (role === "group" || role === "presentation" || role === "none") return "structure";
	}
	switch (element.localName) {
		case "a":
		case "button": return "action";
		case "input":
		case "select":
		case "textarea": return "field";
		case "article":
		case "figure":
		case "img": return "object";
		case "aside":
		case "footer":
		case "header":
		case "nav": return "chrome";
		case "td":
		case "th":
		case "li": return "range-item";
		case "section": return element.hasAttribute("aria-label") || element.hasAttribute("aria-labelledby") ? "object" : "structure";
		default: return;
	}
}
function isTextEntryElement(element) {
	if (!element) return false;
	return isSurfaceTextEntryTarget(element) || surfaceTargetRetainsBrowserFocusAfterSelection(element) || element.matches("select");
}
function shouldDeselectBareSurfaceBackground$1(surface, element, target) {
	if (target !== element) return false;
	const override = element.getAttribute("data-surface-background");
	if (override === "select") return false;
	if (override === "deselect") return true;
	return surface !== void 0 && backgroundDeselectSurfaces$1.has(surface);
}
function shouldPreserveSurfaceFocus(target) {
	return surfaceTargetRetainsBrowserFocusAfterSelection(target);
}
function textEntryElements(element) {
	return Array.from(element.querySelectorAll("input, textarea, select, [contenteditable]:not([contenteditable=false])")).filter(isTextEntryElement);
}
function isMagneticSelectionUnit(opts) {
	return opts.surface === "cell" && opts.policy?.pointer !== "content-interactive";
}
function snapFocusToMagneticSelectionUnit(element, target, opts) {
	if (!isMagneticSelectionUnit(opts)) return;
	if (target === element) return;
	if (surfaceTargetRetainsBrowserFocusAfterSelection(target)) return;
	if (target?.closest("[data-ladder-id]") !== element) return;
	const focusElement = () => {
		if (!element.isConnected) return;
		if (element.ownerDocument.activeElement === element) return;
		element.focus({ preventScroll: true });
	};
	requestAnimationFrame(focusElement);
	setTimeout(focusElement, 0);
}
function shouldDelegateToEditor(surface, element, target) {
	if (isTextEntryElement(target)) return true;
	let editorCount = textEntryElements(element).length;
	if (surface === "cell") return editorCount > 0;
	return editorCount === 1;
}
function focusSurfaceEditor(element, target, requireSingleEditor) {
	const editor = isTextEntryElement(target) ? target : (() => {
		let editors = textEntryElements(element);
		if (requireSingleEditor && editors.length !== 1) return null;
		return editors[0] ?? null;
	})();
	if (!editor) return;
	editor.focus({ preventScroll: true });
	requestAnimationFrame(() => {
		if (!editor.isConnected) return;
		editor.focus({ preventScroll: true });
	});
	setTimeout(() => {
		if (!editor.isConnected) return;
		editor.focus({ preventScroll: true });
	}, 0);
}
function isSurfaceNodeMode(value) {
	return value === "use" || value === "change" || value === "inspect";
}
function isEnabledDataAttribute$2(value) {
	return value === "" || value === "true";
}
function modeForElement(element, mode) {
	if (mode) return mode;
	const inherited = element.closest("[data-surface-mode]")?.getAttribute("data-surface-mode") ?? null;
	return isSurfaceNodeMode(inherited) ? inherited : "use";
}
function inspectForElement(element, inspect) {
	if (inspect !== void 0) return inspect;
	const inherited = element.closest("[data-surface-inspect]")?.getAttribute("data-surface-inspect") ?? null;
	if (isEnabledDataAttribute$2(inherited)) return true;
	if (inherited === "false") return false;
	return modeForElement(element, void 0) === "inspect";
}
function selectionModeForElement(element, opts) {
	const mode = modeForElement(element, opts.mode);
	if (mode === "use" && inspectForElement(element, opts.inspect)) return "inspect";
	return mode;
}
function runtimeForNode(element, opts) {
	return opts.runtime ?? surfaceRuntimeForElement(element);
}
function runtimeClickOptionsForElement(element, opts) {
	return {
		mode: selectionModeForElement(element, opts),
		inspect: inspectForElement(element, opts.inspect)
	};
}
function semanticPathForEvent(event) {
	const ids = [];
	const seen = /* @__PURE__ */ new Set();
	for (const target of event.composedPath()) {
		if (!(target instanceof Element)) continue;
		const id = target.getAttribute("data-ladder-id");
		if (!id || seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
}
function projectedClickTargetId(owningLadder, element, opts, rawTargetId, pointerPath) {
	if (!rawTargetId) return null;
	const runtime = runtimeForNode(element, opts);
	if (runtime) {
		const traversalIds = new Set(runtime.traversalSet(runtimeClickOptionsForElement(element, opts)).ids);
		for (const id of pointerPath) if (traversalIds.has(id)) return id;
		return runtime.node(rawTargetId) ? rawTargetId : null;
	}
	return owningLadder.targetIdFor(rawTargetId, selectionModeForElement(element, opts));
}
function resolvedClickTargetId(owningLadder, element, opts, rawTargetId, event, pointerPath) {
	if (!rawTargetId) return {
		targetId: null,
		handledByRuntime: false
	};
	const runtime = runtimeForNode(element, opts);
	if (runtime) {
		const result = runtime.dispatch({
			type: "click",
			targetId: rawTargetId,
			detail: event.detail,
			additive: event.metaKey || event.ctrlKey,
			range: event.shiftKey,
			pointerPath,
			...runtimeClickOptionsForElement(element, opts)
		});
		return {
			targetId: result.ownerId,
			handledByRuntime: result.handled
		};
	}
	return {
		targetId: owningLadder.targetIdFor(rawTargetId, selectionModeForElement(element, opts)),
		handledByRuntime: false
	};
}
function isUseInteractiveTarget(target, opts) {
	return target === "action" || opts.onActivate !== void 0 || opts.onExpand !== void 0 || opts.onCollapse !== void 0 || opts.scrollOnSelect === true || opts.hoverSignal !== void 0;
}
function encodePathPart(part) {
	return encodeURIComponent(String(part));
}
function parentSurfaceForElement(element) {
	return element.parentElement?.closest("[data-surface-component]") ?? null;
}
function parentSurfaceCoordinateForElement(element) {
	const parentSurface = parentSurfaceForElement(element);
	if (!parentSurface) return { state: "none" };
	if (parentSurface.getAttribute("data-surface-coordinate-ready") !== "true") return { state: "pending" };
	const path = parentSurface.getAttribute("data-surface-coordinate") ?? parentSurface.getAttribute("data-surface-path") ?? null;
	return path ? {
		state: "ready",
		path
	} : { state: "none" };
}
function parentSurfacePathForElement(element) {
	const parentSurface = element.parentElement?.closest("[data-surface-coordinate], [data-surface-path]");
	return parentSurface?.getAttribute("data-surface-coordinate") ?? parentSurface?.getAttribute("data-surface-path") ?? null;
}
function appendPath(parentPath, keyParts) {
	const suffix = keyParts.map(encodePathPart).join(":");
	return suffix ? `${parentPath}:${suffix}` : parentPath;
}
function nearestCoordinateSpaceElement(element) {
	return element.parentElement?.closest("[data-surface-coordinate-space][data-surface-coordinate-space-id]") ?? null;
}
function coordinateSpaceForElement(element, opts, parentCoordinate = parentSurfaceCoordinateForElement(element)) {
	const local = opts.localCoordinate;
	if (opts.coordinateSpace) {
		const spaceId = opts.focusKey ?? opts.id;
		if (!spaceId) return void 0;
		const parentSpace = local ? nearestCoordinateSpaceElement(element) : null;
		const parentSpaceId = parentSpace?.getAttribute("data-surface-coordinate-space-id");
		const parentSchema = parentSpace?.getAttribute("data-surface-coordinate-space");
		return {
			coordinate: local && parentSpaceId && parentSchema ? `${parentSpaceId}[${parentSchema}]:${local}` : opts.coordinate ?? (local ? `${spaceId}[${opts.coordinateSpace}]:${local}` : `${spaceId}[${opts.coordinateSpace}]`),
			id: spaceId,
			schema: opts.coordinateSpace
		};
	}
	if (!local) return void 0;
	const parentSpace = nearestCoordinateSpaceElement(element);
	const parentSpaceId = parentSpace?.getAttribute("data-surface-coordinate-space-id");
	const parentSchema = parentSpace?.getAttribute("data-surface-coordinate-space");
	if (!parentSpaceId || !parentSchema) return void 0;
	if (parentCoordinate.path) return {
		coordinate: appendPath(parentCoordinate.path, [local]),
		id: parentSpaceId,
		schema: parentSchema
	};
	return {
		coordinate: `${parentSpaceId}[${parentSchema}]:${local}`,
		id: parentSpaceId,
		schema: parentSchema
	};
}
function shouldRefineCoordinateFromDom(source) {
	return source === "context" || source === "generated";
}
function surfaceCoordinateForElement(element, opts, parentCoordinate = parentSurfaceCoordinateForElement(element)) {
	const inheritedPath = parentCoordinate.path ?? parentSurfacePathForElement(element);
	const domCoordinate = inheritedPath ? appendPath(inheritedPath, opts.keyParts ?? []) : void 0;
	if (shouldRefineCoordinateFromDom(opts.coordinateSource) && domCoordinate) return domCoordinate;
	return opts.coordinate ?? opts.focusKey ?? (opts.generatedId ? domCoordinate : void 0);
}
var hoveredSurface = null;
var hoverSignalByRoot = /* @__PURE__ */ new WeakMap();
function clearHoveredSurface() {
	hoveredSurface?.classList.remove("is-surface-hovered");
	hoveredSurface = null;
}
function setHoveredSurface(surface) {
	if (surface === hoveredSurface) return;
	clearHoveredSurface();
	hoveredSurface = surface;
	hoveredSurface?.classList.add("is-surface-hovered");
}
function rootForSurfaceElement(element) {
	return element.closest("[data-surface-component=\"environment\"]") ?? document.body;
}
function clearRootHoverSignal(root, signal) {
	const currentSignal = hoverSignalByRoot.get(root);
	if (signal && currentSignal && currentSignal !== signal) return;
	for (const target of root.querySelectorAll(".is-surface-correspondence-hovered")) target.classList.remove("is-surface-correspondence-hovered");
	hoverSignalByRoot.delete(root);
}
function setRootHoverSignal(root, signal) {
	if (hoverSignalByRoot.get(root) === signal) return;
	clearRootHoverSignal(root);
	for (const target of root.querySelectorAll("[data-surface-hover-anchor]")) if (target.getAttribute("data-surface-hover-anchor") === signal) target.classList.add("is-surface-correspondence-hovered");
	hoverSignalByRoot.set(root, signal);
}
function surfaceIdForElement(element) {
	return element?.getAttribute("data-ladder-id") ?? null;
}
function surfaceElementById$2(root, id) {
	if (!id) return null;
	if (root.getAttribute("data-ladder-id") === id) return root;
	for (const element of root.querySelectorAll("[data-ladder-id]")) if (element.getAttribute("data-ladder-id") === id) return element;
	return null;
}
function nearestSurfaceAtPoint(root, event) {
	for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
		const surface = element.closest("[data-ladder-id]");
		if (surface && root.contains(surface)) return surface;
	}
	const fallback = event.target?.closest("[data-ladder-id]") ?? null;
	return fallback && root.contains(fallback) ? fallback : null;
}
function nearestLiftSourceForTarget(root, target) {
	const source = target?.closest("[data-surface-lift-source]") ?? null;
	return source && root.contains(source) ? source : null;
}
function nearestLiftSourceAtPoint(root, event) {
	for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
		const source = element.closest("[data-surface-lift-source]");
		if (source && root.contains(source)) return source;
	}
	return nearestLiftSourceForTarget(root, event.target);
}
function hasLiftEdges(edges) {
	return edges !== void 0 && Object.values(edges).some(Boolean);
}
var surfaceNode = modifier((element, [ladder], opts = {}) => {
	const priorLadderId = element.getAttribute("data-ladder-id");
	const priorFocusKey = element.getAttribute("data-surface-focus-key");
	const priorSurfacePath = element.getAttribute("data-surface-path");
	const priorSurfaceCoordinate = element.getAttribute("data-surface-coordinate");
	const priorSurfaceCoordinateReady = element.getAttribute("data-surface-coordinate-ready");
	const priorSurface = element.getAttribute("data-surface");
	const priorSurfaceTarget = element.getAttribute("data-surface-target");
	const priorSurfaceTargetScope = element.getAttribute("data-surface-target-scope");
	const priorTabindex = element.getAttribute("tabindex");
	const priorId = element.getAttribute("id");
	const priorAriaExpanded = element.getAttribute("aria-expanded");
	const priorAriaControls = element.getAttribute("aria-controls");
	const priorAriaDescribedBy = element.getAttribute("aria-describedby");
	const priorAriaHasPopup = element.getAttribute("aria-haspopup");
	const priorLiftSource = element.getAttribute("data-surface-lift-source");
	const priorScrollAnchor = element.getAttribute("data-surface-scroll-anchor");
	const priorScrollTarget = element.getAttribute("data-surface-scroll-target");
	const priorHoverAnchor = element.getAttribute("data-surface-hover-anchor");
	const priorHoverSignal = element.getAttribute("data-surface-hover-signal");
	const priorSurfaceActivatable = element.getAttribute("data-surface-activatable");
	const priorSurfaceExpandable = element.getAttribute("data-surface-expandable");
	const priorSurfaceExpanded = element.getAttribute("data-surface-expanded");
	const priorSurfaceDecalShape = element.getAttribute("data-surface-decal-shape");
	let cleanup = () => {};
	let didInstall = false;
	let isDestroying = false;
	let restoreFocusTimer;
	let installRetryFrame;
	let installRetryCount = 0;
	const install = () => {
		if (isDestroying || didInstall) return didInstall;
		const owningLadder = ladder ?? ladderForSurfaceElement(element);
		if (!owningLadder || !opts.id || !opts.surface) return false;
		const parentCoordinate = parentSurfaceCoordinateForElement(element);
		if (parentCoordinate.state === "pending") return false;
		const ownLiftManager = () => opts.liftManager ?? liftManagerForSurfaceElement(element);
		const runtimeCoordinateSpace = coordinateSpaceForElement(element, opts, parentCoordinate);
		const runtimeCoordinate = runtimeCoordinateSpace?.coordinate ?? surfaceCoordinateForElement(element, opts, parentCoordinate);
		const nodeId = runtimeCoordinate ? `${opts.surface}:${runtimeCoordinate}` : opts.id;
		if (!nodeId) return false;
		const unregisterLiftRoot = opts.liftManager ? registerSurfaceLiftDomRoot(element, opts.liftManager) : void 0;
		element.setAttribute("id", nodeId);
		element.setAttribute("data-ladder-id", nodeId);
		if (runtimeCoordinate) {
			element.setAttribute("data-surface-coordinate", runtimeCoordinate);
			element.setAttribute("data-surface-focus-key", runtimeCoordinate);
			element.setAttribute("data-surface-path", runtimeCoordinate);
		}
		if (runtimeCoordinateSpace) {
			element.setAttribute("data-surface-coordinate-space", runtimeCoordinateSpace.schema);
			element.setAttribute("data-surface-coordinate-space-id", runtimeCoordinateSpace.id);
			if (opts.localCoordinate) element.setAttribute("data-surface-local-coordinate", opts.localCoordinate);
		}
		element.setAttribute("data-surface-coordinate-ready", "true");
		element.setAttribute("data-surface", opts.surface);
		const target = opts.target ?? ariaDerivedTarget(element);
		if (target) element.setAttribute("data-surface-target", target);
		else element.removeAttribute("data-surface-target");
		if (opts.targetScope) element.setAttribute("data-surface-target-scope", opts.targetScope);
		else element.removeAttribute("data-surface-target-scope");
		if (hasLiftEdges(opts.lift)) element.setAttribute("data-surface-lift-source", nodeId);
		else element.removeAttribute("data-surface-lift-source");
		if (opts.policy?.decalShape) element.setAttribute("data-surface-decal-shape", opts.policy.decalShape);
		else element.removeAttribute("data-surface-decal-shape");
		const scrollAnchor = opts.scrollAnchor ?? runtimeCoordinate;
		if (scrollAnchor) element.setAttribute("data-surface-scroll-anchor", scrollAnchor);
		else element.removeAttribute("data-surface-scroll-anchor");
		const scrollTarget = opts.scrollTarget ?? runtimeCoordinate;
		if (opts.scrollOnSelect && scrollTarget) element.setAttribute("data-surface-scroll-target", scrollTarget);
		else element.removeAttribute("data-surface-scroll-target");
		const hoverAnchor = opts.hoverAnchor ?? runtimeCoordinate;
		if (hoverAnchor) element.setAttribute("data-surface-hover-anchor", hoverAnchor);
		else element.removeAttribute("data-surface-hover-anchor");
		if (opts.hoverSignal) element.setAttribute("data-surface-hover-signal", opts.hoverSignal);
		else element.removeAttribute("data-surface-hover-signal");
		if (opts.onActivate) element.setAttribute("data-surface-activatable", "true");
		else element.removeAttribute("data-surface-activatable");
		const hasDisclosure = opts.expanded !== void 0;
		if (hasDisclosure) {
			element.setAttribute("data-surface-expandable", "true");
			element.setAttribute("data-surface-expanded", String(opts.expanded ?? false));
		} else {
			element.removeAttribute("data-surface-expandable");
			element.removeAttribute("data-surface-expanded");
		}
		const parentId = parentSurfaceIdForElement(element) ?? opts.parentId ?? null;
		const sourceForLift = () => ({
			id: nodeId,
			path: runtimeCoordinate ?? opts.focusKey,
			surface: opts.surface,
			element,
			data: opts.liftData
		});
		const unregisterLiftSource = hasLiftEdges(opts.lift) ? ownLiftManager()?.registerSource(sourceForLift(), opts.lift) : void 0;
		const syncLiftAria = () => {
			if (!(opts.liftActiveSourceId !== void 0 && opts.liftActiveSourceId === nodeId && opts.liftActiveTargetId !== void 0)) {
				if (hasDisclosure) element.setAttribute("aria-expanded", String(opts.expanded ?? false));
				else element.removeAttribute("aria-expanded");
				element.removeAttribute("aria-controls");
				element.removeAttribute("aria-describedby");
				element.removeAttribute("aria-haspopup");
				return;
			}
			const kind = opts.liftActiveKind;
			const targetId = opts.liftActiveTargetId;
			if (kind === "details") {
				element.setAttribute("aria-describedby", targetId);
				element.removeAttribute("aria-haspopup");
				element.removeAttribute("aria-controls");
			} else {
				element.setAttribute("aria-controls", targetId);
				element.removeAttribute("aria-describedby");
				if (kind === "edit" || kind === "preview") element.setAttribute("aria-haspopup", "dialog");
				else if (kind === "tools") element.setAttribute("aria-haspopup", "menu");
			}
			element.setAttribute("aria-expanded", "true");
		};
		syncLiftAria();
		ownLiftManager()?.updateSourceData(nodeId, opts.liftData);
		const registration = {
			id: nodeId,
			focusKey: runtimeCoordinate,
			surface: opts.surface,
			target,
			targetScope: opts.targetScope,
			scopeId: opts.scopeId,
			scopeKind: opts.scopeKind,
			policy: opts.policy,
			grid: opts.grid,
			coordinateSpaceId: runtimeCoordinateSpace?.id,
			localCoordinate: opts.localCoordinate,
			parentId
		};
		const owningRuntime = runtimeForNode(element, opts);
		const unregister = owningLadder.register(registration);
		const unregisterDomNode = owningRuntime ? registerSurfaceDomNode(owningRuntime, nodeId, element) : void 0;
		const unregisterRuntime = owningRuntime?.register(registration);
		const invokeSelect = (event) => {
			opts.onSelect?.(event);
			if (!opts.scrollOnSelect) return;
			const targetKey = opts.scrollTarget ?? runtimeCoordinate;
			if (!targetKey) return;
			const root = element.closest("[data-surface-component=\"environment\"]") ?? document.body;
			Array.from(root.querySelectorAll("[data-surface-scroll-anchor]")).find((candidate) => candidate.getAttribute("data-surface-scroll-anchor") === targetKey)?.scrollIntoView({
				block: "center",
				inline: "nearest",
				behavior: "auto"
			});
		};
		const invokeActivate = (event) => {
			if (!opts.onActivate) return false;
			event.preventDefault();
			event.stopPropagation();
			opts.onActivate(event);
			return true;
		};
		const invokeExpand = (event) => {
			if (!opts.onExpand) return false;
			event.preventDefault();
			event.stopPropagation();
			opts.onExpand(event);
			return true;
		};
		const invokeCollapse = (event) => {
			if (!opts.onCollapse) return false;
			event.preventDefault();
			event.stopPropagation();
			opts.onCollapse(event);
			return true;
		};
		const onSurfaceActivate = (event) => {
			invokeActivate(event);
		};
		const onSurfaceExpand = (event) => {
			invokeExpand(event);
		};
		const onSurfaceCollapse = (event) => {
			invokeCollapse(event);
		};
		const onFocus = (event) => {
			if (event.target !== element) return;
			invokeSelect(event);
		};
		const scheduleHoverId = (id) => {
			setTimeout(() => {
				if (!isDestroying) owningLadder.hoverId(id);
			}, 0);
		};
		const applyHoverSignal = (active) => {
			if (!opts.hoverSignal) return;
			const root = rootForSurfaceElement(element);
			if (active) setRootHoverSignal(root, opts.hoverSignal);
			else clearRootHoverSignal(root, opts.hoverSignal);
		};
		const clearInspectHover = () => {
			const root = rootForSurfaceElement(element);
			clearRootHoverSignal(root);
			if (hoveredSurface && root.contains(hoveredSurface)) clearHoveredSurface();
			scheduleHoverId(null);
		};
		const onClick = (event) => {
			if (opts.skipClick) return;
			const target = event.target;
			if (shouldPreserveSurfaceFocus(target)) return;
			const pointerPath = semanticPathForEvent(event);
			const rawTargetId = pointerPath[0] ?? null;
			const hit = target?.closest("[data-ladder-id]");
			const liftHit = nearestLiftSourceForTarget(element, target);
			const hitTargetId = hit instanceof HTMLElement ? projectedClickTargetId(owningLadder, element, opts, rawTargetId ?? surfaceIdForElement(hit), pointerPath) : null;
			const isDirectSurfaceHit = hit === element;
			const isLiftSourceHit = liftHit === element;
			const isResolvedSurfaceHit = hitTargetId === nodeId;
			if (isDirectSurfaceHit && shouldDeselectBareSurfaceBackground$1(opts.surface, element, target)) return;
			if (isLiftSourceHit && !isDirectSurfaceHit && hit instanceof HTMLElement) {
				if (hitTargetId && hitTargetId !== nodeId) return;
			}
			if (!isDirectSurfaceHit && !isLiftSourceHit && !isResolvedSurfaceHit) return;
			const resolved = resolvedClickTargetId(owningLadder, element, opts, rawTargetId ?? nodeId, event, pointerPath);
			const targetId = resolved.targetId;
			if (targetId && !resolved.handledByRuntime) owningLadder.focusId(targetId);
			if (!isNativeFocusable(element)) invokeSelect(event);
			if (isDirectSurfaceHit && modeForElement(element, opts.mode) === "change" && shouldDelegateToEditor(opts.surface, element, target)) focusSurfaceEditor(element, target, opts.surface !== "cell");
			else snapFocusToMagneticSelectionUnit(element, target, opts);
		};
		const onPointerDown = (event) => {
			const target = event.target;
			if (shouldPreserveSurfaceFocus(target)) return;
			if (target?.closest("[data-ladder-id]") !== element) return;
			if (modeForElement(element, opts.mode) === "change" && shouldDelegateToEditor(opts.surface, element, target)) focusSurfaceEditor(element, target, opts.surface !== "cell");
		};
		const onDoubleClick = (event) => {
			const target = event.target;
			if (shouldPreserveSurfaceFocus(target)) return;
			if (isTextEntryElement(target)) return;
			const hit = target?.closest("[data-ladder-id]");
			const liftHit = nearestLiftSourceForTarget(element, target);
			const activationHit = target?.closest("[data-surface-activatable=\"true\"]");
			const isDirectSurfaceHit = hit === element;
			const isLiftSourceHit = liftHit === element;
			const isActivationHit = activationHit === element;
			if (isLiftSourceHit && !isDirectSurfaceHit && hit instanceof HTMLElement) {
				const hitTargetId = owningLadder.targetIdFor(surfaceIdForElement(hit), selectionModeForElement(element, opts));
				if (hitTargetId && hitTargetId !== nodeId) return;
			}
			if (!isDirectSurfaceHit && !isLiftSourceHit && !isActivationHit) return;
			if (isLiftSourceHit || isActivationHit) {
				const targetId = owningLadder.targetIdFor(nodeId, selectionModeForElement(element, opts));
				if (targetId) owningLadder.focusId(targetId);
			}
			if (isActivationHit && invokeActivate(event)) return;
			if (isDirectSurfaceHit && modeForElement(element, opts.mode) === "change" && shouldDelegateToEditor(opts.surface, element, target)) {
				focusSurfaceEditor(element, target, opts.surface !== "cell");
				return;
			}
			ownLiftManager()?.openForMode(sourceForLift(), opts.lift, modeForElement(element, opts.mode), "change-activate");
		};
		const onInspectHover = (event) => {
			const target = event.target;
			if (isTextEntryElement(target) || isTextEntryElement(document.activeElement)) {
				clearInspectHover();
				return;
			}
			applyHoverSignal(true);
			if (!inspectForElement(element, opts.inspect)) {
				const root = rootForSurfaceElement(element);
				if (hoveredSurface && root.contains(hoveredSurface)) clearHoveredSurface();
				scheduleHoverId(null);
				ownLiftManager()?.scheduleDismissDetails();
				return;
			}
			const liftSource = nearestLiftSourceAtPoint(element, event);
			const surface = liftSource ?? nearestSurfaceAtPoint(element, event);
			const targetId = owningLadder.targetIdFor(surfaceIdForElement(surface), "inspect");
			setHoveredSurface(surfaceElementById$2(element, targetId));
			scheduleHoverId(targetId);
			if (liftSource === element) ownLiftManager()?.scheduleHover(sourceForLift(), opts.lift, "inspect");
		};
		const onInspectLeave = (event) => {
			const relatedTarget = event.relatedTarget;
			if (relatedTarget && element.contains(relatedTarget)) return;
			requestAnimationFrame(() => {
				if (isDestroying || element.matches(":hover")) return;
				applyHoverSignal(false);
				if (hoveredSurface && element.contains(hoveredSurface)) clearHoveredSurface();
				scheduleHoverId(null);
				ownLiftManager()?.scheduleDismissDetails();
			});
		};
		let didInstallClick = false;
		let didInstallPointerDown = false;
		let didInstallHover = false;
		const updateInteractivity = () => {
			const nextMode = modeForElement(element, opts.mode);
			const inspectEnabled = inspectForElement(element, opts.inspect);
			const useInteractive = isUseInteractiveTarget(target, opts);
			if (priorTabindex === null && !isNativeFocusable(element)) if (nextMode === "use" && !inspectEnabled && !useInteractive) element.removeAttribute("tabindex");
			else element.setAttribute("tabindex", "0");
			if (nextMode === "use" && !inspectEnabled && !useInteractive) {
				if (didInstallClick) {
					element.removeEventListener("click", onClick);
					element.removeEventListener("dblclick", onDoubleClick);
					didInstallClick = false;
				}
				if (didInstallPointerDown) {
					element.removeEventListener("pointerdown", onPointerDown);
					didInstallPointerDown = false;
				}
			} else if (!didInstallClick) {
				element.addEventListener("click", onClick);
				element.addEventListener("dblclick", onDoubleClick);
				didInstallClick = true;
			}
			if (nextMode === "change" && !didInstallPointerDown) {
				element.addEventListener("pointerdown", onPointerDown);
				didInstallPointerDown = true;
			} else if (nextMode !== "change" && didInstallPointerDown) {
				element.removeEventListener("pointerdown", onPointerDown);
				didInstallPointerDown = false;
			}
			if ((inspectEnabled || opts.hoverSignal) && !didInstallHover) {
				element.addEventListener("pointerover", onInspectHover);
				element.addEventListener("pointermove", onInspectHover);
				element.addEventListener("mouseover", onInspectHover);
				element.addEventListener("mousemove", onInspectHover);
				element.addEventListener("pointerleave", onInspectLeave);
				element.addEventListener("mouseleave", onInspectLeave);
				didInstallHover = true;
			} else if (!inspectEnabled && !opts.hoverSignal && didInstallHover) {
				clearInspectHover();
				element.removeEventListener("pointerover", onInspectHover);
				element.removeEventListener("pointermove", onInspectHover);
				element.removeEventListener("mouseover", onInspectHover);
				element.removeEventListener("mousemove", onInspectHover);
				element.removeEventListener("pointerleave", onInspectLeave);
				element.removeEventListener("mouseleave", onInspectLeave);
				didInstallHover = false;
			}
		};
		updateInteractivity();
		element.addEventListener("surface-activate", onSurfaceActivate);
		element.addEventListener("surface-expand", onSurfaceExpand);
		element.addEventListener("surface-collapse", onSurfaceCollapse);
		element.addEventListener("focus", onFocus);
		const modeRoot = opts.mode ? null : element.closest("[data-surface-mode]");
		const inspectRoot = opts.inspect !== void 0 ? null : element.closest("[data-surface-inspect]");
		const modeObserver = modeRoot ? new MutationObserver(() => updateInteractivity()) : null;
		modeObserver?.observe(modeRoot, {
			attributes: true,
			attributeFilter: ["data-surface-mode"]
		});
		const inspectObserver = inspectRoot && inspectRoot !== modeRoot ? new MutationObserver(() => updateInteractivity()) : null;
		inspectObserver?.observe(inspectRoot, {
			attributes: true,
			attributeFilter: ["data-surface-inspect"]
		});
		const paint = () => {
			const projected = (runtimeForNode(element, opts)?.projection({ mode: selectionModeForElement(element, opts) }))?.nodeMap.get(nodeId);
			const surfaceAdornments = new Set(projected?.surfaceAdornments ?? projected?.visualAdornments ?? []);
			const isFocused = projected ? surfaceAdornments.has("focus") : owningLadder.isFocused(nodeId);
			const isSelected = projected ? surfaceAdornments.has("selection") : owningLadder.isFocused(nodeId);
			const isOnFocusPath = projected ? projected.focusPath && !projected.focused && !isFocused : owningLadder.isOnFocusPath(nodeId);
			element.classList.toggle("is-surface-focused", isFocused);
			element.classList.toggle("is-surface-selected", isSelected);
			element.classList.toggle("is-surface-focus-path", isOnFocusPath && !isFocused);
			element.classList.toggle("is-surface-edit-anchor", surfaceAdornments.has("edit-anchor"));
			setDatasetValue(element, "surfaceVisualAdornments", projected?.visualAdornments.join(" ") ?? "");
			setDatasetValue(element, "surfaceAdornments", projected?.surfaceAdornments.join(" ") ?? "");
			setDatasetValue(element, "surfaceDecalAdornments", projected?.decalAdornments.join(" ") ?? "");
			setDatasetValue(element, "surfaceSuppressedAdornments", projected?.suppressedAdornments.join(" ") ?? "");
			setDatasetValue(element, "surfaceDecalShape", projected?.decalShape ?? opts.policy?.decalShape ?? "");
			element.classList.toggle("is-ladder-focused", isFocused);
			element.classList.toggle("is-ladder-selected", isSelected);
		};
		const unsubscribe = owningLadder.subscribe(() => paint());
		const unsubscribeRuntime = owningRuntime?.subscribeSelection(() => paint());
		const shouldRestoreFocus = owningLadder.consumeRestoredFocusId(nodeId);
		const restoreFocus = () => {
			if (!isDestroying && element.isConnected) element.focus({ preventScroll: true });
		};
		queueMicrotask(() => {
			if (shouldRestoreFocus) restoreFocus();
			paint();
		});
		if (shouldRestoreFocus) restoreFocusTimer = setTimeout(restoreFocus, 0);
		cleanup = () => {
			if (restoreFocusTimer !== void 0) clearTimeout(restoreFocusTimer);
			unregisterLiftSource?.();
			unregisterLiftRoot?.();
			modeObserver?.disconnect();
			inspectObserver?.disconnect();
			element.removeEventListener("click", onClick);
			element.removeEventListener("dblclick", onDoubleClick);
			element.removeEventListener("pointerdown", onPointerDown);
			element.removeEventListener("surface-activate", onSurfaceActivate);
			element.removeEventListener("surface-expand", onSurfaceExpand);
			element.removeEventListener("surface-collapse", onSurfaceCollapse);
			element.removeEventListener("focus", onFocus);
			element.removeEventListener("pointerover", onInspectHover);
			element.removeEventListener("pointermove", onInspectHover);
			element.removeEventListener("mouseover", onInspectHover);
			element.removeEventListener("mousemove", onInspectHover);
			element.removeEventListener("pointerleave", onInspectLeave);
			element.removeEventListener("mouseleave", onInspectLeave);
			clearInspectHover();
			if (owningLadder.hoveredId === nodeId) setTimeout(() => owningLadder.hoverId(null), 0);
			unsubscribe();
			unsubscribeRuntime?.();
			unregister();
			unregisterDomNode?.();
			unregisterRuntime?.();
			element.classList.remove("is-ladder-focused", "is-ladder-selected", "is-surface-focused", "is-surface-selected", "is-surface-focus-path", "is-surface-edit-anchor");
			delete element.dataset["surfaceVisualAdornments"];
			delete element.dataset["surfaceAdornments"];
			delete element.dataset["surfaceDecalAdornments"];
			delete element.dataset["surfaceDecalShape"];
			delete element.dataset["surfaceSuppressedAdornments"];
			if (priorLadderId === null) element.removeAttribute("data-ladder-id");
			else element.setAttribute("data-ladder-id", priorLadderId);
			if (priorFocusKey === null) element.removeAttribute("data-surface-focus-key");
			else element.setAttribute("data-surface-focus-key", priorFocusKey);
			if (priorSurfacePath === null) element.removeAttribute("data-surface-path");
			else element.setAttribute("data-surface-path", priorSurfacePath);
			if (priorSurfaceCoordinate === null) element.removeAttribute("data-surface-coordinate");
			else element.setAttribute("data-surface-coordinate", priorSurfaceCoordinate);
			if (priorSurfaceCoordinateReady === null) element.removeAttribute("data-surface-coordinate-ready");
			else element.setAttribute("data-surface-coordinate-ready", priorSurfaceCoordinateReady);
			if (priorSurface === null) element.removeAttribute("data-surface");
			else element.setAttribute("data-surface", priorSurface);
			if (priorSurfaceTarget === null) element.removeAttribute("data-surface-target");
			else element.setAttribute("data-surface-target", priorSurfaceTarget);
			if (priorSurfaceTargetScope === null) element.removeAttribute("data-surface-target-scope");
			else element.setAttribute("data-surface-target-scope", priorSurfaceTargetScope);
			if (priorTabindex === null) element.removeAttribute("tabindex");
			else element.setAttribute("tabindex", priorTabindex);
			if (priorId === null) element.removeAttribute("id");
			else element.setAttribute("id", priorId);
			if (priorAriaExpanded === null) element.removeAttribute("aria-expanded");
			else element.setAttribute("aria-expanded", priorAriaExpanded);
			if (priorAriaControls === null) element.removeAttribute("aria-controls");
			else element.setAttribute("aria-controls", priorAriaControls);
			if (priorAriaDescribedBy === null) element.removeAttribute("aria-describedby");
			else element.setAttribute("aria-describedby", priorAriaDescribedBy);
			if (priorAriaHasPopup === null) element.removeAttribute("aria-haspopup");
			else element.setAttribute("aria-haspopup", priorAriaHasPopup);
			if (priorLiftSource === null) element.removeAttribute("data-surface-lift-source");
			else element.setAttribute("data-surface-lift-source", priorLiftSource);
			if (priorScrollAnchor === null) element.removeAttribute("data-surface-scroll-anchor");
			else element.setAttribute("data-surface-scroll-anchor", priorScrollAnchor);
			if (priorScrollTarget === null) element.removeAttribute("data-surface-scroll-target");
			else element.setAttribute("data-surface-scroll-target", priorScrollTarget);
			if (priorHoverAnchor === null) element.removeAttribute("data-surface-hover-anchor");
			else element.setAttribute("data-surface-hover-anchor", priorHoverAnchor);
			if (priorHoverSignal === null) element.removeAttribute("data-surface-hover-signal");
			else element.setAttribute("data-surface-hover-signal", priorHoverSignal);
			if (priorSurfaceActivatable === null) element.removeAttribute("data-surface-activatable");
			else element.setAttribute("data-surface-activatable", priorSurfaceActivatable);
			if (priorSurfaceExpandable === null) element.removeAttribute("data-surface-expandable");
			else element.setAttribute("data-surface-expandable", priorSurfaceExpandable);
			if (priorSurfaceExpanded === null) element.removeAttribute("data-surface-expanded");
			else element.setAttribute("data-surface-expanded", priorSurfaceExpanded);
			if (priorSurfaceDecalShape === null) element.removeAttribute("data-surface-decal-shape");
			else element.setAttribute("data-surface-decal-shape", priorSurfaceDecalShape);
		};
		didInstall = true;
		return true;
	};
	const scheduleInstallRetry = () => {
		queueMicrotask(() => {
			if (install()) return;
			const retry = () => {
				installRetryFrame = void 0;
				if (isDestroying || install()) return;
				installRetryCount += 1;
				if (installRetryCount < 30) installRetryFrame = requestAnimationFrame(retry);
			};
			installRetryFrame = requestAnimationFrame(retry);
		});
	};
	scheduleInstallRetry();
	return () => {
		isDestroying = true;
		if (installRetryFrame !== void 0) cancelAnimationFrame(installRetryFrame);
		queueMicrotask(cleanup);
	};
});
function setDatasetValue(element, key, value) {
	if (element.dataset[key] !== value) element.dataset[key] = value;
}
var backgroundDeselectSurfaces = new Set([
	"space",
	"layout",
	"canvas",
	"scene",
	"grid",
	"scroll",
	"flow",
	"outline",
	"frame",
	"pane",
	"plane"
]);
function pathContainsPreserveFocus(event) {
	return event.composedPath().some((entry) => entry instanceof Element && (entry.hasAttribute("data-surface-preserve-focus") || entry.hasAttribute("data-surface-key-scope") || entry.closest("[data-surface-preserve-focus]") !== null || entry.closest("[data-surface-key-scope]") !== null));
}
function isEnabledDataAttribute$1(value) {
	return value === "" || value === "true";
}
function shouldDeselectBareSurfaceBackground(hit, target) {
	if (target !== hit) return false;
	const override = hit.getAttribute("data-surface-background");
	if (override === "select") return false;
	if (override === "deselect") return true;
	const surface = hit.getAttribute("data-surface");
	return surface !== null && backgroundDeselectSurfaces.has(surface);
}
function editableElements(element) {
	return Array.from(element.querySelectorAll("[data-surface-inline-edit=\"true\"], input, textarea, select, [contenteditable]:not([contenteditable=false])")).filter((candidate, index, candidates) => candidate.isConnected && candidates.indexOf(candidate) === index);
}
function isEditorElement(element) {
	return Boolean(element?.matches("[data-surface-inline-edit=\"true\"], input, textarea, select, [contenteditable]:not([contenteditable=false])"));
}
function changeEditorForSurface(surface) {
	if (isEditorElement(surface)) return surface;
	const inlineEditors = editableElements(surface).filter((candidate) => candidate.getAttribute("data-surface-inline-edit") === "true");
	if (inlineEditors.length === 1) return inlineEditors[0];
	if (inlineEditors.length > 1) return null;
	const editors = editableElements(surface);
	return editors.length === 1 ? editors[0] : null;
}
function focusChangeEditor(surface) {
	const editor = changeEditorForSurface(surface);
	if (!editor) return false;
	editor.focus({ preventScroll: true });
	requestAnimationFrame(() => {
		if (!editor.isConnected) return;
		editor.focus({ preventScroll: true });
	});
	setTimeout(() => {
		if (!editor.isConnected) return;
		editor.focus({ preventScroll: true });
	}, 0);
	return true;
}
function shouldFocusRootOnPointerDown(root, target) {
	if (!target || !(target instanceof Element)) return false;
	if (!root.contains(target)) return false;
	if (isSurfaceTextEntryTarget(target)) return false;
	const interactive = target.closest("button, a[href], input, textarea, select, [contenteditable=true], [role=\"button\"], [role=\"menuitem\"], [role=\"option\"], [tabindex]");
	return interactive === null || interactive === root;
}
/** Predicate: should this ladder LEAVE ITSELF ALONE (not clear)
*  given a click on `target`?
*
*  Two yes-answers:
*
*    (a) Target is inside `root` AND walked up to a [data-ladder-id]
*        ancestor that's also inside root. The cell's own click
*        handler will / has set focus.
*
*    (b) Target is OUTSIDE `root` (typical for a popover portaled
*        to body / a canvas renderer / a top-layer dialog) but the
*        nearest [data-ladder-id] ancestor's id is registered in
*        OUR ladder. The lift belongs to us — the user is editing
*        a cell we own, just in a portaled lift surface. Clearing
*        here would close the editing context the user is actively
*        working in.
*
*  Detached targets (target.isConnected === false) also return true.
*  Rationale: a cell's pointerdown handler can call ladder.select(),
*  which mutates tracked state and (in some Glimmer setups) flushes
*  a re-render synchronously, which destroys the cell DOM, which
*  detaches the original click target. Treating detached targets as
*  ladder targets is the safer default: a real background click
*  never has a detached target at this point.
*
*  Returns false to mean "this was a background click — clear". */
function clickedOnLadderTarget(root, target, ladder) {
	if (!target || !(target instanceof Element)) return false;
	if (!target.isConnected) return true;
	if (target.closest("[data-surface-preserve-focus]")) return true;
	const hit = target.closest("[data-ladder-id]");
	if (!hit) return false;
	const id = hit.getAttribute("data-ladder-id");
	if (!id) return false;
	if (root.contains(hit)) return !shouldDeselectBareSurfaceBackground(hit, target);
	return ladder.getNode(id) !== null;
}
function surfaceElementFromTarget(root, target) {
	if (!target || !(target instanceof Element)) return null;
	const hit = target.closest("[data-ladder-id]");
	if (!hit || !root.contains(hit)) return null;
	return hit;
}
function magneticSelectionSurfaceFromTarget(root, target) {
	if (!target || !(target instanceof Element)) return null;
	if (!root.contains(target)) return null;
	if (surfaceTargetRetainsBrowserFocusAfterSelection(target)) return null;
	const hit = target.closest("[data-ladder-id][data-surface=\"cell\"], [data-ladder-id][data-surface-component=\"cell\"]");
	if (!hit || !root.contains(hit) || hit === target) return null;
	if (hit.getAttribute("data-surface-pointer") === "content-interactive") return null;
	return hit;
}
function focusMagneticSelectionSurface(surface) {
	const focusSurfaceElement = () => {
		if (!surface.isConnected) return;
		if (surface.ownerDocument.activeElement === surface) return;
		surface.focus({ preventScroll: true });
	};
	requestAnimationFrame(focusSurfaceElement);
	setTimeout(focusSurfaceElement, 0);
}
function surfaceIdFromTarget(root, target, ladder) {
	const id = surfaceElementFromTarget(root, target)?.getAttribute("data-ladder-id") ?? null;
	if (!id || !ladder.getNode(id)) return null;
	return id;
}
function surfaceElementById$1(root, id) {
	if (root.getAttribute("data-ladder-id") === id) return root;
	for (const element of root.querySelectorAll("[data-ladder-id]")) if (element.getAttribute("data-ladder-id") === id) return element;
	return null;
}
function runtimeHasSplitFocus(runtime) {
	if (!runtime) return false;
	const snapshot = runtime.snapshot();
	if (snapshot.input !== null) return true;
	const transfer = snapshot.transfer;
	if (!transfer) return false;
	if (transfer.kind === "copy" && !transfer.destination) return false;
	if (transfer.kind === "drag") return transfer.movedPastThreshold === true;
	return transfer.destination !== void 0;
}
function runtimeSelectionAlreadyOwnsFocus(runtime, id) {
	const snapshot = runtime.snapshot();
	if (snapshot.focusedId !== id) return false;
	if (runtime.node(id)?.policy?.selection === "none") return true;
	return Object.values(snapshot.selections).some((selection) => selection.headId === id && selection.ids.includes(id));
}
function runtimeHasActiveRangeHead(runtime, id) {
	return Object.values(runtime.snapshot().selections).some((selection) => selection.headId === id && selection.ids.length > 1);
}
function syncRuntimeToNavigationFocus(runtime, id) {
	if (!runtime || runtimeHasSplitFocus(runtime)) return;
	if (!runtime.node(id)) return;
	if (runtimeSelectionAlreadyOwnsFocus(runtime, id)) return;
	if (runtimeHasActiveRangeHead(runtime, id)) return;
	runtime.select(id);
}
function activeRuntimeFocusId(runtime) {
	if (!runtime || runtimeHasSplitFocus(runtime)) return null;
	return runtime.snapshot().focusedId;
}
function focusSurface(root, ladder, id, options = {}) {
	const { runtime, syncRuntime = true, ...focusOptions } = options;
	const target = surfaceElementById$1(root, id);
	if (!target) return false;
	if (syncRuntime) syncRuntimeToNavigationFocus(runtime, id);
	if (ladder.focusedId !== id) ladder.focusId(id);
	target.focus(focusOptions);
	return true;
}
function revealSurface(root, reveal) {
	if (!reveal || reveal.block === "none" && reveal.inline === "none") return;
	surfaceElementById$1(root, reveal.targetId)?.scrollIntoView({
		block: reveal.block === "none" ? "nearest" : reveal.block,
		inline: reveal.inline === "none" ? "nearest" : reveal.inline
	});
}
function targetModeForRoot$1(root) {
	const mode = root.getAttribute("data-surface-mode");
	const inspect = isEnabledDataAttribute$1(root.getAttribute("data-surface-inspect"));
	if (mode === "use" && inspect) return "inspect";
	if (mode === "use" || mode === "change" || mode === "inspect") return mode;
	return "use";
}
function runtimeModeForTargetMode$1(mode) {
	return mode === "debug" ? "debug" : mode;
}
function runtimeTraversalOptionsForRoot(root, mode) {
	return {
		mode: runtimeModeForTargetMode$1(mode),
		inspect: isEnabledDataAttribute$1(root.getAttribute("data-surface-inspect"))
	};
}
function runtimeTraversalIds(root, runtime, mode, view) {
	if (!runtime || view === "all") return null;
	return runtime.traversalSet(runtimeTraversalOptionsForRoot(root, mode)).ids;
}
function runtimeNavigationIdFor(root, runtime, id, mode, view) {
	if (!runtime || view === "all" || !id) return null;
	const ids = runtimeTraversalIds(root, runtime, mode, view);
	if (!ids) return null;
	const traversalIds = new Set(ids);
	let cursor = runtime.node(id);
	while (cursor) {
		if (traversalIds.has(cursor.id)) return cursor.id;
		if (cursor.parentId === null) return null;
		cursor = runtime.node(cursor.parentId);
	}
	return null;
}
function runtimeStepNavigationId(root, runtime, id, mode, view, delta) {
	const ids = runtimeTraversalIds(root, runtime, mode, view);
	if (!ids || ids.length === 0) return null;
	if (!id) return delta > 0 ? ids[0] : ids[ids.length - 1];
	const current = runtimeNavigationIdFor(root, runtime, id, mode, view);
	if (!current) return delta > 0 ? ids[0] : ids[ids.length - 1];
	const index = ids.indexOf(current);
	return index >= 0 ? ids[index + delta] ?? null : null;
}
function runtimeFirstChildNavigationId(root, runtime, id, mode, view) {
	const ids = runtimeTraversalIds(root, runtime, mode, view);
	if (!runtime || !ids) return null;
	const traversalIds = new Set(ids);
	const visit = (parentId) => {
		for (const node of runtime.registrations()) {
			if (node.parentId !== parentId) continue;
			if (traversalIds.has(node.id)) return node.id;
			const descendant = visit(node.id);
			if (descendant) return descendant;
		}
		return null;
	};
	return visit(id);
}
function runtimeParentNavigationId(root, runtime, id, mode, view) {
	if (!runtime || view === "all") return null;
	const ids = runtimeTraversalIds(root, runtime, mode, view);
	if (!ids) return null;
	const traversalIds = new Set(ids);
	let cursor = runtime.node(id);
	while (cursor?.parentId) {
		cursor = runtime.node(cursor.parentId);
		if (cursor && traversalIds.has(cursor.id)) return cursor.id;
	}
	return null;
}
function directionForArrowKey(key) {
	switch (key) {
		case "ArrowLeft": return "left";
		case "ArrowRight": return "right";
		case "ArrowUp": return "up";
		case "ArrowDown": return "down";
		default: throw new Error(`Unsupported arrow key: ${key}`);
	}
}
function changeRouteForRoot(root) {
	const route = root.getAttribute("data-surface-change-route");
	if (route === "inline" || route === "lifted" || route === "auto") return route;
	return "auto";
}
function activeLiftOwnsDomFocus(root) {
	const manager = liftManagerForSurfaceElement(root);
	if (!manager?.isOpen) return false;
	return manager.kind === "edit" || manager.kind === "tools";
}
function liftSourceIdForSurface(surface) {
	return surface.getAttribute("data-surface-lift-source");
}
function singleDescendantLiftSourceId(surface) {
	const ids = /* @__PURE__ */ new Set();
	for (const descendant of surface.querySelectorAll("[data-surface-lift-source]")) {
		const id = descendant.getAttribute("data-surface-lift-source");
		if (id) ids.add(id);
		if (ids.size > 1) return null;
	}
	return [...ids][0] ?? null;
}
function surfaceKindForElement(surface) {
	return surface.getAttribute("data-surface");
}
function openChangeLiftForSurface(root, surface) {
	const manager = liftManagerForSurfaceElement(root);
	if (!manager) return false;
	const sourceId = liftSourceIdForSurface(surface);
	if (sourceId) {
		if (manager.openForModeBySourceId(sourceId, "change", "change-activate")) return true;
	}
	const descendantSourceId = singleDescendantLiftSourceId(surface);
	if (!descendantSourceId) return false;
	const sourceOverride = {
		id: surface.getAttribute("data-ladder-id") ?? descendantSourceId,
		path: surface.getAttribute("data-surface-coordinate") ?? void 0,
		element: surface
	};
	const surfaceKind = surfaceKindForElement(surface);
	if (surfaceKind) sourceOverride.surface = surfaceKind;
	return manager.openForModeBySourceId(descendantSourceId, "change", "change-activate", sourceOverride);
}
function activateChangeTarget(root, surface) {
	const route = changeRouteForRoot(root);
	if (route !== "lifted" && focusChangeEditor(surface)) return true;
	if (route !== "inline" && openChangeLiftForSurface(root, surface)) return true;
	return route === "inline" ? focusChangeEditor(surface) : false;
}
function navigationViewForOptions(opts) {
	return opts.navigationView ?? "targets";
}
function navigationIdFor(ladder, id, mode, view) {
	if (view === "all") return id && ladder.getNode(id) ? id : null;
	return ladder.targetIdFor(id, mode);
}
function firstNavigationId(ladder, mode, view) {
	return view === "all" ? ladder.firstId() : ladder.firstTargetId(mode);
}
function lastNavigationId(ladder, mode, view) {
	return view === "all" ? ladder.lastId() : ladder.lastTargetId(mode);
}
function nextNavigationId(ladder, id, mode, view) {
	return view === "all" ? ladder.nextInTree(id) : ladder.nextTargetInTree(id, mode);
}
function prevNavigationId(ladder, id, mode, view) {
	return view === "all" ? ladder.prevInTree(id) : ladder.prevTargetInTree(id, mode);
}
function firstChildNavigationId(ladder, id, mode, view) {
	if (view === "targets") return ladder.firstChildTargetId(id, mode);
	return ladder.childrenOf(id)[0] ?? null;
}
function parentNavigationId(ladder, id, mode, view) {
	return view === "all" ? ladder.parentOf(id) : ladder.parentTargetId(id, mode);
}
function dispatchSurfaceCommand(surface, command, originalEvent) {
	const event = new CustomEvent(command, {
		bubbles: false,
		cancelable: true,
		detail: { originalEvent }
	});
	if (surface.dispatchEvent(event)) return false;
	originalEvent.preventDefault();
	originalEvent.stopPropagation();
	return true;
}
function scopedPatternElement(root, currentId, pattern) {
	return surfaceElementById$1(root, currentId)?.closest(`[data-surface-pattern="${pattern}"]`) ?? null;
}
function navigationIdsWithin(scope, ladder, mode, view) {
	const ids = [];
	for (const surface of scope.querySelectorAll("[data-ladder-id]")) {
		const id = surface.getAttribute("data-ladder-id");
		if (!id || ids.includes(id)) continue;
		if (view === "all" || ladder.isEligibleTarget(id, mode)) ids.push(id);
	}
	return ids;
}
function scopedNavigationId(root, ladder, currentId, mode, view, delta) {
	const scope = scopedPatternElement(root, currentId, "disclosure-tree");
	if (!scope) return null;
	const ids = navigationIdsWithin(scope, ladder, mode, view);
	const currentNavigationId = navigationIdFor(ladder, currentId, mode, view);
	if (!currentNavigationId) return ids[0] ?? null;
	const index = ids.indexOf(currentNavigationId);
	if (index < 0) return ids[0] ?? null;
	return ids[index + delta] ?? null;
}
function handleDisclosureTreeKey(root, ladder, runtime, currentId, mode, view, event) {
	const scope = scopedPatternElement(root, currentId, "disclosure-tree");
	if (!scope) return false;
	const surface = surfaceElementById$1(root, currentId);
	if (!surface || !scope.contains(surface)) return false;
	if (event.key === "Enter") return dispatchSurfaceCommand(surface, "surface-activate", event);
	if (event.key === "ArrowRight") {
		if (surface.getAttribute("data-surface-expandable") === "true" && surface.getAttribute("data-surface-expanded") !== "true" && dispatchSurfaceCommand(surface, "surface-expand", event)) return true;
	}
	if (event.key === "ArrowLeft") {
		if (surface.getAttribute("data-surface-expandable") === "true" && surface.getAttribute("data-surface-expanded") === "true" && dispatchSurfaceCommand(surface, "surface-collapse", event)) return true;
		const parentId = parentNavigationId(ladder, currentId, mode, view);
		const parentSurface = parentId ? surfaceElementById$1(root, parentId) : null;
		if (parentId && parentSurface && scope.contains(parentSurface)) {
			event.preventDefault();
			return focusSurface(root, ladder, parentId, { runtime });
		}
	}
	return false;
}
function closestActivatableSurface(root, surface) {
	const activatable = surface?.closest("[data-surface-activatable=\"true\"]") ?? null;
	return activatable && root.contains(activatable) ? activatable : null;
}
/**
* The modifier. Public API:
*
*   <main {{surfaceRoot this.ladder}}>
*
* The modifier accepts a single positional arg: the FocusLadder it
* coordinates. Hosts that want to skip one of the two effects
* (e.g., they own keyboard handling themselves) can pass options:
*
*   <main {{surfaceRoot this.ladder skipKeyboard=true}}>
*
* Both effects default ON.
*/
var surfaceRoot = modifier((element, [ladder], opts = {}) => {
	const didAddTabindex = element.getAttribute("tabindex") === null && !opts.skipKeyboard;
	if (didAddTabindex) element.setAttribute("tabindex", "0");
	const unregisterDomRoot = registerSurfaceDomRoot(element, ladder, opts.runtime);
	let syncFocusTimer;
	const shouldDeselectOnEscape = () => opts.skipEscapeDeselect !== true;
	const canRootOwnDeselectForEvent = (event) => {
		const target = event.target;
		if (!target || !(target instanceof Element)) return true;
		if (pathContainsPreserveFocus(event)) return false;
		if (activeLiftOwnsDomFocus(element)) return false;
		return true;
	};
	const clearSurfaceSelection = (reason, focusRoot, event) => {
		const runtimeSnapshot = opts.runtime?.snapshot();
		const runtimeHasInteraction = Boolean(runtimeSnapshot?.focusedId || runtimeSnapshot?.hoveredId || Object.keys(runtimeSnapshot?.selections ?? {}).length > 0);
		if (ladder.focusedId === null && ladder.hoveredId === null && !runtimeHasInteraction) return false;
		ladder.clear();
		ladder.hoverId(null);
		if (!runtimeHasSplitFocus(opts.runtime)) opts.runtime?.clearInteractionState();
		event?.preventDefault();
		event?.stopPropagation();
		element.dispatchEvent(new CustomEvent("surface-deselect", {
			bubbles: true,
			detail: { reason }
		}));
		if (focusRoot) element.focus({ preventScroll: true });
		return true;
	};
	let lastNavAt = 0;
	const markNav = () => {
		lastNavAt = Date.now();
	};
	const isNavRecent = () => Date.now() - lastNavAt < 2e3;
	const onFocusin = (event) => {
		if (event.target instanceof Element && event.target.closest("[data-surface-preserve-focus]")) return;
		const id = surfaceIdFromTarget(element, event.target, ladder);
		const mode = targetModeForRoot$1(element);
		const navigationView = navigationViewForOptions(opts);
		const runtime = opts.runtime;
		const nextId = runtimeNavigationIdFor(element, runtime, id, mode, navigationView) ?? navigationIdFor(ladder, id, mode, navigationView);
		if (nextId) {
			syncRuntimeToNavigationFocus(runtime, nextId);
			ladder.focusId(nextId);
		}
		const magneticSurface = magneticSelectionSurfaceFromTarget(element, event.target);
		if (magneticSurface && magneticSurface.getAttribute("data-ladder-id") === nextId) focusMagneticSelectionSurface(magneticSurface);
	};
	const handlePolymorphKey = (event) => {
		const runtime = opts.runtime;
		const rawCurrentId = surfaceIdFromTarget(element, event.target, ladder);
		const mode = targetModeForRoot$1(element);
		const navigationView = navigationViewForOptions(opts);
		const activeNavigationId = runtimeNavigationIdFor(element, runtime, rawCurrentId, mode, navigationView) ?? navigationIdFor(ladder, rawCurrentId, mode, navigationView);
		const currentId = runtimeNavigationIdFor(element, runtime, ladder.focusedId, mode, navigationView) ?? ladder.focusedId ?? activeNavigationId;
		if (event.key === "Escape") {
			if (isNavRecent()) {
				markNav();
				const parentId = currentId ? runtimeParentNavigationId(element, runtime, currentId, mode, navigationView) ?? parentNavigationId(ladder, currentId, mode, navigationView) : null;
				if (parentId && focusSurface(element, ladder, parentId, { runtime })) {
					event.preventDefault();
					event.stopPropagation();
					return true;
				}
			}
			return shouldDeselectOnEscape() ? clearSurfaceSelection("escape", true, event) : false;
		}
		if (event.key === "Tab") {
			markNav();
			let nextId = null;
			if (currentId) nextId = event.shiftKey ? runtimeStepNavigationId(element, runtime, currentId, mode, navigationView, -1) ?? prevNavigationId(ladder, currentId, mode, navigationView) : runtimeStepNavigationId(element, runtime, currentId, mode, navigationView, 1) ?? nextNavigationId(ladder, currentId, mode, navigationView);
			nextId ??= event.shiftKey ? runtimeStepNavigationId(element, runtime, null, mode, navigationView, -1) ?? lastNavigationId(ladder, mode, navigationView) : runtimeStepNavigationId(element, runtime, null, mode, navigationView, 1) ?? firstNavigationId(ladder, mode, navigationView);
			if (!nextId) return false;
			event.preventDefault();
			return focusSurface(element, ladder, nextId, { runtime });
		}
		if (!currentId) return false;
		if (handleDisclosureTreeKey(element, ladder, runtime, currentId, mode, navigationView, event)) {
			markNav();
			return true;
		}
		const currentSurface = surfaceElementById$1(element, currentId);
		if (mode === "change" && (event.key === "Enter" || event.key === "F2")) {
			const surface = currentSurface;
			if (surface && activateChangeTarget(element, surface)) {
				event.preventDefault();
				event.stopPropagation();
				markNav();
				return true;
			}
			if (event.key === "F2") return false;
		}
		if (event.key === "Enter") {
			const activationSurface = closestActivatableSurface(element, currentSurface);
			if (activationSurface && dispatchSurfaceCommand(activationSurface, "surface-activate", event)) {
				markNav();
				return true;
			}
			const firstChildId = firstChildNavigationId(ladder, currentId, mode, navigationView);
			const targetChildId = runtimeFirstChildNavigationId(element, runtime, currentId, mode, navigationView) ?? firstChildId;
			if (!targetChildId) return false;
			event.preventDefault();
			markNav();
			return focusSurface(element, ladder, targetChildId, { runtime });
		}
		if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown") {
			if (runtime) {
				const result = runtime.dispatch({
					type: "move",
					direction: directionForArrowKey(event.key),
					shift: event.shiftKey,
					mode: runtimeModeForTargetMode$1(mode)
				});
				const targetId = result.intent?.type === "move-selection" ? result.intent.targetId : runtime.snapshot().focusedId;
				if (targetId && focusSurface(element, ladder, targetId, {
					runtime,
					syncRuntime: false
				})) {
					revealSurface(element, result.reveal);
					event.preventDefault();
					event.stopPropagation();
					markNav();
					return true;
				}
				if (result.handled || result.reason === "edge") {
					event.preventDefault();
					event.stopPropagation();
					markNav();
					return true;
				}
			}
			const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
			const nextId = (event.key === "ArrowUp" || event.key === "ArrowDown" ? scopedNavigationId(element, ladder, currentId, mode, navigationView, delta) : null) ?? (delta < 0 ? runtimeStepNavigationId(element, runtime, currentId, mode, navigationView, -1) ?? prevNavigationId(ladder, currentId, mode, navigationView) : runtimeStepNavigationId(element, runtime, currentId, mode, navigationView, 1) ?? nextNavigationId(ladder, currentId, mode, navigationView));
			if (!nextId) {
				event.preventDefault();
				event.stopPropagation();
				return true;
			}
			event.preventDefault();
			markNav();
			return focusSurface(element, ladder, nextId, { runtime });
		}
		return false;
	};
	const onKeydown = (event) => {
		if (opts.skipKeyboard) return;
		if (event.defaultPrevented) {
			opts.onKey?.(event, ladder, false);
			return;
		}
		if (pathContainsPreserveFocus(event)) {
			opts.onKey?.(event, ladder, false);
			return;
		}
		if (event.key === "Escape" && shouldDeselectOnEscape() && canRootOwnDeselectForEvent(event) && isSurfaceTextEntryTarget(event.target)) {
			const handled = clearSurfaceSelection("escape", true, event);
			opts.onKey?.(event, ladder, handled);
			return;
		}
		if (surfaceTargetOwnsKeyboardEvent(event)) return;
		if (opts.shouldRouteKey?.(event, ladder) === false) {
			opts.onKey?.(event, ladder, false);
			return;
		}
		const handled = handlePolymorphKey(event);
		opts.onKey?.(event, ladder, handled);
	};
	const onDocPointerDown = (event) => {
		if (opts.skipBackgroundClick) return;
		if (shouldFocusRootOnPointerDown(element, event.target)) element.focus({ preventScroll: true });
		if (clickedOnLadderTarget(element, event.target, ladder)) return;
		clearSurfaceSelection("background", event.target instanceof Node && element.contains(event.target));
	};
	const clearPendingFocusSync = () => {
		if (syncFocusTimer === void 0) return;
		clearTimeout(syncFocusTimer);
		syncFocusTimer = void 0;
	};
	const syncDomFocusToLadder = () => {
		const runtime = opts.runtime;
		if (runtimeHasSplitFocus(runtime) || activeLiftOwnsDomFocus(element) || surfaceTargetRetainsBrowserFocusAfterSelection(document.activeElement)) {
			clearPendingFocusSync();
			return;
		}
		const focusedId = activeRuntimeFocusId(runtime) ?? ladder.focusedId;
		if (!focusedId) {
			clearPendingFocusSync();
			return;
		}
		const magneticSurface = magneticSelectionSurfaceFromTarget(element, document.activeElement);
		if (magneticSurface && magneticSurface.getAttribute("data-ladder-id") === focusedId) {
			focusMagneticSelectionSurface(magneticSurface);
			return;
		}
		const activeId = surfaceIdFromTarget(element, document.activeElement, ladder);
		const mode = targetModeForRoot$1(element);
		const navigationView = navigationViewForOptions(opts);
		if ((runtimeNavigationIdFor(element, runtime, activeId, mode, navigationView) ?? navigationIdFor(ladder, activeId, mode, navigationView)) === focusedId) {
			clearPendingFocusSync();
			return;
		}
		clearPendingFocusSync();
		syncFocusTimer = setTimeout(() => {
			syncFocusTimer = void 0;
			if (runtimeHasSplitFocus(opts.runtime)) return;
			if (activeLiftOwnsDomFocus(element)) return;
			if (surfaceTargetRetainsBrowserFocusAfterSelection(document.activeElement)) return;
			const nextFocusedId = activeRuntimeFocusId(opts.runtime) ?? ladder.focusedId;
			if (!nextFocusedId) return;
			const nextActiveId = surfaceIdFromTarget(element, document.activeElement, ladder);
			if ((runtimeNavigationIdFor(element, opts.runtime, nextActiveId, targetModeForRoot$1(element), navigationViewForOptions(opts)) ?? navigationIdFor(ladder, nextActiveId, targetModeForRoot$1(element), navigationViewForOptions(opts))) === nextFocusedId) return;
			focusSurface(element, ladder, nextFocusedId, {
				runtime: opts.runtime,
				syncRuntime: false,
				preventScroll: true
			});
		}, 0);
	};
	const unsubscribeFocusSync = ladder.subscribe(syncDomFocusToLadder);
	const unsubscribeRuntimeFocusSync = opts.runtime?.subscribeSelection(syncDomFocusToLadder);
	element.addEventListener("keydown", onKeydown);
	element.addEventListener("focusin", onFocusin);
	document.addEventListener("pointerdown", onDocPointerDown, true);
	return () => {
		element.removeEventListener("keydown", onKeydown);
		element.removeEventListener("focusin", onFocusin);
		document.removeEventListener("pointerdown", onDocPointerDown, true);
		unsubscribeFocusSync();
		unsubscribeRuntimeFocusSync?.();
		if (syncFocusTimer !== void 0) clearTimeout(syncFocusTimer);
		unregisterDomRoot();
		if (didAddTabindex) element.removeAttribute("tabindex");
	};
});
var CommitInlineEditEvent = "boxel-surface:inline-edit-commit";
var InlineEditTextDisplayAttribute = "data-surface-inline-text-display";
function restoreAttribute$1(element, name, value) {
	if (value === null) element.removeAttribute(name);
	else element.setAttribute(name, value);
}
function surfaceModeForElement(element) {
	return element.closest("[data-surface-mode]")?.getAttribute("data-surface-mode") ?? "inspect";
}
function changeRouteForElement(element) {
	return element.closest("[data-surface-change-route]")?.getAttribute("data-surface-change-route") ?? "auto";
}
function shouldActivateInlineEdit(element, opts) {
	if (!opts.enabled) return false;
	if (opts.activation !== "change-inline") return true;
	return surfaceModeForElement(element) === "change" && changeRouteForElement(element) !== "lifted";
}
var surfaceInlineEdit = modifier((element, _, opts = {}) => {
	const syncTextDisplay = () => {
		if (element.getAttribute(InlineEditTextDisplayAttribute) === "true" && opts.value !== void 0 && document.activeElement !== element && element.textContent !== opts.value) element.textContent = opts.value;
	};
	if (!opts.enabled) {
		syncTextDisplay();
		if (element.getAttribute("data-surface-inline-edit") === "true") {
			element.removeAttribute("contenteditable");
			element.removeAttribute("role");
			element.removeAttribute("aria-label");
			element.removeAttribute("aria-multiline");
			element.removeAttribute("spellcheck");
			element.removeAttribute("data-surface-inline-edit");
			element.removeAttribute("data-surface-inline-multiline");
			element.removeAttribute("data-surface-inline-dirty");
		}
		return;
	}
	const priorContentEditable = element.getAttribute("contenteditable");
	const priorRole = element.getAttribute("role");
	const priorAriaLabel = element.getAttribute("aria-label");
	const priorAriaMultiline = element.getAttribute("aria-multiline");
	const priorSpellcheck = element.getAttribute("spellcheck");
	const priorInlineEdit = element.getAttribute("data-surface-inline-edit");
	const priorInlineMultiline = element.getAttribute("data-surface-inline-multiline");
	const previousInlineEdit = priorInlineEdit === "true";
	let isActive = false;
	const activate = () => {
		if (isActive) return;
		element.setAttribute("contenteditable", "plaintext-only");
		element.setAttribute("role", "textbox");
		element.setAttribute("spellcheck", "false");
		element.setAttribute("data-surface-inline-edit", "true");
		element.setAttribute(InlineEditTextDisplayAttribute, "true");
		if (opts.label) element.setAttribute("aria-label", opts.label);
		if (opts.multiline) {
			element.setAttribute("aria-multiline", "true");
			element.setAttribute("data-surface-inline-multiline", "true");
		} else {
			element.removeAttribute("aria-multiline");
			element.removeAttribute("data-surface-inline-multiline");
		}
		isActive = true;
	};
	const deactivate = () => {
		if (!isActive && element.getAttribute("data-surface-inline-edit") !== "true") {
			syncTextDisplay();
			return;
		}
		restoreAttribute$1(element, "contenteditable", previousInlineEdit ? null : priorContentEditable);
		restoreAttribute$1(element, "role", previousInlineEdit ? null : priorRole);
		restoreAttribute$1(element, "aria-label", previousInlineEdit ? null : priorAriaLabel);
		restoreAttribute$1(element, "aria-multiline", previousInlineEdit ? null : priorAriaMultiline);
		restoreAttribute$1(element, "spellcheck", previousInlineEdit ? null : priorSpellcheck);
		restoreAttribute$1(element, "data-surface-inline-edit", previousInlineEdit ? null : priorInlineEdit);
		restoreAttribute$1(element, "data-surface-inline-multiline", previousInlineEdit ? null : priorInlineMultiline);
		element.removeAttribute("data-surface-inline-dirty");
		isActive = false;
		syncTextDisplay();
	};
	let lastCommittedValue = opts.value;
	const commit = (event) => {
		const value = element.textContent ?? "";
		const isDirty = element.getAttribute("data-surface-inline-dirty") === "true";
		if (value === lastCommittedValue) {
			element.removeAttribute("data-surface-inline-dirty");
			return;
		}
		if (!isDirty) return;
		lastCommittedValue = value;
		element.removeAttribute("data-surface-inline-dirty");
		opts.onInput?.(value, event);
	};
	const onInput = (event) => {
		const value = element.textContent ?? "";
		lastCommittedValue = value;
		element.setAttribute("data-surface-inline-dirty", "true");
		opts.onInput?.(value, event);
	};
	const onKeydown = (event) => {
		if (!opts.multiline && event.key === "Enter") {
			event.preventDefault();
			commit(event);
			element.blur();
		}
	};
	const onCommitRequest = (event) => {
		commit(event);
		element.blur();
	};
	const sync = () => {
		if (shouldActivateInlineEdit(element, opts)) activate();
		else deactivate();
	};
	element.addEventListener("input", onInput);
	element.addEventListener("blur", commit);
	element.addEventListener("keydown", onKeydown);
	element.addEventListener(CommitInlineEditEvent, onCommitRequest);
	sync();
	const modeRoot = element.closest("[data-surface-mode]");
	const routeRoot = element.closest("[data-surface-change-route]");
	const observer = new MutationObserver(sync);
	if (modeRoot && routeRoot === modeRoot) observer.observe(modeRoot, {
		attributes: true,
		attributeFilter: ["data-surface-mode", "data-surface-change-route"]
	});
	else {
		if (modeRoot) observer.observe(modeRoot, {
			attributes: true,
			attributeFilter: ["data-surface-mode"]
		});
		if (routeRoot) observer.observe(routeRoot, {
			attributes: true,
			attributeFilter: ["data-surface-change-route"]
		});
	}
	return () => {
		observer.disconnect();
		element.removeEventListener("input", onInput);
		element.removeEventListener("blur", commit);
		element.removeEventListener("keydown", onKeydown);
		element.removeEventListener(CommitInlineEditEvent, onCommitRequest);
		deactivate();
	};
});
var surfaceScopeRelay = modifier((element, positional, options = {}) => {
	const relay = options.relay ?? positional[0] ?? createSurfaceScopeRelay();
	relay.adopt(surfaceScopeAttributesForTree(element));
	relay.stamp(element);
	const observer = new MutationObserver((mutations) => {
		for (const mutation of mutations) for (const node of mutation.addedNodes) if (node instanceof Element) relay.stamp(node);
	});
	observer.observe(element, {
		childList: true,
		subtree: true
	});
	return () => observer.disconnect();
});
var StyleId = "boxel-surface-coordinate-debugger-styles";
function ensureStyles(document) {
	if (document.getElementById(StyleId)) return;
	const style = document.createElement("style");
	style.id = StyleId;
	style.textContent = `
    .boxel-surface-coordinate-debugger {
      --surface-debug-accent: #5645d4;
      --surface-debug-hover: #0f766e;
      position: fixed;
      right: var(--boxel-surface-coordinate-debugger-right, 16px);
      top: var(--boxel-surface-coordinate-debugger-top, 16px);
      z-index: 100000;
      color: #111827;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 11px;
      line-height: 1.35;
      pointer-events: none;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }

    .boxel-surface-coordinate-debugger__toggle,
    .boxel-surface-coordinate-debugger__row {
      pointer-events: auto;
      font: inherit;
    }

    .boxel-surface-coordinate-debugger__toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 30px;
      padding: 6px 10px;
      border: 1px solid rgba(17, 24, 39, 0.18);
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.94);
      color: #111827;
      box-shadow: 0 10px 26px rgba(15, 23, 42, 0.16);
      cursor: pointer;
    }

    .boxel-surface-coordinate-debugger__panel {
      width: min(620px, calc(100vw - 32px));
      max-height: calc(100vh - var(--boxel-surface-coordinate-debugger-top, 16px) - 32px);
      margin-top: 8px;
      overflow: hidden;
      border: 1px solid rgba(17, 24, 39, 0.16);
      border-radius: 9px;
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.22);
      pointer-events: auto;
      backdrop-filter: blur(10px);
      display: flex;
      flex-direction: column;
    }

    .boxel-surface-coordinate-debugger__panel[hidden] {
      display: none;
    }

    .boxel-surface-coordinate-debugger__header {
      display: grid;
      gap: 4px;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(17, 24, 39, 0.1);
      background: #fafaf9;
      flex: 0 0 auto;
    }

    .boxel-surface-coordinate-debugger__title {
      font-weight: 700;
      font-size: 12px;
    }

    .boxel-surface-coordinate-debugger__stat {
      display: grid;
      grid-template-columns: 66px minmax(0, 1fr);
      gap: 8px;
      color: #4b5563;
      align-items: start;
    }

    .boxel-surface-coordinate-debugger__stat strong {
      color: #111827;
      font-weight: 700;
    }

    .boxel-surface-coordinate-debugger__value {
      min-width: 0;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .boxel-surface-coordinate-debugger__tree {
      min-height: 0;
      flex: 1 1 auto;
      overflow: auto;
      padding: 6px;
      overscroll-behavior: contain;
    }

    .boxel-surface-coordinate-debugger__row {
      width: 100%;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: start;
      padding-top: 4px;
      padding-bottom: 4px;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: #111827;
      text-align: left;
      cursor: pointer;
    }

    .boxel-surface-coordinate-debugger__row:hover {
      background: rgba(86, 69, 212, 0.08);
    }

    .boxel-surface-coordinate-debugger__row[data-focus-path='true'] {
      background: rgba(86, 69, 212, 0.05);
    }

    .boxel-surface-coordinate-debugger__row[data-selected='true'] {
      background: rgba(86, 69, 212, 0.14);
      color: #24185f;
    }

    .boxel-surface-coordinate-debugger__row[data-hovered='true'] {
      box-shadow: inset 0 0 0 1px rgba(0, 117, 222, 0.36);
    }

    .boxel-surface-coordinate-debugger__row[data-editing='true'] {
      background: rgba(245, 215, 94, 0.4);
      box-shadow: inset 0 0 0 1px rgba(221, 91, 0, 0.3);
    }

    .boxel-surface-coordinate-debugger__coordinate {
      min-width: 0;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .boxel-surface-coordinate-debugger__surface {
      color: #6b7280;
      font-weight: 700;
    }

    .boxel-surface-coordinate-debugger__badge {
      color: #6b7280;
      font-size: 10px;
      white-space: nowrap;
      padding-top: 1px;
    }

    .boxel-surface-coordinate-decal {
      position: fixed;
      pointer-events: none;
      box-sizing: border-box;
      border: 2px solid transparent;
      border-radius: 5px;
      z-index: 99990;
      transform: translateZ(0);
    }

    .boxel-surface-coordinate-decal[hidden] {
      display: none;
    }

    .boxel-surface-coordinate-decal--selected {
      background: rgba(86, 69, 212, 0.055);
      box-shadow:
        inset 0 0 0 2px rgba(86, 69, 212, 0.58),
        0 0 0 1px rgba(255, 255, 255, 0.74),
        0 8px 22px rgba(86, 69, 212, 0.16);
    }

    .boxel-surface-coordinate-decal--hovered {
      border-color: rgba(13, 148, 136, 0.92);
      background: rgba(20, 184, 166, 0.075);
      box-shadow:
        0 0 0 1px rgba(240, 253, 250, 0.95),
        0 0 0 6px rgba(20, 184, 166, 0.2),
        0 12px 30px rgba(15, 118, 110, 0.24);
    }

    .boxel-surface-coordinate-decal--editing {
      background: rgba(245, 215, 94, 0.18);
      box-shadow:
        inset 0 0 0 2px rgba(221, 91, 0, 0.58),
        0 0 0 1px rgba(255, 255, 255, 0.74),
        0 8px 22px rgba(221, 91, 0, 0.14);
    }
  `;
	document.head.append(style);
}
function surfaceElementById(root, id) {
	if (!id) return null;
	if (root.getAttribute("data-ladder-id") === id) return root;
	for (const element of root.querySelectorAll("[data-ladder-id]")) if (element.getAttribute("data-ladder-id") === id) return element;
	return null;
}
function coordinateFor(node) {
	return node?.focusKey ?? node?.id ?? "none";
}
function isEnabledDataAttribute(value) {
	return value === "" || value === "true";
}
function targetModeForRoot(root) {
	const mode = root.getAttribute("data-surface-mode");
	const inspect = isEnabledDataAttribute(root.getAttribute("data-surface-inspect"));
	if (mode === "use" && inspect) return "inspect";
	if (mode === "use" || mode === "change" || mode === "inspect") return mode;
	return "inspect";
}
function runtimeModeForTargetMode(mode) {
	return mode === "debug" ? "debug" : mode;
}
function text(value) {
	return document.createTextNode(value);
}
function appendStat(parent, label, value) {
	const row = document.createElement("div");
	row.className = "boxel-surface-coordinate-debugger__stat";
	const strong = document.createElement("strong");
	strong.textContent = label;
	const content = document.createElement("span");
	content.className = "boxel-surface-coordinate-debugger__value";
	content.textContent = value || "none";
	content.title = value || "none";
	row.append(strong, content);
	parent.append(row);
}
function applyDecal(decal, root, id) {
	const target = surfaceElementById(root, id);
	if (!target || !target.isConnected) {
		decal.hidden = true;
		decal.removeAttribute("data-surface-coordinate-decal-id");
		decal.removeAttribute("data-surface-coordinate");
		return;
	}
	const rect = target.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) {
		decal.hidden = true;
		decal.removeAttribute("data-surface-coordinate-decal-id");
		decal.removeAttribute("data-surface-coordinate");
		return;
	}
	decal.hidden = false;
	decal.setAttribute("data-surface-coordinate-decal-id", id ?? "");
	decal.setAttribute("data-surface-coordinate", target.getAttribute("data-surface-coordinate") ?? "");
	decal.style.left = `${Math.round(rect.left)}px`;
	decal.style.top = `${Math.round(rect.top)}px`;
	decal.style.width = `${Math.round(rect.width)}px`;
	decal.style.height = `${Math.round(rect.height)}px`;
}
var surfaceCoordinateDebugger = modifier((element, [ladder], opts = {}) => {
	if (!ladder) return;
	const showPanel = opts.enabled ?? false;
	const showDecals = opts.decals ?? true;
	if (!showPanel && !showDecals) return;
	ensureStyles(document);
	let open = opts.open ?? false;
	let frame;
	let disposed = false;
	const host = showPanel ? document.createElement("div") : void 0;
	if (host) {
		host.className = "boxel-surface-coordinate-debugger";
		host.setAttribute("data-surface-preserve-focus", "");
	}
	const toggle = showPanel ? document.createElement("button") : void 0;
	if (toggle) {
		toggle.type = "button";
		toggle.className = "boxel-surface-coordinate-debugger__toggle";
	}
	const panel = showPanel ? document.createElement("section") : void 0;
	if (panel) {
		panel.className = "boxel-surface-coordinate-debugger__panel";
		panel.hidden = !open;
	}
	const selectedDecal = showDecals ? document.createElement("div") : void 0;
	if (selectedDecal) {
		selectedDecal.className = "boxel-surface-coordinate-decal boxel-surface-coordinate-decal--selected";
		selectedDecal.setAttribute("data-surface-coordinate-decal", "selected");
	}
	const hoveredDecal = showDecals ? document.createElement("div") : void 0;
	if (hoveredDecal) {
		hoveredDecal.className = "boxel-surface-coordinate-decal boxel-surface-coordinate-decal--hovered";
		hoveredDecal.setAttribute("data-surface-coordinate-decal", "hovered");
	}
	const editingDecal = showDecals ? document.createElement("div") : void 0;
	if (editingDecal) {
		editingDecal.className = "boxel-surface-coordinate-decal boxel-surface-coordinate-decal--editing";
		editingDecal.setAttribute("data-surface-coordinate-decal", "editing");
	}
	if (host && toggle && panel) {
		host.append(toggle, panel);
		document.body.append(host);
	}
	if (selectedDecal && hoveredDecal && editingDecal) document.body.append(selectedDecal, hoveredDecal, editingDecal);
	const focusSurface = (id) => {
		ladder.focusId(id);
		const target = surfaceElementById(element, id);
		target?.scrollIntoView({
			block: "nearest",
			inline: "nearest"
		});
		target?.focus({ preventScroll: true });
	};
	const renderTree = (tree) => {
		const treeElement = document.createElement("div");
		treeElement.className = "boxel-surface-coordinate-debugger__tree";
		for (const node of tree) {
			const isEditing = surfaceElementById(element, node.id)?.getAttribute("data-surface-editing") === "true";
			const row = document.createElement("button");
			row.type = "button";
			row.className = "boxel-surface-coordinate-debugger__row";
			row.style.paddingLeft = `${8 + node.depth * 14}px`;
			row.setAttribute("data-selected", String(node.selected || node.focused));
			row.setAttribute("data-hovered", String(node.hovered));
			row.setAttribute("data-editing", String(isEditing));
			row.setAttribute("data-focus-path", String(node.onFocusPath));
			row.title = node.id;
			const coordinate = document.createElement("span");
			coordinate.className = "boxel-surface-coordinate-debugger__coordinate";
			const surface = document.createElement("span");
			surface.className = "boxel-surface-coordinate-debugger__surface";
			surface.textContent = node.surface;
			coordinate.append(surface, text(" "), text(coordinateFor(node)));
			const badges = document.createElement("span");
			badges.className = "boxel-surface-coordinate-debugger__badge";
			badges.textContent = [
				node.target ?? "",
				node.targetScope ? `scope:${node.targetScope}` : "",
				node.focused ? "focus" : "",
				node.selected ? "select" : "",
				node.hovered ? "hover" : "",
				isEditing ? "edit" : ""
			].filter(Boolean).join(" ");
			row.append(coordinate, badges);
			row.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				focusSurface(node.id);
			});
			treeElement.append(row);
		}
		return treeElement;
	};
	const render = () => {
		if (disposed) return;
		frame = void 0;
		const runtime = opts.runtime;
		const targetMode = targetModeForRoot(element);
		const projection = runtime?.projection({
			mode: runtimeModeForTargetMode(targetMode),
			inspect: isEnabledDataAttribute(element.getAttribute("data-surface-inspect"))
		});
		const allTree = ladder.treeSnapshot();
		const view = opts.view ?? "all";
		const traversalIds = projection ? new Set(projection.traversal.ids) : void 0;
		const tree = view === "targets" ? allTree.filter((node) => traversalIds ? traversalIds.has(node.id) : ladder.isEligibleTarget(node.id, targetMode)) : allTree;
		const focused = ladder.focusedId ? ladder.getNode(ladder.focusedId) : null;
		const hovered = ladder.hoveredId ? ladder.getNode(ladder.hoveredId) : null;
		const selectedIds = ladder.selectedIds();
		const primary = projection?.visualPrimary;
		const selectedId = primary?.sourceId ?? primary?.id ?? ladder.focusedId ?? selectedIds[selectedIds.length - 1] ?? null;
		const hoveredId = projection?.visualDecals.find((decal) => decal.kind === "inspect" || decal.kind === "hover")?.ids[0] ?? ladder.hoveredId;
		const editingId = (primary?.kind === "input" ? primary.sourceId ?? primary.id : void 0) ?? allTree.find((node) => surfaceElementById(element, node.id)?.getAttribute("data-surface-editing") === "true")?.id ?? null;
		if (showPanel && toggle && panel) {
			toggle.textContent = open ? "Coordinates - hide" : "Coordinates";
			toggle.setAttribute("aria-expanded", String(open));
			panel.hidden = !open;
			const header = document.createElement("div");
			header.className = "boxel-surface-coordinate-debugger__header";
			const title = document.createElement("div");
			title.className = "boxel-surface-coordinate-debugger__title";
			title.textContent = view === "targets" ? `Surface targets (${tree.length}/${allTree.length})` : `Surface coordinates (${allTree.length})`;
			header.append(title);
			appendStat(header, "view", view === "targets" ? `targeting:${targetMode}` : "all");
			appendStat(header, "runtime", runtime ? "projection" : "ladder");
			appendStat(header, "focus", focused ? focused.focusKey ?? focused.id : "none");
			appendStat(header, "hover", hovered ? hovered.focusKey ?? hovered.id : "none");
			appendStat(header, "select", selectedIds.join(", ") || "none");
			appendStat(header, "edit", editingId ?? "none");
			appendStat(header, "path", ladder.focusPath.join(" -> ") || "none");
			panel.replaceChildren(header, renderTree(tree));
		}
		if (selectedDecal && hoveredDecal && editingDecal) {
			applyDecal(selectedDecal, element, selectedId);
			applyDecal(hoveredDecal, element, hoveredId);
			applyDecal(editingDecal, element, editingId);
		}
	};
	const schedule = () => {
		if (frame !== void 0) return;
		frame = requestAnimationFrame(render);
	};
	const unsubscribe = ladder.subscribe(schedule);
	const unsubscribeRuntimeTopology = opts.runtime?.subscribeTopology(schedule);
	const unsubscribeRuntimeViewport = opts.runtime?.subscribeViewport(schedule);
	const observer = new MutationObserver(schedule);
	observer.observe(element, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: [
			"data-ladder-id",
			"data-surface-coordinate",
			"data-surface-coordinate-ready",
			"data-surface-editing",
			"class",
			"style"
		]
	});
	const onToggle = (event) => {
		event.preventDefault();
		event.stopPropagation();
		open = !open;
		render();
	};
	const onViewportChange = () => schedule();
	toggle?.addEventListener("click", onToggle);
	window.addEventListener("resize", onViewportChange);
	window.addEventListener("scroll", onViewportChange, true);
	render();
	return () => {
		disposed = true;
		if (frame !== void 0) cancelAnimationFrame(frame);
		unsubscribe();
		unsubscribeRuntimeTopology?.();
		unsubscribeRuntimeViewport?.();
		observer.disconnect();
		toggle?.removeEventListener("click", onToggle);
		window.removeEventListener("resize", onViewportChange);
		window.removeEventListener("scroll", onViewportChange, true);
		selectedDecal?.remove();
		hoveredDecal?.remove();
		editingDecal?.remove();
		host?.remove();
	};
});
//#endregion
//#region dist/form-step-t6BDikej.js
var _class$e, _descriptor$a, _descriptor2$7, _descriptor3$2;
/**
* The ladder works in terms of a small subset of `Surface` — the
* surfaces that participate in focus/selection nesting. `pane` and
* `plane` are lift surfaces; they live in their own focus subtree
* (the lift handles its own focus root) and don't appear here.
*
* Hierarchy goes `space → layout/canvas/scene/grid/scroll/flow/outline →
* row/frame/pane/plane → cell/run/unit`. The ladder accepts the full
* declared surface vocabulary so examples can exercise ergonomics before
* every pair has a hardened contract shard.
*
* `connection` is a first-class object surface for edges/links between
* objects. It participates in selection, drag/connection editing, and
* coordinate-space movement instead of being host-only SVG/path chrome.
*
* `unit` is the bottom of most trees (single-value widget). `cell`
* sits between `layout` and `unit` only for multi-unit widgets.
*/
/** Which axis a step request applies to. Hosts that lay out children
*  in a row pass `'x'`; column-stack hosts pass `'y'`; agnostic hosts
*  (Tab key, sequential nav) pass `'linear'`. K.3a treats all axes
*  uniformly; K.4+ may add axis-specific behavior (e.g., a grid
*  treating ArrowDown vs ArrowRight differently). */
/**
* Cross-host focus + selection coordination. See the file header for
* the model.
*
* The two state slots (`_focusPath`, `_selection`) are `@tracked` so
* Glimmer templates that read `isFocused(id)` / `isSelected(id)`
* / `focusedId` / `focusDepth` re-render on change. All mutations
* REASSIGN those slots (never mutate in place), so trackers fire
* reliably.
*
* The class is plain (not a Resource) because its lifetime is tied
* to the host's surface root, not to a set of arguments — hosts
* construct it once.
*/
var FocusLadder = (_class$e = class FocusLadder {
	constructor() {
		_defineProperty(this, "_nodes", /* @__PURE__ */ new Map());
		_defineProperty(this, "_children", /* @__PURE__ */ new Map());
		_initializerDefineProperty$1(this, "_focusPath", _descriptor$a, this);
		_initializerDefineProperty$1(this, "_selection", _descriptor2$7, this);
		_initializerDefineProperty$1(this, "_hoveredId", _descriptor3$2, this);
		_defineProperty(this, "_pendingFocusKey", null);
		_defineProperty(this, "_restoredFocusId", null);
		_defineProperty(this, "_selectionAnchor", null);
		_defineProperty(this, "_subs", /* @__PURE__ */ new Set());
		_defineProperty(this, "isFocused", (id) => this.focusedId === id);
		_defineProperty(this, "isHovered", (id) => this._hoveredId === id);
		/** True when `id` is anywhere on the focus path (including the
		*  deepest entry). Useful for "ancestor of focus" highlighting. */
		_defineProperty(this, "isOnFocusPath", (id) => this._focusPath.includes(id));
		_defineProperty(this, "isSelected", (id) => {
			const depth = this._depthOf(id);
			if (depth < 0) return false;
			return this._selection.get(depth)?.has(id) ?? false;
		});
	}
	/**
	* Register a node. Returns an unregister function — hosts SHOULD
	* call it on teardown (typically from a `willDestroy` hook or a
	* Glimmer modifier's cleanup).
	*
	* Re-registering an existing id refreshes its surface/parent fields
	* and (if the parent changed) re-parents it in the sibling map.
	*/
	register(reg) {
		const existing = this._nodes.get(reg.id);
		const registered = { ...reg };
		this._nodes.set(reg.id, registered);
		if (!existing || existing.parentId !== reg.parentId) {
			if (existing) this._removeFromSiblings(reg.id, existing.parentId);
			const sibs = this._children.get(reg.parentId)?.slice() ?? [];
			if (!sibs.includes(reg.id)) sibs.push(reg.id);
			this._children.set(reg.parentId, sibs);
		}
		if (this._pendingFocusKey !== null && this._focusKeyForNode(registered) === this._pendingFocusKey) {
			this._pendingFocusKey = null;
			this._restoredFocusId = reg.id;
			this.focusId(reg.id);
		} else this._notify();
		return () => {
			if (this._nodes.get(reg.id) === registered) this.unregister(reg.id);
		};
	}
	/** Unregister a node. Drops it from the focus path and selection
	*  if present. Children of the dropped node are NOT cascaded —
	*  hosts that own a subtree should unregister bottom-up. */
	unregister(id) {
		const node = this._nodes.get(id);
		if (!node) return;
		const focusedNode = this.focusedId ? this._nodes.get(this.focusedId) : null;
		if (focusedNode && this._focusPath.includes(id)) this._pendingFocusKey = this._focusKeyForNode(focusedNode);
		this._nodes.delete(id);
		this._removeFromSiblings(id, node.parentId);
		if (this._focusPath.includes(id)) {
			const idx = this._focusPath.indexOf(id);
			this._focusPath = this._focusPath.slice(0, idx);
		}
		let mutated = false;
		const next = /* @__PURE__ */ new Map();
		for (const [depth, set] of this._selection) if (set.has(id)) {
			const cloned = new Set(set);
			cloned.delete(id);
			if (cloned.size > 0) next.set(depth, cloned);
			mutated = true;
		} else next.set(depth, new Set(set));
		if (mutated) this._selection = next;
		if (this._selectionAnchor === id) this._selectionAnchor = null;
		if (this._hoveredId === id) this._hoveredId = null;
		if (this._pendingFocusKey !== null && this._focusFirstByKey(this._pendingFocusKey)) this._pendingFocusKey = null;
		this._notify();
	}
	/** Replace the ordered sibling list under a parent. Use when the
	*  host owns reordering (e.g., grid columns dragged into a new
	*  position) and needs to keep the ladder's nav order in sync. */
	setSiblings(parentId, ids) {
		this._children.set(parentId, [...ids]);
		this._notify();
	}
	/** Clear ALL topology + state. Useful for hot-reload or surface
	*  swaps. */
	reset() {
		this._nodes.clear();
		this._children.clear();
		this._focusPath = [];
		this._selection = /* @__PURE__ */ new Map();
		this._hoveredId = null;
		this._selectionAnchor = null;
		this._pendingFocusKey = null;
		this._restoredFocusId = null;
		this._notify();
	}
	/**
	* Register a callback fired after every topology / focus / hover /
	* selection mutation.
	* Returns an unsubscribe function. Hosts use this to mirror ladder
	* state into their own data model (e.g., the `<Canvas>` host
	* mirroring `ladder.clear()` into xyflow's `unselectAll()` so the
	* two selection models stay in sync).
	*
	* Subs run synchronously during the mutating call. Don't mutate
	* the ladder from inside a sub — that re-enters and can cause
	* loops; if you need to chain effects, queue them with
	* `requestAnimationFrame` or similar.
	*
	* Topology changes (register / unregister / setSiblings) notify
	* because coordinate debuggers, decals, and keyboard projections need
	* to see the complete live tree, not just focus state changes.
	*/
	subscribe(cb) {
		this._subs.add(cb);
		return () => {
			this._subs.delete(cb);
		};
	}
	_notify() {
		for (const cb of this._subs) cb(this);
	}
	_removeFromSiblings(id, parentId) {
		const sibs = this._children.get(parentId);
		if (!sibs) return;
		const idx = sibs.indexOf(id);
		if (idx < 0) return;
		const next = sibs.slice();
		next.splice(idx, 1);
		if (next.length === 0) this._children.delete(parentId);
		else this._children.set(parentId, next);
	}
	_focusKeyForNode(node) {
		return node.focusKey ?? node.id;
	}
	_focusFirstByKey(focusKey) {
		for (const node of this._nodes.values()) if (this._focusKeyForNode(node) === focusKey) {
			this._restoredFocusId = node.id;
			this.focusId(node.id);
			return true;
		}
		return false;
	}
	_targetForNode(node) {
		if (node.target) return node.target;
		switch (node.surface) {
			case "space":
			case "layout":
			case "scroll":
			case "flow":
			case "outline":
			case "pane":
			case "plane":
			case "grid":
			case "row":
			case "scene":
			case "canvas": return "structure";
			case "frame":
			case "connection": return "object";
			case "cell": return "field";
			case "run":
			case "unit": return "value";
			default: return "debug";
		}
	}
	_isEligibleTarget(node, mode) {
		const target = this._targetForNode(node);
		if (mode === "debug") return true;
		if (this._isCollapsedIntoRangeItem(node, mode)) return false;
		switch (mode) {
			case "use": return target === "action";
			case "change": return target === "field" || target === "value" || target === "range-item" || target === "object" || target === "action";
			case "inspect": return target === "object" || target === "field" || target === "value" || target === "range-item" || target === "action";
			default: return false;
		}
	}
	_rangeItemAncestorFor(node) {
		let cursor = node;
		while (cursor?.parentId) {
			cursor = this._nodes.get(cursor.parentId);
			if (!cursor) return null;
			if (this._targetForNode(cursor) === "range-item") return cursor;
		}
		return null;
	}
	_isCollapsedIntoRangeItem(node, mode) {
		if (mode !== "change" && mode !== "inspect") return false;
		const target = this._targetForNode(node);
		if (target !== "field" && target !== "value") return false;
		return this._rangeItemAncestorFor(node) !== null;
	}
	/** The current focus path. Empty when nothing is focused. */
	get focusPath() {
		return this._focusPath;
	}
	/** The deepest id on the focus path, or `null`. */
	get focusedId() {
		return this._focusPath[this._focusPath.length - 1] ?? null;
	}
	/** The stable product identity for the focused surface, when one was
	*  provided. Falls back to the surface id for anonymous surfaces. */
	get focusedKey() {
		const focusedId = this.focusedId;
		if (!focusedId) return null;
		const node = this._nodes.get(focusedId);
		return node ? this._focusKeyForNode(node) : focusedId;
	}
	/** The depth of the focused id (1 = root, 2 = root's child, ...).
	*  Returns 0 when nothing is focused. */
	get focusDepth() {
		return this._focusPath.length;
	}
	get hoveredId() {
		return this._hoveredId;
	}
	/** All selected ids at a given depth, in sibling order. */
	selectionAt(depth) {
		const set = this._selection.get(depth);
		if (!set) return [];
		const parentId = this._parentOfDepth(depth);
		return (this._children.get(parentId) ?? []).filter((id) => set.has(id));
	}
	/** Look up a node by id. Returns the registration record or `null`. */
	getNode(id) {
		return this._nodes.get(id) ?? null;
	}
	targetFor(id) {
		const node = this._nodes.get(id);
		return node ? this._targetForNode(node) : "debug";
	}
	targetScopeFor(id) {
		return this._nodes.get(id)?.targetScope;
	}
	isEligibleTarget(id, mode = "inspect") {
		const node = this._nodes.get(id);
		return node ? this._isEligibleTarget(node, mode) : false;
	}
	/** Resolve a raw coordinate/instance id to the closest purposeful
	*  target in the same ancestry chain for the requested mode. */
	targetIdFor(id, mode = "inspect") {
		if (!id) return null;
		if (mode === "debug") return this._nodes.has(id) ? id : null;
		let node = this._nodes.get(id);
		if (node && this._isCollapsedIntoRangeItem(node, mode)) return this._rangeItemAncestorFor(node)?.id ?? null;
		while (node) {
			if (this._isEligibleTarget(node, mode)) return node.id;
			if (node.parentId === null) break;
			node = this._nodes.get(node.parentId);
		}
		return null;
	}
	firstTargetId(mode = "inspect") {
		return this._flattenTargetTree(mode)[0] ?? null;
	}
	lastTargetId(mode = "inspect") {
		const ids = this._flattenTargetTree(mode);
		return ids[ids.length - 1] ?? null;
	}
	nextTargetInTree(id, mode = "inspect") {
		return this._stepTargetInTree(id, 1, mode);
	}
	prevTargetInTree(id, mode = "inspect") {
		return this._stepTargetInTree(id, -1, mode);
	}
	firstChildTargetId(id, mode = "inspect") {
		const visit = (parentId) => {
			for (const childId of this._children.get(parentId) ?? []) {
				const child = this._nodes.get(childId);
				if (!child) continue;
				if (this._isEligibleTarget(child, mode)) return child.id;
				const descendant = visit(child.id);
				if (descendant) return descendant;
			}
			return null;
		};
		return visit(id);
	}
	parentTargetId(id, mode = "inspect") {
		let node = this._nodes.get(id);
		while (node?.parentId) {
			node = this._nodes.get(node.parentId);
			if (node && this._isEligibleTarget(node, mode)) return node.id;
		}
		return null;
	}
	selectedIds() {
		const ids = [];
		for (const [depth] of this._selection) ids.push(...this.selectionAt(depth));
		return ids;
	}
	treeSnapshot(parentId = null, depth = 0) {
		const snapshots = [];
		for (const id of this._children.get(parentId) ?? []) {
			const node = this._nodes.get(id);
			if (!node) continue;
			const children = this._children.get(id) ?? [];
			snapshots.push({
				...node,
				depth,
				children,
				focused: this.isFocused(id),
				hovered: this.isHovered(id),
				onFocusPath: this.isOnFocusPath(id),
				selected: this.isSelected(id)
			});
			snapshots.push(...this.treeSnapshot(id, depth + 1));
		}
		return snapshots;
	}
	/** Consume the id restored by focus-key continuity. DOM modifiers use
	*  this once to return real browser focus after a mode-render swap. */
	consumeRestoredFocusId(id) {
		if (this._restoredFocusId !== id) return false;
		this._restoredFocusId = null;
		return true;
	}
	/** Ordered child ids for a given parent (or the root when `parentId`
	*  is `null`). */
	childrenOf(parentId) {
		return this._children.get(parentId) ?? [];
	}
	/** The registered parent id for a node, or `null` for the root. */
	parentOf(id) {
		return this._nodes.get(id)?.parentId ?? null;
	}
	/** Ordered sibling ids for a node, including the node itself. */
	siblingsOf(id) {
		const node = this._nodes.get(id);
		if (!node) return [];
		return this._children.get(node.parentId) ?? [];
	}
	/** Focus a registered node by id, rebuilding the full ancestry path. */
	focusId(id) {
		if (!this._nodes.has(id)) return false;
		this.focus(this._ancestry(id));
		return true;
	}
	/** First registered surface in tree order. */
	firstId() {
		return this._flattenTree()[0] ?? null;
	}
	/** Last registered surface in tree order. */
	lastId() {
		const ids = this._flattenTree();
		return ids[ids.length - 1] ?? null;
	}
	/** DFS tree walk for Tab: first child, next sibling, then ancestor's
	*  next sibling. Mirrors the original polymorph surface traversal. */
	nextInTree(id) {
		const kids = this._children.get(id) ?? [];
		if (kids.length > 0) return kids[0];
		let cur = id;
		while (cur) {
			const node = this._nodes.get(cur);
			if (!node) break;
			const sibs = this._children.get(node.parentId) ?? [];
			const idx = sibs.indexOf(cur);
			if (idx >= 0 && idx < sibs.length - 1) return sibs[idx + 1];
			cur = node.parentId;
		}
		return null;
	}
	/** Shift+Tab tree walk: previous sibling's deepest descendant, else
	*  parent. Mirrors the original polymorph surface traversal. */
	prevInTree(id) {
		const node = this._nodes.get(id);
		if (!node) return null;
		const sibs = this._children.get(node.parentId) ?? [];
		const idx = sibs.indexOf(id);
		if (idx > 0) {
			let cur = sibs[idx - 1];
			while (true) {
				const kids = this._children.get(cur) ?? [];
				if (kids.length === 0) return cur;
				cur = kids[kids.length - 1];
			}
		}
		return node.parentId;
	}
	/**
	* Set the focus path explicitly. The selection at the deepest depth
	* is replaced with `{focusedId}`; outer depths are preserved (so a
	* canvas-level selection survives entering a row card). Pass an
	* empty array to clear focus entirely.
	*/
	focus(path) {
		this._focusPath = [...path];
		const head = this.focusedId;
		if (head === null) {
			this._selectionAnchor = null;
			this._notify();
			return;
		}
		const depth = this._focusPath.length - 1;
		const next = /* @__PURE__ */ new Map();
		for (const [d, set] of this._selection) if (d !== depth) next.set(d, new Set(set));
		next.set(depth, new Set([head]));
		this._selection = next;
		this._selectionAnchor = head;
		this._notify();
	}
	/** Descend into the focused node's first child. Returns true if
	*  focus moved. */
	enter() {
		const head = this.focusedId;
		if (!head) return false;
		const kids = this._children.get(head);
		if (!kids || kids.length === 0) return false;
		this.focus([...this._focusPath, kids[0]]);
		return true;
	}
	/** Pop the deepest entry off the focus path. Returns true if focus
	*  moved (i.e., depth was > 0). */
	exit() {
		if (this._focusPath.length === 0) return false;
		this.focus(this._focusPath.slice(0, -1));
		return true;
	}
	/** Move focus to the next sibling at the current depth. The `axis`
	*  hint lets hosts wire ArrowRight to `'x'`, ArrowDown to `'y'`,
	*  Tab to `'linear'`. K.3a treats all axes the same; K.4+ may
	*  add axis-specific behavior. */
	next(axis = "linear") {
		if (!this.focusedId) return false;
		return this._step(1, axis);
	}
	prev(axis = "linear") {
		if (!this.focusedId) return false;
		return this._step(-1, axis);
	}
	_step(delta, _axis) {
		const head = this.focusedId;
		if (!head) return false;
		const node = this._nodes.get(head);
		if (!node) return false;
		const sibs = this._children.get(node.parentId) ?? [];
		const idx = sibs.indexOf(head);
		if (idx < 0) return false;
		const target = idx + delta;
		if (target < 0 || target >= sibs.length) return false;
		const nextId = sibs[target];
		this.focus([...this._focusPath.slice(0, -1), nextId]);
		return true;
	}
	_flattenTree() {
		const out = [];
		const visit = (parentId) => {
			const kids = this._children.get(parentId) ?? [];
			for (const id of kids) {
				out.push(id);
				visit(id);
			}
		};
		visit(null);
		return out;
	}
	_flattenTargetTree(mode) {
		if (mode === "debug") return this._flattenTree();
		return this._flattenTree().filter((id) => {
			const node = this._nodes.get(id);
			return node ? this._isEligibleTarget(node, mode) : false;
		});
	}
	_stepTargetInTree(id, delta, mode) {
		const current = this.targetIdFor(id, mode);
		const ids = this._flattenTargetTree(mode);
		if (ids.length === 0) return null;
		if (!current) return delta > 0 ? ids[0] : ids[ids.length - 1];
		const index = ids.indexOf(current);
		if (index < 0) return delta > 0 ? ids[0] : ids[ids.length - 1];
		return ids[index + delta] ?? null;
	}
	/**
	* Update selection at the focused id's depth. Focus moves to `id`
	* (so subsequent shift-extend operations anchor correctly), unless
	* an additive toggle removes `id` — in that case focus stays put.
	*
	* - Plain (no opts):     replace with `{id}`. Anchor = id.
	* - `additive: true`:    toggle `id` in the set. Anchor = id.
	* - `range: true`:       extend from the active anchor to `id`
	*                        (inclusive sibling range). Anchor preserved.
	*                        Falls back to a single-cell selection when
	*                        no anchor is set or anchor and id have
	*                        different parents.
	*/
	select(id, opts = {}) {
		const node = this._nodes.get(id);
		if (!node) return;
		const depth = this._depthOf(id);
		if (depth < 0) return;
		const next = /* @__PURE__ */ new Map();
		for (const [d, set] of this._selection) next.set(d, new Set(set));
		let bucket = next.get(depth) ?? /* @__PURE__ */ new Set();
		if (opts.range && this._selectionAnchor !== null) {
			const anchorNode = this._nodes.get(this._selectionAnchor);
			if (anchorNode && anchorNode.parentId === node.parentId) {
				const sibs = this._children.get(node.parentId) ?? [];
				const fromIdx = sibs.indexOf(this._selectionAnchor);
				const toIdx = sibs.indexOf(id);
				if (fromIdx >= 0 && toIdx >= 0) {
					const [lo, hi] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
					bucket = new Set(sibs.slice(lo, hi + 1));
				} else bucket = new Set([id]);
			} else {
				bucket = new Set([id]);
				this._selectionAnchor = id;
			}
		} else if (opts.additive) {
			bucket = new Set(bucket);
			if (bucket.has(id)) bucket.delete(id);
			else bucket.add(id);
			this._selectionAnchor = id;
		} else {
			bucket = new Set([id]);
			this._selectionAnchor = id;
		}
		if (bucket.size === 0) next.delete(depth);
		else next.set(depth, bucket);
		this._selection = next;
		if (bucket.has(id)) this._focusPath = this._ancestry(id);
		this._notify();
	}
	/** Clear selection at a given depth, or all depths. When called
	*  with no depth, ALSO clears the focus path — that's the
	*  "user clicked the background, drop everything" idiom. When
	*  called with a depth, focus is preserved. */
	clear(depth) {
		if (depth === void 0) {
			this._selection = /* @__PURE__ */ new Map();
			this._selectionAnchor = null;
			this._focusPath = [];
			this._hoveredId = null;
			this._notify();
			return;
		}
		const next = /* @__PURE__ */ new Map();
		for (const [d, set] of this._selection) if (d !== depth) next.set(d, new Set(set));
		this._selection = next;
		this._notify();
	}
	/** Clear focus, hover, anchor, and selected ids for one subtree.
	*  This is the local Escape idiom for composite surfaces: a grid or
	*  canvas can drop its own visible selection chrome without forcing
	*  the surrounding card/environment to handle the same key event. */
	clearSubtree(parentId) {
		if (!this._nodes.has(parentId)) return false;
		const ids = /* @__PURE__ */ new Set();
		const collect = (id) => {
			ids.add(id);
			for (const childId of this._children.get(id) ?? []) collect(childId);
		};
		collect(parentId);
		let changed = false;
		const nextSelection = /* @__PURE__ */ new Map();
		for (const [depth, set] of this._selection) {
			const nextSet = /* @__PURE__ */ new Set();
			for (const id of set) if (ids.has(id)) changed = true;
			else nextSet.add(id);
			if (nextSet.size > 0) nextSelection.set(depth, nextSet);
		}
		const focusIndex = this._focusPath.findIndex((id) => ids.has(id));
		if (focusIndex >= 0) {
			this._focusPath = this._focusPath.slice(0, focusIndex);
			changed = true;
		}
		if (this._selectionAnchor && ids.has(this._selectionAnchor)) {
			this._selectionAnchor = null;
			changed = true;
		}
		if (this._hoveredId && ids.has(this._hoveredId)) {
			this._hoveredId = null;
			changed = true;
		}
		if (!changed) return false;
		this._selection = nextSelection;
		this._notify();
		return true;
	}
	hoverId(id) {
		if (id !== null && !this._nodes.has(id)) return;
		if (this._hoveredId === id) return;
		this._hoveredId = id;
		this._notify();
	}
	/**
	* Handle a keyboard event. Returns true (and calls preventDefault)
	* when the event mapped to a ladder op; false to let the host
	* handle it (e.g., printable keys for type-to-edit).
	*
	* Mapping:
	*   ArrowDown / ArrowRight  →  next (y / x)
	*   ArrowUp   / ArrowLeft   →  prev (y / x)
	*   Tab                     →  next (linear); Shift+Tab → prev
	*   Enter                   →  enter
	*   Escape                  →  exit
	*
	* Shift modifier with arrows is reserved for range-extend in K.4;
	* for now it's treated like plain arrow.
	*/
	handleKey(event) {
		let moved = false;
		switch (event.key) {
			case "ArrowDown":
				moved = this.next("y");
				break;
			case "ArrowUp":
				moved = this.prev("y");
				break;
			case "ArrowRight":
				moved = this.next("x");
				break;
			case "ArrowLeft":
				moved = this.prev("x");
				break;
			case "Tab":
				moved = event.shiftKey ? this.prev("linear") : this.next("linear");
				break;
			case "Enter":
				moved = this.enter();
				break;
			case "Escape":
				moved = this.exit();
				break;
			default: return false;
		}
		if (moved) event.preventDefault();
		return moved;
	}
	/** Walk the ancestry chain to find the depth of a node. Root = 0,
	*  root's child = 1, etc. Returns -1 if the node isn't registered. */
	_depthOf(id) {
		let node = this._nodes.get(id);
		if (!node) return -1;
		let depth = 0;
		while (node && node.parentId !== null) {
			const parent = this._nodes.get(node.parentId);
			if (!parent) break;
			depth++;
			node = parent;
		}
		return depth;
	}
	/** Build the path of ids from the root down to (and including) `id`. */
	_ancestry(id) {
		const chain = [];
		let node = this._nodes.get(id);
		while (node) {
			chain.unshift(node.id);
			if (node.parentId === null) break;
			node = this._nodes.get(node.parentId);
		}
		return chain;
	}
	/** The parent id at a given depth on the current focus path. Used
	*  by `selectionAt` to find the sibling list for ordering. */
	_parentOfDepth(depth) {
		if (depth <= 0) return null;
		return this._focusPath[depth - 1] ?? null;
	}
}, _descriptor$a = _applyDecoratedDescriptor$1(_class$e.prototype, "_focusPath", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return [];
	}
}), _descriptor2$7 = _applyDecoratedDescriptor$1(_class$e.prototype, "_selection", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return /* @__PURE__ */ new Map();
	}
}), _descriptor3$2 = _applyDecoratedDescriptor$1(_class$e.prototype, "_hoveredId", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return null;
	}
}), _class$e);
/**
* Convenience factory. K.3a callers construct one explicitly; K.3b
* will add a context-provided variant for hosts that want
* auto-resolution from a parent.
*/
function createFocusLadder() {
	return new FocusLadder();
}
var EMPTY_PRESET_DEFAULTS = {
	aspects: [],
	modeProjection: {}
};
var FOCI_MODES = [
	"use",
	"change",
	"inspect",
	"debug"
];
var FOCI_PRESET_DEFAULTS = {
	sheet: {
		aspects: ["sheet"],
		modeProjection: {},
		movement: "engine",
		sheetCells: true
	},
	grid: {
		aspects: ["sheet"],
		modeProjection: {},
		movement: "engine",
		sheetCells: true
	},
	table: {
		aspects: [],
		modeProjection: {},
		movement: "engine",
		sheetCells: false
	},
	collection: {
		aspects: [],
		modeProjection: {},
		movement: "engine",
		rowStops: true
	},
	properties: {
		aspects: [],
		modeProjection: {},
		movement: "engine",
		rowStops: true,
		rowValueProjection: true
	},
	bare: {
		aspects: ["bare"],
		modeProjection: {},
		chrome: "bare"
	},
	kanban: {
		aspects: [],
		modeProjection: { change: ["reorder"] },
		rowStops: true,
		destinationKind: "kanban-gap"
	},
	dashboard: {
		aspects: ["place"],
		modeProjection: { change: ["place"] },
		destinationKind: "dashboard-slot"
	},
	canvas: {
		aspects: ["object"],
		modeProjection: { change: ["place", "connect"] },
		movement: "surface",
		canvasFrames: true,
		canvasEdges: true
	},
	scene: {
		aspects: ["object", "viewport"],
		modeProjection: { change: ["place"] }
	},
	outline: EMPTY_PRESET_DEFAULTS,
	layout: EMPTY_PRESET_DEFAULTS,
	page: {
		aspects: [],
		modeProjection: {},
		traversalModel: "document"
	},
	notebook: {
		aspects: [],
		modeProjection: {},
		traversalModel: "document"
	},
	tools: {
		aspects: ["tools"],
		modeProjection: {},
		traversalModel: "tools"
	},
	adorn: EMPTY_PRESET_DEFAULTS
};
function compileFociPolicy(registration) {
	const policy = { ...registration.policy };
	const presetDefaults = presetDefaultsFor(policy.preset);
	if (presetDefaults.chrome && !policy.chrome) policy.chrome = presetDefaults.chrome;
	if (presetDefaults.movement && !policy.movement) policy.movement = presetDefaults.movement;
	if (presetDefaults.traversalModel && !policy.traversalModel) policy.traversalModel = presetDefaults.traversalModel;
	if (presetDefaults.aspects.length > 0 || policy.aspects) policy.aspects = uniqueAspects([...presetDefaults.aspects, ...policy.aspects ?? []]);
	if (Object.keys(presetDefaults.modeProjection).length > 0 || policy.modeProjection) policy.modeProjection = mergeModeProjection(presetDefaults.modeProjection, policy.modeProjection);
	if (policy.chrome === "inert") policy.pointer = "preview-only";
	if (policy.chrome === "bare" && !policy.pointer) policy.pointer = "surface-owned";
	if (policy.chrome === "cell" && !policy.pointer) policy.pointer = "cell-owned";
	if (!policy.pointer) policy.pointer = "transparent";
	if (!policy.selection) policy.selection = defaultSelectionFor(registration);
	if (!policy.keyboard) policy.keyboard = defaultKeyboardFor(registration);
	if (!policy.movement) policy.movement = "auto";
	if (policy.movement === "auto") policy.movement = defaultMovementFor(registration, policy);
	if (!policy.edit) policy.edit = defaultEditFor(registration);
	if (!policy.lift) policy.lift = "none";
	return policy;
}
function compileFociProgram(registrations) {
	const parentById = /* @__PURE__ */ new Map();
	const registrationsById = /* @__PURE__ */ new Map();
	const childrenById = /* @__PURE__ */ new Map();
	const diagnostics = [];
	for (const registration of registrations) {
		if (registrationsById.has(registration.id)) diagnostics.push({
			code: "duplicate-id",
			id: registration.id,
			message: `Duplicate surface id ${registration.id}`
		});
		registrationsById.set(registration.id, registration);
		parentById.set(registration.id, registration.parentId);
		const siblings = childrenById.get(registration.parentId)?.slice() ?? [];
		siblings.push(registration.id);
		childrenById.set(registration.parentId, siblings);
	}
	for (const registration of registrations) if (registration.parentId !== null && !registrationsById.has(registration.parentId)) diagnostics.push({
		code: "missing-parent",
		id: registration.id,
		message: `${registration.id} references missing parent ${registration.parentId}`
	});
	const nodeMap = /* @__PURE__ */ new Map();
	const policiesById = /* @__PURE__ */ new Map();
	for (const registration of registrations) policiesById.set(registration.id, compileFociPolicy(registration));
	return {
		nodes: registrations.map((registration) => {
			const policy = policiesById.get(registration.id) ?? compileFociPolicy(registration);
			const pathRegistrations = pathTo(registration.id, parentById, registrationsById).map((id) => registrationsById.get(id)).filter((node) => Boolean(node));
			const pathPolicies = pathRegistrations.map((node) => {
				return policiesById.get(node.id) ?? compileFociPolicy(node);
			});
			const inheritedAspectsByMode = inheritedAspectsForPath(pathPolicies);
			const inheritedAspects = inheritedAspectsByMode.use;
			const inheritedTraversalModel = pathPolicies.map((nodePolicy) => {
				return nodePolicy.traversalModel ?? (nodePolicy.traversal === "boundary" ? "boundary" : void 0);
			}).reverse().find((model) => model !== null && model !== void 0) ?? null;
			const movementOwner = pathRegistrations.map((node, index) => {
				const compiledPolicy = pathPolicies[index] ?? compileFociPolicy(node);
				return {
					id: node.id,
					movement: compiledPolicy.movement ?? "auto"
				};
			}).reverse().find((entry) => entry.movement !== "auto");
			const presetDefaults = presetDefaultsFor(policy.preset);
			const sheetCellDefault = inheritedPresetDefault(pathRegistrations, "sheetCells");
			if (sheetCellDefault === true && registration.surface === "cell") {
				const explicit = registration.policy ?? {};
				if (explicit.chrome === void 0) policy.chrome = "cell";
				if (explicit.pointer === void 0) policy.pointer = "cell-owned";
				if (explicit.selection === void 0) policy.selection = "grid-cell";
				if (registration.grid && explicit.keyboard === void 0) policy.keyboard = "grid-cell";
			}
			const canvasFrameDefault = inheritedPresetDefault(pathRegistrations, "canvasFrames");
			if (canvasFrameDefault === true && (registration.surface === "frame" || registration.surface === "connection")) {
				const explicit = registration.policy ?? {};
				if (explicit.pointer === void 0) policy.pointer = "surface-owned";
				if (explicit.selection === void 0) policy.selection = "object";
				if (explicit.keyboard === void 0) policy.keyboard = "canvas";
				if (explicit.movement === void 0) policy.movement = "surface";
			}
			const canvasEdgeDefault = inheritedPresetDefault(pathRegistrations, "canvasEdges");
			if (canvasEdgeDefault === true && registration.surface === "connection") {
				const explicit = registration.policy ?? {};
				if (explicit.decalShape === void 0) policy.decalShape = "path";
				if (explicit.selection === void 0) policy.selection = "object";
				if (explicit.keyboard === void 0) policy.keyboard = "canvas";
			}
			const rowStopDefault = inheritedPresetDefault(pathRegistrations, "rowStops") === true;
			const rowValueProjectionDefault = inheritedPresetDefault(pathRegistrations, "rowValueProjection") === true;
			const destinationKindDefault = inheritedPresetDefault(pathRegistrations, "destinationKind");
			const compiled = {
				id: registration.id,
				parentId: registration.parentId,
				surface: registration.surface,
				target: registration.target,
				targetScope: registration.targetScope,
				focusKey: registration.focusKey,
				scopeId: registration.scopeId,
				scopeKind: registration.scopeKind,
				policy,
				grid: registration.grid,
				coordinateSpaceId: registration.coordinateSpaceId,
				localCoordinate: registration.localCoordinate,
				children: childrenById.get(registration.id) ?? [],
				inheritedAspects,
				inheritedAspectsByMode,
				inheritedTraversalModel,
				effectiveMovement: movementOwner?.movement ?? "auto",
				movementOwnerId: movementOwner?.id ?? null,
				presetDefaults,
				sheetCellDefault,
				canvasFrameDefault,
				canvasEdgeDefault,
				rowStopDefault,
				rowValueProjectionDefault,
				destinationKindDefault
			};
			nodeMap.set(registration.id, compiled);
			return compiled;
		}),
		nodeMap,
		diagnostics
	};
}
function inheritedAspectsForPath(pathPolicies) {
	return Object.fromEntries(FOCI_MODES.map((mode) => [mode, uniqueAspects(pathPolicies.flatMap((policy) => [...policy.aspects ?? [], ...policy.modeProjection?.[mode] ?? []]))]));
}
function presetDefaultsFor(preset) {
	return preset ? FOCI_PRESET_DEFAULTS[preset] : EMPTY_PRESET_DEFAULTS;
}
function pathTo(id, parentById, registrationsById) {
	const path = [];
	let cursor = id;
	const seen = /* @__PURE__ */ new Set();
	while (cursor && registrationsById.has(cursor) && !seen.has(cursor)) {
		seen.add(cursor);
		path.unshift(cursor);
		cursor = parentById.get(cursor);
	}
	return path;
}
function inheritedPresetDefault(path, key) {
	for (const node of path.slice().reverse()) {
		const preset = node.policy?.preset;
		if (!preset) continue;
		const value = presetDefaultsFor(preset)[key];
		if (value !== void 0) return value;
	}
}
function defaultSelectionFor(registration) {
	switch (registration.target) {
		case "action":
		case "chrome":
		case "debug":
		case "structure": return "none";
		case "object":
			if (registration.surface === "frame" || registration.surface === "connection") return "object";
			if (registration.surface === "layout" || registration.surface === "grid" || registration.surface === "canvas" || registration.surface === "scene" || registration.surface === "outline" || registration.surface === "space") return "none";
			return "single";
		case "field": return registration.grid ? "grid-cell" : "single";
		case "range-item": return registration.surface === "row" ? "row" : "single";
		case "value": return "none";
	}
	switch (registration.surface) {
		case "cell": return "grid-cell";
		case "row": return "row";
		case "frame":
		case "connection": return "object";
		case "layout":
		case "grid":
		case "canvas":
		case "scene":
		case "outline":
		case "space": return "none";
		default: return registration.target === "action" ? "none" : "single";
	}
}
function defaultEditFor(registration) {
	if (registration.target === "field") return "inline";
	return "none";
}
function defaultKeyboardFor(registration) {
	if (registration.grid) return "grid-cell";
	switch (registration.surface) {
		case "cell": return "tree";
		case "row": return "row-list";
		case "canvas":
		case "frame":
		case "connection": return "canvas";
		case "scene": return "scene";
		case "outline": return "outline";
		default: return "tree";
	}
}
function defaultMovementFor(registration, policy) {
	if (registration.surface === "canvas" || registration.surface === "scene" || policy.preset === "canvas" || policy.preset === "scene") return "surface";
	return "auto";
}
function uniqueAspects(aspects) {
	return [...new Set(aspects)];
}
function mergeModeProjection(defaults, explicit) {
	const merged = {};
	for (const mode of [
		"use",
		"change",
		"inspect",
		"debug"
	]) {
		const aspects = uniqueAspects([...defaults[mode] ?? [], ...explicit?.[mode] ?? []]);
		if (aspects.length > 0) merged[mode] = aspects;
	}
	return merged;
}
var FociStore = class {
	constructor() {
		_defineProperty(this, "nodes", /* @__PURE__ */ new Map());
		_defineProperty(this, "children", /* @__PURE__ */ new Map());
		_defineProperty(this, "program", compileFociProgram([]));
		_defineProperty(this, "pathCache", /* @__PURE__ */ new Map());
		_defineProperty(this, "scopeIdCache", /* @__PURE__ */ new Map());
		_defineProperty(this, "focusPath", []);
		_defineProperty(this, "selections", /* @__PURE__ */ new Map());
		_defineProperty(this, "selectionActivatedAt", /* @__PURE__ */ new Map());
		_defineProperty(this, "activeScopeId", null);
		_defineProperty(this, "hoveredId", null);
		_defineProperty(this, "input", null);
		_defineProperty(this, "overlay", null);
		_defineProperty(this, "transfer", null);
		_defineProperty(this, "coordinateRevisions", /* @__PURE__ */ new Map());
		_defineProperty(this, "logEntries", []);
		_defineProperty(this, "snapshotVersionValue", 0);
		_defineProperty(this, "snapshotVersionKey", "");
	}
	register(registration) {
		this.addRegistration(registration);
		this.refreshCompiledProgram();
	}
	load(registrations) {
		this.clearAll();
		for (const registration of registrations) this.addRegistration(registration);
		this.refreshCompiledProgram();
		return this;
	}
	addRegistration(registration) {
		const existing = this.nodes.get(registration.id);
		const node = {
			...registration,
			policy: compileFociPolicy(registration)
		};
		this.nodes.set(node.id, node);
		if (!existing || existing.parentId !== node.parentId) {
			if (existing) this.removeChild(existing.parentId, node.id);
			const ids = this.children.get(node.parentId)?.slice() ?? [];
			if (!ids.includes(node.id)) ids.push(node.id);
			this.children.set(node.parentId, ids);
		}
	}
	node(id) {
		return this.nodes.get(id) ?? null;
	}
	traversalSet(options = {}) {
		const mode = options.mode ?? "use";
		const rootId = options.rootId ?? null;
		const inheritedAspects = new Set(options.aspects ?? []);
		const stops = [];
		const baseAxes = traversalAxesFor(mode, options.inspect);
		const axes = this.transfer && !baseAxes.includes("receivers") ? [...baseAxes, "receivers"] : baseAxes;
		const visit = (id) => {
			const node = this.nodes.get(id);
			if (!node) return;
			if (node.policy.traversal === "skip") return;
			const aspects = this.effectiveAspectsFor(node, mode, inheritedAspects);
			const stop = this.traversalStopFor(node, mode, axes, aspects);
			const boundary = node.policy.traversal === "boundary" || stop !== null && this.isAutoBoundary(node, mode, aspects);
			if (stop) stops.push(stop);
			if (boundary || stop?.reason === "sheet-cell" && (mode === "use" || mode === "change")) return;
			for (const childId of this.children.get(id) ?? []) visit(childId);
		};
		if (rootId === null) for (const id of this.children.get(null) ?? []) visit(id);
		else for (const id of this.children.get(rootId) ?? []) visit(id);
		return {
			mode,
			axes,
			aspects: [...inheritedAspects],
			rootId,
			ids: stops.map((stop) => stop.id),
			stops
		};
	}
	projection(options = {}) {
		const mode = options.mode ?? "use";
		const traversal = this.traversalSet(options);
		const stopById = new Map(traversal.stops.map((stop) => [stop.id, stop]));
		const activeSelection = this.activeSelection();
		const selectedIds = new Set([...this.selections.values()].flatMap((selection) => selection.ids));
		const rangeIds = new Set(activeSelection && activeSelection.ids.length > 1 ? activeSelection.ids : []);
		const layerRolesById = this.projectedLayerRoles();
		const rawNodes = [];
		for (const id of this.treeIds()) {
			const node = this.nodes.get(id);
			const stop = stopById.get(id);
			const layerRoles = layerRolesById.get(id) ?? [];
			const adornments = this.projectionAdornmentsFor(node, {
				mode,
				stop,
				layerRoles,
				rangeIds
			});
			const programmaticFocusable = this.isPointerFocusableTarget(node);
			const browserFocusable = Boolean(stop);
			const focused = this.focusedId === id;
			const projected = {
				id,
				surface: node.surface,
				target: node.target,
				focusKey: node.focusKey,
				scopeId: this.scopeIdFor(node),
				traversalStop: Boolean(stop),
				traversalReason: stop?.reason,
				selectable: (node.policy.selection ?? "single") !== "none",
				editable: this.isEditableStop(node),
				receiver: stop?.reason === "receiver",
				browserFocusable,
				programmaticFocusable,
				tabIndex: browserFocusable ? 0 : focused && programmaticFocusable ? -1 : null,
				focusPath: this.focusPath.includes(id),
				focused,
				hovered: this.hoveredId === id,
				selected: selectedIds.has(id),
				layerRoles,
				adornments,
				visualAdornments: adornments,
				surfaceAdornments: adornments,
				decalAdornments: [],
				adornmentPresentation: {},
				suppressedAdornments: [],
				decalShape: node.policy.decalShape
			};
			rawNodes.push(projected);
		}
		const rawDecals = this.projectionDecals(traversal, mode);
		const visualResolution = this.resolveProjectionVisuals({
			mode,
			nodes: rawNodes,
			decals: rawDecals
		});
		const nodes = rawNodes.map((node) => {
			const visual = visualResolution.nodeVisuals.get(node.id);
			const visualAdornments = visual?.adornments ?? node.adornments;
			const adornmentResolution = this.resolveAdornmentPresentation(node.id, visualAdornments);
			return {
				...node,
				visualAdornments,
				surfaceAdornments: adornmentResolution.surfaceAdornments,
				decalAdornments: adornmentResolution.decalAdornments,
				adornmentPresentation: adornmentResolution.presentation,
				suppressedAdornments: visual?.suppressed ?? []
			};
		});
		const nodeMap = new Map(nodes.map((node) => [node.id, node]));
		const presentationSuppressedDecals = [];
		return {
			mode,
			traversal,
			nodes,
			nodeMap,
			decals: rawDecals,
			visualDecals: mode === "debug" ? visualResolution.decals : visualResolution.decals.filter((decal) => {
				if (this.shouldRenderDecal(decal)) return true;
				presentationSuppressedDecals.push(decal);
				return false;
			}),
			suppressedDecals: [...visualResolution.suppressedDecals, ...presentationSuppressedDecals],
			visualPrimary: visualResolution.primary
		};
	}
	firstTraversalId(options = {}) {
		return this.traversalSet(options).ids[0] ?? null;
	}
	nextTraversalId(id, options = {}) {
		return this.stepTraversalId(id, 1, options);
	}
	prevTraversalId(id, options = {}) {
		return this.stepTraversalId(id, -1, options);
	}
	dispatch(event) {
		switch (event.type) {
			case "click": return this.click(event.targetId, event);
			case "hover": return this.hover(event.targetId);
			case "key": return this.key(event.key, event);
			case "move": return this.move(event.direction, event);
			case "activate": return this.activate(event);
			case "edit": return this.requestEdit(event);
			case "commitInput": return this.commitInput(event);
			case "escape": return this.escape(event);
			case "cancel": return this.cancel(event);
			case "copy": return this.copy();
			case "paste": return this.paste();
			case "dragStart": return this.dragStart(event.targetId);
			case "dragOver": return this.dragOver(event.targetId);
			case "drop": return this.drop();
			case "connectStart": return this.connectStart(event.sourceId, event.sourceHandleId);
			case "connectOver": return this.connectOver(event.targetId, event.targetHandleId);
			case "connectEnd": return this.connectEnd();
			case "moveSpace": return this.moveSpace(event.spaceId, event.movement, event.effect);
		}
	}
	click(rawTargetId, options = {}) {
		const targetId = this.resolvePointerTarget(rawTargetId, options);
		if (!targetId) {
			this.record(`click:${rawTargetId}:ignored`);
			return {
				handled: false,
				ownerId: null,
				reason: "preview-only"
			};
		}
		const target = this.nodes.get(targetId);
		if (!target) return {
			handled: false,
			ownerId: null,
			reason: "unknown-target"
		};
		if (this.input && !this.isSameInputSource(targetId)) this.closeInput(false);
		if (!this.isPointerFocusableTarget(target)) {
			this.closePreview();
			const cancelled = this.cancel({
				trigger: "click-away",
				targetId: target.id,
				focusId: this.focusedId
			});
			if (cancelled.handled) return cancelled;
			this.record(`click:${target.id}:not-selectable`);
			return {
				handled: false,
				ownerId: target.id,
				reason: "not-selectable"
			};
		}
		if (target.target === "action") {
			const sourceId = this.activeSelection()?.headId ?? target.parentId;
			this.openMenu(sourceId, targetId);
			return {
				handled: true,
				ownerId: targetId,
				reason: "action-menu"
			};
		}
		if (target.policy.pointer === "content-interactive") {
			this.input = this.createInputSession({
				kind: "control",
				targetId: target.id,
				keyboardOwnerId: target.id,
				sourceId: this.activeSelection()?.headId ?? target.parentId,
				visualSuppression: "source-anchor",
				policyNode: target
			});
			this.focusTo(target.id);
			this.record(`control:${target.id}`);
			return {
				handled: true,
				ownerId: target.id,
				reason: "control-focus"
			};
		}
		if ((target.policy.edit ?? "none") !== "none" && options.detail === 2) {
			const intent = this.openEditor(target.id);
			return {
				handled: true,
				ownerId: target.id,
				reason: "open-editor",
				intent
			};
		}
		this.closePreview();
		this.select(target.id, options);
		return {
			handled: true,
			ownerId: target.id,
			reason: "select"
		};
	}
	hover(rawTargetId) {
		if (rawTargetId === null) {
			this.hoveredId = null;
			this.closePreview();
			this.record("hover:clear");
			return {
				handled: true,
				ownerId: null,
				reason: "hover-clear"
			};
		}
		const targetId = this.resolvePointerTarget(rawTargetId);
		if (!targetId) {
			this.record(`hover:${rawTargetId}:ignored`);
			return {
				handled: false,
				ownerId: null,
				reason: "preview-only"
			};
		}
		const target = this.nodes.get(targetId);
		if (!target) return {
			handled: false,
			ownerId: null,
			reason: "unknown-target"
		};
		this.hoveredId = target.id;
		if (target.policy.lift === "hover-preview" && this.activeSelection()?.headId === target.id && !this.input) {
			this.overlay = this.createOverlay("preview", target.id, false);
			this.record(`preview:${target.id}`);
			return {
				handled: true,
				ownerId: target.id,
				reason: "preview"
			};
		}
		this.record(`hover:${target.id}`);
		return {
			handled: true,
			ownerId: target.id,
			reason: "hover"
		};
	}
	activate(options = {}) {
		if (this.input) {
			const ownerId = this.input.id;
			if (this.input.kind === "editor") return this.commitEditor(ownerId, options);
			if (this.input.kind === "drag") {
				const targetId = this.focusedId;
				return {
					handled: Boolean(targetId),
					ownerId: targetId,
					reason: targetId ? "drop-on-focus" : "no-drop-target",
					intent: {
						type: "drop-on-focus",
						sourceId: this.input.sourceId,
						targetId
					}
				};
			}
			this.record(`activate:input:${ownerId}`);
			return {
				handled: true,
				ownerId,
				reason: "input-owned-activation"
			};
		}
		const headId = this.keyboardHeadId();
		if (!headId) return {
			handled: false,
			ownerId: null,
			reason: "no-focus"
		};
		const head = this.nodes.get(headId);
		if (!head) return {
			handled: false,
			ownerId: null,
			reason: "unknown-focus"
		};
		if (head.target === "action") {
			const sourceId = this.activeSelection()?.headId ?? head.parentId ?? head.id;
			this.openMenu(sourceId, head.id);
			return {
				handled: true,
				ownerId: head.id,
				reason: "action-menu",
				intent: {
					type: "open-menu",
					sourceId,
					targetId: head.id
				}
			};
		}
		if (head.policy.pointer === "content-interactive") {
			const sourceId = this.activeSelection()?.headId ?? head.parentId ?? null;
			this.input = this.createInputSession({
				kind: "control",
				targetId: head.id,
				keyboardOwnerId: head.id,
				sourceId,
				visualSuppression: "source-anchor",
				policyNode: head
			});
			this.focusTo(head.id);
			this.record(`control:${head.id}`);
			return {
				handled: true,
				ownerId: head.id,
				reason: "control-focus",
				intent: {
					type: "focus-control",
					targetId: head.id,
					sourceId
				}
			};
		}
		const editResult = this.requestEdit(options);
		if (editResult.handled) return editResult;
		const editableDescendantId = this.primaryEditableDescendantIdFor(head);
		if (editableDescendantId) return {
			handled: true,
			ownerId: editableDescendantId,
			reason: "open-editor",
			intent: this.openEditor(editableDescendantId)
		};
		if (this.isActivatableBoundary(head)) {
			this.record(`activate:drill:${head.id}`);
			return {
				handled: true,
				ownerId: head.id,
				reason: "drill-in",
				intent: {
					type: "drill-in",
					targetId: head.id
				}
			};
		}
		this.record(`activate:${head.id}:ignored`);
		return {
			handled: false,
			ownerId: head.id,
			reason: "not-activatable"
		};
	}
	requestEdit(options = {}) {
		const headId = this.keyboardHeadId();
		if (!headId) return {
			handled: false,
			ownerId: null,
			reason: "no-focus"
		};
		const head = this.nodes.get(headId);
		if (!head) return {
			handled: false,
			ownerId: null,
			reason: "unknown-focus"
		};
		if ((head.policy.edit ?? "none") === "none") return {
			handled: false,
			ownerId: head.id,
			reason: "not-editable"
		};
		const intent = this.openEditor(head.id, options.seed);
		return {
			handled: true,
			ownerId: head.id,
			reason: "open-editor",
			intent
		};
	}
	move(direction, options = {}) {
		if (this.input) {
			const ownerId = this.input.id;
			this.record(`move:${direction}:input:${ownerId}`);
			return {
				handled: true,
				ownerId,
				reason: "input-owned-key"
			};
		}
		const headId = this.keyboardHeadId();
		if (!headId) return {
			handled: false,
			ownerId: null,
			reason: "no-focus"
		};
		const head = this.nodes.get(headId);
		if (!head) return {
			handled: false,
			ownerId: null,
			reason: "unknown-focus"
		};
		const movement = this.moveFrom(head.id, direction, options);
		if (movement?.type === "delegated") return {
			handled: true,
			ownerId: movement.ownerId ?? head.id,
			reason: "move-request",
			intent: {
				type: "resolve-move",
				ownerId: movement.ownerId ?? head.id,
				sourceId: head.id,
				direction,
				axis: movement.axis,
				range: Boolean(options.shift),
				scopeId: movement.scopeId
			}
		};
		return {
			handled: movement !== null,
			ownerId: head.id,
			reason: movement ? "move-selection-head" : "edge",
			reveal: movement?.targetId ? {
				targetId: movement.targetId,
				block: "nearest",
				inline: "nearest",
				reason: "keyboard"
			} : void 0,
			intent: movement?.targetId ? {
				type: "move-selection",
				sourceId: head.id,
				targetId: movement.targetId,
				direction,
				axis: movement.axis,
				range: Boolean(options.shift),
				scopeId: movement.scopeId
			} : void 0
		};
	}
	key(key, options = {}) {
		if (this.input) {
			const ownerId = this.input.id;
			if (this.input.kind === "drag" && key === "Tab") {
				const moved = this.stepTraversal(options.shift ? -1 : 1, {
					mode: options.mode ?? "use",
					aspects: options.aspects
				});
				return {
					handled: moved,
					ownerId: this.focusedId,
					reason: moved ? "traverse-transfer" : "traversal-empty"
				};
			}
			if (key === "Escape") {
				const sourceId = this.input.sourceId;
				this.closeInput(true);
				return {
					handled: true,
					ownerId,
					reason: sourceId ? "close-input-restore-source" : "close-input"
				};
			}
			if (key === "Enter" && this.input.kind === "editor") return this.activate(options);
			this.record(`key:${key}:input:${ownerId}`);
			return {
				handled: true,
				ownerId,
				reason: "input-owned-key"
			};
		}
		if (key === "Escape" && this.overlay?.activityRole === "preview") {
			const ownerId = this.overlay.sourceId;
			this.closePreview();
			return {
				handled: true,
				ownerId,
				reason: "close-preview"
			};
		}
		if (this.transfer && key === "Escape") {
			this.transfer = null;
			this.record("transfer:cancel");
			return {
				handled: true,
				ownerId: null,
				reason: "cancel-transfer"
			};
		}
		if (key === "Tab") {
			const moved = this.stepTraversal(options.shift ? -1 : 1, {
				mode: options.mode ?? "use",
				aspects: options.aspects
			});
			return {
				handled: moved,
				ownerId: this.focusedId,
				reason: moved ? "traverse" : "traversal-empty"
			};
		}
		if (key === "Escape") return this.escape(options);
		const headId = this.activeSelection()?.headId ?? this.focusedId;
		if (!headId) return {
			handled: false,
			ownerId: null,
			reason: "no-focus"
		};
		const head = this.nodes.get(headId);
		if (!head) return {
			handled: false,
			ownerId: null,
			reason: "unknown-focus"
		};
		if (key === "Enter") return this.activate(options);
		if (key === "F2") return this.requestEdit(options);
		if (isPrintableKey(key)) return this.requestEdit({
			...options,
			seed: key
		});
		if (isArrowKey(key)) return this.move(directionFromArrowKey(key), options);
		return {
			handled: false,
			ownerId: head.id,
			reason: "unhandled-key"
		};
	}
	escape(options = {}) {
		return this.cancel({
			trigger: "escape",
			focusId: options.focusId ?? this.focusedId
		});
	}
	commitInput(options = {}) {
		if (!this.input) return {
			handled: false,
			ownerId: this.focusedId,
			reason: "no-input"
		};
		const session = this.input;
		const sourceId = session.sourceId;
		const trigger = options.trigger ?? "explicit";
		const advance = options.advance ?? "none";
		this.closeInput(options.restoreSource ?? session.cancelPolicy.restoreSource);
		if (sourceId && advance !== "none") this.advanceFrom(sourceId, advance);
		return {
			handled: true,
			ownerId: session.targetId,
			reason: "commit-input",
			intent: {
				type: "commit-input",
				sourceId,
				targetId: session.targetId,
				trigger,
				advance
			}
		};
	}
	cancel(options = {}) {
		const trigger = options.trigger ?? "programmatic";
		if (this.input) {
			const session = this.input;
			const ownerId = session.id;
			const sourceId = session.sourceId;
			this.closeInput(options.restoreSource ?? session.cancelPolicy.restoreSource);
			return {
				handled: true,
				ownerId,
				reason: isOutsideClickTrigger(trigger) ? "click-away-close-input" : sourceId ? "close-input-restore-source" : "close-input"
			};
		}
		if (this.overlay?.activityRole === "preview") {
			const ownerId = this.overlay.sourceId;
			this.closePreview();
			return {
				handled: true,
				ownerId,
				reason: "close-preview"
			};
		}
		if (this.transfer) {
			this.transfer = null;
			this.record("transfer:cancel");
			return {
				handled: true,
				ownerId: null,
				reason: "cancel-transfer"
			};
		}
		const focusId = this.resolveFocusId(options.focusId ?? this.focusedId);
		const activeScopeId = this.activeScopeId;
		const scopeId = this.selectionScopeForCancel(options, focusId);
		if (scopeId) {
			const selection = this.selections.get(scopeId);
			const parentScopeId = selection ? this.parentSelectionScopeFor(selection) : null;
			const intentType = trigger === "escape" && scopeId === activeScopeId || parentScopeId ? "go-up-level" : "dismiss-selection";
			return this.clearSelectionScope(scopeId, {
				focusId,
				reason: isOutsideClickTrigger(trigger) ? "click-away-cancel" : intentType === "go-up-level" ? "escape-up-level" : "dismiss-focused-selection",
				intentType
			});
		}
		this.record(isOutsideClickTrigger(trigger) ? "click-away:nothing" : focusId ? `escape:${focusId}:nothing` : "escape:nothing");
		return {
			handled: false,
			ownerId: focusId,
			reason: "nothing-to-dismiss"
		};
	}
	copy() {
		const selection = this.activeSelection();
		if (!selection) return {
			handled: false,
			ownerId: null,
			reason: "no-selection"
		};
		this.transfer = {
			kind: "copy",
			origin: cloneSelection(selection)
		};
		this.record(`copy:${selection.scopeId}:${selection.ids.join(",")}`);
		return {
			handled: true,
			ownerId: selection.headId,
			reason: "copy"
		};
	}
	paste() {
		if (!this.transfer || this.transfer.kind !== "copy") return {
			handled: false,
			ownerId: null,
			reason: "no-copy-origin"
		};
		const targetId = this.destinationHeadId();
		if (!targetId) return {
			handled: false,
			ownerId: null,
			reason: "no-destination"
		};
		const destination = this.destinationFor(targetId, "copy");
		if (!destination) return {
			handled: false,
			ownerId: targetId,
			reason: "rejected"
		};
		this.transfer = {
			...this.transfer,
			destination
		};
		this.record(`paste:${this.transfer.origin.scopeId}->${targetId}`);
		this.transfer = null;
		return {
			handled: true,
			ownerId: targetId,
			reason: "paste"
		};
	}
	dragStart(rawTargetId) {
		const targetId = this.resolvePointerTarget(rawTargetId);
		if (!targetId) return {
			handled: false,
			ownerId: null,
			reason: "preview-only"
		};
		if (!this.selectionContaining(targetId)) this.select(targetId);
		const origin = this.selectionContaining(targetId) ?? this.activeSelection();
		if (!origin) return {
			handled: false,
			ownerId: targetId,
			reason: "no-origin"
		};
		this.transfer = {
			kind: "drag",
			origin: cloneSelection(origin),
			pointerCaptured: true,
			movedPastThreshold: false
		};
		this.input = this.createInputSession({
			kind: "drag",
			targetId: `${targetId}::drag`,
			keyboardOwnerId: `${targetId}::drag`,
			sourceId: targetId,
			visualSuppression: "transfer-lock",
			policyNode: this.nodes.get(targetId),
			commitModel: "command",
			commitTriggers: ["release"]
		});
		this.record(`drag:start:${targetId}`);
		return {
			handled: true,
			ownerId: targetId,
			reason: "drag-start"
		};
	}
	dragOver(rawTargetId) {
		if (!this.transfer || this.transfer.kind !== "drag") return {
			handled: false,
			ownerId: null,
			reason: "no-drag-origin"
		};
		const targetId = this.resolvePointerTarget(rawTargetId);
		if (!targetId) return {
			handled: false,
			ownerId: null,
			reason: "preview-only"
		};
		const destination = this.destinationFor(targetId, "move");
		if (!destination) return {
			handled: false,
			ownerId: targetId,
			reason: "rejected"
		};
		this.transfer = {
			...this.transfer,
			destination,
			movedPastThreshold: true
		};
		this.record(`drag:over:${targetId}`);
		return {
			handled: true,
			ownerId: targetId,
			reason: "drag-over"
		};
	}
	drop() {
		if (!this.transfer || this.transfer.kind !== "drag") return {
			handled: false,
			ownerId: null,
			reason: "no-drag"
		};
		const destinationId = this.transfer.destination?.targetId ?? null;
		this.record(`drag:drop:${destinationId ?? "none"}`);
		this.transfer = null;
		this.input = null;
		return {
			handled: destinationId !== null,
			ownerId: destinationId,
			reason: "drop"
		};
	}
	connectStart(rawSourceId, sourceHandleId) {
		const sourceId = this.resolvePointerTarget(rawSourceId);
		if (!sourceId) return {
			handled: false,
			ownerId: null,
			reason: "preview-only"
		};
		if (!this.selectionContaining(sourceId)) this.select(sourceId);
		const origin = this.selectionContaining(sourceId) ?? this.activeSelection();
		if (!origin) return {
			handled: false,
			ownerId: sourceId,
			reason: "no-origin"
		};
		this.transfer = {
			kind: "connect",
			origin: cloneSelection(origin),
			sourceHandleId: sourceHandleId ?? null,
			pointerCaptured: true,
			movedPastThreshold: false
		};
		this.input = this.createInputSession({
			kind: "connect",
			targetId: `${sourceId}::connect`,
			keyboardOwnerId: `${sourceId}::connect`,
			sourceId,
			visualSuppression: "transfer-lock",
			policyNode: this.nodes.get(sourceId),
			commitModel: "command",
			commitTriggers: ["release"]
		});
		this.record(`connect:start:${sourceId}`);
		return {
			handled: true,
			ownerId: sourceId,
			reason: "connect-start"
		};
	}
	connectOver(rawTargetId, targetHandleId) {
		if (!this.transfer || this.transfer.kind !== "connect") return {
			handled: false,
			ownerId: null,
			reason: "no-connect-origin"
		};
		const targetId = this.resolvePointerTarget(rawTargetId);
		if (!targetId) return {
			handled: false,
			ownerId: null,
			reason: "preview-only"
		};
		const destination = this.destinationFor(targetId, "connect");
		if (!destination) return {
			handled: false,
			ownerId: targetId,
			reason: "rejected"
		};
		this.transfer = {
			...this.transfer,
			destination,
			targetHandleId: targetHandleId ?? null,
			movedPastThreshold: true
		};
		this.record(`connect:over:${targetId}`);
		return {
			handled: true,
			ownerId: targetId,
			reason: "connect-over"
		};
	}
	connectEnd() {
		if (!this.transfer || this.transfer.kind !== "connect") return {
			handled: false,
			ownerId: null,
			reason: "no-connect"
		};
		const destinationId = this.transfer.destination?.targetId ?? null;
		this.record(`connect:end:${destinationId ?? "none"}`);
		this.transfer = null;
		this.input = null;
		return {
			handled: destinationId !== null,
			ownerId: destinationId,
			reason: "connect-end"
		};
	}
	moveSpace(spaceId, _movement, effect) {
		const space = this.nodes.get(spaceId);
		if (!space) return {
			handled: false,
			ownerId: null,
			reason: "unknown-space"
		};
		const revision = (this.coordinateRevisions.get(spaceId) ?? 0) + 1;
		this.coordinateRevisions.set(spaceId, revision);
		const moveEffect = effect ?? space.policy.coordinateSpace?.moveEffect ?? "preserve-input";
		const sourceId = this.input?.sourceId ?? this.overlay?.sourceId ?? this.focusedId;
		if (!(sourceId !== null && sourceId !== void 0 && (sourceId === spaceId || this.pathTo(sourceId).includes(spaceId)))) {
			this.record(`space:${spaceId}:move:unaffected`);
			return {
				handled: true,
				ownerId: spaceId,
				reason: "space-move-unaffected"
			};
		}
		switch (moveEffect) {
			case "dismiss-input":
				this.closeInput(true);
				this.closePreview();
				this.record(`space:${spaceId}:move:dismiss-input`);
				return {
					handled: true,
					ownerId: spaceId,
					reason: "space-move-dismiss-input"
				};
			case "clear-selection":
				this.closeInput(true);
				this.closePreview();
				this.clearActiveScope();
				this.record(`space:${spaceId}:move:clear-selection`);
				return {
					handled: true,
					ownerId: spaceId,
					reason: "space-move-clear-selection"
				};
			case "reanchor-overlay":
				if (this.overlay) this.overlay = {
					...this.overlay,
					coordinateSpaceId: spaceId,
					coordinateRevision: revision
				};
				this.record(`space:${spaceId}:move:reanchor-overlay`);
				return {
					handled: true,
					ownerId: spaceId,
					reason: "space-move-reanchor-overlay"
				};
			default:
				this.record(`space:${spaceId}:move:preserve-input`);
				return {
					handled: true,
					ownerId: spaceId,
					reason: "space-move-preserve-input"
				};
		}
	}
	openTools(sourceId, toolsId = `${sourceId}::tools`) {
		this.overlay = this.createOverlay("tools", sourceId, true, toolsId);
		this.input = this.createInputSession({
			kind: "tools",
			targetId: toolsId,
			keyboardOwnerId: toolsId,
			sourceId,
			liftedTargetId: toolsId,
			visualSuppression: "source-anchor",
			policyNode: this.nodes.get(sourceId),
			commitModel: "command",
			commitTriggers: ["explicit"]
		});
		this.record(`tools:${sourceId}`);
	}
	snapshot() {
		return {
			focusPath: [...this.focusPath],
			focusedId: this.focusedId,
			hoveredId: this.hoveredId,
			activeScopeId: this.activeScopeId,
			selections: Object.fromEntries([...this.selections].map(([scopeId, selection]) => [scopeId, cloneSelection(selection)])),
			layers: this.layers(),
			input: this.input ? {
				...this.input,
				commitPolicy: {
					...this.input.commitPolicy,
					triggers: [...this.input.commitPolicy.triggers]
				},
				cancelPolicy: {
					...this.input.cancelPolicy,
					triggers: [...this.input.cancelPolicy.triggers]
				}
			} : null,
			overlay: this.overlay ? { ...this.overlay } : null,
			transfer: this.transfer ? {
				...this.transfer,
				origin: cloneSelection(this.transfer.origin),
				destination: this.transfer.destination ? { ...this.transfer.destination } : void 0
			} : null,
			coordinateRevisions: Object.fromEntries(this.coordinateRevisions),
			tree: this.treeSnapshot(),
			log: [...this.logEntries]
		};
	}
	get focusedId() {
		return this.focusPath[this.focusPath.length - 1] ?? null;
	}
	get snapshotVersion() {
		const key = this.snapshotStateKey();
		if (key !== this.snapshotVersionKey) {
			this.snapshotVersionKey = key;
			this.snapshotVersionValue += 1;
		}
		return this.snapshotVersionValue;
	}
	snapshotStateKey() {
		return JSON.stringify({
			focusPath: this.focusPath,
			activeScopeId: this.activeScopeId,
			hoveredId: this.hoveredId,
			selections: [...this.selections].sort(([left], [right]) => left.localeCompare(right)).map(([scopeId, selection]) => [
				scopeId,
				selection.headId,
				selection.anchorId,
				selection.scopeKind,
				selection.ids,
				selection.range ?? null
			]),
			input: this.input ? {
				kind: this.input.kind,
				id: this.input.id,
				targetId: this.input.targetId,
				sourceId: this.input.sourceId,
				liftedTargetId: this.input.liftedTargetId,
				keyboardOwnerId: this.input.keyboardOwnerId,
				visualSuppression: this.input.visualSuppression,
				commitPolicy: this.input.commitPolicy,
				cancelPolicy: this.input.cancelPolicy
			} : null,
			overlay: this.overlay,
			transfer: this.transfer ? {
				...this.transfer,
				origin: [
					this.transfer.origin.scopeId,
					this.transfer.origin.headId,
					this.transfer.origin.anchorId,
					this.transfer.origin.scopeKind,
					this.transfer.origin.ids,
					this.transfer.origin.range ?? null
				]
			} : null,
			coordinateRevisions: [...this.coordinateRevisions].sort(([left], [right]) => left.localeCompare(right))
		});
	}
	clearAll() {
		this.nodes.clear();
		this.children.clear();
		this.program = compileFociProgram([]);
		this.clearTopologyCaches();
		this.focusPath = [];
		this.selections.clear();
		this.selectionActivatedAt.clear();
		this.activeScopeId = null;
		this.hoveredId = null;
		this.input = null;
		this.overlay = null;
		this.transfer = null;
		this.coordinateRevisions.clear();
		this.logEntries = [];
	}
	refreshCompiledProgram() {
		this.program = compileFociProgram([...this.nodes.values()]);
		for (const compiled of this.program.nodes) {
			const node = this.nodes.get(compiled.id);
			if (node) node.policy = compiled.policy;
		}
		this.clearTopologyCaches();
	}
	clearTopologyCaches() {
		this.pathCache.clear();
		this.scopeIdCache.clear();
	}
	compiledNodeFor(node) {
		const id = typeof node === "string" ? node : node.id;
		return this.program.nodeMap.get(id) ?? null;
	}
	removeChild(parentId, childId) {
		const ids = this.children.get(parentId);
		if (!ids) return;
		const next = ids.filter((id) => id !== childId);
		if (next.length > 0) this.children.set(parentId, next);
		else this.children.delete(parentId);
	}
	resolvePointerTarget(rawTargetId, options = {}) {
		const leafToRoot = this.pointerPathToRoot(rawTargetId, options);
		if (leafToRoot.length === 0) return null;
		for (const id of leafToRoot) if (this.nodes.get(id)?.policy.pointer === "preview-only") return null;
		const leafId = leafToRoot[0] ?? rawTargetId;
		const leaf = this.nodes.get(leafId) ?? this.nodes.get(rawTargetId);
		if (!leaf) return null;
		const atomicAncestor = this.atomicSelectionAncestorFor(rawTargetId, options, leafToRoot);
		if (atomicAncestor) {
			const leafCanOwnInteraction = leaf.policy.pointer === "content-interactive" || leaf.target === "action" || leaf.policy.keyboard === "editor";
			const atomicAlreadySelected = this.selectionContaining(atomicAncestor)?.ids.includes(atomicAncestor) ?? false;
			const activeInputSource = this.input?.sourceId === atomicAncestor;
			if (leafCanOwnInteraction && (atomicAlreadySelected || activeInputSource)) return leaf.id;
			return atomicAncestor;
		}
		if (leaf.policy.pointer === "content-interactive" || leaf.target === "action" || leaf.policy.keyboard === "editor") return leaf.id;
		if ((leaf.policy.selection ?? "single") !== "none") return leaf.id;
		for (const id of leafToRoot) {
			const node = this.nodes.get(id);
			if (!node) continue;
			if (node.policy.pointer === "surface-owned" || node.policy.pointer === "cell-owned") return node.id;
		}
		const traversalIds = new Set(this.traversalSet(options).ids);
		for (const id of leafToRoot) if (traversalIds.has(id)) return id;
		if (leaf.target === "structure") return null;
		return leaf.id;
	}
	pointerPathToRoot(rawTargetId, options) {
		const optionPath = "pointerPath" in options ? options.pointerPath : void 0;
		if (optionPath && optionPath.length > 0) return uniqueKnownPath(optionPath, this.nodes);
		return [...this.pathTo(rawTargetId)].reverse();
	}
	atomicSelectionAncestorFor(rawTargetId, options, leafToRoot = this.pointerPathToRoot(rawTargetId, options)) {
		const mode = options.mode ?? "use";
		if (mode !== "use" && mode !== "change") return null;
		if (leafToRoot.length < 2) return null;
		const explicitAspects = new Set(options.aspects ?? []);
		const axes = traversalAxesFor(mode, options.inspect);
		for (const id of leafToRoot.slice(1)) {
			const node = this.nodes.get(id);
			if (!node) continue;
			const aspects = this.effectiveAspectsFor(node, mode, explicitAspects);
			const stop = this.traversalStopFor(node, mode, axes, aspects);
			if (!stop) continue;
			if (stop.reason === "sheet-cell" || node.policy.pointer === "cell-owned" || node.policy.chrome === "cell" || node.policy.selection === "grid-cell" || node.policy.keyboard === "grid-cell") return node.id;
		}
		return null;
	}
	focus(id) {
		if (id === null) {
			this.focusPath = [];
			this.record("focus:clear");
			return true;
		}
		if (!this.nodes.has(id)) return false;
		this.focusTo(id);
		this.record(`focus:${id}`);
		return true;
	}
	select(id, options = {}) {
		const node = this.nodes.get(id);
		if (!node) return;
		if (options.restoreSource && this.input) this.closeInput(this.input.sourceId === id);
		if ((node.policy.selection ?? "single") === "none") {
			this.focusTo(id);
			this.record(`focus:${id}`);
			return;
		}
		const scopeId = this.scopeIdFor(node);
		const scopeKind = node.scopeKind ?? this.scopeKindFor(scopeId);
		const previous = this.selections.get(scopeId);
		const anchorId = options.range ? previous?.anchorId ?? previous?.headId ?? id : id;
		let ids;
		let range;
		if (options.range && previous) {
			const computed = this.rangeBetween(scopeId, anchorId ?? id, id);
			ids = computed.ids;
			range = computed.range;
		} else if (options.additive && previous) {
			const next = new Set(previous.ids);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			ids = this.orderIds(scopeId, [...next]);
		} else ids = [id];
		const selection = {
			scopeId,
			scopeKind,
			headId: id,
			anchorId,
			ids,
			range
		};
		this.selections.set(scopeId, selection);
		this.activeScopeId = scopeId;
		this.selectionActivatedAt.set(scopeId, nowMs());
		this.focusTo(id);
		this.record(`select:${scopeId}:${ids.join(",")}`);
	}
	clearInteractionState() {
		this.focusPath = [];
		this.selections.clear();
		this.selectionActivatedAt.clear();
		this.activeScopeId = null;
		this.hoveredId = null;
		this.input = null;
		this.overlay = null;
		this.transfer = null;
		this.record("clear:interaction");
	}
	isPointerFocusableTarget(node) {
		if ((node.policy.selection ?? "single") !== "none") return true;
		if (node.target === "action") return true;
		if (node.policy.pointer === "content-interactive") return true;
		if (this.transfer && (node.policy.accepts?.length ?? 0) > 0) return true;
		if (node.target === "field" || node.target === "value" || node.target === "range-item") return true;
		return node.policy.traversal === "stop" || node.policy.traversal === "boundary" || node.policy.traversalModel === "boundary";
	}
	focusTo(id) {
		this.focusPath = this.pathTo(id);
	}
	pathTo(id) {
		const cached = this.pathCache.get(id);
		if (cached) return cached;
		const path = [];
		let cursor = this.nodes.get(id);
		while (cursor) {
			path.unshift(cursor.id);
			if (cursor.parentId === null) break;
			cursor = this.nodes.get(cursor.parentId);
		}
		this.pathCache.set(id, path);
		return path;
	}
	scopeIdFor(node) {
		const cached = this.scopeIdCache.get(node.id);
		if (cached) return cached;
		let scopeId;
		if (node.scopeId) {
			this.scopeIdCache.set(node.id, node.scopeId);
			return node.scopeId;
		}
		let cursor = node;
		while (cursor) {
			if (cursor.targetScope || cursor.scopeId || this.isImplicitScopeRoot(cursor)) {
				scopeId = cursor.scopeId ?? cursor.id;
				this.scopeIdCache.set(node.id, scopeId);
				return scopeId;
			}
			if (cursor.parentId === null) break;
			cursor = this.nodes.get(cursor.parentId);
		}
		scopeId = node.parentId ?? node.id;
		this.scopeIdCache.set(node.id, scopeId);
		return scopeId;
	}
	scopeKindFor(scopeId) {
		const node = this.nodes.get(scopeId);
		return node?.targetScope ?? node?.scopeKind ?? (node ? this.implicitScopeKindFor(node) : void 0) ?? "object";
	}
	isImplicitScopeRoot(node) {
		return this.implicitScopeKindFor(node) !== null;
	}
	implicitScopeKindFor(node) {
		if (node.surface === "grid" || node.policy.preset === "sheet" || node.policy.preset === "grid" || node.policy.preset === "table" || node.policy.preset === "collection" || node.policy.preset === "properties") return "range";
		if (node.surface === "outline" || node.policy.preset === "outline" || node.policy.preset === "page" || node.policy.preset === "notebook") return "document";
		if (node.policy.preset === "tools") return "actions";
		if (node.surface === "canvas" || node.surface === "scene" || node.policy.preset === "canvas" || node.policy.preset === "scene" || node.policy.preset === "kanban" || node.policy.preset === "dashboard") return "object";
		return null;
	}
	coordinateSpaceIdFor(id) {
		let cursor = this.nodes.get(id);
		while (cursor) {
			if (cursor.coordinateSpaceId) return cursor.coordinateSpaceId;
			if (cursor.policy.coordinateSpace) return cursor.id;
			if (cursor.parentId === null) break;
			cursor = this.nodes.get(cursor.parentId);
		}
	}
	activeSelection() {
		if (!this.activeScopeId) return null;
		return this.selections.get(this.activeScopeId) ?? null;
	}
	keyboardHeadId() {
		const focusId = this.focusedId;
		const active = this.activeSelection();
		if (!active?.headId) return focusId;
		if (!focusId) return active.headId;
		if (active.ids.includes(focusId) || this.pathTo(focusId).includes(active.headId)) return active.headId;
		return focusId;
	}
	destinationHeadId() {
		const focusId = this.focusedId;
		if (!focusId) return this.activeSelection()?.headId ?? null;
		const active = this.activeSelection();
		if (!active?.headId) return focusId;
		if (active.ids.includes(focusId) || this.pathTo(focusId).includes(active.headId)) return active.headId;
		return focusId;
	}
	selectionContaining(id) {
		for (const selection of this.selections.values()) if (selection.ids.includes(id)) return selection;
		return null;
	}
	isSameInputSource(targetId) {
		return this.input?.sourceId === targetId || this.input?.sourceId !== null && this.input?.sourceId !== void 0 && this.pathTo(targetId).includes(this.input.sourceId);
	}
	commitEditor(ownerId, options) {
		const sourceId = this.input?.sourceId ?? null;
		const direction = options.shift ? "up" : "down";
		this.closeInput(true);
		if (sourceId) this.advanceFrom(sourceId, direction);
		return {
			handled: true,
			ownerId,
			reason: "commit-editor",
			intent: {
				type: "commit-editor",
				sourceId,
				direction
			}
		};
	}
	openEditor(sourceId, initialValue) {
		const source = this.nodes.get(sourceId);
		if (!source) throw new Error(`Cannot open editor for unknown surface: ${sourceId}`);
		const lifted = source.policy.edit === "lifted";
		const inputId = lifted ? `${sourceId}::edit` : `${sourceId}::inline-editor`;
		this.closePreview();
		this.input = this.createInputSession({
			kind: "editor",
			targetId: inputId,
			keyboardOwnerId: inputId,
			sourceId,
			liftedTargetId: lifted ? inputId : void 0,
			visualSuppression: lifted ? "source-anchor" : "none",
			policyNode: source,
			commitModel: source.policy.commitModel ?? (lifted ? "draft" : "immediate"),
			commitTriggers: source.policy.commitTriggers ?? (lifted ? ["save", "enter"] : ["enter", "blur"])
		});
		if (lifted) this.overlay = this.createOverlay("edit", sourceId, true, inputId);
		this.focusTo(sourceId);
		this.record(initialValue ? `edit:${sourceId}:seed:${initialValue}` : `edit:${sourceId}`);
		return {
			type: "open-editor",
			sourceId,
			editorId: inputId,
			editPolicy: source.policy.edit ?? "none",
			seed: initialValue
		};
	}
	openMenu(sourceId, menuId) {
		const source = sourceId ?? menuId;
		this.overlay = this.createOverlay("menu", source, true, menuId);
		this.input = this.createInputSession({
			kind: "menu",
			targetId: menuId,
			keyboardOwnerId: menuId,
			sourceId: source,
			liftedTargetId: menuId,
			visualSuppression: "source-anchor",
			policyNode: this.nodes.get(source),
			commitModel: "command",
			commitTriggers: ["explicit", "enter"]
		});
		this.record(`menu:${source}`);
	}
	createInputSession(options) {
		const policy = options.policyNode?.policy;
		return {
			kind: options.kind,
			id: options.targetId,
			targetId: options.targetId,
			sourceId: options.sourceId,
			liftedTargetId: options.liftedTargetId,
			keyboardOwnerId: options.keyboardOwnerId,
			visualSuppression: options.visualSuppression,
			commitPolicy: {
				model: options.commitModel ?? policy?.commitModel ?? defaultCommitModelForInputKind(options.kind),
				triggers: [...options.commitTriggers ?? policy?.commitTriggers ?? defaultCommitTriggersForInputKind(options.kind)]
			},
			cancelPolicy: {
				triggers: [...options.cancelTriggers ?? policy?.cancelTriggers ?? defaultCancelTriggersForInputKind(options.kind)],
				restoreSource: options.sourceId !== null
			}
		};
	}
	closeInput(restoreSource) {
		const sourceId = this.input?.sourceId ?? null;
		this.input = null;
		if (this.overlay?.activityRole === "input") this.overlay = null;
		if (restoreSource && sourceId && this.nodes.has(sourceId)) {
			this.focusTo(sourceId);
			const source = this.nodes.get(sourceId);
			const scopeId = this.scopeIdFor(source);
			if (!this.selections.get(scopeId)?.ids.includes(sourceId)) this.select(sourceId);
			else {
				this.activeScopeId = scopeId;
				this.selectionActivatedAt.set(scopeId, nowMs());
			}
		}
		this.record(sourceId ? `input:close:${sourceId}` : "input:close");
	}
	closePreview() {
		if (this.overlay?.activityRole === "preview") {
			this.record(`preview:close:${this.overlay.sourceId}`);
			this.overlay = null;
		}
	}
	createOverlay(kind, sourceId, autofocus, targetId = `${sourceId}::${kind}`) {
		const boundaryScopeId = this.scopeIdFor(this.nodes.get(sourceId));
		const coordinateSpaceId = this.coordinateSpaceIdFor(sourceId);
		return {
			kind,
			sourceId,
			targetId,
			logicalParentId: sourceId,
			activityRole: autofocus ? "input" : "preview",
			autofocus,
			boundaryScopeId,
			coordinateSpaceId,
			coordinateRevision: coordinateSpaceId ? this.coordinateRevisions.get(coordinateSpaceId) ?? 0 : void 0,
			placement: kind === "tools" ? "side" : "bottom-start",
			focusPolicy: autofocus ? "restore-source" : "none",
			closePolicy: autofocus ? "escape" : "source-change"
		};
	}
	moveFrom(sourceId, direction, options) {
		const source = this.nodes.get(sourceId);
		if (!source) return null;
		const keyboard = source.policy.keyboard ?? this.keyboardFor(source);
		const scopeId = this.scopeIdFor(source);
		if (this.shouldDelegateMovement(source, keyboard)) return {
			type: "delegated",
			ownerId: this.movementOwnerIdFor(source, scopeId),
			scopeId,
			axis: keyboard === "grid-cell" && source.grid ? "grid" : movementAxisForKeyboard(keyboard)
		};
		if (keyboard === "grid-cell") {
			const targetId = this.gridStep(source, direction);
			if (!targetId) return null;
			this.closePreview();
			this.select(targetId, { range: options.shift });
			return {
				type: "resolved",
				targetId,
				scopeId,
				axis: source.grid ? "grid" : "linear"
			};
		}
		const descendantTarget = this.descendantStep(source, direction);
		if (descendantTarget) {
			this.select(descendantTarget, { range: options.shift });
			return {
				type: "resolved",
				targetId: descendantTarget,
				scopeId,
				axis: "linear"
			};
		}
		const siblingTarget = this.linearStep(sourceId, direction, keyboard);
		if (!siblingTarget) return null;
		this.select(siblingTarget, { range: options.shift });
		return {
			type: "resolved",
			targetId: siblingTarget,
			scopeId,
			axis: movementAxisForKeyboard(keyboard)
		};
	}
	advanceFrom(sourceId, direction) {
		this.moveFrom(sourceId, direction, {});
	}
	keyboardFor(node) {
		return node.policy.keyboard ?? "tree";
	}
	shouldDelegateMovement(source, keyboard) {
		const policy = this.movementPolicyFor(source);
		if (policy === "surface") return true;
		if (policy === "engine") return false;
		return keyboard === "canvas" || keyboard === "scene";
	}
	movementPolicyFor(source) {
		return this.compiledNodeFor(source)?.effectiveMovement ?? "auto";
	}
	movementOwnerIdFor(source, scopeId) {
		return this.compiledNodeFor(source)?.movementOwnerId ?? scopeId;
	}
	gridStep(source, direction) {
		if (!source.grid) return this.linearStep(source.id, direction, "grid-cell");
		const scopeId = this.scopeIdFor(source);
		const delta = direction === "right" ? {
			row: 0,
			col: 1
		} : direction === "left" ? {
			row: 0,
			col: -1
		} : direction === "down" ? {
			row: 1,
			col: 0
		} : direction === "up" ? {
			row: -1,
			col: 0
		} : null;
		if (!delta) return null;
		const row = source.grid.row + delta.row;
		const col = source.grid.col + delta.col;
		for (const node of this.nodes.values()) if (this.scopeIdFor(node) === scopeId && node.grid?.row === row && node.grid?.col === col) return node.id;
		return null;
	}
	linearStep(sourceId, direction, keyboard) {
		const delta = linearDeltaFor(direction, keyboard);
		if (delta === 0) return null;
		const node = this.nodes.get(sourceId);
		if (!node) return null;
		const ids = this.children.get(node.parentId) ?? [];
		const index = ids.indexOf(sourceId);
		if (index < 0) return null;
		return ids[index + delta] ?? null;
	}
	descendantStep(source, direction) {
		if (direction === "right") return this.primaryEditableDescendantIdFor(source);
		if (direction !== "left" || !source.parentId) return null;
		const parent = this.nodes.get(source.parentId);
		if (!parent) return null;
		if (this.primaryEditableDescendantIdFor(parent) === source.id && this.isRowValueProjectionRoot(parent)) return parent.id;
		return null;
	}
	primaryEditableDescendantIdFor(node) {
		if (!this.isRowValueProjectionRoot(node)) return null;
		const descendants = this.treeIds().filter((id) => {
			if (id === node.id) return false;
			return this.pathTo(id).includes(node.id);
		});
		for (const id of descendants) {
			const candidate = this.nodes.get(id);
			if (candidate && this.isEditableStop(candidate)) return id;
		}
		return null;
	}
	rangeBetween(scopeId, anchorId, headId) {
		const anchor = this.nodes.get(anchorId);
		const head = this.nodes.get(headId);
		if (anchor?.grid && head?.grid) {
			const minRow = Math.min(anchor.grid.row, head.grid.row);
			const maxRow = Math.max(anchor.grid.row, head.grid.row);
			const minCol = Math.min(anchor.grid.col, head.grid.col);
			const maxCol = Math.max(anchor.grid.col, head.grid.col);
			return {
				ids: [...this.nodes.values()].filter((node) => {
					return this.scopeIdFor(node) === scopeId && node.grid && node.grid.row >= minRow && node.grid.row <= maxRow && node.grid.col >= minCol && node.grid.col <= maxCol;
				}).sort(compareGridNodes).map((node) => node.id),
				range: {
					axis: "grid",
					start: anchor.grid,
					end: head.grid,
					normalized: {
						minRow,
						maxRow,
						minCol,
						maxCol
					}
				}
			};
		}
		const ids = this.orderIds(scopeId, [anchorId, headId]);
		return {
			ids,
			range: {
				axis: "linear",
				start: anchorId,
				end: headId,
				normalized: ids
			}
		};
	}
	orderIds(scopeId, ids) {
		const wanted = new Set(ids);
		const ordered = this.treeIds().filter((id) => {
			const node = this.nodes.get(id);
			return node && this.scopeIdFor(node) === scopeId && wanted.has(id);
		});
		return ordered.length > 0 ? ordered : [...ids];
	}
	destinationFor(targetId, operation) {
		const target = this.nodes.get(targetId);
		if (!target) return null;
		const accepts = target.policy.accepts ?? [];
		const payloadType = this.transfer?.origin.ids.map((id) => this.nodes.get(id)?.policy.payloadType).find(Boolean);
		if (accepts.length > 0 && payloadType && !accepts.includes(payloadType)) return null;
		if (accepts.length === 0 && target.policy.selection === "none") return null;
		return {
			targetId,
			targetKind: this.destinationKindFor(target),
			accepts,
			operation
		};
	}
	destinationKindFor(target) {
		if (target.surface === "outline") return "nest-child";
		const presetKind = this.compiledNodeFor(target)?.destinationKindDefault;
		if (presetKind === "kanban-gap") return target.target === "structure" ? "kanban-gap" : "lane-end";
		if (presetKind) return presetKind;
		if (target.surface === "layout") return "dashboard-slot";
		if (target.policy.accepts?.includes("connector-handle") || this.ancestorHasSurface(target, "connection")) return "connect-handle";
		if (target.surface === "canvas") return "drop-world";
		if (target.surface === "grid") return "grid-span";
		return "drop";
	}
	clearActiveScope() {
		if (!this.activeScopeId) return false;
		return this.clearSelectionScope(this.activeScopeId, {
			focusId: this.focusedId,
			reason: "clear-active-scope",
			intentType: "dismiss-selection"
		}).handled;
	}
	clearSelectionScope(scopeId, options) {
		const selection = this.selections.get(scopeId);
		if (!selection) return {
			handled: false,
			ownerId: options.focusId,
			reason: "nothing-to-dismiss"
		};
		const wasActive = this.activeScopeId === scopeId;
		const parentScopeId = this.parentSelectionScopeFor(selection);
		this.selections.delete(scopeId);
		this.selectionActivatedAt.delete(scopeId);
		if (wasActive) {
			this.activeScopeId = parentScopeId ?? latestSelectionScope(this.selections);
			this.focusAfterSelectionDismiss(selection, this.activeScopeId);
			if (this.activeScopeId) this.selectionActivatedAt.set(this.activeScopeId, nowMs());
		} else if (this.activeScopeId && !this.selections.has(this.activeScopeId)) this.activeScopeId = latestSelectionScope(this.selections);
		this.record(`clear:${selection.scopeId}`);
		return {
			handled: true,
			ownerId: selection.headId ?? options.focusId,
			reason: options.reason,
			intent: options.intentType === "go-up-level" ? {
				type: "go-up-level",
				sourceScopeId: selection.scopeId,
				targetScopeId: this.activeScopeId,
				focusId: options.focusId
			} : {
				type: "dismiss-selection",
				scopeId: selection.scopeId,
				focusId: options.focusId
			}
		};
	}
	focusAfterSelectionDismiss(selection, nextActiveScopeId) {
		const nextSelection = nextActiveScopeId ? this.selections.get(nextActiveScopeId) : null;
		if (nextSelection?.headId) {
			this.focusTo(nextSelection.headId);
			return;
		}
		const scopeNode = this.nodes.get(selection.scopeId);
		if (scopeNode && this.isPointerFocusableTarget(scopeNode)) {
			this.focusTo(scopeNode.id);
			return;
		}
		const head = selection.headId ? this.nodes.get(selection.headId) : null;
		if (head?.parentId) {
			const parent = this.nodes.get(head.parentId);
			if (parent && this.isPointerFocusableTarget(parent)) {
				this.focusTo(parent.id);
				return;
			}
		}
		this.focusPath = [];
	}
	parentSelectionScopeFor(selection) {
		const headId = selection.headId;
		if (!headId) return null;
		const ancestorIds = this.pathTo(headId).slice(0, -1).reverse();
		for (const ancestorId of ancestorIds) {
			const ancestorSelection = this.selectionContaining(ancestorId);
			if (ancestorSelection && ancestorSelection.scopeId !== selection.scopeId && this.selections.has(ancestorSelection.scopeId)) return ancestorSelection.scopeId;
		}
		return null;
	}
	selectionScopeForFocus(focusId) {
		const focusNode = this.nodes.get(focusId);
		if (focusNode) {
			const directScopeId = this.scopeIdFor(focusNode);
			if (this.selections.has(directScopeId)) return directScopeId;
		}
		const path = this.pathTo(focusId).slice().reverse();
		for (const id of path) {
			const selection = this.selectionContaining(id);
			if (selection && this.selections.has(selection.scopeId)) return selection.scopeId;
		}
		return null;
	}
	selectionScopeForCancel(options, focusId) {
		if (options.scopeId && this.selections.has(options.scopeId)) return options.scopeId;
		const targetId = options.targetId && this.nodes.has(options.targetId) ? options.targetId : null;
		if (targetId) {
			const scopesUnderTarget = [...this.selections.values()].filter((selection) => {
				return selection.headId !== null && this.pathTo(selection.headId).includes(targetId);
			}).sort((left, right) => {
				return this.pathTo(right.headId ?? "").length - this.pathTo(left.headId ?? "").length;
			});
			if (this.activeScopeId && scopesUnderTarget.some((selection) => {
				return selection.scopeId === this.activeScopeId;
			})) return this.activeScopeId;
			if (scopesUnderTarget[0]) return scopesUnderTarget[0].scopeId;
		}
		if (focusId) {
			const focusedScopeId = this.selectionScopeForFocus(focusId);
			if (focusedScopeId) return focusedScopeId;
		}
		const active = this.activeSelection();
		if (active) return active.scopeId;
		return latestSelectionScope(this.selections);
	}
	resolveFocusId(focusId) {
		if (focusId && this.nodes.has(focusId)) return focusId;
		return this.focusedId;
	}
	layers() {
		const layers = [];
		if (this.input) {
			layers.push({
				role: "input",
				id: this.input.id,
				sourceId: this.input.sourceId ?? void 0,
				keyOwner: true,
				visualTier: "primary"
			});
			if (this.input.sourceId) layers.push({
				role: "source",
				id: this.input.sourceId,
				keyOwner: false,
				visualTier: "source"
			});
		} else {
			const active = this.activeSelection();
			if (active?.headId) layers.push({
				role: "selection",
				id: active.headId,
				scopeId: active.scopeId,
				keyOwner: true,
				visualTier: "primary"
			});
		}
		if (this.overlay?.activityRole === "preview") layers.push({
			role: "preview",
			id: this.overlay.targetId,
			sourceId: this.overlay.sourceId,
			keyOwner: false,
			visualTier: "preview"
		});
		if (this.transfer) {
			if (this.transfer.origin.headId) layers.push({
				role: "origin",
				id: this.transfer.origin.headId,
				scopeId: this.transfer.origin.scopeId,
				keyOwner: false,
				visualTier: "source"
			});
			const destination = this.visibleTransferDestination();
			if (destination) layers.push({
				role: "destination",
				id: destination.targetId,
				keyOwner: false,
				visualTier: "destination"
			});
		}
		if (this.hoveredId) layers.push({
			role: "hover",
			id: this.hoveredId,
			keyOwner: false,
			visualTier: "preview"
		});
		for (const [scopeId, selection] of this.selections) {
			if (scopeId === this.activeScopeId) continue;
			if (!selection.headId) continue;
			layers.push({
				role: "context",
				id: selection.headId,
				scopeId,
				keyOwner: false,
				visualTier: "context"
			});
		}
		return layers;
	}
	projectedLayerRoles() {
		const rolesById = /* @__PURE__ */ new Map();
		for (const layer of this.layers()) {
			if (this.nodes.has(layer.id)) addProjectionLayerRole(rolesById, layer.id, layer.role);
			if (layer.sourceId && this.nodes.has(layer.sourceId)) addProjectionLayerRole(rolesById, layer.sourceId, "source");
		}
		return new Map([...rolesById].map(([id, roles]) => [id, [...roles]]));
	}
	projectionAdornmentsFor(node, options) {
		const adornments = /* @__PURE__ */ new Set();
		if (this.focusedId === node.id) adornments.add("focus");
		if (options.rangeIds.has(node.id)) adornments.add("range");
		if (options.stop?.reason === "receiver") adornments.add("receiver");
		for (const role of options.layerRoles) {
			if (role === "input" || role === "preview") continue;
			if (role === "selection" && this.focusedId === node.id) continue;
			adornments.add(role);
			if (role === "hover" && (options.mode === "inspect" || options.mode === "debug")) adornments.add("inspect");
		}
		return [...adornments];
	}
	projectionDecals(traversal, mode) {
		const decals = [];
		const activeSelection = this.activeSelection();
		for (const stop of traversal.stops) if (stop.reason === "receiver") decals.push({
			kind: "receiver",
			ids: [stop.id],
			label: `Drop target ${stop.id}`
		});
		if (activeSelection && activeSelection.ids.length > 1) decals.push({
			kind: "range",
			ids: [...activeSelection.ids],
			label: `Range ${activeSelection.ids.join(", ")}`
		});
		for (const layer of this.layers()) {
			if (layer.role === "input" || layer.role === "preview") continue;
			if (layer.role === "selection" && layer.id === this.focusedId) continue;
			if (layer.role === "hover" || layer.role === "inspect") continue;
			if (!this.nodes.has(layer.id)) continue;
			decals.push({
				kind: layer.role,
				ids: [layer.id],
				label: `${layer.role} ${layer.id}`
			});
		}
		if (this.hoveredId && this.nodes.has(this.hoveredId) && (mode === "inspect" || mode === "debug")) decals.push({
			kind: "inspect",
			ids: [this.hoveredId],
			label: `Inspect ${this.hoveredId}`
		});
		if (this.focusedId && this.nodes.has(this.focusedId)) decals.push({
			kind: "focus",
			ids: [this.focusedId],
			label: `Focus ${this.focusedId}`
		});
		if (this.input?.sourceId && this.nodes.has(this.input.sourceId)) decals.push({
			kind: "edit-anchor",
			ids: [this.input.sourceId],
			label: `Edit anchor ${this.input.sourceId}`
		});
		return decals;
	}
	resolveProjectionVisuals(options) {
		const adornmentsById = /* @__PURE__ */ new Map();
		const suppressedById = /* @__PURE__ */ new Map();
		for (const node of options.nodes) {
			adornmentsById.set(node.id, new Set(node.adornments));
			suppressedById.set(node.id, /* @__PURE__ */ new Set());
		}
		const rawDecals = [...options.decals];
		const suppressedDecals = [];
		let visualDecals = rawDecals;
		const primary = this.visualPrimaryFor(options);
		if (options.mode === "debug") return {
			nodeVisuals: buildNodeVisuals(adornmentsById, suppressedById),
			decals: rawDecals,
			suppressedDecals: [],
			primary
		};
		const suppressAdornment = (id, kind) => {
			const adornments = adornmentsById.get(id);
			if (!adornments?.has(kind)) return;
			adornments.delete(kind);
			suppressedById.get(id)?.add(kind);
		};
		const suppressAdornmentsEverywhere = (kinds) => {
			for (const node of options.nodes) for (const kind of kinds) suppressAdornment(node.id, kind);
		};
		const addAdornment = (id, kind) => {
			adornmentsById.get(id)?.add(kind);
		};
		const suppressDecals = (predicate) => {
			const kept = [];
			for (const decal of visualDecals) if (predicate(decal)) suppressedDecals.push(decal);
			else kept.push(decal);
			visualDecals = kept;
		};
		if (this.transferLocksVisuals()) {
			suppressAdornmentsEverywhere([
				"focus",
				"selection",
				"range",
				"context",
				"hover",
				"inspect"
			]);
			suppressDecals((decal) => decal.kind === "focus" || decal.kind === "selection" || decal.kind === "range" || decal.kind === "context" || decal.kind === "hover" || decal.kind === "inspect");
		} else if (this.input?.sourceId && this.input.visualSuppression === "source-anchor") {
			const sourceId = this.input.sourceId;
			suppressAdornmentsEverywhere(["range", "context"]);
			for (const kind of [
				"focus",
				"selection",
				"source",
				"origin",
				"destination"
			]) suppressAdornment(sourceId, kind);
			addAdornment(sourceId, "edit-anchor");
			suppressDecals((decal) => decal.kind === "range" || decal.kind === "context" || decal.kind === "source" || decal.kind === "origin" || decal.kind === "selection" || decal.kind === "focus" && decal.ids.includes(sourceId));
		} else if (this.hoveredId && options.mode === "inspect") {
			suppressAdornmentsEverywhere([
				"focus",
				"selection",
				"range",
				"context"
			]);
			suppressDecals((decal) => decal.kind === "focus" || decal.kind === "selection" || decal.kind === "range" || decal.kind === "context");
		} else if (primary?.kind === "range") {
			suppressAdornmentsEverywhere([
				"focus",
				"selection",
				"context"
			]);
			suppressDecals((decal) => decal.kind === "focus" || decal.kind === "selection" || decal.kind === "context");
		}
		const activeSelection = this.activeSelection();
		if (activeSelection?.headId && this.focusedId && activeSelection.headId !== this.focusedId && this.pathTo(activeSelection.headId).includes(this.focusedId)) {
			suppressAdornment(this.focusedId, "focus");
			suppressDecals((decal) => decal.kind === "focus" && decal.ids.includes(this.focusedId));
		}
		return {
			nodeVisuals: buildNodeVisuals(adornmentsById, suppressedById),
			decals: visualDecals,
			suppressedDecals,
			primary
		};
	}
	resolveAdornmentPresentation(id, visualAdornments) {
		const node = this.nodes.get(id);
		const surfaceAdornments = [];
		const decals = [];
		const presentation = {};
		for (const adornment of visualAdornments) {
			const resolved = this.presentationForAdornment(node, adornment);
			presentation[adornment] = resolved;
			if (resolved === "surface" || resolved === "both") surfaceAdornments.push(adornment);
			if (resolved === "decal" || resolved === "both") decals.push(adornment);
		}
		return {
			surfaceAdornments,
			decalAdornments: decals,
			presentation
		};
	}
	presentationForAdornment(node, adornment) {
		const explicit = node?.policy.adornments?.[adornment];
		if (explicit && explicit !== "auto") return explicit;
		if (node?.surface === "row" && (adornment === "focus" || adornment === "selection" || adornment === "source")) return "surface";
		if (adornment === "range" || adornment === "receiver" || adornment === "inspect" || adornment === "edit-anchor" || adornment === "origin" || adornment === "destination") return "decal";
		if (adornment === "focus" || adornment === "selection" || adornment === "source") return this.surfaceNeedsExternalSelectionChrome(node) ? "decal" : "surface";
		return "surface";
	}
	shouldRenderDecal(decal) {
		if (decal.ids.length === 0) return false;
		return decal.ids.some((id) => {
			const presentation = this.presentationForAdornment(this.nodes.get(id), decal.kind);
			return presentation === "decal" || presentation === "both";
		});
	}
	surfaceNeedsExternalSelectionChrome(node) {
		if (!node) return false;
		return node.target === "range-item" || node.policy.selection === "grid-cell" || node.policy.selection === "object" || node.policy.selection === "range" || node.policy.keyboard === "grid-cell" || node.policy.chrome === "cell" || node.policy.aspects?.includes("cell") === true;
	}
	visualPrimaryFor(options) {
		const destination = this.visibleTransferDestination();
		const transfer = this.transfer;
		if (destination && transfer) return {
			kind: "transfer-destination",
			id: destination.targetId,
			sourceId: transfer.origin.headId ?? void 0
		};
		if (this.transfer?.origin.headId) return {
			kind: "transfer-origin",
			id: this.transfer.origin.headId
		};
		if (this.input) return {
			kind: "input",
			id: this.input.id,
			sourceId: this.input.sourceId ?? void 0
		};
		if (this.hoveredId && (options.mode === "inspect" || options.mode === "debug")) return {
			kind: "inspect",
			id: this.hoveredId
		};
		const range = options.decals.find((decal) => decal.kind === "range");
		if (range?.ids[0]) return {
			kind: "range",
			id: range.ids[0]
		};
		if (this.focusedId) return {
			kind: "focus",
			id: this.focusedId
		};
		return null;
	}
	visibleTransferDestination() {
		if (!this.transfer?.destination) return null;
		switch (this.transfer.kind) {
			case "drag": return this.transfer.movedPastThreshold ? this.transfer.destination : null;
			case "place":
			case "connect":
			case "resize":
			case "reorder":
			case "cut": return this.transfer.destination;
			case "copy": return null;
		}
	}
	transferLocksVisuals() {
		if (!this.transfer) return false;
		if (this.visibleTransferDestination()) return true;
		return this.transfer.kind !== "copy";
	}
	treeSnapshot() {
		return this.treeIds().map((id) => {
			return {
				...this.nodes.get(id),
				children: this.children.get(id) ?? [],
				focusPath: this.focusPath.includes(id),
				focused: this.focusedId === id,
				hovered: this.hoveredId === id,
				selected: this.selectionContaining(id) !== null
			};
		});
	}
	treeIds() {
		const ids = [];
		const visit = (parentId) => {
			for (const childId of this.children.get(parentId) ?? []) {
				ids.push(childId);
				visit(childId);
			}
		};
		visit(null);
		return ids;
	}
	stepTraversal(delta, options) {
		const nextId = this.stepTraversalId(this.focusedId, delta, options);
		if (!nextId) return false;
		this.focusTraversalStop(nextId);
		return true;
	}
	stepTraversalId(id, delta, options) {
		const ids = this.traversalSet(options).ids;
		if (ids.length === 0) return null;
		if (!id) return delta > 0 ? ids[0] : ids[ids.length - 1];
		let index = ids.indexOf(id);
		if (index < 0) index = this.pathTo(id).slice().reverse().map((pathId) => ids.indexOf(pathId)).find((candidate) => candidate >= 0) ?? -1;
		if (index < 0) return delta > 0 ? ids[0] : ids[ids.length - 1];
		return ids[index + delta] ?? null;
	}
	focusTraversalStop(id) {
		const node = this.nodes.get(id);
		if (!node) return;
		if ((node.policy.selection ?? "single") === "none") {
			this.focusTo(id);
			this.record(`traverse:${id}`);
			return;
		}
		this.select(id);
	}
	traversalStopFor(node, mode, axes, aspects) {
		const target = node.target;
		const scopeId = this.scopeIdFor(node);
		const forced = node.policy.traversal === "stop";
		const interactive = node.policy.pointer === "content-interactive";
		const action = target === "action" || interactive;
		if (forced) return this.makeTraversalStop(node, scopeId, "forced");
		if (axes.includes("debug")) return this.makeTraversalStop(node, scopeId, "debug");
		if (node.policy.traversal === "boundary" || node.policy.traversalModel === "boundary") return this.makeTraversalStop(node, scopeId, "boundary");
		if (this.isDocumentItemStop(node, mode)) return this.makeTraversalStop(node, scopeId, "document-item");
		if (this.isToolControlStop(node, mode)) return this.makeTraversalStop(node, scopeId, "tool-control");
		if (action && axes.includes("actions")) return this.makeTraversalStop(node, scopeId, interactive ? "interactive" : "action");
		if (this.isReceiverStop(node, mode, aspects) && axes.includes("receivers")) return this.makeTraversalStop(node, scopeId, "receiver");
		if (this.isSheetCellStop(node, aspects) && (mode === "use" || mode === "change")) return this.makeTraversalStop(node, scopeId, "sheet-cell");
		if (this.isObjectStop(node) && axes.includes("objects")) return this.makeTraversalStop(node, scopeId, "object");
		if (this.isRowStop(node) && (mode === "use" || mode === "change")) return this.makeTraversalStop(node, scopeId, "row");
		if (mode === "change" && this.isEditableStop(node)) return this.makeTraversalStop(node, scopeId, "editable");
		if (mode === "inspect" && this.isInspectableStop(node)) return this.makeTraversalStop(node, scopeId, "inspect");
		if (aspects.has("inspect") && this.isMaterialStop(node)) return this.makeTraversalStop(node, scopeId, "inspect");
		return null;
	}
	makeTraversalStop(node, scopeId, reason) {
		return {
			id: node.id,
			surface: node.surface,
			target: node.target,
			scopeId,
			reason
		};
	}
	effectiveAspectsFor(node, mode, explicit) {
		const aspects = new Set(this.compiledNodeFor(node)?.inheritedAspectsByMode[mode] ?? []);
		for (const aspect of explicit) aspects.add(aspect);
		return aspects;
	}
	isReceiverStop(node, mode, aspects) {
		if ((node.policy.accepts?.length ?? 0) === 0) return false;
		if (this.transfer) return true;
		if (mode !== "change") return false;
		return aspects.has("place") || aspects.has("reorder") || aspects.has("resize") || aspects.has("connect");
	}
	isSheetCellStop(node, aspects) {
		if (node.surface !== "cell") return false;
		const sheetCellDefault = this.compiledNodeFor(node)?.sheetCellDefault;
		if (sheetCellDefault === false && !aspects.has("sheet")) return false;
		return node.grid !== void 0 || sheetCellDefault === true || aspects.has("sheet") || node.policy.selection === "grid-cell" || node.policy.chrome === "cell" || node.policy.keyboard === "grid-cell";
	}
	isObjectStop(node) {
		return node.target === "object" && (node.surface === "frame" || node.surface === "connection" || node.policy.selection === "single" || node.policy.selection === "object");
	}
	isRowStop(node) {
		if (node.surface !== "row") return false;
		if (node.policy.selection === "row" && (node.target === "object" || node.target === "range-item")) return true;
		return this.compiledNodeFor(node)?.rowStopDefault === true || this.ancestorHasSurface(node, "outline");
	}
	isRowValueProjectionRoot(node) {
		return node.surface === "row" && this.compiledNodeFor(node)?.rowValueProjectionDefault === true && (node.target === "range-item" || node.target === "field");
	}
	isEditableStop(node) {
		if (node.policy.pointer === "content-interactive") return true;
		return (node.policy.edit ?? "none") !== "none";
	}
	isDocumentItemStop(node, mode) {
		if (mode === "debug") return false;
		if (this.parentTraversalModel(node) !== "document") return false;
		if (node.policy.traversal === "skip") return false;
		return node.target === "object" || node.target === "field" || node.target === "value" || node.target === "range-item" || node.policy.traversal === "stop";
	}
	isToolControlStop(node, mode) {
		if (mode === "debug") return false;
		if (this.nearestTraversalModel(node) !== "tools") return false;
		return node.target === "action" || node.policy.pointer === "content-interactive" || this.isEditableStop(node);
	}
	isMaterialStop(node) {
		return node.target === "object" || node.target === "field" || node.target === "value" || node.target === "range-item";
	}
	isInspectableStop(node) {
		if (node.parentId === null && node.surface === "space") return false;
		if (node.policy.pointer === "preview-only") return false;
		return true;
	}
	isAutoBoundary(node, _mode, _aspects) {
		if (node.policy.traversal === "boundary") return true;
		if (node.policy.traversalModel === "boundary") return true;
		if (node.surface === "pane" || node.surface === "plane") return true;
		if (this.parentTraversalModel(node) === "document") return this.childrenOf(node.id).length > 0;
		return node.surface === "frame" && this.childrenOf(node.id).length > 0 && (this.ancestorHasSurface(node, "canvas") || this.ancestorHasSurface(node, "scene"));
	}
	isActivatableBoundary(node) {
		if (this.childrenOf(node.id).length === 0) return false;
		return node.policy.traversal === "boundary" || node.policy.traversalModel === "boundary" || this.isAutoBoundary(node, "use", /* @__PURE__ */ new Set());
	}
	parentTraversalModel(node) {
		if (node.parentId === null) return null;
		return this.compiledNodeFor(node.parentId)?.inheritedTraversalModel ?? null;
	}
	nearestTraversalModel(node) {
		if (node.parentId === null) return null;
		return this.compiledNodeFor(node.parentId)?.inheritedTraversalModel ?? null;
	}
	ancestorHasSurface(node, surface) {
		for (const pathId of this.pathTo(node.id)) {
			if (pathId === node.id) continue;
			if (this.nodes.get(pathId)?.surface === surface) return true;
		}
		return false;
	}
	childrenOf(id) {
		return this.children.get(id) ?? [];
	}
	record(message) {
		this.logEntries.push(message);
	}
};
function createFociStore(registrations = []) {
	return new FociStore().load(registrations);
}
function traversalAxesFor(mode, inspect = false) {
	if (mode === "debug") return ["debug"];
	if (mode === "inspect" || inspect) return [
		"actions",
		"material",
		"objects"
	];
	if (mode === "change") return [
		"actions",
		"material",
		"editable",
		"objects",
		"receivers"
	];
	return [
		"actions",
		"material",
		"objects"
	];
}
function compareGridNodes(a, b) {
	const rowDelta = (a.grid?.row ?? 0) - (b.grid?.row ?? 0);
	if (rowDelta !== 0) return rowDelta;
	return (a.grid?.col ?? 0) - (b.grid?.col ?? 0);
}
function addProjectionLayerRole(rolesById, id, role) {
	const roles = rolesById.get(id) ?? /* @__PURE__ */ new Set();
	roles.add(role);
	rolesById.set(id, roles);
}
function buildNodeVisuals(adornmentsById, suppressedById) {
	return new Map([...adornmentsById].map(([id, adornments]) => [id, {
		adornments: [...adornments],
		suppressed: [...suppressedById.get(id) ?? []]
	}]));
}
function isArrowKey(key) {
	return key === "ArrowRight" || key === "ArrowLeft" || key === "ArrowUp" || key === "ArrowDown";
}
function directionFromArrowKey(key) {
	switch (key) {
		case "ArrowRight": return "right";
		case "ArrowLeft": return "left";
		case "ArrowUp": return "up";
		case "ArrowDown": return "down";
		default: throw new Error(`Not an arrow key: ${key}`);
	}
}
function linearDeltaFor(direction, keyboard) {
	if (keyboard === "grid-cell") return direction === "left" || direction === "up" ? -1 : 1;
	if (keyboard === "row-list" || keyboard === "outline") {
		if (direction === "up") return -1;
		if (direction === "down") return 1;
		return 0;
	}
	if (keyboard === "tree") {
		if (direction === "up") return -1;
		if (direction === "down") return 1;
		return 0;
	}
	if (keyboard === "canvas" || keyboard === "scene") return direction === "left" || direction === "up" ? -1 : 1;
	return 0;
}
function movementAxisForKeyboard(keyboard) {
	if (keyboard === "canvas" || keyboard === "scene") return "spatial";
	return "linear";
}
function isPrintableKey(key) {
	return key.length === 1 && key >= " " && key !== "";
}
function isOutsideClickTrigger(trigger) {
	return trigger === "outside-click" || trigger === "click-away";
}
function defaultCommitModelForInputKind(kind) {
	switch (kind) {
		case "control": return "immediate";
		case "menu":
		case "tools":
		case "drag": return "command";
		default: return "draft";
	}
}
function defaultCommitTriggersForInputKind(kind) {
	switch (kind) {
		case "control": return ["change"];
		case "drag": return ["release"];
		case "menu":
		case "tools": return ["enter", "explicit"];
		default: return ["enter", "save"];
	}
}
function defaultCancelTriggersForInputKind(kind) {
	switch (kind) {
		case "control": return ["escape", "source-change"];
		case "drag": return ["escape"];
		default: return [
			"escape",
			"outside-click",
			"source-change"
		];
	}
}
function cloneSelection(selection) {
	return {
		...selection,
		ids: [...selection.ids],
		range: selection.range ? {
			...selection.range,
			start: cloneUnknown(selection.range.start),
			end: cloneUnknown(selection.range.end),
			normalized: cloneUnknown(selection.range.normalized)
		} : void 0
	};
}
function cloneUnknown(value) {
	if (Array.isArray(value)) return [...value];
	if (value && typeof value === "object") return { ...value };
	return value;
}
function uniqueKnownPath(path, nodes) {
	const ids = [];
	const seen = /* @__PURE__ */ new Set();
	for (const id of path) {
		if (seen.has(id) || !nodes.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
}
function latestSelectionScope(selections) {
	let latest = null;
	for (const scopeId of selections.keys()) latest = scopeId;
	return latest;
}
function nowMs() {
	return Date.now();
}
var ALL_NOTIFICATION_SCOPES = [
	"selection",
	"topology",
	"input",
	"viewport"
];
var INTERACTION_NOTIFICATION_SCOPES = ["selection", "input"];
var TOPOLOGY_NOTIFICATION_SCOPES = [
	"topology",
	"selection",
	"input"
];
var DEFAULT_VIEWPORT = {
	x: 0,
	y: 0,
	zoom: 1,
	width: 0,
	height: 0
};
var SurfaceRuntimeImpl = class {
	constructor() {
		_defineProperty(this, "store", createFociStore());
		_defineProperty(this, "records", /* @__PURE__ */ new Map());
		_defineProperty(this, "siblingOrders", /* @__PURE__ */ new Map());
		_defineProperty(this, "subscribers", /* @__PURE__ */ new Set());
		_defineProperty(this, "scopedSubscribers", {
			selection: /* @__PURE__ */ new Set(),
			topology: /* @__PURE__ */ new Set(),
			input: /* @__PURE__ */ new Set(),
			viewport: /* @__PURE__ */ new Set()
		});
		_defineProperty(this, "viewportState", { ...DEFAULT_VIEWPORT });
		_defineProperty(this, "pendingSelect", null);
		_defineProperty(this, "projectionCache", /* @__PURE__ */ new Map());
		_defineProperty(this, "batchDepth", 0);
		_defineProperty(this, "pendingReload", false);
		_defineProperty(this, "pendingNotify", false);
		_defineProperty(this, "pendingNotifyScopes", /* @__PURE__ */ new Set());
	}
	batch(callback) {
		const endBatch = this.beginBatch();
		try {
			return callback();
		} finally {
			endBatch();
		}
	}
	beginBatch() {
		let closed = false;
		this.batchDepth += 1;
		return () => {
			if (closed) return;
			closed = true;
			this.batchDepth = Math.max(0, this.batchDepth - 1);
			if (this.batchDepth === 0) this.flushBatch();
		};
	}
	register(registration) {
		const record = cloneRegistration(registration);
		this.records.set(record.id, record);
		this.reloadAndNotify();
		return () => {
			if (this.records.get(record.id) === record) this.unregister(record.id);
		};
	}
	update(id, patch) {
		const existing = this.records.get(id);
		if (!existing) return;
		this.records.set(id, mergeRegistration(existing, patch));
		this.reloadAndNotify();
	}
	unregister(id) {
		if (!this.records.delete(id)) return;
		for (const [parentId, order] of this.siblingOrders) if (order.includes(id)) this.siblingOrders.set(parentId, order.filter((orderedId) => orderedId !== id));
		this.reloadAndNotify();
	}
	setSiblings(parentId, ids) {
		this.siblingOrders.set(parentId, [...ids]);
		this.reloadAndNotify();
	}
	reset() {
		this.records.clear();
		this.siblingOrders.clear();
		this.pendingSelect = null;
		this.pendingReload = false;
		this.pendingNotify = false;
		this.pendingNotifyScopes.clear();
		this.viewportState = { ...DEFAULT_VIEWPORT };
		this.projectionCache.clear();
		this.store.load([]);
		this.queueNotify(ALL_NOTIFICATION_SCOPES);
	}
	dispatch(event) {
		const previousSnapshotVersion = this.store.snapshotVersion;
		const result = this.store.dispatch(event);
		this.queueNotify(INTERACTION_NOTIFICATION_SCOPES, previousSnapshotVersion);
		return result;
	}
	projection(options = {}) {
		const key = projectionCacheKey(options);
		const cached = this.projectionCache.get(key);
		if (cached) return cached;
		const projection = this.store.projection(options);
		this.projectionCache.set(key, projection);
		return projection;
	}
	traversalSet(options = {}) {
		return this.store.traversalSet(options);
	}
	snapshot() {
		return this.store.snapshot();
	}
	registrations() {
		return this.orderedRegistrations();
	}
	node(id) {
		return this.store.node(id);
	}
	get viewport() {
		return { ...this.viewportState };
	}
	subscribe(callback) {
		this.subscribers.add(callback);
		return () => this.subscribers.delete(callback);
	}
	subscribeSelection(callback) {
		return this.subscribeScoped("selection", callback);
	}
	subscribeTopology(callback) {
		return this.subscribeScoped("topology", callback);
	}
	subscribeInput(callback) {
		return this.subscribeScoped("input", callback);
	}
	subscribeViewport(callback) {
		return this.subscribeScoped("viewport", callback);
	}
	focus(id) {
		const previousSnapshotVersion = this.store.snapshotVersion;
		const changed = this.store.focus(id);
		if (changed) this.queueNotify(["selection"], previousSnapshotVersion);
		return changed;
	}
	select(id, options = {}) {
		if (!this.records.has(id)) {
			this.pendingSelect = {
				id,
				options: { ...options }
			};
			return;
		}
		this.pendingSelect = null;
		if (this.pendingReload) {
			this.pendingSelect = {
				id,
				options: { ...options }
			};
			this.pendingNotify = true;
			this.pendingNotifyScopes.add("selection");
			this.projectionCache.clear();
			return;
		}
		const previousSnapshotVersion = this.store.snapshotVersion;
		this.store.select(id, options);
		this.queueNotify(["selection"], previousSnapshotVersion);
	}
	setViewport(viewport) {
		const next = normalizeViewport({
			...this.viewportState,
			...viewport
		}, this.viewportState);
		if (viewportsEqual(this.viewportState, next)) return;
		this.viewportState = next;
		this.queueNotify(["viewport"]);
	}
	hover(id) {
		const previousSnapshotVersion = this.store.snapshotVersion;
		const result = this.store.hover(id);
		this.queueNotify(["selection"], previousSnapshotVersion);
		return result;
	}
	cancel(trigger = "programmatic", options = {}) {
		const previousSnapshotVersion = this.store.snapshotVersion;
		const result = this.store.cancel({
			...options,
			trigger
		});
		this.queueNotify(INTERACTION_NOTIFICATION_SCOPES, previousSnapshotVersion);
		return result;
	}
	clearInteractionState() {
		this.pendingSelect = null;
		const previousSnapshotVersion = this.store.snapshotVersion;
		this.store.clearInteractionState();
		this.queueNotify(INTERACTION_NOTIFICATION_SCOPES, previousSnapshotVersion);
	}
	clearSubtree(parentId) {
		const ids = this.descendantIds(parentId);
		if (ids.size === 0) return false;
		const snapshot = this.store.snapshot();
		const focusInside = snapshot.focusPath.some((id) => ids.has(id));
		const selectionInside = Object.values(snapshot.selections).some((selection) => selection.ids.some((id) => ids.has(id)));
		const hoverInside = snapshot.hoveredId !== null && ids.has(snapshot.hoveredId);
		if (!focusInside && !selectionInside && !hoverInside) return false;
		const previousSnapshotVersion = this.store.snapshotVersion;
		this.store.clearInteractionState();
		this.queueNotify(INTERACTION_NOTIFICATION_SCOPES, previousSnapshotVersion);
		return true;
	}
	reloadAndNotify() {
		this.projectionCache.clear();
		if (this.batchDepth > 0) {
			this.pendingReload = true;
			this.pendingNotify = true;
			for (const scope of TOPOLOGY_NOTIFICATION_SCOPES) this.pendingNotifyScopes.add(scope);
			return;
		}
		this.reload();
		this.notify(TOPOLOGY_NOTIFICATION_SCOPES);
	}
	queueNotify(scopes, previousSnapshotVersion) {
		if (previousSnapshotVersion !== void 0 && previousSnapshotVersion === this.store.snapshotVersion) return;
		this.projectionCache.clear();
		if (this.batchDepth > 0) {
			this.pendingNotify = true;
			for (const scope of scopes) this.pendingNotifyScopes.add(scope);
			return;
		}
		this.notify(scopes);
	}
	flushBatch() {
		if (this.pendingReload) {
			this.pendingReload = false;
			this.reload();
		}
		if (this.pendingNotify) {
			this.pendingNotify = false;
			const scopes = this.pendingNotifyScopes.size > 0 ? [...this.pendingNotifyScopes] : [...ALL_NOTIFICATION_SCOPES];
			this.pendingNotifyScopes.clear();
			this.notify(scopes);
		}
	}
	notify(scopes) {
		this.projectionCache.clear();
		for (const subscriber of [...this.subscribers]) subscriber(this);
		const scoped = /* @__PURE__ */ new Set();
		for (const scope of scopes) for (const subscriber of this.scopedSubscribers[scope]) scoped.add(subscriber);
		for (const subscriber of scoped) subscriber(this);
	}
	subscribeScoped(scope, callback) {
		const subscribers = this.scopedSubscribers[scope];
		subscribers.add(callback);
		return () => subscribers.delete(callback);
	}
	reload() {
		this.projectionCache.clear();
		const state = captureInteractionState(this.store.snapshot());
		this.store.load(this.orderedRegistrations());
		restoreInteractionState(this.store, state, this.records);
		this.applyPendingSelect();
	}
	applyPendingSelect() {
		const pending = this.pendingSelect;
		if (!pending || !this.records.has(pending.id)) return;
		this.pendingSelect = null;
		this.store.select(pending.id, pending.options);
	}
	orderedRegistrations() {
		const children = /* @__PURE__ */ new Map();
		for (const record of this.records.values()) {
			const siblings = children.get(record.parentId) ?? [];
			siblings.push(record);
			children.set(record.parentId, siblings);
		}
		for (const [parentId, order] of this.siblingOrders) {
			const siblings = children.get(parentId);
			if (!siblings) continue;
			const rank = new Map(order.map((id, index) => [id, index]));
			siblings.sort((a, b) => {
				const aRank = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
				const bRank = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
				if (aRank !== bRank) return aRank - bRank;
				return 0;
			});
		}
		const ordered = [];
		const visit = (parentId) => {
			for (const child of children.get(parentId) ?? []) {
				ordered.push(child);
				visit(child.id);
			}
		};
		visit(null);
		if (ordered.length !== this.records.size) {
			for (const record of this.records.values()) if (!ordered.includes(record)) ordered.push(record);
		}
		return ordered.map(cloneRegistration);
	}
	descendantIds(parentId) {
		const descendants = /* @__PURE__ */ new Set();
		const visit = (id) => {
			if (!this.records.has(id) || descendants.has(id)) return;
			descendants.add(id);
			for (const record of this.records.values()) if (record.parentId === id) visit(record.id);
		};
		visit(parentId);
		return descendants;
	}
};
function createSurfaceRuntime() {
	return new SurfaceRuntimeImpl();
}
function projectionCacheKey(options) {
	return [
		options.mode ?? "use",
		options.rootId ?? "",
		options.inspect === true ? "inspect" : "",
		...options.aspects ?? []
	].join("\0");
}
function normalizeViewport(viewport, fallback = DEFAULT_VIEWPORT) {
	return {
		x: finiteNumber(viewport.x, fallback.x),
		y: finiteNumber(viewport.y, fallback.y),
		zoom: positiveNumber(viewport.zoom, fallback.zoom),
		width: nonNegativeNumber(viewport.width, fallback.width),
		height: nonNegativeNumber(viewport.height, fallback.height)
	};
}
function viewportsEqual(a, b) {
	return a.x === b.x && a.y === b.y && a.zoom === b.zoom && a.width === b.width && a.height === b.height;
}
function finiteNumber(value, fallback) {
	return Number.isFinite(value) ? value : fallback;
}
function positiveNumber(value, fallback) {
	return Number.isFinite(value) && value > 0 ? value : fallback;
}
function nonNegativeNumber(value, fallback) {
	return Number.isFinite(value) && value >= 0 ? value : fallback;
}
function cloneRegistration(registration) {
	return {
		...registration,
		policy: registration.policy ? {
			...registration.policy,
			aspects: registration.policy.aspects ? [...registration.policy.aspects] : void 0,
			accepts: registration.policy.accepts ? [...registration.policy.accepts] : void 0,
			modeProjection: registration.policy.modeProjection ? { ...registration.policy.modeProjection } : void 0,
			coordinateSpace: registration.policy.coordinateSpace ? {
				...registration.policy.coordinateSpace,
				axes: registration.policy.coordinateSpace.axes ? [...registration.policy.coordinateSpace.axes] : void 0
			} : void 0
		} : void 0
	};
}
function mergeRegistration(existing, patch) {
	return cloneRegistration({
		...existing,
		...patch,
		policy: patch.policy ? {
			...existing.policy ?? {},
			...patch.policy
		} : existing.policy
	});
}
function captureInteractionState(snapshot) {
	return {
		focusedId: snapshot.focusedId,
		hoveredId: snapshot.hoveredId,
		selections: Object.values(snapshot.selections).map((selection) => ({
			headId: selection.headId,
			ids: [...selection.ids]
		}))
	};
}
function restoreInteractionState(store, state, records) {
	for (const selection of state.selections) {
		let first = true;
		for (const id of selection.ids) {
			if (!records.has(id)) continue;
			store.select(id, { additive: !first });
			first = false;
		}
		if (selection.headId && records.has(selection.headId)) store.focus(selection.headId);
	}
	if (state.focusedId && records.has(state.focusedId)) store.focus(state.focusedId);
	if (state.hoveredId && records.has(state.hoveredId)) store.hover(state.hoveredId);
}
/**
* SurfaceLayerManager — dynamic z-index allocator for surface layers.
*
* Static z-index tokens declare where each layer tier sits, but they do not
* order multiple active surfaces inside one tier. A fresh allocation on mount
* gives nested popovers, cell lifts, modals, drag ghosts, and future top-layer
* bridges deterministic stacking without every host inventing its own ladder.
*/
var TIER_BASE = {
	selection: 1,
	"cell-lift": 200,
	popover: 1e3,
	modal: 1e4,
	toast: 9e4
};
var TIER_CEILING = {
	selection: 99,
	"cell-lift": 999,
	popover: 9999,
	modal: 89999,
	toast: 99999
};
var SurfaceLayerManager = class {
	constructor() {
		_defineProperty(this, "active", /* @__PURE__ */ new Map());
	}
	allocate(tier) {
		const base = TIER_BASE[tier];
		const ceiling = TIER_CEILING[tier];
		let z = base;
		while (this.active.has(z) && z < ceiling) z++;
		if (z >= ceiling) console.warn(`[SurfaceLayerManager] Tier '${tier}' exhausted (${ceiling - base} active). Returning ceiling.`);
		this.active.set(z, tier);
		return z;
	}
	release(z) {
		this.active.delete(z);
	}
	get top() {
		if (this.active.size === 0) return 0;
		return Math.max(...this.active.keys());
	}
	get snapshot() {
		return new Map(this.active);
	}
	countByTier() {
		const out = {
			selection: 0,
			"cell-lift": 0,
			popover: 0,
			modal: 0,
			toast: 0
		};
		for (const tier of this.active.values()) out[tier]++;
		return out;
	}
	_resetForTests() {
		this.active.clear();
	}
	collapseSelectionBoxes(rects, options = {}) {
		return collapseSurfaceLayerBoxes(rects, options);
	}
};
var SURFACE_LAYERS = new SurfaceLayerManager();
function collapseSurfaceLayerBoxes(rects, options = {}) {
	const tolerance = options.tolerance ?? 1;
	const normalized = rects.map((rect, index) => {
		const left = rect.left;
		const top = rect.top;
		const right = rect.left + rect.width;
		const bottom = rect.top + rect.height;
		return {
			ids: [rect.id ?? String(index)],
			left,
			top,
			right,
			bottom,
			width: rect.width,
			height: rect.height,
			...rect.radius ? { radius: clampSurfaceLayerRadii(rect.radius, rect.width, rect.height) } : {}
		};
	}).filter((box) => Number.isFinite(box.left) && Number.isFinite(box.top) && box.width > 0 && box.height > 0).sort((a, b) => a.top - b.top || a.left - b.left);
	if (normalized.length <= 1) return normalized;
	const rowBands = [];
	for (const box of normalized) {
		const row = rowBands.find((band) => overlapsVertically(band[0], box, tolerance));
		if (row) row.push(box);
		else rowBands.push([box]);
	}
	const rowBoxes = [];
	for (const band of rowBands) {
		band.sort((a, b) => a.left - b.left);
		let current = null;
		for (const box of band) if (!current) current = cloneBox(box);
		else if (box.left <= current.right + tolerance) current = unionBoxes(current, box);
		else {
			rowBoxes.push(current);
			current = cloneBox(box);
		}
		if (current) rowBoxes.push(current);
	}
	rowBoxes.sort((a, b) => a.left - b.left || a.top - b.top);
	const collapsed = [];
	for (const box of rowBoxes) {
		const match = collapsed.find((candidate) => nearlyEqual(candidate.left, box.left, tolerance) && nearlyEqual(candidate.right, box.right, tolerance) && box.top <= candidate.bottom + tolerance);
		if (match) {
			const next = unionBoxes(match, box);
			Object.assign(match, next);
		} else collapsed.push(cloneBox(box));
	}
	return collapsed.sort((a, b) => a.top - b.top || a.left - b.left);
}
function overlapsVertically(a, b, tolerance) {
	if (nearlyEqual(a.top, b.top, tolerance)) return true;
	return Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > Math.min(a.height, b.height) / 2;
}
function nearlyEqual(a, b, tolerance) {
	return Math.abs(a - b) <= tolerance;
}
function cloneBox(box) {
	return {
		ids: [...box.ids],
		left: box.left,
		top: box.top,
		right: box.right,
		bottom: box.bottom,
		width: box.width,
		height: box.height,
		...box.radius ? { radius: { ...box.radius } } : {}
	};
}
function unionBoxes(a, b) {
	const left = Math.min(a.left, b.left);
	const top = Math.min(a.top, b.top);
	const right = Math.max(a.right, b.right);
	const bottom = Math.max(a.bottom, b.bottom);
	return {
		ids: [...a.ids, ...b.ids],
		left,
		top,
		right,
		bottom,
		width: right - left,
		height: bottom - top,
		...mergedSurfaceLayerRadius(a.radius, b.radius, right - left, bottom - top)
	};
}
function mergedSurfaceLayerRadius(a, b, width, height) {
	if (!a || !b) return {};
	return { radius: clampSurfaceLayerRadii({
		topLeft: Math.min(a.topLeft, b.topLeft),
		topRight: Math.min(a.topRight, b.topRight),
		bottomRight: Math.min(a.bottomRight, b.bottomRight),
		bottomLeft: Math.min(a.bottomLeft, b.bottomLeft)
	}, width, height) };
}
function clampSurfaceLayerRadii(radius, width, height) {
	const max = Math.max(0, Math.min(width, height) / 2);
	return {
		topLeft: clampRadius(radius.topLeft, max),
		topRight: clampRadius(radius.topRight, max),
		bottomRight: clampRadius(radius.bottomRight, max),
		bottomLeft: clampRadius(radius.bottomLeft, max)
	};
}
function clampRadius(value, max) {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(value, max));
}
var _class$d, _descriptor$9;
var LiftContextName = "boxel-surface:lift-manager";
function defaultOpenFor(kind) {
	switch (kind) {
		case "details":
		case "preview": return ["inspect-hover"];
		case "edit": return ["change-activate"];
		case "tools": return ["use-action"];
	}
}
function normalizeOpen(kind, open) {
	if (Array.isArray(open)) return open;
	if (open) return [open];
	return defaultOpenFor(kind);
}
function normalizeEdge(source, edges, kind) {
	const input = edges?.[kind];
	if (!input) return null;
	const declaration = input === true ? {} : typeof input === "string" ? { presentation: input } : input;
	return {
		...declaration,
		kind,
		sourceId: source.id,
		sourcePath: source.path,
		sourceSurface: source.surface,
		presentation: declaration.presentation ?? kind,
		open: normalizeOpen(kind, declaration.open)
	};
}
function escapeAttributeValue(value) {
	return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}
function restoreAttribute(element, name, value) {
	if (value === null) element.removeAttribute(name);
	else element.setAttribute(name, value);
}
function liftEditorSelector$1() {
	return [
		"input:not([type=\"hidden\"]):not([disabled]):not([tabindex=\"-1\"])",
		"textarea:not([disabled]):not([tabindex=\"-1\"])",
		"select:not([disabled]):not([tabindex=\"-1\"])",
		"[contenteditable=\"\"]:not([tabindex=\"-1\"])",
		"[contenteditable=\"true\"]:not([tabindex=\"-1\"])"
	].join(",");
}
function captureLiftEditorFocus(token) {
	if (token === void 0) return null;
	const active = document.activeElement;
	if (!(active instanceof HTMLElement)) return null;
	const lift = active.closest("[data-bx-lift]");
	if (!lift || !active.matches(liftEditorSelector$1())) return null;
	const editors = Array.from(lift.querySelectorAll(liftEditorSelector$1()));
	const index = Math.max(0, editors.indexOf(active));
	const selection = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? {
		selectionStart: active.selectionStart,
		selectionEnd: active.selectionEnd
	} : {
		selectionStart: null,
		selectionEnd: null
	};
	return {
		token,
		tagName: active.tagName,
		id: active.id || null,
		ariaLabel: active.getAttribute("aria-label"),
		index,
		...selection
	};
}
function restoreLiftEditorFocus(snapshot) {
	if (!snapshot) return;
	const restore = () => {
		const lift = document.querySelector(`[data-bx-lift-focus-token="${snapshot.token}"]`);
		if (!lift) return;
		const editors = Array.from(lift.querySelectorAll(liftEditorSelector$1()));
		const active = document.activeElement;
		if (active instanceof HTMLElement && lift.contains(active) && active.matches(liftEditorSelector$1())) return;
		let target;
		if (snapshot.id) target = editors.find((editor) => editor.id === snapshot.id);
		if (!target && snapshot.ariaLabel) target = editors.find((editor) => editor.tagName === snapshot.tagName && editor.getAttribute("aria-label") === snapshot.ariaLabel);
		target ??= editors[snapshot.index] ?? editors[0];
		if (!target) return;
		target.focus({ preventScroll: true });
		if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && snapshot.selectionStart !== null && snapshot.selectionEnd !== null) target.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
	};
	requestAnimationFrame(restore);
	setTimeout(restore, 0);
}
var LiftManager = (_class$d = class LiftManager {
	constructor(options = {}) {
		_initializerDefineProperty$1(this, "active", _descriptor$9, this);
		_defineProperty(this, "resolver", void 0);
		_defineProperty(this, "sources", /* @__PURE__ */ new Map());
		_defineProperty(this, "hoverTimer", null);
		_defineProperty(this, "dismissTimer", null);
		_defineProperty(this, "lastClosedAt", 0);
		_defineProperty(this, "hoverPauseMs", void 0);
		_defineProperty(this, "dismissGraceMs", void 0);
		_defineProperty(this, "dismissCooldownMs", void 0);
		_defineProperty(this, "sourceAria", null);
		_defineProperty(this, "nextFocusToken", 1);
		_defineProperty(this, "open", (source, edges, kind) => {
			const edge = normalizeEdge(source, edges, kind);
			if (!edge) return false;
			this.cancelHoverTimer();
			this.cancelDismissTimer();
			this.restoreSourceAria();
			this.active = {
				source,
				edge,
				focusToken: this.nextFocusToken++
			};
			this.applySourceAria();
			return true;
		});
		_defineProperty(this, "openForMode", (source, edges, mode, open) => {
			for (const kind of liftKindsForOpen(open)) {
				const edge = normalizeEdge(source, edges, kind);
				if (!edge || !edge.open.includes(open)) continue;
				if (open.startsWith("change") && mode !== "change") continue;
				if (open.startsWith("inspect") && mode !== "inspect") continue;
				if (open.startsWith("use") && mode !== "use") continue;
				this.cancelHoverTimer();
				this.cancelDismissTimer();
				this.restoreSourceAria();
				this.active = {
					source,
					edge,
					focusToken: this.nextFocusToken++
				};
				this.applySourceAria();
				return true;
			}
			return false;
		});
		_defineProperty(this, "openForModeBySourceId", (sourceId, mode, open, sourceOverride = {}) => {
			const registered = this.sources.get(sourceId);
			if (!registered) return false;
			return this.openForMode({
				...registered.source,
				...sourceOverride
			}, registered.edges, mode, open);
		});
		_defineProperty(this, "scheduleHover", (source, edges, mode) => {
			const open = mode === "inspect" ? "inspect-hover" : mode === "change" ? "change-hover" : "use-action";
			const kind = liftKindsForOpen(open).find((candidate) => {
				return normalizeEdge(source, edges, candidate)?.open.includes(open);
			});
			if (!kind) return;
			if (this.active?.edge.kind === "edit") return;
			if (this.lastClosedAt > 0 && Date.now() - this.lastClosedAt < this.dismissCooldownMs) return;
			this.cancelHoverTimer();
			this.cancelDismissTimer();
			this.hoverTimer = setTimeout(() => {
				this.hoverTimer = null;
				if (this.active?.edge.kind === "edit") return;
				this.open(source, edges, kind);
			}, this.hoverPauseMs);
		});
		_defineProperty(this, "scheduleDismissDetails", () => {
			this.cancelHoverTimer();
			if (this.active?.edge.kind !== "details" && this.active?.edge.kind !== "preview") return;
			this.cancelDismissTimer();
			this.dismissTimer = setTimeout(() => {
				this.dismissTimer = null;
				if (this.active?.edge.kind === "details" || this.active?.edge.kind === "preview") {
					this.restoreSourceAria();
					this.active = null;
					this.lastClosedAt = Date.now();
				}
			}, this.dismissGraceMs);
		});
		_defineProperty(this, "cancelDismiss", () => {
			this.cancelDismissTimer();
		});
		_defineProperty(this, "escalate", (kind) => {
			const active = this.active;
			if (!active) return;
			this.open(active.source, { [kind]: { presentation: kind } }, kind);
		});
		_defineProperty(this, "close", () => {
			const closedKind = this.active?.edge.kind;
			this.cancelHoverTimer();
			this.cancelDismissTimer();
			this.restoreSourceAria();
			this.active = null;
			if (closedKind === "details" || closedKind === "preview") this.lastClosedAt = Date.now();
		});
		this.hoverPauseMs = options.hoverPauseMs ?? 350;
		this.dismissGraceMs = options.dismissGraceMs ?? 220;
		this.dismissCooldownMs = options.dismissCooldownMs ?? 600;
	}
	get isOpen() {
		return this.active !== null && this.targetComponent !== void 0;
	}
	get activeSourceId() {
		return this.active?.source.id;
	}
	get activeTargetId() {
		if (!this.active) return void 0;
		return `lift:${this.active.edge.kind}:${this.active.source.id}`;
	}
	get kind() {
		return this.active?.edge.kind ?? "details";
	}
	get anchorSelector() {
		const id = this.active?.source.id;
		return id ? `[data-ladder-id="${escapeAttributeValue(id)}"]` : "";
	}
	get placementMode() {
		return this.active?.edge.placementMode ?? "attached";
	}
	get size() {
		return this.active?.edge.size ?? (this.kind === "edit" ? "comfortable" : "compact");
	}
	get backdrop() {
		return this.active?.edge.backdrop ?? "none";
	}
	get elevation() {
		return this.active?.edge.elevation ?? "elevated";
	}
	get keyboardModel() {
		return this.active?.edge.keyboard ?? (this.kind === "edit" ? "edit-text" : "pick");
	}
	get focusToken() {
		return this.active?.focusToken;
	}
	get targetContext() {
		if (!this.active) return void 0;
		return {
			source: this.active.source,
			edge: this.active.edge,
			close: this.close,
			escalate: this.escalate,
			updateSourceData: (data) => {
				if (!this.active) return;
				this.updateSourceData(this.active.source.id, data);
			}
		};
	}
	get resolvedTarget() {
		const context = this.targetContext;
		if (!context || !this.resolver) return void 0;
		const resolved = this.resolver(context);
		if (!resolved) return void 0;
		if (typeof resolved === "function") return { component: resolved };
		return resolved;
	}
	get targetComponent() {
		return this.resolvedTarget?.component;
	}
	get canRenderTarget() {
		return this.targetComponent !== void 0 && this.targetContext !== void 0;
	}
	hasEdge(source, edges, kind) {
		return normalizeEdge(source, edges, kind) !== null;
	}
	registerSource(source, edges) {
		const token = Symbol(source.id);
		this.sources.set(source.id, {
			source,
			edges,
			token
		});
		return () => {
			if (this.sources.get(source.id)?.token === token) this.sources.delete(source.id);
		};
	}
	isOpenFor(sourceId) {
		return this.active?.source.id === sourceId;
	}
	updateSourceData(sourceId, data) {
		const registered = this.sources.get(sourceId);
		if (registered) this.sources.set(sourceId, {
			...registered,
			source: {
				...registered.source,
				data
			}
		});
		const active = this.active;
		if (!active || active.source.id !== sourceId) return;
		const focusSnapshot = captureLiftEditorFocus(active.focusToken);
		this.active = {
			...active,
			source: {
				...active.source,
				data
			}
		};
		restoreLiftEditorFocus(focusSnapshot);
	}
	destroy() {
		this.cancelHoverTimer();
		this.cancelDismissTimer();
		this.restoreSourceAria();
	}
	applySourceAria() {
		if (!this.active || !this.activeTargetId) return;
		const { element } = this.active.source;
		this.sourceAria = {
			element,
			expanded: element.getAttribute("aria-expanded"),
			controls: element.getAttribute("aria-controls"),
			describedBy: element.getAttribute("aria-describedby"),
			hasPopup: element.getAttribute("aria-haspopup"),
			editing: element.getAttribute("data-surface-editing"),
			hadEditingClass: element.classList.contains("is-surface-editing")
		};
		const targetId = this.activeTargetId;
		switch (this.active.edge.kind) {
			case "details":
				element.setAttribute("aria-describedby", targetId);
				element.removeAttribute("aria-controls");
				element.removeAttribute("aria-haspopup");
				break;
			case "preview":
			case "edit":
				element.setAttribute("aria-controls", targetId);
				element.setAttribute("aria-haspopup", "dialog");
				element.removeAttribute("aria-describedby");
				if (this.active.edge.kind === "edit") {
					element.setAttribute("data-surface-editing", "true");
					element.classList.add("is-surface-editing");
				}
				break;
			case "tools":
				element.setAttribute("aria-controls", targetId);
				element.setAttribute("aria-haspopup", "menu");
				element.removeAttribute("aria-describedby");
				break;
		}
		element.setAttribute("aria-expanded", "true");
	}
	restoreSourceAria() {
		const snapshot = this.sourceAria;
		if (!snapshot) return;
		this.sourceAria = null;
		restoreAttribute(snapshot.element, "aria-expanded", snapshot.expanded);
		restoreAttribute(snapshot.element, "aria-controls", snapshot.controls);
		restoreAttribute(snapshot.element, "aria-describedby", snapshot.describedBy);
		restoreAttribute(snapshot.element, "aria-haspopup", snapshot.hasPopup);
		restoreAttribute(snapshot.element, "data-surface-editing", snapshot.editing);
		snapshot.element.classList.toggle("is-surface-editing", snapshot.hadEditingClass);
	}
	cancelHoverTimer() {
		if (this.hoverTimer !== null) {
			clearTimeout(this.hoverTimer);
			this.hoverTimer = null;
		}
	}
	cancelDismissTimer() {
		if (this.dismissTimer !== null) {
			clearTimeout(this.dismissTimer);
			this.dismissTimer = null;
		}
	}
}, _descriptor$9 = _applyDecoratedDescriptor$1(_class$d.prototype, "active", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return null;
	}
}), _class$d);
function liftKindsForOpen(open) {
	switch (open) {
		case "inspect-hover":
		case "inspect-activate": return ["details", "preview"];
		case "change-hover": return ["details", "preview"];
		case "change-activate": return ["edit"];
		case "use-action": return [
			"tools",
			"preview",
			"details"
		];
	}
}
function createLiftManager(options = {}) {
	return new LiftManager(options);
}
var LadderContextName = "boxel-surface:ladder";
var SurfaceRuntimeContextName = "boxel-surface:runtime";
var ParentIdContextName = "boxel-surface:parent-id";
var ParentContextName = "boxel-surface:parent-surface";
var DemoContextName = "boxel-surface:demo";
var ModeContextName = "boxel-surface:mode";
var InspectContextName = "boxel-surface:inspect";
var PathContextName = "boxel-surface:path";
var ChangeRouteContextName = "boxel-surface:change-route";
var CoordinateSpaceContextName = "boxel-surface:coordinate-space";
var _dec$4, _dec2$1, _dec3$1, _dec4$1, _dec5$1, _dec6$1, _class$c, _descriptor$8, _descriptor2$6, _descriptor3$1, _descriptor4$1, _descriptor5$1, _descriptor6$1, _Lift;
/** Esc / click-out dismiss modifier.
*
*  Capture-phase listeners — they fire BEFORE any bubble-phase
*  handler in the lift body OR in the host's surrounding shell.
*  Both paths call `stopPropagation()` so the same Esc / pointerdown
*  doesn't ALSO trigger the host's grid-key handler (clearing cell
*  focus) or the next cell's openEdit (when the user clicked from
*  one lift directly into another cell). The lift owns dismissal,
*  full stop. */
var dismissOnOutside = modifier((_el, [onDismiss]) => {
	if (!onDismiss) return;
	const onPointer = (event) => {
		const target = event.target;
		if (!target) return;
		if (target.closest("[data-bx-lift]")) return;
		if (target.closest("[data-bx-lift-anchor]")) return;
		onDismiss();
	};
	const onKey = (event) => {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			onDismiss();
		}
	};
	window.addEventListener("pointerdown", onPointer, true);
	window.addEventListener("keydown", onKey, true);
	return () => {
		window.removeEventListener("pointerdown", onPointer, true);
		window.removeEventListener("keydown", onKey, true);
	};
});
var allocateLiftLayer = modifier((element, [tier, fixedZIndex]) => {
	const z = fixedZIndex ?? SURFACE_LAYERS.allocate(tier);
	element.style.setProperty("--bx-lift-z", String(z));
	element.dataset["surfaceLayerTier"] = tier;
	element.dataset["surfaceLayerZ"] = String(z);
	return () => {
		if (fixedZIndex === void 0) SURFACE_LAYERS.release(z);
		element.style.removeProperty("--bx-lift-z");
		delete element.dataset["surfaceLayerTier"];
		delete element.dataset["surfaceLayerZ"];
	};
});
var liftSurfaceRoot = modifier((element, _positional, named) => {
	const anchor = named.anchor ? element.ownerDocument.querySelector(named.anchor) : null;
	const ladder = named.ladder ?? (anchor ? ladderForSurfaceElement(anchor) : void 0);
	const runtime = named.runtime ?? (anchor ? surfaceRuntimeForElement(anchor) : void 0);
	const liftManager = named.liftManager ?? (anchor ? liftManagerForSurfaceElement(anchor) : void 0);
	const modeRoot = anchor?.closest("[data-surface-mode]");
	const inspectRoot = anchor?.closest("[data-surface-inspect]");
	const priorMode = element.getAttribute("data-surface-mode");
	const priorInspect = element.getAttribute("data-surface-inspect");
	const syncModeAndInspect = () => {
		const mode = named.mode ?? modeRoot?.dataset["surfaceMode"];
		const inspectAttr = named.inspect ?? inspectRoot?.getAttribute("data-surface-inspect");
		const inspect = typeof inspectAttr === "boolean" ? inspectAttr : inspectAttr === "true" || inspectAttr === "";
		element.setAttribute("data-surface-mode", mode ?? "use");
		element.setAttribute("data-surface-inspect", String(inspect));
	};
	syncModeAndInspect();
	element.setAttribute("data-surface-portaled-root", "lift");
	const unregisterRoot = ladder ? registerSurfaceDomRoot(element, ladder, runtime) : void 0;
	const unregisterLiftRoot = liftManager ? registerSurfaceLiftDomRoot(element, liftManager) : void 0;
	const modeObserver = new MutationObserver(syncModeAndInspect);
	if (modeRoot) modeObserver.observe(modeRoot, {
		attributes: true,
		attributeFilter: ["data-surface-mode"]
	});
	if (inspectRoot && inspectRoot !== modeRoot) modeObserver.observe(inspectRoot, {
		attributes: true,
		attributeFilter: ["data-surface-inspect"]
	});
	return () => {
		modeObserver.disconnect();
		unregisterLiftRoot?.();
		unregisterRoot?.();
		element.removeAttribute("data-surface-portaled-root");
		if (priorMode === null) element.removeAttribute("data-surface-mode");
		else element.setAttribute("data-surface-mode", priorMode);
		if (priorInspect === null) element.removeAttribute("data-surface-inspect");
		else element.setAttribute("data-surface-inspect", priorInspect);
	};
});
/** Shadow-anchor modifier — overlays the lift on the anchor's bbox.
*  Sets top / left / min-width from anchor's getBoundingClientRect.
*  Clamps to the viewport: if the lift's natural width would extend
*  past the right edge, shifts left to keep the right edge inside. */
var shadowAnchor = modifier((element, [selector]) => {
	const anchorEl = () => document.querySelector(selector);
	const update = () => {
		const a = anchorEl();
		if (!a) return;
		const r = a.getBoundingClientRect();
		element.style.position = "absolute";
		element.style.top = `${window.scrollY + r.top}px`;
		element.style.left = `${window.scrollX + r.left}px`;
		element.style.minWidth = `${Math.round(r.width)}px`;
		requestAnimationFrame(() => {
			const lr = element.getBoundingClientRect();
			const overflowRight = lr.right - window.innerWidth + 8;
			if (overflowRight > 0) {
				const newLeft = window.scrollX + r.left - overflowRight;
				element.style.left = `${Math.max(window.scrollX + 8, newLeft)}px`;
			}
			const overflowBottom = lr.bottom - window.innerHeight + 8;
			if (overflowBottom > 0) {
				const newTop = window.scrollY + r.top - overflowBottom;
				element.style.top = `${Math.max(window.scrollY + 8, newTop)}px`;
			}
		});
	};
	update();
	const ro = new ResizeObserver(update);
	const a = anchorEl();
	if (a) ro.observe(a);
	window.addEventListener("scroll", update, true);
	window.addEventListener("resize", update);
	return () => {
		ro.disconnect();
		window.removeEventListener("scroll", update, true);
		window.removeEventListener("resize", update);
	};
});
var anchoredLift = modifier((floatingElement, [selector], { placement = "bottom-start", offsetOptions = 0, strategy = "fixed" } = {}) => {
	let frame = 0;
	let destroyed = false;
	let lastTop = "";
	let lastLeft = "";
	let lastVisibility = "";
	const referenceElement = () => document.querySelector(selector);
	Object.assign(floatingElement.style, {
		position: strategy,
		top: "0px",
		left: "0px",
		margin: "0"
	});
	const apply = (top, left, visibility) => {
		if (top === lastTop && left === lastLeft && visibility === lastVisibility) return;
		lastTop = top;
		lastLeft = left;
		lastVisibility = visibility;
		Object.assign(floatingElement.style, {
			top,
			left,
			margin: "0",
			visibility
		});
	};
	const update = async () => {
		frame = 0;
		const reference = referenceElement();
		if (!reference) {
			apply(lastTop || "0px", lastLeft || "0px", "hidden");
			return;
		}
		const { middlewareData, x, y } = await computePosition(reference, floatingElement, {
			middleware: [
				offset(offsetOptions),
				flip(),
				shift({ padding: 8 }),
				hide({ strategy: "referenceHidden" })
			],
			placement,
			strategy
		});
		if (destroyed) return;
		apply(`${Math.round(y)}px`, `${Math.round(x)}px`, middlewareData.hide?.referenceHidden ? "hidden" : "visible");
	};
	const schedule = () => {
		if (frame !== 0) return;
		frame = requestAnimationFrame(() => {
			update();
		});
	};
	schedule();
	const reference = referenceElement();
	const cleanup = reference ? autoUpdate(reference, floatingElement, schedule, {
		ancestorResize: true,
		ancestorScroll: true,
		elementResize: true,
		layoutShift: false,
		animationFrame: false
	}) : void 0;
	return () => {
		destroyed = true;
		cancelAnimationFrame(frame);
		cleanup?.();
	};
});
/** Focus-management modifier. Auto-focuses first focusable in body
*  on mount; restores DOM focus to the closest focusable ancestor
*  of the anchor on unmount. */
var focusedLiftTokens = /* @__PURE__ */ new Set();
function liftFocusableSelector() {
	return [
		"button:not([disabled]):not([tabindex=\"-1\"])",
		"input:not([type=\"hidden\"]):not([disabled]):not([tabindex=\"-1\"])",
		"select:not([disabled]):not([tabindex=\"-1\"])",
		"textarea:not([disabled]):not([tabindex=\"-1\"])",
		"[contenteditable=\"\"]:not([tabindex=\"-1\"])",
		"[contenteditable=\"true\"]:not([tabindex=\"-1\"])",
		"[tabindex]:not([tabindex=\"-1\"])"
	].join(",");
}
function liftEditorSelector() {
	return [
		"input:not([type=\"hidden\"]):not([disabled]):not([tabindex=\"-1\"])",
		"textarea:not([disabled]):not([tabindex=\"-1\"])",
		"select:not([disabled]):not([tabindex=\"-1\"])",
		"[contenteditable=\"\"]:not([tabindex=\"-1\"])",
		"[contenteditable=\"true\"]:not([tabindex=\"-1\"])"
	].join(",");
}
function visibleFocusables(element) {
	return Array.from(element.querySelectorAll(liftFocusableSelector())).filter((candidate) => {
		if (!candidate.isConnected) return false;
		if (candidate.closest("[inert]")) return false;
		return candidate.getClientRects().length > 0 || candidate === document.activeElement;
	});
}
function firstLiftFocusTarget(element) {
	const body = element.querySelector(".bx-lift__body") ?? element;
	const keyboardModel = element.getAttribute("data-bx-lift-keyboard-model");
	if (keyboardModel === "pick") {
		const listbox = body.querySelector("[role=\"listbox\"]:not([tabindex=\"-1\"])");
		if (listbox) return listbox;
	}
	const autofocus = body.querySelector("[autofocus]");
	if (autofocus) return autofocus;
	if (keyboardModel === "edit-text" || keyboardModel === "edit-number" || keyboardModel === "compose") {
		const editor = body.querySelector(liftEditorSelector());
		if (editor) return editor;
	}
	return body.querySelector(liftFocusableSelector());
}
function focusLiftTarget(target) {
	target.focus({ preventScroll: true });
	if (target instanceof HTMLInputElement) {
		if (target.type === "text" || target.type === "number" || target.type === "search" || target.type === "url" || target.type === "tel" || target.type === "email" || target.type === "password") target.select();
	} else if (target instanceof HTMLTextAreaElement) target.select();
}
function isPlainTextKey(event) {
	return event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
}
function isPickerNavigationKey(event) {
	return event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End" || event.key === "Enter" || event.key === "Tab" || event.key === " " || event.key === "Spacebar" || isPlainTextKey(event);
}
function isEditingKey(event) {
	if (event.metaKey || event.ctrlKey || event.altKey) return false;
	return event.key === "Enter" || event.key === "Tab" || event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End" || event.key === "PageUp" || event.key === "PageDown" || event.key === "Backspace" || event.key === "Delete" || isPlainTextKey(event);
}
function liftKeyboardModelOwnsEvent(element, event) {
	const keyboardModel = element.getAttribute("data-bx-lift-keyboard-model");
	if (keyboardModel === "pick") return isPickerNavigationKey(event);
	if (keyboardModel === "edit-text" || keyboardModel === "edit-number" || keyboardModel === "compose") return isEditingKey(event);
	return false;
}
function topmostKeyboardLift() {
	return Array.from(document.querySelectorAll("[data-bx-lift][data-bx-lift-keyboard-lock=\"true\"]")).sort((a, b) => {
		const za = Number(a.dataset["surfaceLayerZ"] ?? 0);
		return Number(b.dataset["surfaceLayerZ"] ?? 0) - za;
	})[0] ?? null;
}
function cloneKeyboardEvent(event) {
	const next = new KeyboardEvent(event.type, {
		key: event.key,
		code: event.code,
		location: event.location,
		altKey: event.altKey,
		ctrlKey: event.ctrlKey,
		metaKey: event.metaKey,
		shiftKey: event.shiftKey,
		repeat: event.repeat,
		isComposing: event.isComposing,
		bubbles: true,
		cancelable: true
	});
	next.__boxelLiftKeyboardRerouted = true;
	return next;
}
var liftFocusModifier = modifier((element, [focusToken], { enabled = true } = {}) => {
	if (!enabled) return;
	const initial = document.activeElement;
	const previouslyFocused = initial && initial !== document.body ? initial : null;
	const token = focusToken === void 0 ? void 0 : String(focusToken);
	let frame = 0;
	let attempts = 0;
	const focusWhenReady = () => {
		if (token && focusedLiftTokens.has(token)) return;
		const target = firstLiftFocusTarget(element);
		if (!target) {
			if (attempts++ < 4) frame = requestAnimationFrame(focusWhenReady);
			return;
		}
		focusLiftTarget(target);
		if (token) focusedLiftTokens.add(token);
	};
	frame = requestAnimationFrame(focusWhenReady);
	const anchorSelector = element.getAttribute("data-bx-lift-anchor-selector");
	return () => {
		cancelAnimationFrame(frame);
		const active = document.activeElement;
		if (active?.closest("[data-bx-lift]")) return;
		if (active !== null && active !== document.body && !element.contains(active)) return;
		const isFocusable = (el) => {
			if (el.hasAttribute("disabled")) return false;
			const tag = el.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || tag === "A") return true;
			if (el.hasAttribute("contenteditable")) return true;
			const ti = el.getAttribute("tabindex");
			if (ti !== null && ti !== "-1") return true;
			return false;
		};
		const findFocusable = (start) => {
			let cur = start;
			while (cur && cur !== document.body) {
				if (isFocusable(cur)) return cur;
				cur = cur.parentElement;
			}
			return start;
		};
		let restoreTo = null;
		if (previouslyFocused && document.contains(previouslyFocused)) restoreTo = isFocusable(previouslyFocused) ? previouslyFocused : findFocusable(previouslyFocused);
		if (!restoreTo && anchorSelector) restoreTo = findFocusable(document.querySelector(anchorSelector));
		if (!restoreTo) return;
		restoreTo.focus();
		setTimeout(() => {
			if (restoreTo && document.contains(restoreTo)) restoreTo.focus();
		}, 0);
	};
});
/** Delegates stale-focus keyboard events into the active lift body.
*
*  This is the engine-level version of the old grid-demo pattern:
*  while an edit/tools lift is open, Arrow/Enter/Space/type-ahead
*  belong to the lifted control, even if the browser still reports
*  DOM focus on the source cell or parent grid. The lift focuses its
*  negotiated target (`keyboardModel="pick"` prefers listbox;
*  text/number/compose prefer the editor) and re-dispatches a cloned
*  key event there. Host grids should see neither the stale event nor
*  a parent navigation command.
*/
var delegateLiftKeyboardModifier = modifier((element, _positional, { enabled = true } = {}) => {
	if (!enabled) return;
	const onKeydown = (event) => {
		if (event.__boxelLiftKeyboardRerouted) return;
		if (event.defaultPrevented) return;
		if (event.key === "Escape") return;
		if (topmostKeyboardLift() !== element) return;
		const target = event.target instanceof Element ? event.target : null;
		const active = document.activeElement instanceof Element ? document.activeElement : null;
		if (target && element.contains(target)) return;
		if (active && element.contains(active)) return;
		if (!liftKeyboardModelOwnsEvent(element, event)) return;
		const delegateTarget = firstLiftFocusTarget(element);
		if (!delegateTarget) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		focusLiftTarget(delegateTarget);
		delegateTarget.dispatchEvent(cloneKeyboardEvent(event));
	};
	window.addEventListener("keydown", onKeydown, true);
	return () => window.removeEventListener("keydown", onKeydown, true);
});
/** Keeps edit/plane lifts in control of DOM focus while they are open.
*
*  Surface selection remains on the source coordinate; the lift owns
*  the active editor. This mirrors grid/canvas lifted editing: Tab
*  cycles inside the raised editor, and any programmatic focus steal
*  back to the source is corrected on the next focusin/frame. */
var trapLiftFocusModifier = modifier((element, _positional, { enabled = true } = {}) => {
	if (!enabled) return;
	let lastFocused = null;
	let allowOutsideFocusUntil = 0;
	const focusFallback = () => {
		requestAnimationFrame(() => {
			if (!element.isConnected) return;
			if (document.activeElement instanceof Element && element.contains(document.activeElement)) return;
			((lastFocused?.isConnected && element.contains(lastFocused) ? lastFocused : null) ?? firstLiftFocusTarget(element))?.focus({ preventScroll: true });
		});
	};
	const onKeydown = (event) => {
		if (event.key !== "Tab") return;
		const focusables = visibleFocusables(element);
		if (focusables.length === 0) return;
		event.preventDefault();
		event.stopPropagation();
		const active = document.activeElement;
		const currentIndex = active ? focusables.indexOf(active) : -1;
		const next = focusables[currentIndex === -1 ? 0 : event.shiftKey ? (currentIndex - 1 + focusables.length) % focusables.length : (currentIndex + 1) % focusables.length];
		if (!next) return;
		lastFocused = next;
		next.focus({ preventScroll: true });
	};
	const onFocusin = (event) => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		if (element.contains(target)) {
			lastFocused = target;
			return;
		}
		if (Date.now() < allowOutsideFocusUntil) return;
		focusFallback();
	};
	const onPointerdown = (event) => {
		const target = event.target;
		if (target instanceof Element && element.contains(target)) return;
		allowOutsideFocusUntil = Date.now() + 250;
	};
	element.addEventListener("keydown", onKeydown, true);
	window.addEventListener("focusin", onFocusin, true);
	window.addEventListener("pointerdown", onPointerdown, true);
	return () => {
		element.removeEventListener("keydown", onKeydown, true);
		window.removeEventListener("focusin", onFocusin, true);
		window.removeEventListener("pointerdown", onPointerdown, true);
	};
});
var nextLiftInstanceId = 0;
var cleanupClosedLiftModifier = modifier((_element, [open, instanceId]) => {
	let frame = 0;
	if (!open) frame = requestAnimationFrame(() => {
		for (const stale of document.querySelectorAll(`[data-bx-lift-instance="${instanceId}"]`)) stale.remove();
	});
	return () => {
		cancelAnimationFrame(frame);
	};
});
var Lift = (_dec$4 = consume(SurfaceScopeContextName), _dec2$1 = consume(LadderContextName), _dec3$1 = consume(SurfaceRuntimeContextName), _dec4$1 = consume(LiftContextName), _dec5$1 = consume(ModeContextName), _dec6$1 = consume(InspectContextName), _class$c = (_Lift = class Lift extends Component {
	constructor(...args) {
		super(...args);
		_defineProperty(this, "instanceId", `bx-lift-${++nextLiftInstanceId}`);
		_initializerDefineProperty$1(this, "inheritedScopeRelay", _descriptor$8, this);
		_initializerDefineProperty$1(this, "inheritedLadder", _descriptor2$6, this);
		_initializerDefineProperty$1(this, "inheritedRuntime", _descriptor3$1, this);
		_initializerDefineProperty$1(this, "inheritedLiftManager", _descriptor4$1, this);
		_initializerDefineProperty$1(this, "inheritedMode", _descriptor5$1, this);
		_initializerDefineProperty$1(this, "inheritedInspect", _descriptor6$1, this);
		_defineProperty(this, "localScopeRelay", void 0);
		/** Default action when the user clicks the corner glyph. With
		*  exactly one escalation target, fire that. Otherwise rotate
		*  through targets. */
		_defineProperty(this, "fireEscalateNext", () => {
			const targets = this.escalationTargets;
			const first = targets[0];
			if (targets.length === 0) return;
			if (targets.length === 1 && first) {
				this.args.onEscalate?.(first);
				return;
			}
			if (first) this.args.onEscalate?.(first);
		});
		/** Scrim click — fires onDismiss if provided. Bound here so the
		*  template can wire it without `(fn ...)` plumbing. */
		_defineProperty(this, "handleScrimClick", () => {
			this.args.onDismiss?.();
		});
		_defineProperty(this, "anchoredLift", anchoredLift);
		_defineProperty(this, "shadowAnchor", shadowAnchor);
		_defineProperty(this, "liftFocus", liftFocusModifier);
		_defineProperty(this, "trapLiftFocus", trapLiftFocusModifier);
		_defineProperty(this, "delegateLiftKeyboard", delegateLiftKeyboardModifier);
		_defineProperty(this, "dismissOnOutside", dismissOnOutside);
		_defineProperty(this, "allocateLiftLayer", allocateLiftLayer);
		_defineProperty(this, "liftSurfaceRoot", liftSurfaceRoot);
		_defineProperty(this, "cleanupClosedLift", cleanupClosedLiftModifier);
	}
	get scopeRelay() {
		let relay = this.localScopeRelay;
		if (!relay || relay.parent !== this.inheritedScopeRelay) {
			relay = createSurfaceScopeRelay(this.inheritedScopeRelay);
			this.localScopeRelay = relay;
		}
		return relay;
	}
	get portalTarget() {
		if (typeof document === "undefined") throw new Error("<Lift> requires a browser document to portal into.");
		return document.body;
	}
	get effectivePlacement() {
		return this.args.placement ?? "bottom-start";
	}
	get placementMode() {
		return this.args.placementMode ?? "attached";
	}
	get size() {
		if (this.args.size) return this.args.size;
		if (this.args.kind === "edit") return "comfortable";
		if (this.args.kind === "tools") return "compact";
		return "compact";
	}
	get backdrop() {
		if (this.args.backdrop) return this.args.backdrop;
		if (this.args.kind === "edit") return "blur";
		if (this.args.kind === "tools") return "none";
		return "tint";
	}
	get elevation() {
		if (this.args.elevation) return this.args.elevation;
		if (this.placementMode === "plane") return "modal";
		if (this.args.kind === "edit") return "elevated";
		return "raised";
	}
	get keyboardModel() {
		return this.args.keyboardModel ?? "compose";
	}
	get isShadow() {
		return this.placementMode === "shadow";
	}
	get isPlane() {
		return this.placementMode === "plane";
	}
	get hasScrim() {
		return this.backdrop === "scrim";
	}
	/** Default autoFocus policy. */
	get shouldAutoFocus() {
		if (this.args.autoFocus !== void 0) return this.args.autoFocus;
		return this.args.kind !== "details";
	}
	/** Edit lifts are popover-shaped but modal-like for focus. */
	get shouldTrapFocus() {
		return this.args.kind === "edit" || this.placementMode === "plane";
	}
	get shouldDelegateKeyboard() {
		return this.args.kind === "edit" || this.args.kind === "tools" || this.placementMode === "plane";
	}
	get layerTier() {
		if (this.args.layerTier) return this.args.layerTier;
		if (this.placementMode === "plane" || this.elevation === "modal") return "modal";
		if (this.placementMode === "shadow") return "cell-lift";
		return "popover";
	}
	/** Inline style string for the lift root. Carries the optional
	*  `relativeScale` arg as a `transform: scale(...)` with origin
	*  pinned to the lift's top-left corner.
	*
	*  WHY NOT CSS `zoom`: the CSS `zoom` property scales ALL element
	*  dimensions — INCLUDING positional `top` / `left` written by the
	*  anchored positioning modifier. So a lift with `top: 200px` and
	*  `zoom: 0.8` actually paints at `top: 160px`, jumping it away
	*  from its anchor. That was the "position out of whack" bug.
	*
	*  WHY transform + top-left origin: the anchor modifier uses Floating UI's
	*  `computePosition` which already reads `getBoundingClientRect`
	*  (which RETURNS post-transform coords), so the scaled lift's
	*  apparent box is what the positioner sizes against. With
	*  `transform-origin: top left`, the visual top-left of the scaled
	*  box stays exactly at the `top: y; left: x;` point — for
	*  `bottom-start` placement that's the cell's bottom-left, which
	*  is what we want.
	*
	*  Plane placement gets NO scale (plane is a viewport modal, not
	*  an anchored surface; it always renders at viewport scale). */
	get rootStyle() {
		const z = this.args.relativeScale;
		if (z === void 0 || z === 1) return "";
		if (this.placementMode !== "attached") return "";
		return `transform: scale(${Math.max(.4, Math.min(2.5, z))}); transform-origin: top left;`;
	}
	/** Composite class for the lift root. Includes kind + placement
	*  + size + backdrop + elevation. CSS reads these as orthogonal
	*  modifiers (see styles below). */
	get liftClass() {
		return [
			"bx-lift",
			`bx-lift--${this.args.kind}`,
			`bx-lift--placement-${this.placementMode}`,
			`bx-lift--size-${this.size}`,
			`bx-lift--backdrop-${this.backdrop}`,
			`bx-lift--elevation-${this.elevation}`
		].join(" ");
	}
	/** Other kinds the user can escalate to (filtered to exclude
	*  the current one). When empty, no escalation chrome renders. */
	get escalationTargets() {
		return (this.args.canEscalateTo ?? []).filter((k) => k !== this.args.kind);
	}
	get hasEscalation() {
		return this.escalationTargets.length > 0 && this.args.onEscalate != null;
	}
	/** Glyph for the corner escalation button. When escalation has
	*  exactly one target, use that target's glyph. Otherwise (rare,
	*  but supported), use a generic kebab. */
	get escalationGlyph() {
		const targets = this.escalationTargets;
		const only = targets[0];
		if (targets.length === 1 && only) return this.kindGlyph(only);
		return "⋯";
	}
	/** Aria-label for the corner escalation button. */
	get escalationLabel() {
		const targets = this.escalationTargets;
		const only = targets[0];
		if (targets.length === 1 && only) return `Switch to ${this.kindLabel(only)}`;
		return "Switch lift mode";
	}
	kindLabel(kind) {
		switch (kind) {
			case "details": return "Details";
			case "preview": return "Preview";
			case "edit": return "Edit";
			case "tools": return "Tools";
		}
	}
	kindGlyph(kind) {
		switch (kind) {
			case "details": return "ⓘ";
			case "preview": return "⊡";
			case "edit": return "✎";
			case "tools": return "⋯";
		}
	}
}, setComponentTemplate(precompileTemplate("<span hidden aria-hidden=\"true\" {{this.cleanupClosedLift @open this.instanceId}}></span>\n{{#unless @open}}\n  <span hidden aria-hidden=\"true\" {{this.cleanupClosedLift false this.instanceId}}></span>\n{{/unless}}\n{{#if @open}}\n  {{!-- Scrim — full-viewport dim layer behind the lift, mounted\n        as a sibling so it doesn't share the lift's z-stack. Only\n        renders when backdrop === 'scrim' (plane modals).  --}}\n  {{#if this.hasScrim}}\n    {{#in-element this.portalTarget insertBefore=null}}\n    <div class=\"bx-lift-scrim\" data-bx-lift-instance={{this.instanceId}} {{on \"click\" this.handleScrimClick}} {{surfaceScopeRelay this.scopeRelay}} aria-hidden=\"true\"></div>\n    {{/in-element}}\n  {{/if}}\n\n  {{#if this.isShadow}}\n    {{#in-element this.portalTarget insertBefore=null}}\n    <div class={{this.liftClass}} data-bx-lift data-bx-lift-instance={{this.instanceId}} data-bx-lift-kind={{@kind}} data-bx-lift-placement=\"shadow\" data-bx-lift-anchor-selector={{@anchor}} data-bx-lift-keyboard-model={{this.keyboardModel}} data-bx-lift-keyboard-lock={{if this.shouldDelegateKeyboard \"true\" \"false\"}} data-bx-lift-focus-token={{@focusToken}} data-surface-preserve-focus style={{this.rootStyle}} {{this.allocateLiftLayer this.layerTier @zIndex}} {{this.liftSurfaceRoot anchor=@anchor ladder=this.inheritedLadder runtime=this.inheritedRuntime liftManager=this.inheritedLiftManager mode=this.inheritedMode inspect=this.inheritedInspect}} {{this.shadowAnchor @anchor}} {{this.dismissOnOutside @onDismiss}} {{this.liftFocus @focusToken enabled=this.shouldAutoFocus}} {{this.trapLiftFocus enabled=this.shouldTrapFocus}} {{this.delegateLiftKeyboard enabled=this.shouldDelegateKeyboard}} {{surfaceScopeRelay this.scopeRelay}} ...attributes>\n      {{#if this.hasEscalation}}\n        <button type=\"button\" class=\"bx-lift__escalate\" aria-label={{this.escalationLabel}} title={{this.escalationLabel}} {{on \"click\" this.fireEscalateNext}}>{{this.escalationGlyph}}</button>\n      {{/if}}\n      <div class=\"bx-lift__body\">\n        {{yield @kind}}\n      </div>\n    </div>\n    {{/in-element}}\n  {{else if this.isPlane}}\n    {{#in-element this.portalTarget insertBefore=null}}\n    <div class={{this.liftClass}} data-bx-lift data-bx-lift-instance={{this.instanceId}} data-bx-lift-kind={{@kind}} data-bx-lift-placement=\"plane\" data-bx-lift-anchor-selector={{@anchor}} data-bx-lift-keyboard-model={{this.keyboardModel}} data-bx-lift-keyboard-lock={{if this.shouldDelegateKeyboard \"true\" \"false\"}} data-bx-lift-focus-token={{@focusToken}} data-surface-preserve-focus style={{this.rootStyle}} {{this.allocateLiftLayer this.layerTier @zIndex}} {{this.liftSurfaceRoot anchor=@anchor ladder=this.inheritedLadder runtime=this.inheritedRuntime liftManager=this.inheritedLiftManager mode=this.inheritedMode inspect=this.inheritedInspect}} {{this.dismissOnOutside @onDismiss}} {{this.liftFocus @focusToken enabled=this.shouldAutoFocus}} {{this.trapLiftFocus enabled=this.shouldTrapFocus}} {{this.delegateLiftKeyboard enabled=this.shouldDelegateKeyboard}} {{surfaceScopeRelay this.scopeRelay}} ...attributes>\n      {{#if this.hasEscalation}}\n        <button type=\"button\" class=\"bx-lift__escalate\" aria-label={{this.escalationLabel}} title={{this.escalationLabel}} {{on \"click\" this.fireEscalateNext}}>{{this.escalationGlyph}}</button>\n      {{/if}}\n      <div class=\"bx-lift__body\">\n        {{yield @kind}}\n      </div>\n    </div>\n    {{/in-element}}\n  {{else}}\n    {{#in-element this.portalTarget insertBefore=null}}\n    <div class={{this.liftClass}} data-bx-lift data-bx-lift-instance={{this.instanceId}} data-bx-lift-kind={{@kind}} data-bx-lift-placement=\"attached\" data-bx-lift-anchor-selector={{@anchor}} data-bx-lift-keyboard-model={{this.keyboardModel}} data-bx-lift-keyboard-lock={{if this.shouldDelegateKeyboard \"true\" \"false\"}} data-bx-lift-focus-token={{@focusToken}} data-surface-preserve-focus style={{this.rootStyle}} {{this.allocateLiftLayer this.layerTier @zIndex}} {{this.liftSurfaceRoot anchor=@anchor ladder=this.inheritedLadder runtime=this.inheritedRuntime liftManager=this.inheritedLiftManager mode=this.inheritedMode inspect=this.inheritedInspect}} {{this.anchoredLift @anchor placement=this.effectivePlacement offsetOptions=8}} {{this.dismissOnOutside @onDismiss}} {{this.liftFocus @focusToken enabled=this.shouldAutoFocus}} {{this.trapLiftFocus enabled=this.shouldTrapFocus}} {{this.delegateLiftKeyboard enabled=this.shouldDelegateKeyboard}} {{surfaceScopeRelay this.scopeRelay}} ...attributes>\n      {{#if this.hasEscalation}}\n        <button type=\"button\" class=\"bx-lift__escalate\" aria-label={{this.escalationLabel}} title={{this.escalationLabel}} {{on \"click\" this.fireEscalateNext}}>{{this.escalationGlyph}}</button>\n      {{/if}}\n      <div class=\"bx-lift__body\">\n        {{yield @kind}}\n      </div>\n    </div>\n    {{/in-element}}\n  {{/if}}\n{{/if}}\n\n<style scoped>\n  /* ════════════════════════════════════════════════════════════\n   * Lift visual system — driven by 5 orthogonal class modifiers:\n   *   .bx-lift--{kind}        details | preview | edit | tools\n   *   .bx-lift--placement-{p} attached | shadow | plane\n   *   .bx-lift--size-{s}      compact | comfortable | spacious | auto\n   *   .bx-lift--backdrop-{b}  none | tint | blur | scrim\n   *   .bx-lift--elevation-{e} flat | raised | elevated | modal\n   *\n   * Each axis paints ONE thing, so the cartesian product is\n   * predictable. CSS custom properties let hosts re-skin\n   * without overriding rules.\n   * ════════════════════════════════════════════════════════════ */\n\n  .bx-lift {\n    position: absolute;\n    z-index: var(--bx-lift-z, 1000);\n    font:\n      13px/1.4 Inter, ui-sans-serif, system-ui, -apple-system,\n      Segoe UI, sans-serif;\n    color: var(--bx-lift-fg, #111827);\n    /* `overflow: hidden` clips children to the lift's\n     * border-radius. Without this, an inner scroll container\n     * (`.bx-lift__body { overflow: auto }`) paints over the\n     * rounded corners — visible as a square notch in the bottom\n     * corners of any picker / list. The corner-escalation glyph\n     * sits inside the radius (top: 6px right: 6px) so it isn't\n     * affected. Box-shadow is OUTSIDE the content box and stays\n     * unclipped (the elevation ring still paints around the\n     * rounded edge). */\n    overflow: hidden;\n    animation: bx-lift-in 100ms cubic-bezier(0.32, 0.72, 0.4, 1);\n  }\n  @keyframes bx-lift-in {\n    from { opacity: 0; transform: translateY(-2px) scale(0.985); }\n    to   { opacity: 1; transform: translateY(0)    scale(1); }\n  }\n\n  /* ─── SIZE — width / height tokens ─────────────────────────\n   * \"Comb\" pass: prior defaults were too generous, popovers felt\n   * ceremonious. New defaults hug the content. Each tier's\n   * MAX-width is the smallest box that fits its target use case\n   * cleanly; min-width is just below that so picker rows don't\n   * shrink under their content. Hosts override per-token via\n   * CSS custom properties.\n   *\n   *   compact     status pill picker, true/false picker (~6-8 word menus)\n   *   comfortable date picker grid, chips picker, slider editor\n   *   spacious    formula builder, color picker grid, year-12-grid\n   */\n  .bx-lift--size-compact {\n    min-width: var(--bx-lift-size-compact-min-w, 176px);\n    max-width: min(var(--bx-lift-size-compact-max-w, 240px), 92vw);\n    max-height: min(var(--bx-lift-size-compact-max-h, 280px), 75vh);\n  }\n  .bx-lift--size-comfortable {\n    min-width: var(--bx-lift-size-comfortable-min-w, 240px);\n    max-width: min(var(--bx-lift-size-comfortable-max-w, 320px), 92vw);\n    max-height: min(var(--bx-lift-size-comfortable-max-h, 360px), 75vh);\n  }\n  .bx-lift--size-spacious {\n    min-width: var(--bx-lift-size-spacious-min-w, 320px);\n    max-width: min(var(--bx-lift-size-spacious-max-w, 460px), 92vw);\n    max-height: min(var(--bx-lift-size-spacious-max-h, 500px), 80vh);\n  }\n  /* `auto` adds nothing — content drives. Used for shadow lifts\n   * where the anchor's width is the floor (set by shadowAnchor). */\n\n  /* ─── BACKDROP — visual separation ────────────────────────── */\n  .bx-lift--backdrop-none {\n    background: var(--bx-lift-bg, #fff);\n  }\n  .bx-lift--backdrop-tint {\n    background: rgba(255, 255, 255, 0.98);\n  }\n  .bx-lift--backdrop-blur {\n    background: var(--bx-lift-bg, #fff);\n    backdrop-filter: blur(6px);\n    -webkit-backdrop-filter: blur(6px);\n  }\n  .bx-lift--backdrop-scrim {\n    background: var(--bx-lift-bg, #fff);\n  }\n\n  /* Scrim — full-viewport dim layer mounted as a sibling.\n   * Click dismisses (host wires onDismiss). Z-index sits ONE\n   * BELOW the lift's z (so the lift renders on top). */\n  .bx-lift-scrim {\n    position: fixed;\n    inset: 0;\n    background: var(--bx-lift-scrim-bg, rgba(15, 23, 42, 0.4));\n    backdrop-filter: blur(2px);\n    z-index: calc(var(--bx-lift-z, 10000) - 1);\n    animation: bx-lift-scrim-in 140ms ease-out;\n  }\n  @keyframes bx-lift-scrim-in {\n    from { opacity: 0; }\n    to   { opacity: 1; }\n  }\n\n  /* ─── ELEVATION — shadow + ring ladder ─────────────────────\n   * Numbers from lift-panel mockup §5. Each tier ONE notch up:\n   *   radius      4 → 6 → 8 → 12\n   *   shadow      flat → raised → elevated → modal\n   *   accent ring none → none → 1px @ 32% → 1px @ 18%\n   * Ring SHRINKS in opacity as elevation grows — the deeper\n   * shadow takes over the \"lifted\" job. */\n  .bx-lift--elevation-flat {\n    box-shadow: var(--bx-lift-shadow-flat, 0 1px 2px rgba(0, 0, 0, 0.06));\n    border-radius: 4px;\n  }\n  .bx-lift--elevation-raised {\n    box-shadow: var(\n      --bx-lift-shadow-raised,\n      0 2px 6px -1px rgba(0, 0, 0, 0.08),\n      0 1px 2px rgba(0, 0, 0, 0.04)\n    );\n    border: 1px solid var(--bx-lift-border-soft, #e5e7eb);\n    border-radius: 6px;\n  }\n  .bx-lift--elevation-elevated {\n    box-shadow: var(\n      --bx-lift-shadow-elevated,\n      0 8px 16px -4px rgba(15, 23, 42, 0.10),\n      0 2px 4px -2px rgba(15, 23, 42, 0.06),\n      0 0 0 1px color-mix(in srgb, var(--bx-lift-accent, #4f46e5) 32%, transparent)\n    );\n    border-radius: 8px;\n  }\n  .bx-lift--elevation-modal {\n    --bx-lift-z: 10000;\n    box-shadow: var(\n      --bx-lift-shadow-modal,\n      0 32px 56px -16px rgba(15, 23, 42, 0.22),\n      0 12px 24px -8px rgba(15, 23, 42, 0.14),\n      0 0 0 1px color-mix(in srgb, var(--bx-lift-accent, #4f46e5) 18%, transparent)\n    );\n    border-radius: 12px;\n  }\n\n  /* ─── PLACEMENT — geometry tweaks ─────────────────────────── */\n  .bx-lift--placement-shadow {\n    /* Shadow lift OVERLAYS the source cell. Per mockup §3:\n     *   - tighter 4px radius (matches cell, \"the cell grew\")\n     *   - small downward shadow + accent ring (1.5px) only;\n     *     no large drop shadow extending below the row. */\n    border-radius: 4px;\n    box-shadow:\n      0 4px 8px -2px rgba(15, 23, 42, 0.10),\n      0 0 0 1.5px var(--bx-lift-accent, #4f46e5);\n  }\n  .bx-lift--placement-plane {\n    position: fixed;\n    top: 50%;\n    left: 50%;\n    transform: translate(-50%, -50%);\n    animation: bx-lift-plane-in 180ms cubic-bezier(0.32, 0.72, 0.4, 1);\n  }\n  @keyframes bx-lift-plane-in {\n    from { opacity: 0; transform: translate(-50%, -48%) scale(0.96); }\n    to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }\n  }\n\n  /* ─── KIND — content-color hints ──────────────────────────\n   * Tone-of-voice differentiation. Most chrome is now driven by\n   * elevation + size; per-kind overrides only differentiate\n   * what's left (tools is dark; details has muted body color). */\n  .bx-lift--details {\n    color: var(--bx-lift-fg-muted, #1f2937);\n    font-size: 12px;\n  }\n  .bx-lift--tools {\n    background: var(--bx-lift-tools-bg, #1f2937);\n    color: var(--bx-lift-tools-fg, #f9fafb);\n  }\n  .bx-lift--edit {\n    --bx-lift-edit-bg: #fef7d6;\n    --bx-lift-edit-border: #f5d75e;\n    background: var(--bx-lift-edit-bg);\n  }\n  .bx-lift--edit .bx-lift__body > [data-surface-lift-target='edit'] {\n    background: var(--bx-lift-edit-bg);\n  }\n  .bx-lift--edit .bx-lift__body > [data-surface-lift-target='edit'] > * {\n    background-color: var(--bx-lift-edit-bg);\n    box-shadow:\n      inset 0 0 0 1px color-mix(in srgb, var(--bx-lift-edit-border) 56%, transparent),\n      0 16px 42px rgba(120, 85, 0, 0.12);\n  }\n  .bx-lift--tools.bx-lift--elevation-raised {\n    border-color: rgba(255, 255, 255, 0.08);\n  }\n\n  /* ─── ESCALATION GLYPH — corner button ─────────────────────\n   * Compact one-glyph escalation in the top-right. Only renders\n   * when the contract has multiple lift kinds (the host's\n   * `canEscalateTo` includes kinds OTHER than current). For\n   * single-kind contracts, no chrome — the body is the lift. */\n  .bx-lift__escalate {\n    /* Per mockup §2 — small unobtrusive corner glyph. 18px,\n     * always visible at 0.55 opacity (the lift is open, the\n     * affordance should be discoverable without hovering),\n     * fills with soft accent on hover. */\n    position: absolute;\n    top: 6px;\n    right: 6px;\n    z-index: 2;\n    width: 18px;\n    height: 18px;\n    border: none;\n    border-radius: 4px;\n    background: transparent;\n    color: var(--bx-lift-fg-muted, #9ca3af);\n    font-size: 12px;\n    line-height: 1;\n    cursor: pointer;\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    transition: background 80ms, color 80ms, opacity 80ms;\n    opacity: 0.55;\n  }\n  .bx-lift__escalate:hover,\n  .bx-lift__escalate:focus-visible {\n    opacity: 1;\n    background: color-mix(in srgb, var(--bx-lift-accent, #4f46e5) 10%, transparent);\n    color: var(--bx-lift-accent, #4f46e5);\n  }\n  .bx-lift--tools .bx-lift__escalate {\n    color: rgba(255, 255, 255, 0.6);\n  }\n  .bx-lift--tools .bx-lift__escalate:hover {\n    background: rgba(255, 255, 255, 0.12);\n    color: #fff;\n  }\n\n  /* ─── BODY ──────────────────────────────────────────────────\n   *\n   * INTENTIONALLY NO PADDING. Each editor mounted inside the\n   * lift body owns its own 6px gutter (the \"picker convention\"):\n   *\n   *   .pick-many       padding: 6px\n   *   .pick-one        padding: 6px\n   *   .toggle-strict   padding: 6px\n   *   .actions-pane    padding: 6px\n   *   .textarea-pane   padding: 6px\n   *   .slider--editing padding: 6px\n   *   .number-pane     padding: 12px (variant)\n   *\n   * Why convention vs lift-pads-everything: the picker primitives\n   * (PickOne / PickMany) ship as standalone widgets and may be\n   * mounted in a Form, an inspector pane, or a custom shell.\n   * If the lift OWNED the padding, the picker would have no\n   * breathing room outside a lift. Convention keeps each editor\n   * self-contained.\n   *\n   * If you're authoring a new editor pane, add `padding: 6px` to\n   * the root and use `gap` for inner rhythm. That's it. */\n  .bx-lift__body {\n    display: block;\n    max-height: inherit;\n    overflow: auto;\n  }\n</style>", {
	strictMode: true,
	scope: () => ({
		on,
		surfaceScopeRelay
	})
}), _Lift), _Lift), _descriptor$8 = _applyDecoratedDescriptor$1(_class$c.prototype, "inheritedScopeRelay", [_dec$4], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor2$6 = _applyDecoratedDescriptor$1(_class$c.prototype, "inheritedLadder", [_dec2$1], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor3$1 = _applyDecoratedDescriptor$1(_class$c.prototype, "inheritedRuntime", [_dec3$1], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor4$1 = _applyDecoratedDescriptor$1(_class$c.prototype, "inheritedLiftManager", [_dec4$1], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor5$1 = _applyDecoratedDescriptor$1(_class$c.prototype, "inheritedMode", [_dec5$1], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor6$1 = _applyDecoratedDescriptor$1(_class$c.prototype, "inheritedInspect", [_dec6$1], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _class$c);
var FormFieldContextName = "boxel-surface:form-field";
var _dec$3, _dec2$2, _dec3, _dec4, _dec5, _dec6, _dec7, _dec8, _dec9, _dec0, _dec1, _dec10, _dec11, _dec12, _dec13, _dec14, _dec15, _dec16, _dec17, _dec18, _dec19, _class$b, _descriptor$7, _descriptor2$5, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _descriptor7, _descriptor8, _descriptor9, _descriptor0, _descriptor1, _descriptor10, _SurfaceComponent, _dec20, _dec21, _dec22, _dec23, _dec24, _dec25, _dec26, _dec27, _dec28, _dec29, _dec30, _dec31, _dec32, _dec33, _dec34, _class2, _descriptor11, _descriptor12, _descriptor13, _Environment, _dec35, _class3, _descriptor14, _descriptor15, _descriptor16, _Cell;
function defaultCoordinateSpaceSchema(surface) {
	switch (surface) {
		case "space": return "surface-network";
		case "layout": return "layout";
		case "canvas": return "canvas-plane";
		case "scene": return "scene-world";
		case "grid": return "range-grid";
		case "row": return "range-row";
		case "scroll": return "document-flow";
		case "flow": return "ordered-list";
		case "outline": return "outline-tree";
		case "connection": return "connection-path";
		case "frame": return "fitted-rect";
		case "pane": return "pane-slot";
		case "plane": return "plane-layer";
		case "cell": return "cell-value";
		case "run": return "text";
		case "unit": return "token";
	}
}
var counters = {};
function nextSurfaceId(surface) {
	counters[surface] = (counters[surface] ?? 0) + 1;
	return `${surface}:${counters[surface]}`;
}
function nextScopedSurfaceId(parentId, surface) {
	if (!parentId) return nextSurfaceId(surface);
	const key = `${parentId}/${surface}`;
	counters[key] = (counters[key] ?? 0) + 1;
	return `${parentId}/${surface}:${counters[key]}`;
}
function identityValue(identity) {
	if (typeof identity === "object") {
		if ("id" in identity) return identity.id;
		return identity["@id"];
	}
	return identity;
}
function coordinatePartAttribute(value) {
	if (value === void 0 || value === null) return;
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}
function encodeIdPart(part) {
	return encodeURIComponent(String(part));
}
function surfaceId(surface, identity, ...parts) {
	return [
		surface,
		encodeIdPart(identityValue(identity)),
		...parts.map(encodeIdPart)
	].join(":");
}
function surfaceFocusKey(identity, ...parts) {
	return [encodeIdPart(identityValue(identity)), ...parts.map(encodeIdPart)].join(":");
}
function surfaceIdFromPath(surface, path) {
	return [surface, ...path.map(encodeIdPart)].join(":");
}
function surfaceFocusKeyFromPath(path) {
	return path.map(encodeIdPart).join(":");
}
function normalizeSurfacePath(identity, parts) {
	return [identityValue(identity), ...parts];
}
function normalizeChange(change) {
	if (!change) return void 0;
	return change === true ? {} : change;
}
function modeForPosture(posture) {
	if (posture === void 0) return void 0;
	return posture === "compose" ? "change" : "use";
}
function inlineOptions(change) {
	if (!change?.inline) return void 0;
	return change.inline === true ? {} : change.inline;
}
function liftEdgesWithChange(base, change, useChangeLift) {
	if (!useChangeLift || !change || change.lift === false) return base;
	return {
		...base ?? {},
		edit: change.lift ?? true
	};
}
var SurfaceComponent = (_dec$3 = consume(LadderContextName), _dec2$2 = consume(SurfaceRuntimeContextName), _dec3 = consume(ParentIdContextName), _dec4 = consume(ParentContextName), _dec5 = consume(DemoContextName), _dec6 = consume(ModeContextName), _dec7 = consume(InspectContextName), _dec8 = consume(ChangeRouteContextName), _dec9 = consume(PathContextName), _dec0 = consume(CoordinateSpaceContextName), _dec1 = consume(LiftContextName), _dec10 = consume(SurfaceScopeContextName), _dec11 = provide(ParentIdContextName), _dec12 = provide(ParentContextName), _dec13 = provide(DemoContextName), _dec14 = provide(ModeContextName), _dec15 = provide(InspectContextName), _dec16 = provide(ChangeRouteContextName), _dec17 = provide(PathContextName), _dec18 = provide(CoordinateSpaceContextName), _dec19 = provide(SurfaceScopeContextName), _class$b = (_SurfaceComponent = class SurfaceComponent extends Component {
	constructor(...args) {
		super(...args);
		_defineProperty(this, "generatedId", void 0);
		_initializerDefineProperty$1(this, "inheritedLadder", _descriptor$7, this);
		_initializerDefineProperty$1(this, "inheritedSurfaceRuntime", _descriptor2$5, this);
		_initializerDefineProperty$1(this, "inheritedParentId", _descriptor3, this);
		_initializerDefineProperty$1(this, "inheritedParentSurface", _descriptor4, this);
		_initializerDefineProperty$1(this, "inheritedDemo", _descriptor5, this);
		_initializerDefineProperty$1(this, "inheritedMode", _descriptor6, this);
		_initializerDefineProperty$1(this, "inheritedInspect", _descriptor7, this);
		_initializerDefineProperty$1(this, "inheritedChangeRoute", _descriptor8, this);
		_initializerDefineProperty$1(this, "inheritedSurfacePath", _descriptor9, this);
		_initializerDefineProperty$1(this, "inheritedCoordinateSpace", _descriptor0, this);
		_initializerDefineProperty$1(this, "inheritedLiftManager", _descriptor1, this);
		_initializerDefineProperty$1(this, "inheritedScopeRelay", _descriptor10, this);
		_defineProperty(this, "localScopeRelay", void 0);
	}
	get scopeRelay() {
		let relay = this.localScopeRelay;
		if (!relay || relay.parent !== this.inheritedScopeRelay) {
			relay = createSurfaceScopeRelay(this.inheritedScopeRelay);
			this.localScopeRelay = relay;
		}
		return relay;
	}
	get spaceIdentity() {
		return this.args.space ?? this.args.identity;
	}
	get localCoordinate() {
		return this.args.coord ?? this.args.at;
	}
	get coordinateSchema() {
		return this.args.schema ?? this.args.coordinateSpace ?? (this.spaceIdentity !== void 0 ? defaultCoordinateSpaceSchema(this.surface) : void 0);
	}
	get id() {
		if (this.args.id) return this.args.id;
		if (this.usesAnonymousLeafGeneratedId) {
			this.generatedId ??= nextScopedSurfaceId(this.inheritedParentId, this.surface);
			return this.generatedId;
		}
		if (this.surfacePath !== void 0 && !this.usesContextScopedGeneratedId) return surfaceIdFromPath(this.surface, this.surfacePath);
		if (this.spaceIdentity !== void 0) return surfaceId(this.surface, this.spaceIdentity, ...this.keyParts);
		this.generatedId ??= this.usesContextScopedGeneratedId ? nextScopedSurfaceId(this.inheritedParentId, this.surface) : nextSurfaceId(this.surface);
		return this.generatedId;
	}
	get focusKey() {
		if (this.args.focusKey) return this.args.focusKey;
		if (this.surfacePath !== void 0) return surfaceFocusKeyFromPath(this.surfacePath);
		if (this.spaceIdentity !== void 0) return surfaceFocusKey(this.spaceIdentity, ...this.keyParts);
	}
	get pathAttribute() {
		return this.surfacePath !== void 0 ? surfaceFocusKeyFromPath(this.surfacePath) : void 0;
	}
	get coordinate() {
		if (this.args.coord !== void 0 && this.inheritedCoordinateSpace !== void 0) {
			let local = coordinatePartAttribute(this.args.coord);
			return local !== void 0 ? `${this.inheritedCoordinateSpace.id}[${this.inheritedCoordinateSpace.schema}]:${local}` : `${this.inheritedCoordinateSpace.id}[${this.inheritedCoordinateSpace.schema}]`;
		}
		if (this.coordinateSchema !== void 0) {
			let local = coordinatePartAttribute(this.localCoordinate);
			let spaceId = this.coordinateSpaceId;
			return local !== void 0 ? `${spaceId}[${this.coordinateSchema}]:${local}` : `${spaceId}[${this.coordinateSchema}]`;
		}
		if (this.localCoordinate !== void 0 && this.inheritedCoordinateSpace !== void 0) {
			let local = coordinatePartAttribute(this.localCoordinate);
			return local !== void 0 ? `${this.inheritedCoordinateSpace.id}[${this.inheritedCoordinateSpace.schema}]:${local}` : `${this.inheritedCoordinateSpace.id}[${this.inheritedCoordinateSpace.schema}]`;
		}
		return this.pathAttribute ?? this.args.focusKey;
	}
	get coordinateSpaceAttribute() {
		if (this.coordinateSchema !== void 0) return this.coordinateSchema;
		if (this.localCoordinate !== void 0) return this.inheritedCoordinateSpace?.schema;
	}
	get localCoordinateAttribute() {
		return coordinatePartAttribute(this.localCoordinate);
	}
	get directiveDepthAttribute() {
		return this.args.depth === void 0 ? void 0 : String(this.args.depth);
	}
	get expandableAttribute() {
		return this.args.expanded === void 0 ? void 0 : "true";
	}
	get expandedAttribute() {
		return this.args.expanded === void 0 ? void 0 : String(this.args.expanded);
	}
	get coordinateSpaceId() {
		if (this.coordinateSchema === void 0 && this.localCoordinate !== void 0 && this.inheritedCoordinateSpace !== void 0) return this.inheritedCoordinateSpace.id;
		return this.focusKey ?? this.id;
	}
	get providedCoordinateSpace() {
		if (this.coordinateSchema !== void 0) return {
			surface: this.surface,
			id: this.focusKey ?? this.id,
			schema: this.coordinateSchema
		};
		return this.inheritedCoordinateSpace;
	}
	get coordinateSource() {
		if (this.args.surfacePath !== void 0 || this.args.focusKey !== void 0 || this.args.id !== void 0 || this.args.space !== void 0 || this.args.schema !== void 0 || this.args.coord !== void 0 || this.args.coordinateSpace !== void 0 || this.args.at !== void 0) return "explicit";
		if (this.spaceIdentity !== void 0) return "identity";
		if (this.inheritedSurfacePath !== void 0) return "context";
		return "generated";
	}
	get usesGeneratedId() {
		return this.usesAnonymousLeafGeneratedId || this.usesContextScopedGeneratedId || this.args.id === void 0 && this.spaceIdentity === void 0 && this.surfacePath === void 0;
	}
	get usesAnonymousLeafGeneratedId() {
		return this.args.id === void 0 && (this.surface === "run" || this.surface === "unit");
	}
	get usesContextScopedGeneratedId() {
		return this.args.id === void 0 && this.args.surfacePath === void 0 && this.spaceIdentity === void 0 && this.keyParts.length === 0 && this.inheritedSurfacePath !== void 0;
	}
	get keyParts() {
		if (Array.isArray(this.args.key)) return this.args.key;
		if (this.args.key !== void 0) return [this.args.key];
		if (Array.isArray(this.args.identityPart)) return this.args.identityPart;
		if (this.args.identityPart !== void 0) return [this.args.identityPart];
		return [];
	}
	get surfacePath() {
		if (this.args.surfacePath !== void 0) return this.args.surfacePath;
		if (this.spaceIdentity !== void 0) return normalizeSurfacePath(this.spaceIdentity, this.keyParts);
		if (this.inheritedSurfacePath !== void 0) return [...this.inheritedSurfacePath, ...this.keyParts];
	}
	get ladder() {
		return this.inheritedLadder;
	}
	get runtime() {
		return this.inheritedSurfaceRuntime;
	}
	get runtimeGridCoordinate() {
		if (this.args.grid) return this.args.grid;
		if (this.args.gridRow === void 0 || this.args.gridCol === void 0) return;
		return {
			row: this.args.gridRow,
			col: this.args.gridCol
		};
	}
	get runtimePolicy() {
		const policy = { ...this.args.runtimePolicy ?? {} };
		if (this.args.preset !== void 0) policy.preset = this.args.preset;
		if (this.args.aspects !== void 0) policy.aspects = this.args.aspects;
		if (this.args.runtimeTraversal !== void 0) policy.traversal = this.args.runtimeTraversal;
		if (this.args.runtimeTraversalModel !== void 0) policy.traversalModel = this.args.runtimeTraversalModel;
		if (this.args.runtimeSelection !== void 0) policy.selection = this.args.runtimeSelection;
		if (this.args.runtimeKeyboard !== void 0) policy.keyboard = this.args.runtimeKeyboard;
		if (this.args.runtimeMovement !== void 0) policy.movement = this.args.runtimeMovement;
		if (this.args.runtimePointer !== void 0) policy.pointer = this.args.runtimePointer;
		if (this.args.runtimeEdit !== void 0) policy.edit = this.args.runtimeEdit;
		else if (this.changeUsesInline) policy.edit = "inline";
		else if (this.changeUsesLift) policy.edit = "lifted";
		if (this.args.accepts !== void 0) policy.accepts = this.args.accepts;
		if (this.args.payloadType !== void 0) policy.payloadType = this.args.payloadType;
		return Object.keys(policy).length > 0 ? policy : void 0;
	}
	get parentId() {
		return this.inheritedParentId;
	}
	get demo() {
		return this.args.demo ?? this.inheritedDemo ?? false;
	}
	get mode() {
		return this.args.mode ?? modeForPosture(this.args.posture) ?? this.inheritedMode ?? "use";
	}
	get explicitModeAttribute() {
		return this.args.mode ?? modeForPosture(this.args.posture);
	}
	get inspect() {
		return this.args.inspect ?? this.inheritedInspect ?? this.mode === "inspect";
	}
	get inspectAttribute() {
		return String(this.inspect);
	}
	get explicitInspectAttribute() {
		return this.args.inspect === void 0 ? void 0 : String(this.args.inspect);
	}
	get changeRoute() {
		return this.args.changeRoute ?? this.inheritedChangeRoute ?? "auto";
	}
	get tag() {
		return this.args.tag ?? "div";
	}
	get inline() {
		return this.args.inline ?? false;
	}
	get liftManager() {
		return this.inheritedLiftManager;
	}
	get activeLiftSourceId() {
		return this.liftManager?.activeSourceId;
	}
	get activeLiftTargetId() {
		return this.liftManager?.activeTargetId;
	}
	get activeLiftKind() {
		return this.liftManager?.kind;
	}
	get activeLiftFocusToken() {
		return this.liftManager?.focusToken;
	}
	get changePreference() {
		return normalizeChange(this.args.change);
	}
	get changeInlineOptions() {
		return inlineOptions(this.changePreference);
	}
	get changeUsesInline() {
		return this.changeInlineOptions !== void 0;
	}
	get changeUsesLift() {
		return this.changePreference !== void 0;
	}
	get liftEdges() {
		return liftEdgesWithChange(this.args.lift, this.changePreference, this.changeUsesLift);
	}
	get inlineEditEnabled() {
		return this.args.inlineEdit ?? this.changeUsesInline;
	}
	get inlineEditActivation() {
		return this.args.inlineEdit === void 0 && this.changeUsesInline ? "change-inline" : "always";
	}
	get inlineEditValue() {
		return this.changeInlineOptions?.value ?? this.args.editValue;
	}
	get inlineEditLabel() {
		return this.changeInlineOptions?.label ?? this.args.editLabel;
	}
	get inlineEditMultiline() {
		return this.changeInlineOptions?.multiline ?? this.args.editMultiline;
	}
	get inlineEditInput() {
		return this.changeInlineOptions?.onInput ?? this.args.onEditInput;
	}
	get providedParentId() {
		return this.id;
	}
	get providedParentSurface() {
		return this.surface;
	}
	get providedDemo() {
		return this.demo;
	}
	get providedMode() {
		return this.mode;
	}
	get providedInspect() {
		return this.inspect;
	}
	get providedChangeRoute() {
		return this.changeRoute;
	}
	get providedSurfacePath() {
		return this.surfacePath;
	}
	get providedCoordinateSpaceContext() {
		return this.providedCoordinateSpace;
	}
	get providedScopeRelay() {
		return this.scopeRelay;
	}
	get isArticle() {
		return this.tag === "article";
	}
	get isAside() {
		return this.tag === "aside";
	}
	get isNav() {
		return this.tag === "nav";
	}
	get isButton() {
		return this.tag === "button";
	}
	get isSection() {
		return this.tag === "section";
	}
}, setComponentTemplate(precompileTemplate("<ContextProvider @key={{ParentIdContextName}} @value={{this.id}}>\n  <ContextProvider @key={{ParentContextName}} @value={{this.surface}}>\n    <ContextProvider @key={{DemoContextName}} @value={{this.demo}}>\n      <ContextProvider @key={{ModeContextName}} @value={{this.mode}}>\n        <ContextProvider @key={{InspectContextName}} @value={{this.inspect}}>\n          <ContextProvider @key={{ChangeRouteContextName}} @value={{this.changeRoute}}>\n            <ContextProvider @key={{PathContextName}} @value={{this.surfacePath}}>\n              <ContextProvider @key={{CoordinateSpaceContextName}} @value={{this.providedCoordinateSpace}}>\n                <ContextProvider @key={{SurfaceScopeContextName}} @value={{this.scopeRelay}}>\n          {{#if this.isArticle}}\n            <article id={{this.id}} data-surface-component={{this.surface}} data-surface-role={{this.args.role}} data-surface-pattern={{this.args.pattern}} data-surface-scope={{this.args.scope}} data-surface-depth={{this.directiveDepthAttribute}} data-surface-expandable={{this.expandableAttribute}} data-surface-expanded={{this.expandedAttribute}} data-surface-mode={{this.explicitModeAttribute}} data-surface-posture={{this.args.posture}} data-surface-inspect={{this.explicitInspectAttribute}} data-surface-change-route={{this.args.changeRoute}} data-surface-target={{this.args.target}} data-surface-target-scope={{this.args.targetScope}} data-surface-coordinate-space={{this.coordinateSpaceAttribute}} data-surface-coordinate-space-id={{this.coordinateSpaceId}} data-surface-local-coordinate={{this.localCoordinateAttribute}} data-surface-focus-key={{this.focusKey}} data-surface-path={{this.pathAttribute}} data-surface-coordinate={{this.coordinate}} {{surfaceNode this.ladder runtime=this.runtime id=this.id surface=this.surface parentId=this.parentId mode=this.explicitModeAttribute target=this.args.target targetScope=this.args.targetScope focusKey=this.focusKey coordinate=this.coordinate coordinateSpace=this.coordinateSpaceAttribute localCoordinate=this.localCoordinateAttribute coordinateSource=this.coordinateSource keyParts=this.keyParts generatedId=this.usesGeneratedId policy=this.runtimePolicy grid=this.runtimeGridCoordinate expanded=this.args.expanded onSelect=this.args.onSelect onActivate=this.args.onActivate scrollOnSelect=this.args.scrollOnSelect scrollTarget=this.args.scrollTarget scrollAnchor=this.args.scrollAnchor hoverSignal=this.args.hoverSignal hoverAnchor=this.args.hoverAnchor onExpand=this.args.onExpand onCollapse=this.args.onCollapse lift=this.liftEdges liftData=this.args.liftData liftManager=this.liftManager liftActiveSourceId=this.activeLiftSourceId liftActiveTargetId=this.activeLiftTargetId liftActiveKind=this.activeLiftKind}} {{surfaceScopeRelay this.scopeRelay}} {{surfaceInlineEdit enabled=this.inlineEditEnabled activation=this.inlineEditActivation value=this.inlineEditValue label=this.inlineEditLabel multiline=this.inlineEditMultiline onInput=this.inlineEditInput}} ...attributes>\n              {{yield}}\n            </article>\n          {{else if this.isAside}}\n            <aside id={{this.id}} data-surface-component={{this.surface}} data-surface-role={{this.args.role}} data-surface-pattern={{this.args.pattern}} data-surface-scope={{this.args.scope}} data-surface-depth={{this.directiveDepthAttribute}} data-surface-expandable={{this.expandableAttribute}} data-surface-expanded={{this.expandedAttribute}} data-surface-mode={{this.explicitModeAttribute}} data-surface-posture={{this.args.posture}} data-surface-inspect={{this.explicitInspectAttribute}} data-surface-change-route={{this.args.changeRoute}} data-surface-target={{this.args.target}} data-surface-target-scope={{this.args.targetScope}} data-surface-coordinate-space={{this.coordinateSpaceAttribute}} data-surface-coordinate-space-id={{this.coordinateSpaceId}} data-surface-local-coordinate={{this.localCoordinateAttribute}} data-surface-focus-key={{this.focusKey}} data-surface-path={{this.pathAttribute}} data-surface-coordinate={{this.coordinate}} {{surfaceNode this.ladder runtime=this.runtime id=this.id surface=this.surface parentId=this.parentId mode=this.explicitModeAttribute target=this.args.target targetScope=this.args.targetScope focusKey=this.focusKey coordinate=this.coordinate coordinateSpace=this.coordinateSpaceAttribute localCoordinate=this.localCoordinateAttribute coordinateSource=this.coordinateSource keyParts=this.keyParts generatedId=this.usesGeneratedId policy=this.runtimePolicy grid=this.runtimeGridCoordinate expanded=this.args.expanded onSelect=this.args.onSelect onActivate=this.args.onActivate scrollOnSelect=this.args.scrollOnSelect scrollTarget=this.args.scrollTarget scrollAnchor=this.args.scrollAnchor hoverSignal=this.args.hoverSignal hoverAnchor=this.args.hoverAnchor onExpand=this.args.onExpand onCollapse=this.args.onCollapse lift=this.liftEdges liftData=this.args.liftData liftManager=this.liftManager liftActiveSourceId=this.activeLiftSourceId liftActiveTargetId=this.activeLiftTargetId liftActiveKind=this.activeLiftKind}} {{surfaceScopeRelay this.scopeRelay}} {{surfaceInlineEdit enabled=this.inlineEditEnabled activation=this.inlineEditActivation value=this.inlineEditValue label=this.inlineEditLabel multiline=this.inlineEditMultiline onInput=this.inlineEditInput}} ...attributes>\n              {{yield}}\n            </aside>\n          {{else if this.isNav}}\n            <nav id={{this.id}} data-surface-component={{this.surface}} data-surface-role={{this.args.role}} data-surface-pattern={{this.args.pattern}} data-surface-scope={{this.args.scope}} data-surface-depth={{this.directiveDepthAttribute}} data-surface-expandable={{this.expandableAttribute}} data-surface-expanded={{this.expandedAttribute}} data-surface-mode={{this.explicitModeAttribute}} data-surface-posture={{this.args.posture}} data-surface-inspect={{this.explicitInspectAttribute}} data-surface-change-route={{this.args.changeRoute}} data-surface-target={{this.args.target}} data-surface-target-scope={{this.args.targetScope}} data-surface-coordinate-space={{this.coordinateSpaceAttribute}} data-surface-coordinate-space-id={{this.coordinateSpaceId}} data-surface-local-coordinate={{this.localCoordinateAttribute}} data-surface-focus-key={{this.focusKey}} data-surface-path={{this.pathAttribute}} data-surface-coordinate={{this.coordinate}} {{surfaceNode this.ladder runtime=this.runtime id=this.id surface=this.surface parentId=this.parentId mode=this.explicitModeAttribute target=this.args.target targetScope=this.args.targetScope focusKey=this.focusKey coordinate=this.coordinate coordinateSpace=this.coordinateSpaceAttribute localCoordinate=this.localCoordinateAttribute coordinateSource=this.coordinateSource keyParts=this.keyParts generatedId=this.usesGeneratedId policy=this.runtimePolicy grid=this.runtimeGridCoordinate expanded=this.args.expanded onSelect=this.args.onSelect onActivate=this.args.onActivate scrollOnSelect=this.args.scrollOnSelect scrollTarget=this.args.scrollTarget scrollAnchor=this.args.scrollAnchor hoverSignal=this.args.hoverSignal hoverAnchor=this.args.hoverAnchor onExpand=this.args.onExpand onCollapse=this.args.onCollapse lift=this.liftEdges liftData=this.args.liftData liftManager=this.liftManager liftActiveSourceId=this.activeLiftSourceId liftActiveTargetId=this.activeLiftTargetId liftActiveKind=this.activeLiftKind}} {{surfaceScopeRelay this.scopeRelay}} {{surfaceInlineEdit enabled=this.inlineEditEnabled activation=this.inlineEditActivation value=this.inlineEditValue label=this.inlineEditLabel multiline=this.inlineEditMultiline onInput=this.inlineEditInput}} ...attributes>\n              {{yield}}\n            </nav>\n          {{else if this.isButton}}\n            <button id={{this.id}} data-surface-component={{this.surface}} data-surface-role={{this.args.role}} data-surface-pattern={{this.args.pattern}} data-surface-scope={{this.args.scope}} data-surface-depth={{this.directiveDepthAttribute}} data-surface-expandable={{this.expandableAttribute}} data-surface-expanded={{this.expandedAttribute}} data-surface-mode={{this.explicitModeAttribute}} data-surface-posture={{this.args.posture}} data-surface-inspect={{this.explicitInspectAttribute}} data-surface-change-route={{this.args.changeRoute}} data-surface-target={{this.args.target}} data-surface-target-scope={{this.args.targetScope}} data-surface-coordinate-space={{this.coordinateSpaceAttribute}} data-surface-coordinate-space-id={{this.coordinateSpaceId}} data-surface-local-coordinate={{this.localCoordinateAttribute}} data-surface-focus-key={{this.focusKey}} data-surface-path={{this.pathAttribute}} data-surface-coordinate={{this.coordinate}} {{surfaceNode this.ladder runtime=this.runtime id=this.id surface=this.surface parentId=this.parentId mode=this.explicitModeAttribute target=this.args.target targetScope=this.args.targetScope focusKey=this.focusKey coordinate=this.coordinate coordinateSpace=this.coordinateSpaceAttribute localCoordinate=this.localCoordinateAttribute coordinateSource=this.coordinateSource keyParts=this.keyParts generatedId=this.usesGeneratedId policy=this.runtimePolicy grid=this.runtimeGridCoordinate expanded=this.args.expanded onSelect=this.args.onSelect onActivate=this.args.onActivate scrollOnSelect=this.args.scrollOnSelect scrollTarget=this.args.scrollTarget scrollAnchor=this.args.scrollAnchor hoverSignal=this.args.hoverSignal hoverAnchor=this.args.hoverAnchor onExpand=this.args.onExpand onCollapse=this.args.onCollapse lift=this.liftEdges liftData=this.args.liftData liftManager=this.liftManager liftActiveSourceId=this.activeLiftSourceId liftActiveTargetId=this.activeLiftTargetId liftActiveKind=this.activeLiftKind}} {{surfaceScopeRelay this.scopeRelay}} {{surfaceInlineEdit enabled=this.inlineEditEnabled activation=this.inlineEditActivation value=this.inlineEditValue label=this.inlineEditLabel multiline=this.inlineEditMultiline onInput=this.inlineEditInput}} ...attributes>\n              {{yield}}\n            </button>\n          {{else if this.isSection}}\n            <section id={{this.id}} data-surface-component={{this.surface}} data-surface-role={{this.args.role}} data-surface-pattern={{this.args.pattern}} data-surface-scope={{this.args.scope}} data-surface-depth={{this.directiveDepthAttribute}} data-surface-expandable={{this.expandableAttribute}} data-surface-expanded={{this.expandedAttribute}} data-surface-mode={{this.explicitModeAttribute}} data-surface-posture={{this.args.posture}} data-surface-inspect={{this.explicitInspectAttribute}} data-surface-change-route={{this.args.changeRoute}} data-surface-target={{this.args.target}} data-surface-target-scope={{this.args.targetScope}} data-surface-coordinate-space={{this.coordinateSpaceAttribute}} data-surface-coordinate-space-id={{this.coordinateSpaceId}} data-surface-local-coordinate={{this.localCoordinateAttribute}} data-surface-focus-key={{this.focusKey}} data-surface-path={{this.pathAttribute}} data-surface-coordinate={{this.coordinate}} {{surfaceNode this.ladder runtime=this.runtime id=this.id surface=this.surface parentId=this.parentId mode=this.explicitModeAttribute target=this.args.target targetScope=this.args.targetScope focusKey=this.focusKey coordinate=this.coordinate coordinateSpace=this.coordinateSpaceAttribute localCoordinate=this.localCoordinateAttribute coordinateSource=this.coordinateSource keyParts=this.keyParts generatedId=this.usesGeneratedId policy=this.runtimePolicy grid=this.runtimeGridCoordinate expanded=this.args.expanded onSelect=this.args.onSelect onActivate=this.args.onActivate scrollOnSelect=this.args.scrollOnSelect scrollTarget=this.args.scrollTarget scrollAnchor=this.args.scrollAnchor hoverSignal=this.args.hoverSignal hoverAnchor=this.args.hoverAnchor onExpand=this.args.onExpand onCollapse=this.args.onCollapse lift=this.liftEdges liftData=this.args.liftData liftManager=this.liftManager liftActiveSourceId=this.activeLiftSourceId liftActiveTargetId=this.activeLiftTargetId liftActiveKind=this.activeLiftKind}} {{surfaceScopeRelay this.scopeRelay}} {{surfaceInlineEdit enabled=this.inlineEditEnabled activation=this.inlineEditActivation value=this.inlineEditValue label=this.inlineEditLabel multiline=this.inlineEditMultiline onInput=this.inlineEditInput}} ...attributes>\n              {{yield}}\n            </section>\n          {{else}}\n            <div id={{this.id}} data-surface-component={{this.surface}} data-surface-role={{this.args.role}} data-surface-pattern={{this.args.pattern}} data-surface-scope={{this.args.scope}} data-surface-depth={{this.directiveDepthAttribute}} data-surface-expandable={{this.expandableAttribute}} data-surface-expanded={{this.expandedAttribute}} data-surface-mode={{this.explicitModeAttribute}} data-surface-posture={{this.args.posture}} data-surface-inspect={{this.explicitInspectAttribute}} data-surface-change-route={{this.args.changeRoute}} data-surface-target={{this.args.target}} data-surface-target-scope={{this.args.targetScope}} data-surface-coordinate-space={{this.coordinateSpaceAttribute}} data-surface-coordinate-space-id={{this.coordinateSpaceId}} data-surface-local-coordinate={{this.localCoordinateAttribute}} data-surface-focus-key={{this.focusKey}} data-surface-path={{this.pathAttribute}} data-surface-coordinate={{this.coordinate}} {{surfaceNode this.ladder runtime=this.runtime id=this.id surface=this.surface parentId=this.parentId mode=this.explicitModeAttribute target=this.args.target targetScope=this.args.targetScope focusKey=this.focusKey coordinate=this.coordinate coordinateSpace=this.coordinateSpaceAttribute localCoordinate=this.localCoordinateAttribute coordinateSource=this.coordinateSource keyParts=this.keyParts generatedId=this.usesGeneratedId policy=this.runtimePolicy grid=this.runtimeGridCoordinate expanded=this.args.expanded onSelect=this.args.onSelect onActivate=this.args.onActivate scrollOnSelect=this.args.scrollOnSelect scrollTarget=this.args.scrollTarget scrollAnchor=this.args.scrollAnchor hoverSignal=this.args.hoverSignal hoverAnchor=this.args.hoverAnchor onExpand=this.args.onExpand onCollapse=this.args.onCollapse lift=this.liftEdges liftData=this.args.liftData liftManager=this.liftManager liftActiveSourceId=this.activeLiftSourceId liftActiveTargetId=this.activeLiftTargetId liftActiveKind=this.activeLiftKind}} {{surfaceScopeRelay this.scopeRelay}} {{surfaceInlineEdit enabled=this.inlineEditEnabled activation=this.inlineEditActivation value=this.inlineEditValue label=this.inlineEditLabel multiline=this.inlineEditMultiline onInput=this.inlineEditInput}} ...attributes>\n              {{yield}}\n            </div>\n          {{/if}}\n                </ContextProvider>\n              </ContextProvider>\n            </ContextProvider>\n          </ContextProvider>\n        </ContextProvider>\n      </ContextProvider>\n    </ContextProvider>\n  </ContextProvider>\n</ContextProvider>", {
	strictMode: true,
	scope: () => ({
		ContextProvider,
		ParentIdContextName,
		ParentContextName,
		DemoContextName,
		ModeContextName,
		InspectContextName,
		ChangeRouteContextName,
		PathContextName,
		CoordinateSpaceContextName,
		SurfaceScopeContextName,
		surfaceNode,
		surfaceScopeRelay,
		surfaceInlineEdit
	})
}), _SurfaceComponent), _SurfaceComponent), _descriptor$7 = _applyDecoratedDescriptor$1(_class$b.prototype, "inheritedLadder", [_dec$3], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor2$5 = _applyDecoratedDescriptor$1(_class$b.prototype, "inheritedSurfaceRuntime", [_dec2$2], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor3 = _applyDecoratedDescriptor$1(_class$b.prototype, "inheritedParentId", [_dec3], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor4 = _applyDecoratedDescriptor$1(_class$b.prototype, "inheritedParentSurface", [_dec4], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor5 = _applyDecoratedDescriptor$1(_class$b.prototype, "inheritedDemo", [_dec5], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor6 = _applyDecoratedDescriptor$1(_class$b.prototype, "inheritedMode", [_dec6], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor7 = _applyDecoratedDescriptor$1(_class$b.prototype, "inheritedInspect", [_dec7], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor8 = _applyDecoratedDescriptor$1(_class$b.prototype, "inheritedChangeRoute", [_dec8], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor9 = _applyDecoratedDescriptor$1(_class$b.prototype, "inheritedSurfacePath", [_dec9], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor0 = _applyDecoratedDescriptor$1(_class$b.prototype, "inheritedCoordinateSpace", [_dec0], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor1 = _applyDecoratedDescriptor$1(_class$b.prototype, "inheritedLiftManager", [_dec1], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor10 = _applyDecoratedDescriptor$1(_class$b.prototype, "inheritedScopeRelay", [_dec10], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _applyDecoratedDescriptor$1(_class$b.prototype, "coordinateSchema", [cached], Object.getOwnPropertyDescriptor(_class$b.prototype, "coordinateSchema"), _class$b.prototype), _applyDecoratedDescriptor$1(_class$b.prototype, "id", [cached], Object.getOwnPropertyDescriptor(_class$b.prototype, "id"), _class$b.prototype), _applyDecoratedDescriptor$1(_class$b.prototype, "focusKey", [cached], Object.getOwnPropertyDescriptor(_class$b.prototype, "focusKey"), _class$b.prototype), _applyDecoratedDescriptor$1(_class$b.prototype, "coordinate", [cached], Object.getOwnPropertyDescriptor(_class$b.prototype, "coordinate"), _class$b.prototype), _applyDecoratedDescriptor$1(_class$b.prototype, "coordinateSpaceId", [cached], Object.getOwnPropertyDescriptor(_class$b.prototype, "coordinateSpaceId"), _class$b.prototype), _applyDecoratedDescriptor$1(_class$b.prototype, "runtimeGridCoordinate", [cached], Object.getOwnPropertyDescriptor(_class$b.prototype, "runtimeGridCoordinate"), _class$b.prototype), _applyDecoratedDescriptor$1(_class$b.prototype, "runtimePolicy", [cached], Object.getOwnPropertyDescriptor(_class$b.prototype, "runtimePolicy"), _class$b.prototype), _applyDecoratedDescriptor$1(_class$b.prototype, "providedParentId", [_dec11], Object.getOwnPropertyDescriptor(_class$b.prototype, "providedParentId"), _class$b.prototype), _applyDecoratedDescriptor$1(_class$b.prototype, "providedParentSurface", [_dec12], Object.getOwnPropertyDescriptor(_class$b.prototype, "providedParentSurface"), _class$b.prototype), _applyDecoratedDescriptor$1(_class$b.prototype, "providedDemo", [_dec13], Object.getOwnPropertyDescriptor(_class$b.prototype, "providedDemo"), _class$b.prototype), _applyDecoratedDescriptor$1(_class$b.prototype, "providedMode", [_dec14], Object.getOwnPropertyDescriptor(_class$b.prototype, "providedMode"), _class$b.prototype), _applyDecoratedDescriptor$1(_class$b.prototype, "providedInspect", [_dec15], Object.getOwnPropertyDescriptor(_class$b.prototype, "providedInspect"), _class$b.prototype), _applyDecoratedDescriptor$1(_class$b.prototype, "providedChangeRoute", [_dec16], Object.getOwnPropertyDescriptor(_class$b.prototype, "providedChangeRoute"), _class$b.prototype), _applyDecoratedDescriptor$1(_class$b.prototype, "providedSurfacePath", [_dec17], Object.getOwnPropertyDescriptor(_class$b.prototype, "providedSurfacePath"), _class$b.prototype), _applyDecoratedDescriptor$1(_class$b.prototype, "providedCoordinateSpaceContext", [_dec18], Object.getOwnPropertyDescriptor(_class$b.prototype, "providedCoordinateSpaceContext"), _class$b.prototype), _applyDecoratedDescriptor$1(_class$b.prototype, "providedScopeRelay", [_dec19], Object.getOwnPropertyDescriptor(_class$b.prototype, "providedScopeRelay"), _class$b.prototype), _class$b);
_dec20 = consume(PathContextName), _dec21 = consume(CoordinateSpaceContextName), _dec22 = consume(SurfaceScopeContextName), _dec23 = provide(LadderContextName), _dec24 = provide(SurfaceRuntimeContextName), _dec25 = provide(ParentIdContextName), _dec26 = provide(ParentContextName), _dec27 = provide(DemoContextName), _dec28 = provide(ModeContextName), _dec29 = provide(InspectContextName), _dec30 = provide(ChangeRouteContextName), _dec31 = provide(PathContextName), _dec32 = provide(CoordinateSpaceContextName), _dec33 = provide(LiftContextName), _dec34 = provide(SurfaceScopeContextName), _class2 = (_Environment = class Environment extends Component {
	constructor(owner, args) {
		super(owner, args);
		_defineProperty(this, "localLadder", createFocusLadder());
		_defineProperty(this, "localRuntime", createSurfaceRuntime());
		_defineProperty(this, "localLiftManager", createLiftManager());
		_defineProperty(this, "generatedId", void 0);
		_initializerDefineProperty$1(this, "inheritedSurfacePath", _descriptor11, this);
		_initializerDefineProperty$1(this, "inheritedCoordinateSpace", _descriptor12, this);
		_initializerDefineProperty$1(this, "inheritedScopeRelay", _descriptor13, this);
		_defineProperty(this, "localScopeRelay", void 0);
		const endInitialRuntimeBatch = this.localRuntime.beginBatch();
		queueMicrotask(endInitialRuntimeBatch);
	}
	get surface() {
		return "space";
	}
	get scopeRelay() {
		let relay = this.localScopeRelay;
		if (!relay || relay.parent !== this.inheritedScopeRelay) {
			relay = createSurfaceScopeRelay(this.inheritedScopeRelay);
			this.localScopeRelay = relay;
		}
		return relay;
	}
	get spaceIdentity() {
		return this.args.space ?? this.args.identity;
	}
	get localCoordinate() {
		return this.args.coord ?? this.args.at;
	}
	get coordinateSchema() {
		return this.args.schema ?? this.args.coordinateSpace ?? (this.spaceIdentity !== void 0 ? defaultCoordinateSpaceSchema(this.surface) : void 0);
	}
	get id() {
		if (this.args.id) return this.args.id;
		if (this.surfacePath !== void 0) return surfaceIdFromPath("environment", this.surfacePath);
		if (this.spaceIdentity !== void 0) return surfaceId("environment", this.spaceIdentity, ...this.keyParts);
		this.generatedId ??= nextSurfaceId("environment");
		return this.generatedId;
	}
	get focusKey() {
		if (this.args.focusKey) return this.args.focusKey;
		if (this.surfacePath !== void 0) return surfaceFocusKeyFromPath(this.surfacePath);
		if (this.spaceIdentity !== void 0) return surfaceFocusKey(this.spaceIdentity, ...this.keyParts);
	}
	get pathAttribute() {
		return this.surfacePath !== void 0 ? surfaceFocusKeyFromPath(this.surfacePath) : void 0;
	}
	get coordinate() {
		if (this.args.coord !== void 0 && this.inheritedCoordinateSpace !== void 0) {
			let local = coordinatePartAttribute(this.args.coord);
			return local !== void 0 ? `${this.inheritedCoordinateSpace.id}[${this.inheritedCoordinateSpace.schema}]:${local}` : `${this.inheritedCoordinateSpace.id}[${this.inheritedCoordinateSpace.schema}]`;
		}
		if (this.coordinateSchema !== void 0) {
			let local = coordinatePartAttribute(this.localCoordinate);
			let spaceId = this.coordinateSpaceId;
			return local !== void 0 ? `${spaceId}[${this.coordinateSchema}]:${local}` : `${spaceId}[${this.coordinateSchema}]`;
		}
		if (this.localCoordinate !== void 0 && this.inheritedCoordinateSpace !== void 0) {
			let local = coordinatePartAttribute(this.localCoordinate);
			return local !== void 0 ? `${this.inheritedCoordinateSpace.id}[${this.inheritedCoordinateSpace.schema}]:${local}` : `${this.inheritedCoordinateSpace.id}[${this.inheritedCoordinateSpace.schema}]`;
		}
		return this.pathAttribute ?? this.args.focusKey;
	}
	get coordinateSpaceAttribute() {
		if (this.coordinateSchema !== void 0) return this.coordinateSchema;
		if (this.localCoordinate !== void 0) return this.inheritedCoordinateSpace?.schema;
	}
	get localCoordinateAttribute() {
		return coordinatePartAttribute(this.localCoordinate);
	}
	get directiveDepthAttribute() {
		return this.args.depth === void 0 ? void 0 : String(this.args.depth);
	}
	get coordinateSpaceId() {
		if (this.coordinateSchema === void 0 && this.localCoordinate !== void 0 && this.inheritedCoordinateSpace !== void 0) return this.inheritedCoordinateSpace.id;
		return this.focusKey ?? this.id;
	}
	get providedCoordinateSpace() {
		if (this.coordinateSchema !== void 0) return {
			surface: this.surface,
			id: this.focusKey ?? this.id,
			schema: this.coordinateSchema
		};
		return this.inheritedCoordinateSpace;
	}
	get coordinateSource() {
		if (this.args.surfacePath !== void 0 || this.args.focusKey !== void 0 || this.args.id !== void 0 || this.args.space !== void 0 || this.args.schema !== void 0 || this.args.coord !== void 0 || this.args.coordinateSpace !== void 0 || this.args.at !== void 0) return "explicit";
		if (this.spaceIdentity !== void 0) return "identity";
		if (this.inheritedSurfacePath !== void 0) return "context";
		return "generated";
	}
	get usesGeneratedId() {
		return this.args.id === void 0 && this.spaceIdentity === void 0 && this.surfacePath === void 0;
	}
	get keyParts() {
		if (Array.isArray(this.args.key)) return this.args.key;
		if (this.args.key !== void 0) return [this.args.key];
		if (Array.isArray(this.args.identityPart)) return this.args.identityPart;
		if (this.args.identityPart !== void 0) return [this.args.identityPart];
		return [];
	}
	get surfacePath() {
		if (this.args.surfacePath !== void 0) return this.args.surfacePath;
		if (this.spaceIdentity !== void 0) return normalizeSurfacePath(this.spaceIdentity, this.keyParts);
		if (this.inheritedSurfacePath !== void 0) return [...this.inheritedSurfacePath, ...this.keyParts];
	}
	get ladder() {
		return this.args.ladder ?? this.localLadder;
	}
	get runtime() {
		return this.localRuntime;
	}
	get runtimeGridCoordinate() {
		if (this.args.grid) return this.args.grid;
		if (this.args.gridRow === void 0 || this.args.gridCol === void 0) return;
		return {
			row: this.args.gridRow,
			col: this.args.gridCol
		};
	}
	get runtimePolicy() {
		const policy = { ...this.args.runtimePolicy ?? {} };
		if (this.args.preset !== void 0) policy.preset = this.args.preset;
		if (this.args.aspects !== void 0) policy.aspects = this.args.aspects;
		if (this.args.runtimeTraversal !== void 0) policy.traversal = this.args.runtimeTraversal;
		if (this.args.runtimeTraversalModel !== void 0) policy.traversalModel = this.args.runtimeTraversalModel;
		if (this.args.runtimeSelection !== void 0) policy.selection = this.args.runtimeSelection;
		if (this.args.runtimeKeyboard !== void 0) policy.keyboard = this.args.runtimeKeyboard;
		if (this.args.runtimeMovement !== void 0) policy.movement = this.args.runtimeMovement;
		if (this.args.runtimePointer !== void 0) policy.pointer = this.args.runtimePointer;
		if (this.args.runtimeEdit !== void 0) policy.edit = this.args.runtimeEdit;
		if (this.args.accepts !== void 0) policy.accepts = this.args.accepts;
		if (this.args.payloadType !== void 0) policy.payloadType = this.args.payloadType;
		return Object.keys(policy).length > 0 ? policy : void 0;
	}
	get liftManager() {
		this.localLiftManager.resolver = this.args.liftResolver;
		return this.localLiftManager;
	}
	get liftTargetComponent() {
		return this.liftManager.targetComponent;
	}
	get liftTargetContext() {
		return this.liftManager.targetContext;
	}
	get activeLiftSourceId() {
		return this.liftManager.activeSourceId;
	}
	get activeLiftTargetId() {
		return this.liftManager.activeTargetId;
	}
	get activeLiftKind() {
		return this.liftManager.kind;
	}
	get activeLiftFocusToken() {
		return this.liftManager.focusToken;
	}
	get demo() {
		return this.args.demo ?? false;
	}
	get mode() {
		return this.args.mode ?? modeForPosture(this.args.posture) ?? "use";
	}
	get inspect() {
		return this.args.inspect ?? this.mode === "inspect";
	}
	get inspectAttribute() {
		return String(this.inspect);
	}
	get changeRoute() {
		return this.args.changeRoute ?? "auto";
	}
	get skipKeyboard() {
		return this.args.keyboard === false || this.args.keyboard === "manual" || this.args.keyboard === "none";
	}
	get providedLadder() {
		return this.ladder;
	}
	get providedSurfaceRuntime() {
		return this.runtime;
	}
	get providedParentId() {
		return this.id;
	}
	get providedParentSurface() {
		return this.surface;
	}
	get providedDemo() {
		return this.demo;
	}
	get providedMode() {
		return this.mode;
	}
	get providedInspect() {
		return this.inspect;
	}
	get providedChangeRoute() {
		return this.changeRoute;
	}
	get providedSurfacePath() {
		return this.surfacePath;
	}
	get providedCoordinateSpaceContext() {
		return this.providedCoordinateSpace;
	}
	get providedLiftManager() {
		return this.liftManager;
	}
	get providedScopeRelay() {
		return this.scopeRelay;
	}
}, setComponentTemplate(precompileTemplate("<ContextProvider @key={{LadderContextName}} @value={{this.ladder}}>\n  <ContextProvider @key={{SurfaceRuntimeContextName}} @value={{this.runtime}}>\n    <ContextProvider @key={{ParentIdContextName}} @value={{this.id}}>\n      <ContextProvider @key={{ParentContextName}} @value={{this.surface}}>\n        <ContextProvider @key={{DemoContextName}} @value={{this.demo}}>\n          <ContextProvider @key={{ModeContextName}} @value={{this.mode}}>\n            <ContextProvider @key={{InspectContextName}} @value={{this.inspect}}>\n              <ContextProvider @key={{LiftContextName}} @value={{this.liftManager}}>\n                <ContextProvider @key={{ChangeRouteContextName}} @value={{this.changeRoute}}>\n                  <ContextProvider @key={{PathContextName}} @value={{this.surfacePath}}>\n                    <ContextProvider @key={{CoordinateSpaceContextName}} @value={{this.providedCoordinateSpace}}>\n                      <ContextProvider @key={{SurfaceScopeContextName}} @value={{this.scopeRelay}}>\n                  <div id={{this.id}} data-surface-component=\"environment\" data-surface-role={{this.args.role}} data-surface-pattern={{this.args.pattern}} data-surface-scope={{this.args.scope}} data-surface-depth={{this.directiveDepthAttribute}} data-surface-mode={{this.mode}} data-surface-posture={{this.args.posture}} data-surface-inspect={{this.inspectAttribute}} data-surface-change-route={{this.changeRoute}} data-surface-target={{this.args.target}} data-surface-target-scope={{this.args.targetScope}} data-surface-coordinate-space={{this.coordinateSpaceAttribute}} data-surface-coordinate-space-id={{this.coordinateSpaceId}} data-surface-local-coordinate={{this.localCoordinateAttribute}} data-surface-focus-key={{this.focusKey}} data-surface-path={{this.pathAttribute}} data-surface-coordinate={{this.coordinate}} {{surfaceRoot this.ladder runtime=this.runtime skipKeyboard=this.skipKeyboard navigationView=this.args.coordinateDebugView}} {{surfaceNode this.ladder runtime=this.runtime id=this.id surface=this.surface mode=this.mode target=this.args.target targetScope=this.args.targetScope focusKey=this.focusKey coordinate=this.coordinate coordinateSpace=this.coordinateSpaceAttribute localCoordinate=this.localCoordinateAttribute coordinateSource=this.coordinateSource keyParts=this.keyParts generatedId=this.usesGeneratedId policy=this.runtimePolicy grid=this.runtimeGridCoordinate expanded=this.args.expanded onSelect=this.args.onSelect onActivate=this.args.onActivate scrollOnSelect=this.args.scrollOnSelect scrollTarget=this.args.scrollTarget scrollAnchor=this.args.scrollAnchor hoverSignal=this.args.hoverSignal hoverAnchor=this.args.hoverAnchor onExpand=this.args.onExpand onCollapse=this.args.onCollapse lift=this.args.lift liftData=this.args.liftData liftManager=this.liftManager liftActiveSourceId=this.activeLiftSourceId liftActiveTargetId=this.activeLiftTargetId liftActiveKind=this.activeLiftKind}} {{surfaceScopeRelay this.scopeRelay}} {{surfaceInlineEdit enabled=this.args.inlineEdit value=this.args.editValue label=this.args.editLabel multiline=this.args.editMultiline onInput=this.args.onEditInput}} {{surfaceCoordinateDebugger this.ladder runtime=this.runtime enabled=this.args.coordinateDebug decals=this.args.coordinateDecals open=this.args.coordinateDebugOpen view=this.args.coordinateDebugView}} ...attributes>\n                    {{yield}}\n\n                    {{#if this.liftTargetComponent}}\n                      {{#if this.liftTargetContext}}\n                        {{#let this.liftTargetComponent as |LiftTarget|}}\n                          <Lift @anchor={{this.liftManager.anchorSelector}} @open={{this.liftManager.isOpen}} @kind={{this.liftManager.kind}} @placementMode={{this.liftManager.placementMode}} @size={{this.liftManager.size}} @backdrop={{this.liftManager.backdrop}} @elevation={{this.liftManager.elevation}} @keyboardModel={{this.liftManager.keyboardModel}} @focusToken={{this.activeLiftFocusToken}} @onDismiss={{this.liftManager.close}} {{on \"pointerenter\" this.liftManager.cancelDismiss}} {{on \"pointerleave\" this.liftManager.scheduleDismissDetails}}>\n                            <div id={{this.liftManager.activeTargetId}} data-surface-lift-target={{this.liftManager.kind}} data-surface-lift-source={{this.liftManager.activeSourceId}} data-surface-preserve-focus>\n                              <LiftTarget @context={{this.liftTargetContext}} />\n                            </div>\n                          </Lift>\n                        {{/let}}\n                      {{/if}}\n                    {{/if}}\n                  </div>\n                      </ContextProvider>\n                    </ContextProvider>\n                  </ContextProvider>\n                </ContextProvider>\n              </ContextProvider>\n            </ContextProvider>\n          </ContextProvider>\n        </ContextProvider>\n      </ContextProvider>\n    </ContextProvider>\n  </ContextProvider>\n</ContextProvider>", {
	strictMode: true,
	scope: () => ({
		ContextProvider,
		LadderContextName,
		SurfaceRuntimeContextName,
		ParentIdContextName,
		ParentContextName,
		DemoContextName,
		ModeContextName,
		InspectContextName,
		LiftContextName,
		ChangeRouteContextName,
		PathContextName,
		CoordinateSpaceContextName,
		SurfaceScopeContextName,
		surfaceRoot,
		surfaceNode,
		surfaceScopeRelay,
		surfaceInlineEdit,
		surfaceCoordinateDebugger,
		Lift,
		on
	})
}), _Environment), _Environment), _descriptor11 = _applyDecoratedDescriptor$1(_class2.prototype, "inheritedSurfacePath", [_dec20], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor12 = _applyDecoratedDescriptor$1(_class2.prototype, "inheritedCoordinateSpace", [_dec21], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor13 = _applyDecoratedDescriptor$1(_class2.prototype, "inheritedScopeRelay", [_dec22], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _applyDecoratedDescriptor$1(_class2.prototype, "coordinateSchema", [cached], Object.getOwnPropertyDescriptor(_class2.prototype, "coordinateSchema"), _class2.prototype), _applyDecoratedDescriptor$1(_class2.prototype, "id", [cached], Object.getOwnPropertyDescriptor(_class2.prototype, "id"), _class2.prototype), _applyDecoratedDescriptor$1(_class2.prototype, "focusKey", [cached], Object.getOwnPropertyDescriptor(_class2.prototype, "focusKey"), _class2.prototype), _applyDecoratedDescriptor$1(_class2.prototype, "coordinate", [cached], Object.getOwnPropertyDescriptor(_class2.prototype, "coordinate"), _class2.prototype), _applyDecoratedDescriptor$1(_class2.prototype, "coordinateSpaceId", [cached], Object.getOwnPropertyDescriptor(_class2.prototype, "coordinateSpaceId"), _class2.prototype), _applyDecoratedDescriptor$1(_class2.prototype, "runtimeGridCoordinate", [cached], Object.getOwnPropertyDescriptor(_class2.prototype, "runtimeGridCoordinate"), _class2.prototype), _applyDecoratedDescriptor$1(_class2.prototype, "runtimePolicy", [cached], Object.getOwnPropertyDescriptor(_class2.prototype, "runtimePolicy"), _class2.prototype), _applyDecoratedDescriptor$1(_class2.prototype, "providedLadder", [_dec23], Object.getOwnPropertyDescriptor(_class2.prototype, "providedLadder"), _class2.prototype), _applyDecoratedDescriptor$1(_class2.prototype, "providedSurfaceRuntime", [_dec24], Object.getOwnPropertyDescriptor(_class2.prototype, "providedSurfaceRuntime"), _class2.prototype), _applyDecoratedDescriptor$1(_class2.prototype, "providedParentId", [_dec25], Object.getOwnPropertyDescriptor(_class2.prototype, "providedParentId"), _class2.prototype), _applyDecoratedDescriptor$1(_class2.prototype, "providedParentSurface", [_dec26], Object.getOwnPropertyDescriptor(_class2.prototype, "providedParentSurface"), _class2.prototype), _applyDecoratedDescriptor$1(_class2.prototype, "providedDemo", [_dec27], Object.getOwnPropertyDescriptor(_class2.prototype, "providedDemo"), _class2.prototype), _applyDecoratedDescriptor$1(_class2.prototype, "providedMode", [_dec28], Object.getOwnPropertyDescriptor(_class2.prototype, "providedMode"), _class2.prototype), _applyDecoratedDescriptor$1(_class2.prototype, "providedInspect", [_dec29], Object.getOwnPropertyDescriptor(_class2.prototype, "providedInspect"), _class2.prototype), _applyDecoratedDescriptor$1(_class2.prototype, "providedChangeRoute", [_dec30], Object.getOwnPropertyDescriptor(_class2.prototype, "providedChangeRoute"), _class2.prototype), _applyDecoratedDescriptor$1(_class2.prototype, "providedSurfacePath", [_dec31], Object.getOwnPropertyDescriptor(_class2.prototype, "providedSurfacePath"), _class2.prototype), _applyDecoratedDescriptor$1(_class2.prototype, "providedCoordinateSpaceContext", [_dec32], Object.getOwnPropertyDescriptor(_class2.prototype, "providedCoordinateSpaceContext"), _class2.prototype), _applyDecoratedDescriptor$1(_class2.prototype, "providedLiftManager", [_dec33], Object.getOwnPropertyDescriptor(_class2.prototype, "providedLiftManager"), _class2.prototype), _applyDecoratedDescriptor$1(_class2.prototype, "providedScopeRelay", [_dec34], Object.getOwnPropertyDescriptor(_class2.prototype, "providedScopeRelay"), _class2.prototype);
var Layout$1 = class extends SurfaceComponent {
	get surface() {
		return "layout";
	}
};
var VARS_BY_SURFACE = {
	form: [
		"--cell-padding:var(--boxel-sp-xs) var(--boxel-sp-sm) var(--boxel-sp-xs) var(--boxel-sp-sm)",
		"--cell-border:1px solid var(--border, var(--boxel-form-control-border-color, var(--boxel-300, #d3d3d3)))",
		"--cell-radius:var(--boxel-form-control-border-radius, var(--boxel-border-radius, 10px))",
		"--cell-outline:1px solid transparent",
		"--cell-bg:var(--background, var(--boxel-light, #ffffff))",
		"--cell-fg:var(--foreground, var(--boxel-dark, #000000))",
		"--cell-height:auto",
		"--cell-min-height:var(--boxel-form-control-height, 2.5rem)",
		"--cell-focus-shadow:0 0 0 1px var(--ring, var(--boxel-highlight, #00ffba))",
		"--cell-focus-border:var(--ring, var(--boxel-highlight, #00ffba))",
		"--cell-overflow:grow",
		"--cell-placeholder-color:var(--muted-foreground, var(--boxel-450, #919191))",
		"--cell-error-color:var(--destructive, var(--boxel-error-200, #ff5050))",
		"--cell-helper-color:var(--muted-foreground, var(--boxel-450, #919191))",
		"--boxel-input-height:var(--boxel-form-control-height, 2.5rem)",
		"--boxel-form-control-border-color:var(--border, var(--boxel-300, #d3d3d3))",
		"--boxel-form-control-border-radius:var(--boxel-form-control-border-radius, var(--boxel-border-radius, 10px))",
		"--boxel-form-control-box-shadow:none"
	].join(";") + ";",
	grid: [
		"--cell-padding:0 var(--boxel-sp-xs)",
		"--cell-border:0",
		"--cell-radius:0",
		"--cell-outline:1.5px solid var(--ring, var(--boxel-highlight, #00ffba))",
		"--cell-bg:transparent",
		"--cell-fg:inherit",
		"--cell-height:100%",
		"--cell-min-height:0",
		"--cell-focus-shadow:none",
		"--cell-focus-border:inherit",
		"--cell-overflow:lift",
		"--cell-placeholder-color:var(--muted-foreground, var(--boxel-450, #919191))",
		"--cell-error-color:var(--destructive, var(--boxel-error-200, #ff5050))",
		"--cell-helper-color:var(--muted-foreground, var(--boxel-450, #919191))",
		"--boxel-input-height:100%",
		"--boxel-form-control-height:100%",
		"--boxel-form-control-border-color:transparent",
		"--boxel-form-control-border-radius:0",
		"--boxel-form-control-box-shadow:none"
	].join(";") + ";",
	canvas: [
		"--cell-padding:var(--boxel-sp-xs)",
		"--cell-border:0",
		"--cell-radius:var(--boxel-border-radius-xs, 4px)",
		"--cell-outline:0",
		"--cell-bg:transparent",
		"--cell-fg:inherit",
		"--cell-height:auto",
		"--cell-min-height:0",
		"--cell-focus-shadow:0 0 0 1px var(--ring, var(--boxel-highlight, #00ffba))",
		"--cell-focus-border:var(--ring, var(--boxel-highlight, #00ffba))",
		"--cell-overflow:grow",
		"--cell-placeholder-color:var(--muted-foreground, var(--boxel-450, #919191))",
		"--cell-error-color:var(--destructive, var(--boxel-error-200, #ff5050))",
		"--cell-helper-color:var(--muted-foreground, var(--boxel-450, #919191))",
		"--boxel-input-height:auto",
		"--boxel-form-control-border-color:transparent",
		"--boxel-form-control-border-radius:var(--boxel-border-radius-xs, 4px)",
		"--boxel-form-control-box-shadow:none"
	].join(";") + ";",
	scene: [
		"--cell-padding:var(--boxel-sp-sm) var(--boxel-sp)",
		"--cell-border:1px solid color-mix(in oklch, var(--primary-foreground) 18%, transparent)",
		"--cell-radius:var(--boxel-border-radius-sm)",
		"--cell-outline:0",
		"--cell-bg:color-mix(in oklch, var(--primary-foreground) 5%, transparent)",
		"--cell-fg:inherit",
		"--cell-height:auto",
		"--cell-min-height:0",
		"--cell-focus-shadow:0 0 0 1px color-mix(in oklch, var(--primary-foreground) 45%, transparent)",
		"--cell-focus-border:color-mix(in oklch, var(--primary-foreground) 45%, transparent)",
		"--cell-overflow:grow",
		"--cell-placeholder-color:color-mix(in oklch, var(--primary-foreground) 50%, transparent)",
		"--cell-error-color:var(--destructive)",
		"--cell-helper-color:color-mix(in oklch, var(--primary-foreground) 55%, transparent)",
		"--boxel-input-height:auto",
		"--boxel-form-control-border-color:color-mix(in oklch, var(--primary-foreground) 18%, transparent)",
		"--boxel-form-control-border-radius:var(--boxel-border-radius)",
		"--boxel-form-control-box-shadow:none"
	].join(";") + ";"
};
var Cell = (_dec35 = consume(FormFieldContextName), _class3 = (_Cell = class Cell extends SurfaceComponent {
	constructor(...args) {
		super(...args);
		_defineProperty(this, "cellGuid", guidFor(this));
		_initializerDefineProperty$1(this, "inheritedFormField", _descriptor14, this);
		_initializerDefineProperty$1(this, "detectedCellSurface", _descriptor15, this);
		_initializerDefineProperty$1(this, "detectedState", _descriptor16, this);
		_defineProperty(this, "detectCell", modifier((el) => {
			let formFieldState = el.closest("[data-bx-form-field-state]")?.getAttribute("data-bx-form-field-state");
			this.detectedState = isCellValidationState(formFieldState) ? formFieldState : "none";
			if (this.args.surface) {
				this.detectedCellSurface = this.args.surface;
				return;
			}
			this.detectedCellSurface = el.closest("[data-bx-grid]") ? "grid" : el.closest("[data-bx-canvas-node-id], [data-bx-canvas-edge-id], [data-bx-canvas-runtime-root]") ? "canvas" : el.closest("[data-bx-scene-node-id], [data-bx-scene-runtime-root]") ? "scene" : "form";
		}));
	}
	get surface() {
		return "cell";
	}
	get cellSurface() {
		return this.args.surface ?? this.detectedCellSurface;
	}
	get style() {
		return VARS_BY_SURFACE[this.cellSurface];
	}
	get overflow() {
		return this.cellSurface === "grid" ? "lift" : "grow";
	}
	get bottomTreatment() {
		return this.args.bottomTreatment ?? "rounded";
	}
	get state() {
		return this.args.state ?? this.inheritedFormField?.state ?? this.detectedState;
	}
	get disabled() {
		return this.args.disabled ?? this.inheritedFormField?.disabled ?? false;
	}
	get readonly() {
		return this.args.readonly ?? this.inheritedFormField?.readonly ?? false;
	}
	get surfaceRole() {
		return this.args.role ?? "control";
	}
	get surfaceTarget() {
		return this.args.target ?? (this.cellSurface === "grid" ? "range-item" : "value");
	}
	get defaultFocusOwner() {
		return this.cellSurface === "grid" ? "none" : "inner";
	}
	get keyParts() {
		if (this.args.key !== void 0 || this.args.identityPart !== void 0) return super.keyParts;
		let key = this.inheritedFormField?.surfaceKey ?? this.cellGuid;
		return Array.isArray(key) ? key : [key];
	}
}, setComponentTemplate(precompileTemplate("<ContextProvider @key={{LadderContextName}} @value={{this.ladder}}>\n  <ContextProvider @key={{SurfaceRuntimeContextName}} @value={{this.runtime}}>\n    <ContextProvider @key={{ParentIdContextName}} @value={{this.id}}>\n      <ContextProvider @key={{ParentContextName}} @value={{this.surface}}>\n        <ContextProvider @key={{DemoContextName}} @value={{this.demo}}>\n          <ContextProvider @key={{ModeContextName}} @value={{this.mode}}>\n            <ContextProvider @key={{InspectContextName}} @value={{this.inspect}}>\n              <ContextProvider @key={{LiftContextName}} @value={{this.liftManager}}>\n                <ContextProvider @key={{ChangeRouteContextName}} @value={{this.changeRoute}}>\n                  <ContextProvider @key={{PathContextName}} @value={{this.surfacePath}}>\n                    <ContextProvider @key={{CoordinateSpaceContextName}} @value={{this.providedCoordinateSpace}}>\n                      <ContextProvider @key={{SurfaceScopeContextName}} @value={{this.scopeRelay}}>\n                        {{#let (if (has-block \"pre\") \"outer\" (if (has-block \"post\") \"outer\" this.defaultFocusOwner)) as |focusOwner|}}\n                          <div id={{this.id}} data-surface-component={{this.surface}} data-surface-role={{this.surfaceRole}} data-surface-pattern={{this.args.pattern}} data-surface-scope={{this.args.scope}} data-surface-depth={{this.directiveDepthAttribute}} data-surface-expandable={{this.expandableAttribute}} data-surface-expanded={{this.expandedAttribute}} data-surface-mode={{this.explicitModeAttribute}} data-surface-posture={{this.args.posture}} data-surface-inspect={{this.explicitInspectAttribute}} data-surface-change-route={{this.args.changeRoute}} data-surface-target={{this.surfaceTarget}} data-surface-target-scope={{this.args.targetScope}} data-surface-coordinate-space={{this.coordinateSpaceAttribute}} data-surface-coordinate-space-id={{this.coordinateSpaceId}} data-surface-local-coordinate={{this.localCoordinateAttribute}} data-surface-focus-key={{this.focusKey}} data-surface-path={{this.pathAttribute}} data-surface-coordinate={{this.coordinate}} class=\"bx-cell bx-cell--{{this.cellSurface}}\" style={{this.style}} data-bx-cell-overflow={{this.overflow}} data-bx-cell-state=\"idle\" data-bx-cell-validation-state={{this.state}} data-bx-cell-focus-owner={{focusOwner}} data-bx-cell-bottom-treatment={{this.bottomTreatment}} data-bx-cell-disabled={{if this.disabled \"true\"}} data-bx-cell-readonly={{if this.readonly \"true\"}} data-bx-cell-chained={{if this.args.chained \"true\"}} {{surfaceNode this.ladder runtime=this.runtime id=this.id surface=this.surface parentId=this.parentId mode=this.explicitModeAttribute target=this.surfaceTarget targetScope=this.args.targetScope focusKey=this.focusKey coordinate=this.coordinate coordinateSpace=this.coordinateSpaceAttribute localCoordinate=this.localCoordinateAttribute coordinateSource=this.coordinateSource keyParts=this.keyParts generatedId=this.usesGeneratedId policy=this.runtimePolicy grid=this.runtimeGridCoordinate expanded=this.args.expanded onSelect=this.args.onSelect onActivate=this.args.onActivate scrollOnSelect=this.args.scrollOnSelect scrollTarget=this.args.scrollTarget scrollAnchor=this.args.scrollAnchor hoverSignal=this.args.hoverSignal hoverAnchor=this.args.hoverAnchor onExpand=this.args.onExpand onCollapse=this.args.onCollapse lift=this.liftEdges liftData=this.args.liftData liftManager=this.liftManager liftActiveSourceId=this.activeLiftSourceId liftActiveTargetId=this.activeLiftTargetId liftActiveKind=this.activeLiftKind}} {{surfaceScopeRelay this.scopeRelay}} {{surfaceInlineEdit enabled=this.inlineEditEnabled activation=this.inlineEditActivation value=this.inlineEditValue label=this.inlineEditLabel multiline=this.inlineEditMultiline onInput=this.inlineEditInput}} {{this.detectCell}} ...attributes>\n                            {{#if (has-block \"pre\")}}\n                              <span class=\"bx-cell__accessory bx-cell__accessory--pre\">\n                                {{yield to=\"pre\"}}\n                              </span>\n                            {{/if}}\n                            <span class=\"bx-cell__content\">\n                              {{yield}}\n                            </span>\n                            {{#if (has-block \"post\")}}\n                              <span class=\"bx-cell__accessory bx-cell__accessory--post\">\n                                {{yield to=\"post\"}}\n                              </span>\n                            {{/if}}\n                          </div>\n                        {{/let}}\n                      </ContextProvider>\n                    </ContextProvider>\n                  </ContextProvider>\n                </ContextProvider>\n              </ContextProvider>\n            </ContextProvider>\n          </ContextProvider>\n        </ContextProvider>\n      </ContextProvider>\n    </ContextProvider>\n  </ContextProvider>\n</ContextProvider>\n\n<style>\n  .bx-cell {\n    display: block;\n    width: 100%;\n    color: var(--cell-fg);\n  }\n\n  .bx-cell--grid {\n    display: flex;\n    min-width: 0;\n    height: var(--cell-height);\n    overflow: hidden;\n  }\n\n  .bx-cell--form,\n  .bx-cell--canvas,\n  .bx-cell--scene {\n    display: block;\n    min-height: var(--cell-min-height);\n  }\n\n  .bx-cell:has(.bx-cell__accessory) {\n    display: grid;\n    grid-template-columns: auto minmax(0, 1fr) auto;\n    align-items: stretch;\n    min-height: var(--cell-min-height);\n    border: var(--cell-border);\n    border-radius: var(--cell-radius);\n    background: var(--cell-bg);\n  }\n\n  .bx-cell--grid:has(.bx-cell__accessory) {\n    min-height: 0;\n    height: var(--cell-height);\n  }\n\n  .bx-cell[data-bx-cell-bottom-treatment=\"flat\"]:has(.bx-cell__accessory) {\n    border-bottom-right-radius: 0;\n    border-bottom-left-radius: 0;\n  }\n\n  .bx-cell[data-bx-cell-chained=\"true\"]:has(.bx-cell__accessory) {\n    border: 0;\n  }\n\n  .bx-cell__content {\n    display: block;\n    min-width: 0;\n  }\n\n  .bx-cell--grid .bx-cell__content {\n    flex: 1 1 auto;\n    width: 100%;\n    height: 100%;\n  }\n\n  .bx-cell--grid .input-container,\n  .bx-cell--grid .boxel-input,\n  .bx-cell--grid .container,\n  .bx-cell--grid .boxel-input-group {\n    width: 100%;\n    max-width: none;\n    height: 100%;\n    min-height: 0;\n  }\n\n  .bx-cell--grid .boxel-input {\n    box-sizing: border-box;\n    flex: 1 1 auto;\n    border: 0;\n    border-radius: 0;\n    background: transparent;\n    box-shadow: none;\n    outline: 0;\n    padding: 0 var(--boxel-sp-xs);\n  }\n\n  .bx-cell--grid .boxel-input-group {\n    border: 0;\n    border-radius: 0;\n    background: transparent;\n  }\n\n  .bx-cell--canvas .boxel-input,\n  .bx-cell--canvas .boxel-input-group {\n    background: transparent;\n    border-color: transparent;\n    box-shadow: none;\n  }\n\n  .bx-cell--scene .boxel-input,\n  .bx-cell--scene .boxel-input-group {\n    background: color-mix(in oklch, var(--primary-foreground) 5%, transparent);\n    color: inherit;\n  }\n\n  .bx-cell__content > input,\n  .bx-cell__content > select,\n  .bx-cell__content > textarea,\n  .bx-cell .boxel-input {\n    width: 100%;\n    min-height: var(--cell-min-height);\n    height: var(--cell-height);\n    padding: var(--cell-padding);\n    border: var(--cell-border);\n    border-radius: var(--cell-radius);\n    outline: var(--cell-outline);\n    background: var(--cell-bg);\n    color: var(--cell-fg);\n    font: inherit;\n  }\n\n  .bx-cell:has(.bx-cell__accessory) .bx-cell__content > input,\n  .bx-cell:has(.bx-cell__accessory) .bx-cell__content > select,\n  .bx-cell:has(.bx-cell__accessory) .bx-cell__content > textarea,\n  .bx-cell:has(.bx-cell__accessory) .boxel-input {\n    border: 0;\n    border-radius: 0;\n    background: transparent;\n  }\n\n  .bx-cell__content > input::placeholder,\n  .bx-cell__content > textarea::placeholder,\n  .bx-cell .boxel-input::placeholder {\n    color: var(--cell-placeholder-color);\n  }\n\n  .bx-cell[data-bx-cell-focus-owner=\"inner\"] .bx-cell__content > input:focus,\n  .bx-cell[data-bx-cell-focus-owner=\"inner\"] .bx-cell__content > select:focus,\n  .bx-cell[data-bx-cell-focus-owner=\"inner\"] .bx-cell__content > textarea:focus,\n  .bx-cell[data-bx-cell-focus-owner=\"inner\"] .boxel-input:focus {\n    border-color: var(--cell-focus-border);\n    box-shadow: var(--cell-focus-shadow);\n  }\n\n  .bx-cell[data-bx-cell-focus-owner=\"outer\"] .bx-cell__content > input:focus,\n  .bx-cell[data-bx-cell-focus-owner=\"outer\"] .bx-cell__content > select:focus,\n  .bx-cell[data-bx-cell-focus-owner=\"outer\"] .bx-cell__content > textarea:focus,\n  .bx-cell[data-bx-cell-focus-owner=\"outer\"] .boxel-input:focus,\n  .bx-cell[data-bx-cell-focus-owner=\"none\"] .bx-cell__content > input:focus,\n  .bx-cell[data-bx-cell-focus-owner=\"none\"] .bx-cell__content > select:focus,\n  .bx-cell[data-bx-cell-focus-owner=\"none\"] .bx-cell__content > textarea:focus,\n  .bx-cell[data-bx-cell-focus-owner=\"none\"] .boxel-input:focus {\n    border-color: transparent;\n    outline: 0;\n    box-shadow: none;\n  }\n\n  .bx-cell[data-bx-cell-focus-owner=\"outer\"]:has(.bx-cell__accessory:focus-within),\n  .bx-cell[data-bx-cell-focus-owner=\"outer\"]:has(.bx-cell__content > input:focus),\n  .bx-cell[data-bx-cell-focus-owner=\"outer\"]:has(.bx-cell__content > select:focus),\n  .bx-cell[data-bx-cell-focus-owner=\"outer\"]:has(.bx-cell__content > textarea:focus) {\n    border-color: var(--cell-focus-border);\n    box-shadow: var(--cell-focus-shadow);\n  }\n\n  .bx-cell__accessory {\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    min-height: var(--cell-min-height);\n    padding-inline: var(--boxel-sp-sm);\n    color: var(--cell-helper-color);\n    font-size: var(--boxel-body-font-size);\n    white-space: nowrap;\n  }\n\n  .bx-cell__accessory--pre {\n    border-right: var(--cell-border);\n  }\n\n  .bx-cell__accessory--post {\n    border-left: var(--cell-border);\n  }\n\n  .bx-cell[data-bx-cell-validation-state=\"invalid\"] .bx-cell__content > input,\n  .bx-cell[data-bx-cell-validation-state=\"invalid\"] .bx-cell__content > select,\n  .bx-cell[data-bx-cell-validation-state=\"invalid\"] .bx-cell__content > textarea,\n  .bx-cell[data-bx-cell-validation-state=\"invalid\"] .boxel-input,\n  .bx-cell[data-bx-cell-validation-state=\"invalid\"]:has(.bx-cell__accessory) {\n    border-color: var(--cell-error-color);\n  }\n\n  .bx-cell[data-bx-cell-state=\"drag-source\"] {\n    opacity: 0.4;\n    pointer-events: none;\n  }\n\n  .bx-cell[data-bx-cell-state=\"drop-target\"] {\n    background: color-mix(in oklch, var(--cell-focus-border) 8%, var(--cell-bg));\n    border-color: var(--cell-focus-border);\n    box-shadow: none;\n  }\n\n  .bx-cell[data-bx-cell-state=\"lift-host\"] {\n    box-shadow: none;\n  }\n\n  .bx-cell[data-bx-cell-disabled=\"true\"],\n  .bx-cell[data-bx-cell-readonly=\"true\"] {\n    opacity: 0.62;\n  }\n</style>", {
	strictMode: true,
	scope: () => ({
		ContextProvider,
		LadderContextName,
		SurfaceRuntimeContextName,
		ParentIdContextName,
		ParentContextName,
		DemoContextName,
		ModeContextName,
		InspectContextName,
		LiftContextName,
		ChangeRouteContextName,
		PathContextName,
		CoordinateSpaceContextName,
		SurfaceScopeContextName,
		surfaceNode,
		surfaceScopeRelay,
		surfaceInlineEdit
	})
}), _Cell), _Cell), _descriptor14 = _applyDecoratedDescriptor$1(_class3.prototype, "inheritedFormField", [_dec35], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor15 = _applyDecoratedDescriptor$1(_class3.prototype, "detectedCellSurface", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return "form";
	}
}), _descriptor16 = _applyDecoratedDescriptor$1(_class3.prototype, "detectedState", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return "none";
	}
}), _class3);
function isCellValidationState(value) {
	return value === "none" || value === "valid" || value === "invalid" || value === "loading" || value === "initial";
}
var _Accessory, _SurfaceAccessoryAlias;
var Accessory = class extends Component {
	get kind() {
		return this.args.kind ?? "label";
	}
	get position() {
		return this.args.position ?? "block-start";
	}
	get tone() {
		return this.args.tone ?? "neutral";
	}
	get id() {
		return this.args.id ?? this.generatedId;
	}
	get generatedId() {
		if (!this.args.labelFor) return void 0;
		return `${this.args.labelFor}-${this.kind}`;
	}
	get role() {
		if (this.kind === "status") return "status";
	}
	get ariaLive() {
		if (this.kind === "status") return "polite";
	}
	get ariaHidden() {
		if (this.args.decorative) return "true";
	}
};
_Accessory = Accessory;
setComponentTemplate(precompileTemplate("<span id={{this.id}} class=\"surface-accessory\" data-surface-accessory={{this.kind}} data-surface-accessory-position={{this.position}} data-surface-accessory-tone={{this.tone}} data-label-for={{@labelFor}} role={{this.role}} aria-live={{this.ariaLive}} aria-hidden={{this.ariaHidden}} ...attributes>\n  {{yield}}\n</span>", { strictMode: true }), _Accessory);
var SurfaceAccessoryAlias = class extends Component {
	get labelFor() {
		return this.args.for ?? this.args.labelFor;
	}
};
_SurfaceAccessoryAlias = SurfaceAccessoryAlias;
setComponentTemplate(precompileTemplate("<Accessory @id={{@id}} @kind={{this.kind}} @labelFor={{this.labelFor}} @position={{@position}} @tone={{@tone}} @decorative={{@decorative}} ...attributes>\n  {{yield}}\n</Accessory>", {
	strictMode: true,
	scope: () => ({ Accessory })
}), _SurfaceAccessoryAlias);
var _LiftChevron;
var LiftChevron = class extends Component {
	/** Render gate. Units whose contract doesn't list `'edit'` in
	*  the lift chain (Pattern A/B widgets) don't get a chevron —
	*  there's nothing to escalate to. */
	get supportsEdit() {
		return this.args.contract.lift.includes("edit");
	}
	/** True when the lift is open AND points at THIS unit. Drives
	*  the loudest tier (full opacity + indigo + bg) so the
	*  chevron stays visible while the user is editing. */
	get isOpen() {
		return this.args.state.isOpenFor(this.args.row, this.args.col);
	}
	/** Accessible label. Override via `@label` for hosts that want
	*  a more specific verb (e.g., `'Pick a date'`, `'Choose tags'`). */
	get label() {
		return this.args.label ?? "Open editor";
	}
};
_LiftChevron = LiftChevron;
setComponentTemplate(precompileTemplate("{{#if this.supportsEdit}}\n  <button type=\"button\" class=\"bx-lift-chevron {{if this.isOpen \"is-lift-open\"}}\" aria-label={{this.label}} title={{this.label}} {{on \"click\" (fn @state.openEdit @row @col)}} ...attributes>▾</button>\n{{/if}}\n\n<style scoped>\n  /* The chevron glyph. Positioned absolutely in the unit's\n   * right edge, so the parent unit needs `position: relative`\n   * (provided by `.bx-cell` in cell-chrome.css, or by the\n   * host's own styles). 16x16 keeps it small enough to live\n   * inside a row-height unit without crowding content. */\n  .bx-lift-chevron {\n    position: absolute;\n    right: 4px;\n    top: 50%;\n    transform: translateY(-50%);\n    width: 16px;\n    height: 16px;\n    padding: 0;\n    border: none;\n    border-radius: 3px;\n    background: transparent;\n    color: var(--bx-lift-chevron-color, #9ca3af);\n    font-size: 11px;\n    line-height: 1;\n    cursor: pointer;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    opacity: 0;\n    transition: opacity 80ms, background 80ms, color 80ms;\n  }\n  /* Lift-open + chevron-hover both promote to the loudest\n   * tier — full opacity, indigo accent, soft bg. !important\n   * so the unit-hover / unit-focused tiers (provided by a\n   * parent rule) can't lower us back. */\n  .bx-lift-chevron.is-lift-open,\n  .bx-lift-chevron:hover {\n    opacity: 1 !important;\n    background: var(\n      --bx-lift-chevron-hover-bg,\n      rgba(99, 102, 241, 0.12)\n    );\n    color: var(\n      --bx-lift-chevron-hover-color,\n      #4f46e5\n    ) !important;\n  }\n  /* Keyboard focus — visible outline so the affordance is\n   * reachable + visible without a mouse. */\n  .bx-lift-chevron:focus-visible {\n    outline: 2px solid var(--bx-lift-chevron-hover-color, #4f46e5);\n    outline-offset: 1px;\n    opacity: 1;\n  }\n</style>", {
	strictMode: true,
	scope: () => ({
		on,
		fn
	})
}), _LiftChevron);
function labelForFieldKey(key) {
	return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}
function resolveFormFields(fields, labelFor = labelForFieldKey) {
	return (fields ?? []).map((field) => ({
		...field,
		kind: field.kind ?? "text",
		label: field.label ?? labelFor(field.key)
	}));
}
function readResolvedFormFieldValue(field, model) {
	if ("value" in field) return field.value;
	if (!isModelRecord(model)) return void 0;
	return model[field.key];
}
function writeResolvedFormFieldValue(field, model, value) {
	if (!isModelRecord(model)) return;
	model[field.key] = value;
}
function isModelRecord(model) {
	return typeof model === "object" && model !== null;
}
var _FormAlert;
var FormAlert = class extends Component {
	get type() {
		return this.args.type ?? "info";
	}
	get isError() {
		return this.type === "error";
	}
	get isWarning() {
		return this.type === "warning";
	}
	get isSuccess() {
		return this.type === "success";
	}
	get isInfo() {
		return this.type === "info";
	}
};
_FormAlert = FormAlert;
setComponentTemplate(precompileTemplate("<div class=\"bx-form-alert bx-form-alert--{{this.type}}\" data-bx-form-alert={{this.type}} role={{if this.isError \"alert\" \"status\"}} ...attributes>\n  <span class=\"bx-form-alert__icon\" aria-hidden=\"true\">\n    {{#if this.isSuccess}}\n      <SuccessBordered class=\"bx-form-alert__icon-svg\" role=\"presentation\" />\n    {{else if this.isWarning}}\n      <Warning class=\"bx-form-alert__icon-svg\" role=\"presentation\" />\n    {{else if this.isError}}\n      <Warning class=\"bx-form-alert__icon-svg\" role=\"presentation\" />\n    {{else}}\n      <ExclamationCircle class=\"bx-form-alert__icon-svg\" role=\"presentation\" />\n    {{/if}}\n  </span>\n  <div class=\"bx-form-alert__messages\">\n    {{#if (has-block \"messages\")}}\n      {{yield to=\"messages\"}}\n    {{else}}\n      {{yield}}\n    {{/if}}\n  </div>\n  {{#if (has-block \"actions\")}}\n    <div class=\"bx-form-alert__actions\">\n      {{yield to=\"actions\"}}\n    </div>\n  {{/if}}\n</div>\n\n<style scoped>\n  .bx-form-alert {\n    --bx-form-alert-color: var(--primary);\n\n    display: grid;\n    grid-template-columns: auto minmax(0, 1fr) auto;\n    align-items: start;\n    gap: var(--boxel-sp-sm);\n    padding: var(--boxel-sp-sm);\n    border: 1px solid var(--bx-form-alert-color);\n    border-radius: var(--boxel-border-radius-sm);\n    background: color-mix(in oklch, var(--bx-form-alert-color) 8%, transparent);\n    color: var(--foreground);\n    font: inherit;\n  }\n\n  .bx-form-alert--error {\n    --bx-form-alert-color: var(--destructive);\n  }\n\n  .bx-form-alert--warning {\n    --bx-form-alert-color: var(--warning);\n  }\n\n  .bx-form-alert--success {\n    --bx-form-alert-color: var(--success);\n  }\n\n  .bx-form-alert__icon {\n    display: grid;\n    place-items: center;\n    width: 20px;\n    height: 20px;\n    color: var(--bx-form-alert-color);\n    --icon-color: currentColor;\n  }\n\n  .bx-form-alert__icon-svg {\n    width: 20px;\n    height: 20px;\n  }\n\n  .bx-form-alert__messages {\n    display: grid;\n    gap: var(--boxel-sp-3xs);\n    min-width: 0;\n    font-size: var(--boxel-body-font-size);\n    line-height: var(--boxel-body-line-height);\n  }\n\n  .bx-form-alert__messages :deep(p) {\n    margin: 0;\n  }\n\n  .bx-form-alert__actions {\n    display: flex;\n    justify-content: flex-end;\n  }\n</style>", {
	strictMode: true,
	scope: () => ({
		SuccessBordered,
		Warning,
		ExclamationCircle
	})
}), _FormAlert);
var _class$a, _descriptor$6, _descriptor2$4, _FormField;
var FormField = (_class$a = (_FormField = class FormField extends Component {
	constructor(...args) {
		super(...args);
		_defineProperty(this, "guid", guidFor(this));
		_initializerDefineProperty$1(this, "inheritedLayout", _descriptor$6, this);
		_initializerDefineProperty$1(this, "inheritedDensity", _descriptor2$4, this);
		_defineProperty(this, "inheritFormChrome", modifier((el) => {
			let form = el.closest("[data-bx-form]");
			let layout = form?.getAttribute("data-bx-form-layout");
			let density = form?.getAttribute("data-bx-form-density");
			this.inheritedLayout = layout === "horizontal" ? "horizontal" : "vertical";
			this.inheritedDensity = density === "compact" ? "compact" : "comfortable";
		}));
	}
	get state() {
		return this.args.state ?? (this.args.errorMessage ? "invalid" : "none");
	}
	get layout() {
		return this.args.layout ?? this.inheritedLayout;
	}
	get density() {
		return this.inheritedDensity;
	}
	get isHorizontal() {
		return this.layout === "horizontal";
	}
	get isVertical() {
		return !this.isHorizontal;
	}
	get isInvalid() {
		return this.state === "invalid";
	}
	get isValid() {
		return this.state === "valid";
	}
	get isLoading() {
		return this.state === "loading";
	}
	get shouldShowMessage() {
		return Boolean(this.args.errorMessage || this.args.helperText);
	}
	get helperId() {
		return `bx-form-field-helper-${this.guid}`;
	}
	get errorId() {
		return `bx-form-field-error-${this.guid}`;
	}
	get describedBy() {
		if (this.args.errorMessage) return this.errorId;
		if (this.args.helperText) return this.helperId;
	}
	get surfaceKey() {
		return this.args.key ?? [this.args.label, this.guid];
	}
	get context() {
		return {
			state: this.state,
			layout: this.layout,
			density: this.density,
			surfaceKey: this.surfaceKey,
			describedBy: this.describedBy,
			invalid: this.isInvalid,
			disabled: this.args.disabled,
			readonly: this.args.readonly,
			required: this.args.required
		};
	}
	get stateIcon() {
		switch (this.state) {
			case "valid": return SuccessBordered;
			case "invalid": return FailureBordered;
			case "loading": return LoadingIndicator;
			default: return;
		}
	}
}, setComponentTemplate(precompileTemplate("<ContextProvider @key={{FormFieldContextName}} @value={{this.context}}>\n  <div class=\"bx-form-field boxel-field {{if this.isHorizontal \"bx-form-field--horizontal horizontal small-label\" \"bx-form-field--vertical vertical\"}} bx-form-field--{{this.density}} {{if @icon \"with-icon\"}}\" data-bx-form-field data-bx-form-field-density={{this.density}} data-bx-form-field-state={{this.state}} data-bx-form-field-disabled={{if @disabled \"true\"}} data-bx-form-field-readonly={{if @readonly \"true\"}} data-test-boxel-field {{this.inheritFormChrome}} ...attributes>\n    <div class=\"label-container\">\n      {{#if @icon}}\n        <@icon class=\"boxel-field__icon\" width=\"16\" height=\"16\" role=\"presentation\" />\n      {{/if}}\n      <span class=\"label boxel-label\" data-test-boxel-field-label>\n        {{@label}}\n      </span>\n      <span class=\"bx-form-field__label-meta\">\n        {{#if (has-block \"label\")}}\n          {{yield to=\"label\"}}\n        {{/if}}\n        {{#if @required}}\n          <span class=\"bx-form-field__required\" aria-hidden=\"true\">*</span>\n        {{/if}}\n      </span>\n      {{#if @optional}}\n        <span class=\"bx-form-field__optional\">Optional</span>\n      {{/if}}\n      {{#if this.stateIcon}}\n        <span class=\"bx-form-field__state\" aria-label={{if this.isValid \"Valid\" (if this.isInvalid \"Invalid\" \"Loading\")}}>\n          <this.stateIcon class=\"bx-form-field__state-icon\" role=\"presentation\" />\n        </span>\n      {{/if}}\n    </div>\n\n    <div class=\"content bx-form-field__content\" aria-describedby={{this.describedBy}} aria-invalid={{if this.isInvalid \"true\"}}>\n      {{yield}}\n    </div>\n\n    {{#if this.shouldShowMessage}}\n      <p class=\"bx-form-field__message {{if this.isInvalid \"bx-form-field__message--error\"}}\" id={{if this.isInvalid this.errorId this.helperId}}>\n        {{#if this.isInvalid}}{{@errorMessage}}{{else}}{{@helperText}}{{/if}}\n      </p>\n    {{/if}}\n  </div>\n</ContextProvider>\n\n<style scoped>\n  .bx-form-field {\n    --boxel-field-label-align: normal;\n    --boxel-field-label-padding-top: 0;\n    --boxel-field-label-size: minmax(4rem, 10%);\n\n    display: grid;\n    width: 100%;\n    max-width: 100%;\n    gap: var(--boxel-sp-4xs);\n    min-width: 0;\n    overflow-wrap: break-word;\n  }\n\n  .bx-form-field--horizontal {\n    grid-template-columns: var(--boxel-field-label-size) 1fr;\n    min-height: var(--boxel-form-control-height);\n  }\n\n  .bx-form-field--compact {\n    --boxel-field-label-size: minmax(4rem, 18%);\n  }\n\n  .bx-form-field--vertical {\n    grid-template-rows: auto 1fr;\n  }\n\n  .label-container {\n    display: flex;\n    align-items: start;\n    min-width: 0;\n  }\n\n  .with-icon .label-container {\n    gap: var(--boxel-sp-xs);\n  }\n\n  .bx-form-field--horizontal > .label-container {\n    padding-top: var(--boxel-sp-sm);\n  }\n\n  .bx-form-field--horizontal > .bx-form-field__content {\n    align-self: center;\n  }\n\n  .label {\n    display: flex;\n    align-items: var(--boxel-field-label-align);\n    min-width: 0;\n    padding-top: var(--boxel-field-label-padding-top);\n    color: var(--foreground);\n    font-family: var(--boxel-caption-font-family);\n    font-size: var(--boxel-caption-font-size);\n    font-weight: var(--boxel-caption-font-weight);\n    line-height: var(--boxel-caption-line-height);\n  }\n\n  .boxel-field__icon {\n    flex-shrink: 0;\n  }\n\n  .bx-form-field--horizontal .bx-form-field__message {\n    margin-left: calc(min(10%, 4rem) + var(--boxel-sp));\n  }\n\n  .bx-form-field__required,\n  .bx-form-field__message--error {\n    color: var(--destructive);\n  }\n\n  .bx-form-field__optional,\n  .bx-form-field__state,\n  .bx-form-field__message {\n    color: var(--muted-foreground);\n    font-size: var(--boxel-caption-font-size);\n    line-height: var(--boxel-caption-line-height);\n  }\n\n  .bx-form-field__label-meta {\n    display: inline-flex;\n    align-items: center;\n    gap: var(--boxel-sp-xs);\n    margin-left: var(--boxel-sp-xs);\n  }\n\n  .bx-form-field__optional {\n    margin-left: auto;\n  }\n\n  .bx-form-field__state {\n    display: inline-grid;\n    place-items: center;\n    min-width: 16px;\n    height: 16px;\n  }\n\n  .bx-form-field__state-icon {\n    width: 16px;\n    height: 16px;\n  }\n\n  [data-bx-form-field-state=\"valid\"] .bx-form-field__state {\n    color: var(--success);\n    --icon-color: currentColor;\n  }\n\n  [data-bx-form-field-state=\"invalid\"] .bx-form-field__state {\n    color: var(--destructive);\n    --icon-color: currentColor;\n  }\n\n  [data-bx-form-field-state=\"loading\"] .bx-form-field__state {\n    color: var(--primary);\n    --icon-color: currentColor;\n  }\n\n  .bx-form-field__content {\n    min-width: 0;\n  }\n\n  .bx-form-field__message {\n    margin: 0;\n    padding-left: var(--boxel-outline-width);\n  }\n</style>", {
	strictMode: true,
	scope: () => ({
		ContextProvider,
		FormFieldContextName
	})
}), _FormField), _FormField), _descriptor$6 = _applyDecoratedDescriptor$1(_class$a.prototype, "inheritedLayout", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return "vertical";
	}
}), _descriptor2$4 = _applyDecoratedDescriptor$1(_class$a.prototype, "inheritedDensity", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return "comfortable";
	}
}), _class$a);
var _dec$2, _class$9, _descriptor$5, _EmailCell;
var EmailCell = (_dec$2 = consume(FormFieldContextName), _class$9 = (_EmailCell = class EmailCell extends Component {
	constructor(...args) {
		super(...args);
		_initializerDefineProperty$1(this, "inheritedFormField", _descriptor$5, this);
	}
	get state() {
		return this.args.state ?? this.inheritedFormField?.state ?? "none";
	}
	get isInvalid() {
		return this.state === "invalid";
	}
	handleInput(event) {
		this.args.onInput?.(event.target.value);
	}
}, setComponentTemplate(precompileTemplate("<Cell @state={{@state}} @disabled={{@disabled}} @readonly={{@readonly}}>\n  <input class=\"boxel-input\" type=\"email\" value={{@value}} placeholder={{@placeholder}} disabled={{@disabled}} readonly={{@readonly}} aria-invalid={{if this.isInvalid \"true\"}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n</Cell>", {
	strictMode: true,
	scope: () => ({
		Cell,
		on
	})
}), _EmailCell), _EmailCell), _descriptor$5 = _applyDecoratedDescriptor$1(_class$9.prototype, "inheritedFormField", [_dec$2], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _applyDecoratedDescriptor$1(_class$9.prototype, "handleInput", [action], Object.getOwnPropertyDescriptor(_class$9.prototype, "handleInput"), _class$9.prototype), _class$9);
var _class$8, _NumberCell;
var NumberCell = (_class$8 = (_NumberCell = class NumberCell extends Component {
	get value() {
		return this.args.value === void 0 ? "" : String(this.args.value);
	}
	handleInput(event) {
		this.args.onInput?.(event.target.value);
	}
}, setComponentTemplate(precompileTemplate("{{#if @prefix}}\n  {{#if @suffix}}\n    <Cell @state={{@state}} @disabled={{@disabled}} @readonly={{@readonly}}>\n      <:pre>{{@prefix}}</:pre>\n      <:default>\n        <input class=\"boxel-input\" type=\"number\" value={{this.value}} placeholder={{@placeholder}} disabled={{@disabled}} readonly={{@readonly}} min={{@min}} max={{@max}} step={{@step}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n      </:default>\n      <:post>{{@suffix}}</:post>\n    </Cell>\n  {{else}}\n    <Cell @state={{@state}} @disabled={{@disabled}} @readonly={{@readonly}}>\n      <:pre>{{@prefix}}</:pre>\n      <:default>\n        <input class=\"boxel-input\" type=\"number\" value={{this.value}} placeholder={{@placeholder}} disabled={{@disabled}} readonly={{@readonly}} min={{@min}} max={{@max}} step={{@step}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n      </:default>\n    </Cell>\n  {{/if}}\n{{else if @suffix}}\n  <Cell @state={{@state}} @disabled={{@disabled}} @readonly={{@readonly}}>\n    <:default>\n      <input class=\"boxel-input\" type=\"number\" value={{this.value}} placeholder={{@placeholder}} disabled={{@disabled}} readonly={{@readonly}} min={{@min}} max={{@max}} step={{@step}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n    </:default>\n    <:post>{{@suffix}}</:post>\n  </Cell>\n{{else}}\n  <Cell @state={{@state}} @disabled={{@disabled}} @readonly={{@readonly}}>\n    <input class=\"boxel-input\" type=\"number\" value={{this.value}} placeholder={{@placeholder}} disabled={{@disabled}} readonly={{@readonly}} min={{@min}} max={{@max}} step={{@step}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n  </Cell>\n{{/if}}", {
	strictMode: true,
	scope: () => ({
		Cell,
		on
	})
}), _NumberCell), _NumberCell), _applyDecoratedDescriptor$1(_class$8.prototype, "handleInput", [action], Object.getOwnPropertyDescriptor(_class$8.prototype, "handleInput"), _class$8.prototype), _class$8);
var _class$7, _SwitchCell;
var SwitchCell = (_class$7 = (_SwitchCell = class SwitchCell extends Component {
	get checked() {
		return Boolean(this.args.value);
	}
	toggle() {
		if (this.args.disabled) return;
		this.args.onChange?.(!this.checked);
	}
}, setComponentTemplate(precompileTemplate("<Cell class=\"bx-switch-cell\" @disabled={{@disabled}}>\n  {{!-- TODO: Replace this local switch control with Boxel UI Switch once\n    @cardstack/boxel-ui exposes tree-shakable component subpaths that do\n    not pull the whole external addon into the surfaces test app build. --}}\n  <button class=\"bx-switch-cell__button\" type=\"button\" role=\"switch\" aria-checked={{this.checked}} disabled={{@disabled}} {{on \"click\" this.toggle}}>\n    <span class=\"bx-switch-cell__copy\">\n      <span class=\"bx-switch-cell__label\">{{@label}}</span>\n      {{#if @description}}\n        <span class=\"bx-switch-cell__description\">{{@description}}</span>\n      {{/if}}\n    </span>\n    <span class=\"bx-switch-cell__track\" data-checked={{if this.checked \"true\"}}>\n      <span class=\"bx-switch-cell__thumb\"></span>\n    </span>\n  </button>\n</Cell>\n\n<style>\n  .bx-switch-cell {\n    min-height: var(--cell-min-height);\n    border: var(--cell-border);\n    border-radius: var(--cell-radius);\n    background: var(--cell-bg);\n  }\n\n  .bx-switch-cell .bx-cell__content {\n    display: block;\n  }\n\n  .bx-switch-cell__button {\n    display: grid;\n    grid-template-columns: minmax(0, 1fr) auto;\n    align-items: center;\n    width: 100%;\n    min-height: var(--cell-min-height);\n    gap: var(--boxel-sp-sm);\n    padding: var(--cell-padding);\n    border: 0;\n    border-radius: inherit;\n    background: transparent;\n    color: var(--cell-fg);\n    font: inherit;\n    text-align: left;\n    cursor: pointer;\n  }\n\n  .bx-switch-cell__button:focus {\n    outline: 0;\n    box-shadow: var(--cell-focus-shadow);\n  }\n\n  .bx-switch-cell.bx-cell--grid {\n    height: 100%;\n    border: 0;\n    border-radius: 0;\n    background: transparent;\n  }\n\n  .bx-switch-cell.bx-cell--grid .bx-cell__content {\n    height: 100%;\n  }\n\n  .bx-switch-cell.bx-cell--grid .bx-switch-cell__button {\n    min-height: 0;\n    height: 100%;\n    padding: 0 var(--boxel-sp-xs);\n    box-shadow: none;\n  }\n\n  .bx-switch-cell.bx-cell--grid .bx-switch-cell__button:focus {\n    box-shadow: none;\n  }\n\n  .bx-switch-cell.bx-cell--grid .bx-switch-cell__copy {\n    display: none;\n  }\n\n  .bx-switch-cell.bx-cell--grid .bx-switch-cell__track {\n    justify-self: center;\n  }\n\n  .bx-switch-cell__button:disabled {\n    cursor: not-allowed;\n  }\n\n  .bx-switch-cell__copy {\n    display: grid;\n    min-width: 0;\n    gap: var(--boxel-sp-4xs);\n  }\n\n  .bx-switch-cell__label {\n    color: var(--foreground);\n    font-size: var(--boxel-body-font-size);\n    font-weight: var(--boxel-section-heading-font-weight);\n    line-height: var(--boxel-body-line-height);\n  }\n\n  .bx-switch-cell__description {\n    color: var(--cell-helper-color);\n    font-size: var(--boxel-caption-font-size);\n    line-height: var(--boxel-caption-line-height);\n  }\n\n  .bx-switch-cell__track {\n    display: inline-flex;\n    align-items: center;\n    width: calc(var(--boxel-sp) + var(--boxel-sp-lg));\n    height: calc(var(--boxel-sp) + var(--boxel-sp-4xs));\n    padding: var(--boxel-sp-5xs);\n    border-radius: var(--boxel-border-radius-xl);\n    background: var(--muted);\n    transition: background-color var(--boxel-transition);\n  }\n\n  .bx-switch-cell__track[data-checked=\"true\"] {\n    background: var(--success);\n  }\n\n  .bx-switch-cell__thumb {\n    width: var(--boxel-sp);\n    height: var(--boxel-sp);\n    border-radius: var(--boxel-border-radius-xl);\n    background: var(--background);\n    box-shadow: 0 var(--boxel-sp-6xs) var(--boxel-sp-4xs) color-mix(in oklch, var(--foreground) 20%, transparent);\n    transition: transform var(--boxel-transition);\n  }\n\n  .bx-switch-cell__track[data-checked=\"true\"] .bx-switch-cell__thumb {\n    transform: translateX(var(--boxel-sp-sm));\n  }\n</style>", {
	strictMode: true,
	scope: () => ({
		Cell,
		on
	})
}), _SwitchCell), _SwitchCell), _applyDecoratedDescriptor$1(_class$7.prototype, "toggle", [action], Object.getOwnPropertyDescriptor(_class$7.prototype, "toggle"), _class$7.prototype), _class$7);
var _class$6, _TextCell;
var TextCell = (_class$6 = (_TextCell = class TextCell extends Component {
	handleInput(event) {
		this.args.onInput?.(event.target.value);
	}
	get inputType() {
		return this.args.type ?? "text";
	}
}, setComponentTemplate(precompileTemplate("{{#if @prefix}}\n  {{#if @suffix}}\n    <Cell @state={{@state}} @disabled={{@disabled}} @readonly={{@readonly}}>\n      <:pre>{{@prefix}}</:pre>\n      <:default>\n        {{#if @multiline}}\n          <textarea class=\"boxel-input\" value={{@value}} placeholder={{@placeholder}} disabled={{@disabled}} readonly={{@readonly}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n        {{else}}\n          <input class=\"boxel-input\" type={{this.inputType}} value={{@value}} placeholder={{@placeholder}} autocomplete={{@autocomplete}} disabled={{@disabled}} readonly={{@readonly}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n        {{/if}}\n      </:default>\n      <:post>{{@suffix}}</:post>\n    </Cell>\n  {{else}}\n    <Cell @state={{@state}} @disabled={{@disabled}} @readonly={{@readonly}}>\n      <:pre>{{@prefix}}</:pre>\n      <:default>\n        {{#if @multiline}}\n          <textarea class=\"boxel-input\" value={{@value}} placeholder={{@placeholder}} disabled={{@disabled}} readonly={{@readonly}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n        {{else}}\n          <input class=\"boxel-input\" type={{this.inputType}} value={{@value}} placeholder={{@placeholder}} autocomplete={{@autocomplete}} disabled={{@disabled}} readonly={{@readonly}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n        {{/if}}\n      </:default>\n    </Cell>\n  {{/if}}\n{{else if @suffix}}\n  <Cell @state={{@state}} @disabled={{@disabled}} @readonly={{@readonly}}>\n    <:default>\n      {{#if @multiline}}\n        <textarea class=\"boxel-input\" value={{@value}} placeholder={{@placeholder}} disabled={{@disabled}} readonly={{@readonly}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n      {{else}}\n        <input class=\"boxel-input\" type={{this.inputType}} value={{@value}} placeholder={{@placeholder}} autocomplete={{@autocomplete}} disabled={{@disabled}} readonly={{@readonly}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n      {{/if}}\n    </:default>\n    <:post>{{@suffix}}</:post>\n  </Cell>\n{{else}}\n  <Cell @state={{@state}} @disabled={{@disabled}} @readonly={{@readonly}}>\n    {{#if @multiline}}\n      <textarea class=\"boxel-input\" value={{@value}} placeholder={{@placeholder}} disabled={{@disabled}} readonly={{@readonly}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n    {{else}}\n      <input class=\"boxel-input\" type={{this.inputType}} value={{@value}} placeholder={{@placeholder}} autocomplete={{@autocomplete}} disabled={{@disabled}} readonly={{@readonly}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n    {{/if}}\n  </Cell>\n{{/if}}", {
	strictMode: true,
	scope: () => ({
		Cell,
		on
	})
}), _TextCell), _TextCell), _applyDecoratedDescriptor$1(_class$6.prototype, "handleInput", [action], Object.getOwnPropertyDescriptor(_class$6.prototype, "handleInput"), _class$6.prototype), _class$6);
var _class$5, _FormResolvedField;
var FormResolvedField = (_class$5 = (_FormResolvedField = class FormResolvedField extends Component {
	get rawValue() {
		return readResolvedFormFieldValue(this.args.field, this.args.model);
	}
	get textValue() {
		return this.rawValue == null ? "" : String(this.rawValue);
	}
	get numberValue() {
		return typeof this.rawValue === "number" ? this.rawValue : this.textValue;
	}
	get booleanValue() {
		return Boolean(this.rawValue);
	}
	get isEmail() {
		return this.args.field.kind === "email";
	}
	get isNumber() {
		return this.args.field.kind === "number";
	}
	get isBoolean() {
		return this.args.field.kind === "boolean";
	}
	get isReadonly() {
		return this.args.mode === "view" || this.args.field.readonly === true;
	}
	get isDisabled() {
		return this.args.field.disabled === true;
	}
	get isBooleanDisabled() {
		return this.isDisabled || this.args.mode === "view";
	}
	updateText(value) {
		if (this.isReadonly || this.isDisabled) return;
		this.args.field.onInput?.(value);
		if (!this.args.field.onInput) writeResolvedFormFieldValue(this.args.field, this.args.model, value);
	}
	updateNumber(value) {
		if (this.isReadonly || this.isDisabled) return;
		this.args.field.onInput?.(value);
		if (this.args.field.onInput) return;
		let nextValue = value;
		if (typeof this.rawValue === "number" && value !== "") nextValue = Number(value);
		writeResolvedFormFieldValue(this.args.field, this.args.model, nextValue);
	}
	updateBoolean(value) {
		if (this.isBooleanDisabled) return;
		this.args.field.onChange?.(value);
		if (!this.args.field.onChange) writeResolvedFormFieldValue(this.args.field, this.args.model, value);
	}
}, setComponentTemplate(precompileTemplate("{{#if this.isBoolean}}\n  <SwitchCell @label={{@field.label}} @description={{@field.description}} @value={{this.booleanValue}} @disabled={{this.isBooleanDisabled}} @onChange={{this.updateBoolean}} ...attributes />\n{{else}}\n  <FormField @label={{@field.label}} @required={{@field.required}} @optional={{@field.optional}} @helperText={{@field.helperText}} @errorMessage={{@field.errorMessage}} @state={{@field.state}} @disabled={{this.isDisabled}} @readonly={{this.isReadonly}} ...attributes>\n    {{#if this.isEmail}}\n      <EmailCell @value={{this.textValue}} @placeholder={{@field.placeholder}} @disabled={{this.isDisabled}} @readonly={{this.isReadonly}} @onInput={{this.updateText}} />\n    {{else if this.isNumber}}\n      <NumberCell @value={{this.numberValue}} @placeholder={{@field.placeholder}} @disabled={{this.isDisabled}} @readonly={{this.isReadonly}} @min={{@field.min}} @max={{@field.max}} @step={{@field.step}} @prefix={{@field.prefix}} @suffix={{@field.suffix}} @onInput={{this.updateNumber}} />\n    {{else}}\n      <TextCell @value={{this.textValue}} @placeholder={{@field.placeholder}} @disabled={{this.isDisabled}} @readonly={{this.isReadonly}} @multiline={{@field.multiline}} @type={{@field.inputType}} @autocomplete={{@field.autocomplete}} @prefix={{@field.prefix}} @suffix={{@field.suffix}} @onInput={{this.updateText}} />\n    {{/if}}\n  </FormField>\n{{/if}}", {
	strictMode: true,
	scope: () => ({
		SwitchCell,
		FormField,
		EmailCell,
		NumberCell,
		TextCell
	})
}), _FormResolvedField), _FormResolvedField), _applyDecoratedDescriptor$1(_class$5.prototype, "updateText", [action], Object.getOwnPropertyDescriptor(_class$5.prototype, "updateText"), _class$5.prototype), _applyDecoratedDescriptor$1(_class$5.prototype, "updateNumber", [action], Object.getOwnPropertyDescriptor(_class$5.prototype, "updateNumber"), _class$5.prototype), _applyDecoratedDescriptor$1(_class$5.prototype, "updateBoolean", [action], Object.getOwnPropertyDescriptor(_class$5.prototype, "updateBoolean"), _class$5.prototype), _class$5);
var _FormBody;
var FormBody = class extends Component {
	get hasHeader() {
		return Boolean(this.args.heading || this.args.description);
	}
	get hasErrors() {
		return Boolean(this.args.errors?.length);
	}
	get hasResolvedFields() {
		return this.args.resolvedFields.length > 0;
	}
};
_FormBody = FormBody;
setComponentTemplate(precompileTemplate("{{#if @hasHeaderBlock}}\n  <header class=\"bx-form__header\">{{yield to=\"header\"}}</header>\n{{else if this.hasHeader}}\n  {{#if @isFieldset}}\n    {{#if @heading}}<legend class=\"bx-form__heading\">{{@heading}}</legend>{{/if}}\n  {{/if}}\n  <header class=\"bx-form__header\" data-bx-form-header-fieldset={{if @isFieldset \"true\"}}>\n    {{#if @heading}}\n      {{#unless @isFieldset}}<h2 class=\"bx-form__heading\">{{@heading}}</h2>{{/unless}}\n    {{/if}}\n    {{#if @description}}<p class=\"bx-form__description\">{{@description}}</p>{{/if}}\n  </header>\n{{/if}}\n\n{{#if this.hasErrors}}\n  <FormAlert @type=\"error\">\n    <:messages>\n      {{#each @errors as |error|}}\n        <p>{{error}}</p>\n      {{/each}}\n    </:messages>\n  </FormAlert>\n{{/if}}\n\n{{#if @helperText}}<p class=\"bx-form__helper\">{{@helperText}}</p>{{/if}}\n\n<div class=\"bx-form__fields\">\n  {{#if @hasDefaultBlock}}\n    {{yield}}\n  {{else if this.hasResolvedFields}}\n    {{#each @resolvedFields as |field|}}\n      <FormResolvedField @field={{field}} @model={{@model}} @mode={{@mode}} />\n    {{/each}}\n  {{else}}\n    {{#each-in @fields as |key Field|}}\n      <FormField @label={{@labelFor key}}>\n        <Field />\n      </FormField>\n    {{/each-in}}\n  {{/if}}\n</div>\n\n{{#if @hasFooterBlock}}\n  <footer class=\"bx-form__footer\">{{yield to=\"footer\"}}</footer>\n{{/if}}", {
	strictMode: true,
	scope: () => ({
		FormAlert,
		FormResolvedField,
		FormField
	})
}), _FormBody);
var _Form;
var Form = class extends Component {
	get tag() {
		return this.args.tag ?? (this.variant === "standalone" ? "form" : "fieldset");
	}
	get variant() {
		return this.args.variant ?? "embedded";
	}
	get density() {
		return this.args.density ?? "comfortable";
	}
	get layout() {
		return this.args.layout ?? "vertical";
	}
	get mode() {
		return this.args.mode ?? "edit";
	}
	get columns() {
		return this.args.columns ?? 1;
	}
	get hasHeader() {
		return Boolean(this.args.heading || this.args.description);
	}
	get hasErrors() {
		return Boolean(this.args.errors?.length);
	}
	get isFieldset() {
		return this.tag === "fieldset";
	}
	get rootClass() {
		return `bx-form bx-form--${this.density} bx-form--${this.layout}`;
	}
	get fields() {
		return this.args.fields ?? {};
	}
	get resolvedFields() {
		return resolveFormFields(this.args.resolvedFields, this.labelFor.bind(this));
	}
	get bodyArgs() {
		return {
			description: this.args.description,
			errors: this.args.errors,
			fields: this.fields,
			heading: this.args.heading,
			helperText: this.args.helperText,
			labelFor: this.labelFor.bind(this),
			layout: this.layout,
			mode: this.mode
		};
	}
	labelFor(key) {
		return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
	}
};
_Form = Form;
setComponentTemplate(precompileTemplate("{{#let (element this.tag) as |Tag|}}\n  <Tag class={{this.rootClass}} data-bx-form data-bx-form-columns={{this.columns}} data-bx-form-density={{this.density}} data-bx-form-layout={{this.layout}} data-bx-form-mode={{this.mode}} data-bx-form-variant={{this.variant}} ...attributes>\n    <FormBody @description={{@description}} @errors={{@errors}} @fields={{this.fields}} @hasDefaultBlock={{has-block}} @hasFooterBlock={{has-block \"footer\"}} @hasHeaderBlock={{has-block \"header\"}} @heading={{@heading}} @helperText={{@helperText}} @isFieldset={{this.isFieldset}} @labelFor={{this.bodyArgs.labelFor}} @layout={{this.layout}} @mode={{this.mode}} @model={{@model}} @resolvedFields={{this.resolvedFields}}>\n      <:header>{{yield to=\"header\"}}</:header>\n      <:default>{{yield}}</:default>\n      <:footer>{{yield to=\"footer\"}}</:footer>\n    </FormBody>\n  </Tag>\n{{/let}}\n\n<style scoped>\n  .bx-form {\n    --bx-form-gap: var(--boxel-sp-lg);\n    --bx-form-padding: var(--boxel-sp-xl);\n    --hr-color: color-mix(in oklch, var(--border) 82%, transparent);\n\n    display: grid;\n    gap: var(--bx-form-gap);\n    padding: var(--bx-form-padding);\n    border: 0;\n    border-radius: var(--boxel-border-radius);\n    background: var(--background);\n    color: var(--foreground);\n  }\n\n  .bx-form--compact {\n    --bx-form-gap: var(--boxel-sp-sm);\n    --bx-form-padding: var(--boxel-sp);\n    --boxel-form-control-height: calc(var(--boxel-sp) * 2);\n    --boxel-input-height: calc(var(--boxel-sp) * 2);\n  }\n\n  .bx-form__header {\n    display: grid;\n    gap: var(--boxel-sp-2xs);\n    padding-bottom: var(--boxel-sp);\n    border-bottom: 1px solid var(--hr-color);\n  }\n\n  .bx-form__heading {\n    margin: 0;\n    font-family: var(--boxel-section-heading-font-family);\n    font-size: var(--boxel-section-heading-font-size);\n    font-weight: var(--boxel-section-heading-font-weight);\n    line-height: var(--boxel-section-heading-line-height);\n  }\n\n  .bx-form__description,\n  .bx-form__helper {\n    margin: 0;\n    color: var(--muted-foreground);\n    font-family: var(--boxel-body-font-family);\n    font-size: var(--boxel-body-font-size);\n    line-height: var(--boxel-body-line-height);\n  }\n\n  .bx-form__fields {\n    display: grid;\n    gap: var(--bx-form-gap);\n  }\n\n  .bx-form[data-bx-form-columns=\"2\"] > .bx-form__fields {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n\n  .bx-form[data-bx-form-columns=\"3\"] > .bx-form__fields {\n    grid-template-columns: repeat(3, minmax(0, 1fr));\n  }\n\n  .bx-form__footer {\n    display: flex;\n    flex-wrap: wrap;\n    gap: var(--boxel-sp-xs);\n    justify-content: flex-end;\n    padding-top: var(--boxel-sp);\n    border-top: 1px solid var(--hr-color);\n  }\n</style>", {
	strictMode: true,
	scope: () => ({
		element,
		FormBody
	})
}), _Form);
var _class$4 = (_FormSection = class FormSection extends Component {
	constructor(...args) {
		super(...args);
		_initializerDefineProperty$1(this, "openOverride", _descriptor$4, this);
	}
	get columns() {
		return this.args.columns ?? 1;
	}
	get isOpen() {
		if (!this.args.collapsible) return true;
		return this.openOverride ?? this.args.defaultOpen ?? true;
	}
	toggle() {
		if (!this.args.collapsible) return;
		this.openOverride = !this.isOpen;
	}
}, setComponentTemplate(precompileTemplate("<section class=\"bx-form-section\" data-bx-form-section data-bx-form-section-columns={{this.columns}} data-bx-form-section-collapsible={{if @collapsible \"true\"}} data-bx-form-section-open={{if this.isOpen \"true\" \"false\"}} ...attributes>\n  <header class=\"bx-form-section__header\">\n    <div class=\"bx-form-section__copy\">\n      {{#if @collapsible}}\n        <button class=\"bx-form-section__trigger\" type=\"button\" aria-expanded={{if this.isOpen \"true\" \"false\"}} {{on \"click\" this.toggle}}>\n          <span class=\"bx-form-section__chevron\" aria-hidden=\"true\"></span>\n          <span>{{@heading}}</span>\n        </button>\n      {{else}}\n        <h3 class=\"bx-form-section__heading\">{{@heading}}</h3>\n      {{/if}}\n      {{#if @description}}\n        <p class=\"bx-form-section__description\">{{@description}}</p>\n      {{/if}}\n    </div>\n    {{#if (has-block \"actions\")}}\n      <div class=\"bx-form-section__actions\">{{yield to=\"actions\"}}</div>\n    {{/if}}\n  </header>\n\n  {{#if this.isOpen}}\n    <div class=\"bx-form-section__fields\">\n      {{yield}}\n    </div>\n  {{/if}}\n</section>\n\n<style scoped>\n  .bx-form-section {\n    display: grid;\n    grid-column: 1 / -1;\n    gap: var(--boxel-sp-sm);\n    min-width: 0;\n    padding-block: var(--boxel-sp-sm);\n    border-block-start: 1px solid var(--hr-color);\n    container-type: inline-size;\n    container-name: bx-form-section;\n  }\n\n  .bx-form-section:first-child {\n    padding-block-start: 0;\n    border-block-start: 0;\n  }\n\n  .bx-form-section__header {\n    display: grid;\n    grid-template-columns: minmax(0, 1fr) auto;\n    gap: var(--boxel-sp-sm);\n    align-items: start;\n    min-width: 0;\n  }\n\n  .bx-form-section__copy {\n    display: grid;\n    gap: var(--boxel-sp-4xs);\n    min-width: 0;\n  }\n\n  .bx-form-section__heading,\n  .bx-form-section__description {\n    margin: 0;\n  }\n\n  .bx-form-section__heading,\n  .bx-form-section__trigger {\n    color: var(--foreground);\n    font-family: var(--boxel-subheading-font-family);\n    font-size: var(--boxel-subheading-font-size);\n    font-weight: var(--boxel-subheading-font-weight);\n    line-height: var(--boxel-subheading-line-height);\n  }\n\n  .bx-form-section__description {\n    color: var(--muted-foreground);\n    font-size: var(--boxel-caption-font-size);\n    line-height: var(--boxel-caption-line-height);\n  }\n\n  .bx-form-section__trigger {\n    display: inline-flex;\n    align-items: center;\n    gap: var(--boxel-sp-xs);\n    width: fit-content;\n    min-width: 0;\n    padding: 0;\n    border: 0;\n    background: transparent;\n    cursor: pointer;\n  }\n\n  .bx-form-section__trigger:focus {\n    outline: 0;\n    box-shadow: 0 0 0 var(--boxel-sp-5xs) var(--ring);\n  }\n\n  .bx-form-section__chevron {\n    width: var(--boxel-sp-xs);\n    height: var(--boxel-sp-xs);\n    border-inline-end: 2px solid currentColor;\n    border-block-end: 2px solid currentColor;\n    transform: rotate(-45deg);\n    transition: transform var(--boxel-transition);\n  }\n\n  .bx-form-section[data-bx-form-section-open=\"true\"] .bx-form-section__chevron {\n    transform: rotate(45deg);\n  }\n\n  .bx-form-section__actions {\n    display: flex;\n    flex-wrap: wrap;\n    gap: var(--boxel-sp-xs);\n  }\n\n  .bx-form-section__fields {\n    display: grid;\n    gap: var(--boxel-sp-sm);\n    min-width: 0;\n  }\n\n  .bx-form-section[data-bx-form-section-columns=\"2\"] .bx-form-section__fields {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n\n  .bx-form-section[data-bx-form-section-columns=\"3\"] .bx-form-section__fields {\n    grid-template-columns: repeat(3, minmax(0, 1fr));\n  }\n\n  @container bx-form-section (max-width: 42rem) {\n    .bx-form-section__header,\n    .bx-form-section[data-bx-form-section-columns=\"2\"] .bx-form-section__fields,\n    .bx-form-section[data-bx-form-section-columns=\"3\"] .bx-form-section__fields {\n      grid-template-columns: 1fr;\n    }\n  }\n</style>", {
	strictMode: true,
	scope: () => ({ on })
}), _FormSection), _FormSection), _descriptor$4 = _applyDecoratedDescriptor$1(_class$4.prototype, "openOverride", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _FormSection;
_applyDecoratedDescriptor$1(_class$4.prototype, "toggle", [action], Object.getOwnPropertyDescriptor(_class$4.prototype, "toggle"), _class$4.prototype);
var _class$3, _descriptor$3, _descriptor2$3, _FormTabs;
var FormTabsContextName = "boxel-surface:form-tabs";
var FormTabRegisterEventName = "bx-form-tab-register";
_class$3 = (_FormTabs = class FormTabs extends Component {
	constructor(...args) {
		super(...args);
		_initializerDefineProperty$1(this, "tabs", _descriptor$3, this);
		_initializerDefineProperty$1(this, "activeOverride", _descriptor2$3, this);
		_defineProperty(this, "tabUpdaters", /* @__PURE__ */ new Map());
		_defineProperty(this, "registerTab", (tab, updateActiveId) => {
			let existingIndex = this.tabs.findIndex((candidate) => candidate.id === tab.id);
			if (existingIndex === -1) this.tabs = [...this.tabs, tab];
			else this.tabs = this.tabs.map((candidate, index) => index === existingIndex ? tab : candidate);
			if (updateActiveId) this.tabUpdaters.set(tab.id, updateActiveId);
			this.syncPanels();
			return () => {
				this.tabs = this.tabs.filter((candidate) => candidate.id !== tab.id);
				this.tabUpdaters.delete(tab.id);
				if (this.activeOverride === tab.id) this.activeOverride = void 0;
				this.syncPanels();
			};
		});
	}
	get activeId() {
		return this.activeOverride ?? this.args.activeTab ?? this.args.defaultTab ?? this.tabs.find((tab) => !tab.disabled)?.id ?? this.tabs[0]?.id;
	}
	syncPanels() {
		for (let update of this.tabUpdaters.values()) update(this.activeId);
	}
	get context() {
		return {
			activeId: this.activeId,
			register: this.registerTab
		};
	}
	select(id) {
		let tab = this.tabs.find((candidate) => candidate.id === id);
		if (!tab || tab.disabled) return;
		this.activeOverride = id;
		this.syncPanels();
		this.args.onChange?.(id);
	}
	selectFromEvent(event) {
		let id = event.currentTarget.dataset["bxFormTabId"];
		if (!id) return;
		this.select(id);
	}
	registerFromEvent(event) {
		let detail = event.detail;
		if (!detail) return;
		event.stopPropagation();
		let unregister = this.registerTab(detail.tab, detail.updateActiveId);
		detail.setUnregister(unregister);
	}
}, setComponentTemplate(precompileTemplate("<div class=\"bx-form-tabs\" data-bx-form-tabs {{on FormTabRegisterEventName this.registerFromEvent}} ...attributes>\n  <div class=\"bx-form-tabs__list\" role=\"tablist\">\n    {{#each this.tabs as |tab|}}\n      <button id={{tab.tabId}} class=\"bx-form-tabs__tab\" type=\"button\" role=\"tab\" aria-selected={{if (eq tab.id this.activeId) \"true\" \"false\"}} aria-controls={{tab.panelId}} disabled={{tab.disabled}} data-bx-form-tab-active={{if (eq tab.id this.activeId) \"true\" \"false\"}} data-bx-form-tab-id={{tab.id}} {{on \"click\" this.selectFromEvent}}>\n        {{tab.label}}\n      </button>\n    {{/each}}\n  </div>\n\n  <div class=\"bx-form-tabs__panels\">\n    {{yield}}\n  </div>\n</div>\n\n<style scoped>\n  .bx-form-tabs {\n    display: grid;\n    gap: var(--boxel-sp);\n    min-width: 0;\n    container-type: inline-size;\n    container-name: bx-form-tabs;\n  }\n\n  .bx-form-tabs__list {\n    display: flex;\n    flex-wrap: wrap;\n    gap: var(--boxel-sp-4xs);\n    border-block-end: 1px solid var(--border);\n  }\n\n  .bx-form-tabs__tab {\n    position: relative;\n    min-width: 0;\n    padding: var(--boxel-sp-xs) var(--boxel-sp-sm);\n    border: 0;\n    border-radius: var(--boxel-border-radius-sm) var(--boxel-border-radius-sm) 0 0;\n    background: transparent;\n    color: var(--muted-foreground);\n    font: inherit;\n    font-weight: var(--boxel-subheading-font-weight);\n    cursor: pointer;\n  }\n\n  .bx-form-tabs__tab::after {\n    position: absolute;\n    inset-inline: var(--boxel-sp-xs);\n    inset-block-end: calc(var(--boxel-sp-6xs) * -1);\n    height: var(--boxel-sp-4xs);\n    border-radius: var(--boxel-border-radius-xs);\n    background: transparent;\n    content: \"\";\n  }\n\n  .bx-form-tabs__tab[data-bx-form-tab-active=\"true\"] {\n    background: var(--card);\n    color: var(--card-foreground);\n  }\n\n  .bx-form-tabs__tab[data-bx-form-tab-active=\"true\"]::after {\n    background: var(--ring);\n  }\n\n  .bx-form-tabs__tab:focus {\n    outline: 0;\n    box-shadow: 0 0 0 var(--boxel-sp-5xs) var(--ring);\n  }\n\n  .bx-form-tabs__tab:disabled {\n    color: var(--muted-foreground);\n    cursor: not-allowed;\n    opacity: 0.6;\n  }\n\n  .bx-form-tabs__panels {\n    display: grid;\n    min-width: 0;\n  }\n\n  @container bx-form-tabs (max-width: 32rem) {\n    .bx-form-tabs__list {\n      display: grid;\n      grid-template-columns: 1fr;\n      border-block-end: 0;\n    }\n\n    .bx-form-tabs__tab {\n      border-radius: var(--boxel-border-radius-sm);\n      text-align: start;\n    }\n\n    .bx-form-tabs__tab::after {\n      inset-inline: auto var(--boxel-sp-xs);\n      inset-block: var(--boxel-sp-xs);\n      width: var(--boxel-sp-4xs);\n      height: auto;\n    }\n  }\n</style>", {
	strictMode: true,
	scope: () => ({
		on,
		FormTabRegisterEventName,
		eq
	})
}), _FormTabs), _FormTabs), _descriptor$3 = _applyDecoratedDescriptor$1(_class$3.prototype, "tabs", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return [];
	}
}), _descriptor2$3 = _applyDecoratedDescriptor$1(_class$3.prototype, "activeOverride", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _applyDecoratedDescriptor$1(_class$3.prototype, "select", [action], Object.getOwnPropertyDescriptor(_class$3.prototype, "select"), _class$3.prototype), _applyDecoratedDescriptor$1(_class$3.prototype, "selectFromEvent", [action], Object.getOwnPropertyDescriptor(_class$3.prototype, "selectFromEvent"), _class$3.prototype), _applyDecoratedDescriptor$1(_class$3.prototype, "registerFromEvent", [action], Object.getOwnPropertyDescriptor(_class$3.prototype, "registerFromEvent"), _class$3.prototype);
var _dec$1 = consume(FormTabsContextName), _class$2 = (_FormTab = class FormTab extends Component {
	constructor(...args) {
		super(...args);
		_defineProperty(this, "guid", guidFor(this));
		_initializerDefineProperty$1(this, "eventActiveId", _descriptor$2, this);
		_initializerDefineProperty$1(this, "tabs", _descriptor2$2, this);
		_defineProperty(this, "register", modifier((el) => {
			let tab = {
				id: this.id,
				label: this.args.label,
				tabId: this.tabId,
				panelId: this.panelId,
				disabled: this.args.disabled
			};
			let contextUnregister = this.tabs?.register(tab);
			if (contextUnregister) return contextUnregister;
			let unregister;
			let cancelled = false;
			queueMicrotask(() => {
				if (cancelled) return;
				el.dispatchEvent(new CustomEvent(FormTabRegisterEventName, {
					bubbles: true,
					detail: {
						tab,
						updateActiveId: (id) => {
							this.eventActiveId = id;
						},
						setUnregister: (next) => {
							unregister = next;
						}
					}
				}));
			});
			return () => {
				cancelled = true;
				unregister?.();
			};
		}));
	}
	get id() {
		return this.args.id ?? this.guid;
	}
	get tabId() {
		return `bx-form-tab-${this.guid}`;
	}
	get panelId() {
		return `bx-form-tab-panel-${this.guid}`;
	}
	get isActive() {
		return (this.tabs?.activeId ?? this.eventActiveId) === this.id;
	}
}, setComponentTemplate(precompileTemplate("<div id={{this.panelId}} class=\"bx-form-tab\" role=\"tabpanel\" aria-labelledby={{this.tabId}} hidden={{if (eq this.isActive true) false true}} data-bx-form-tab-panel={{this.id}} data-bx-form-tab-panel-active={{if this.isActive \"true\" \"false\"}} {{this.register}} ...attributes>\n  {{#if this.isActive}}\n    {{yield}}\n  {{/if}}\n</div>\n\n<style scoped>\n  .bx-form-tab {\n    min-width: 0;\n  }\n</style>", {
	strictMode: true,
	scope: () => ({ eq })
}), _FormTab), _FormTab), _descriptor$2 = _applyDecoratedDescriptor$1(_class$2.prototype, "eventActiveId", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor2$2 = _applyDecoratedDescriptor$1(_class$2.prototype, "tabs", [_dec$1], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _FormTab;
var _class$1, _descriptor$1, _descriptor2$1, _FormWizard;
var FormWizardContextName = "boxel-surface:form-wizard";
var FormStepRegisterEventName = "bx-form-step-register";
_class$1 = (_FormWizard = class FormWizard extends Component {
	constructor(...args) {
		super(...args);
		_initializerDefineProperty$1(this, "steps", _descriptor$1, this);
		_initializerDefineProperty$1(this, "activeOverride", _descriptor2$1, this);
		_defineProperty(this, "stepUpdaters", /* @__PURE__ */ new Map());
		_defineProperty(this, "registerStep", (step, updateActiveId) => {
			let existingIndex = this.steps.findIndex((candidate) => candidate.id === step.id);
			if (existingIndex === -1) this.steps = [...this.steps, step];
			else this.steps = this.steps.map((candidate, index) => index === existingIndex ? step : candidate);
			if (updateActiveId) this.stepUpdaters.set(step.id, updateActiveId);
			this.syncPanels();
			return () => {
				this.steps = this.steps.filter((candidate) => candidate.id !== step.id);
				this.stepUpdaters.delete(step.id);
				if (this.activeOverride === step.id) this.activeOverride = void 0;
				this.syncPanels();
			};
		});
	}
	get activeId() {
		return this.activeOverride ?? this.args.activeStep ?? this.args.defaultStep ?? this.steps.find((step) => !step.disabled)?.id ?? this.steps[0]?.id;
	}
	get activeIndex() {
		return this.steps.findIndex((step) => step.id === this.activeId);
	}
	get activeStep() {
		return this.steps[this.activeIndex];
	}
	get isFirst() {
		return this.activeIndex <= 0;
	}
	get isLast() {
		return this.activeIndex >= this.steps.length - 1;
	}
	get canAdvance() {
		return this.activeStep?.canAdvance !== false;
	}
	get nextLabel() {
		return this.args.nextLabel ?? "Continue";
	}
	get previousLabel() {
		return this.args.previousLabel ?? "Back";
	}
	get finishLabel() {
		return this.args.finishLabel ?? "Finish";
	}
	syncPanels() {
		for (let update of this.stepUpdaters.values()) update(this.activeId);
	}
	get context() {
		return {
			activeId: this.activeId,
			register: this.registerStep
		};
	}
	select(id) {
		let nextIndex = this.steps.findIndex((step) => step.id === id);
		let step = this.steps[nextIndex];
		if (!step || step.disabled) return;
		if (nextIndex > this.activeIndex && !this.canAdvance) return;
		this.activeOverride = id;
		this.syncPanels();
		this.args.onStepChange?.(id);
	}
	selectFromEvent(event) {
		let id = event.currentTarget.dataset["bxFormWizardStepId"];
		if (!id) return;
		this.select(id);
	}
	previous() {
		if (this.isFirst) return;
		let step = this.steps[this.activeIndex - 1];
		if (!step || step.disabled) return;
		this.activeOverride = step.id;
		this.syncPanels();
		this.args.onStepChange?.(step.id);
	}
	next() {
		if (!this.canAdvance) return;
		if (this.isLast) {
			this.args.onFinish?.();
			return;
		}
		let step = this.steps[this.activeIndex + 1];
		if (!step || step.disabled) return;
		this.activeOverride = step.id;
		this.syncPanels();
		this.args.onStepChange?.(step.id);
	}
	registerFromEvent(event) {
		let detail = event.detail;
		if (!detail) return;
		event.stopPropagation();
		let unregister = this.registerStep(detail.step, detail.updateActiveId);
		detail.setUnregister(unregister);
	}
}, setComponentTemplate(precompileTemplate("<div class=\"bx-form-wizard\" data-bx-form-wizard {{on FormStepRegisterEventName this.registerFromEvent}} ...attributes>\n  <ol class=\"bx-form-wizard__steps\">\n    {{#each this.steps as |step index|}}\n      <li class=\"bx-form-wizard__step-item\">\n        <button id={{step.stepId}} class=\"bx-form-wizard__step\" type=\"button\" aria-current={{if (eq step.id this.activeId) \"step\"}} aria-controls={{step.panelId}} disabled={{step.disabled}} data-bx-form-wizard-step-active={{if (eq step.id this.activeId) \"true\" \"false\"}} data-bx-form-wizard-step-complete={{if (lt index this.activeIndex) \"true\" \"false\"}} data-bx-form-wizard-step-id={{step.id}} {{on \"click\" this.selectFromEvent}}>\n          <span class=\"bx-form-wizard__step-index\">{{add index 1}}</span>\n          <span class=\"bx-form-wizard__step-label\">{{step.label}}</span>\n        </button>\n      </li>\n    {{/each}}\n  </ol>\n\n  <div class=\"bx-form-wizard__panels\">\n    {{yield}}\n  </div>\n\n  {{#if (has-block \"footer\")}}\n    <div class=\"bx-form-wizard__footer\">{{yield to=\"footer\"}}</div>\n  {{else}}\n    <div class=\"bx-form-wizard__footer\">\n      <button class=\"bx-form-wizard__button bx-form-wizard__button--secondary\" type=\"button\" disabled={{this.isFirst}} {{on \"click\" this.previous}}>\n        {{this.previousLabel}}\n      </button>\n      <button class=\"bx-form-wizard__button bx-form-wizard__button--primary\" type=\"button\" disabled={{if this.canAdvance false true}} {{on \"click\" this.next}}>\n        {{if this.isLast this.finishLabel this.nextLabel}}\n      </button>\n    </div>\n  {{/if}}\n</div>\n\n<style scoped>\n  .bx-form-wizard {\n    display: grid;\n    gap: var(--boxel-sp);\n    min-width: 0;\n    container-type: inline-size;\n    container-name: bx-form-wizard;\n  }\n\n  .bx-form-wizard__steps {\n    display: grid;\n    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));\n    gap: var(--boxel-sp-xs);\n    padding: 0;\n    margin: 0;\n    list-style: none;\n  }\n\n  .bx-form-wizard__step {\n    display: grid;\n    grid-template-columns: auto minmax(0, 1fr);\n    align-items: center;\n    width: 100%;\n    gap: var(--boxel-sp-xs);\n    padding: var(--boxel-sp-xs);\n    border: 1px solid var(--border);\n    border-radius: var(--boxel-border-radius-sm);\n    background: var(--card);\n    color: var(--card-foreground);\n    font: inherit;\n    text-align: start;\n    cursor: pointer;\n  }\n\n  .bx-form-wizard__step[data-bx-form-wizard-step-active=\"true\"] {\n    border-color: var(--ring);\n    box-shadow: 0 0 0 var(--boxel-sp-5xs) var(--ring);\n  }\n\n  .bx-form-wizard__step[data-bx-form-wizard-step-complete=\"true\"] {\n    background: var(--secondary);\n    color: var(--secondary-foreground);\n  }\n\n  .bx-form-wizard__step:focus {\n    outline: 0;\n    box-shadow: 0 0 0 var(--boxel-sp-5xs) var(--ring);\n  }\n\n  .bx-form-wizard__step:disabled {\n    color: var(--muted-foreground);\n    cursor: not-allowed;\n    opacity: 0.6;\n  }\n\n  .bx-form-wizard__step-index {\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    min-width: calc(var(--boxel-sp) + var(--boxel-sp-xs));\n    height: calc(var(--boxel-sp) + var(--boxel-sp-xs));\n    border-radius: var(--boxel-border-radius-xs);\n    background: var(--muted);\n    color: var(--muted-foreground);\n    font-size: var(--boxel-caption-font-size);\n    font-weight: var(--boxel-section-heading-font-weight);\n  }\n\n  .bx-form-wizard__step-label {\n    min-width: 0;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n  }\n\n  .bx-form-wizard__panels {\n    min-width: 0;\n  }\n\n  .bx-form-wizard__footer {\n    display: flex;\n    flex-wrap: wrap;\n    justify-content: flex-end;\n    gap: var(--boxel-sp-xs);\n    padding-block-start: var(--boxel-sp-sm);\n    border-block-start: 1px solid var(--hr-color);\n  }\n\n  .bx-form-wizard__button {\n    min-height: var(--boxel-form-control-height);\n    padding-inline: var(--boxel-sp);\n    border: 1px solid var(--border);\n    border-radius: var(--boxel-border-radius-sm);\n    font: inherit;\n    font-weight: var(--boxel-subheading-font-weight);\n    cursor: pointer;\n  }\n\n  .bx-form-wizard__button--primary {\n    background: var(--primary);\n    color: var(--primary-foreground);\n  }\n\n  .bx-form-wizard__button--secondary {\n    background: var(--secondary);\n    color: var(--secondary-foreground);\n  }\n\n  .bx-form-wizard__button:focus {\n    outline: 0;\n    box-shadow: 0 0 0 var(--boxel-sp-5xs) var(--ring);\n  }\n\n  .bx-form-wizard__button:disabled {\n    color: var(--muted-foreground);\n    cursor: not-allowed;\n    opacity: 0.6;\n  }\n\n  @container bx-form-wizard (max-width: 36rem) {\n    .bx-form-wizard__steps {\n      grid-template-columns: 1fr;\n    }\n  }\n</style>", {
	strictMode: true,
	scope: () => ({
		on,
		FormStepRegisterEventName,
		eq,
		lt,
		add
	})
}), _FormWizard), _FormWizard), _descriptor$1 = _applyDecoratedDescriptor$1(_class$1.prototype, "steps", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return [];
	}
}), _descriptor2$1 = _applyDecoratedDescriptor$1(_class$1.prototype, "activeOverride", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _applyDecoratedDescriptor$1(_class$1.prototype, "select", [action], Object.getOwnPropertyDescriptor(_class$1.prototype, "select"), _class$1.prototype), _applyDecoratedDescriptor$1(_class$1.prototype, "selectFromEvent", [action], Object.getOwnPropertyDescriptor(_class$1.prototype, "selectFromEvent"), _class$1.prototype), _applyDecoratedDescriptor$1(_class$1.prototype, "previous", [action], Object.getOwnPropertyDescriptor(_class$1.prototype, "previous"), _class$1.prototype), _applyDecoratedDescriptor$1(_class$1.prototype, "next", [action], Object.getOwnPropertyDescriptor(_class$1.prototype, "next"), _class$1.prototype), _applyDecoratedDescriptor$1(_class$1.prototype, "registerFromEvent", [action], Object.getOwnPropertyDescriptor(_class$1.prototype, "registerFromEvent"), _class$1.prototype);
var _dec$5 = consume(FormWizardContextName), _class$10 = (_FormStep = class FormStep extends Component {
	constructor(...args) {
		super(...args);
		_defineProperty(this, "guid", guidFor(this));
		_initializerDefineProperty$1(this, "eventActiveId", _descriptor$10, this);
		_initializerDefineProperty$1(this, "wizard", _descriptor2$8, this);
		_defineProperty(this, "register", modifier((el) => {
			let step = {
				id: this.id,
				label: this.args.label,
				stepId: this.stepId,
				panelId: this.panelId,
				disabled: this.args.disabled,
				canAdvance: this.args.canAdvance
			};
			let contextUnregister = this.wizard?.register(step);
			if (contextUnregister) return contextUnregister;
			let unregister;
			let cancelled = false;
			queueMicrotask(() => {
				if (cancelled) return;
				el.dispatchEvent(new CustomEvent(FormStepRegisterEventName, {
					bubbles: true,
					detail: {
						step,
						updateActiveId: (id) => {
							this.eventActiveId = id;
						},
						setUnregister: (next) => {
							unregister = next;
						}
					}
				}));
			});
			return () => {
				cancelled = true;
				unregister?.();
			};
		}));
	}
	get id() {
		return this.args.id ?? this.guid;
	}
	get stepId() {
		return `bx-form-step-${this.guid}`;
	}
	get panelId() {
		return `bx-form-step-panel-${this.guid}`;
	}
	get isActive() {
		return (this.wizard?.activeId ?? this.eventActiveId) === this.id;
	}
}, setComponentTemplate(precompileTemplate("<section id={{this.panelId}} class=\"bx-form-step\" aria-labelledby={{this.stepId}} hidden={{if (eq this.isActive true) false true}} data-bx-form-step-panel={{this.id}} data-bx-form-step-panel-active={{if this.isActive \"true\" \"false\"}} {{this.register}} ...attributes>\n  {{#if this.isActive}}\n    {{yield}}\n  {{/if}}\n</section>\n\n<style scoped>\n  .bx-form-step {\n    min-width: 0;\n  }\n</style>", {
	strictMode: true,
	scope: () => ({ eq })
}), _FormStep), _FormStep), _descriptor$10 = _applyDecoratedDescriptor$1(_class$10.prototype, "eventActiveId", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor2$8 = _applyDecoratedDescriptor$1(_class$10.prototype, "wizard", [_dec$5], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _FormStep;
//#endregion
//#region packages/boxel-layout/dist/index.js
function _applyDecoratedDescriptor(i, e, r, n, l) {
	var a = {};
	return Object.keys(n).forEach(function(i) {
		a[i] = n[i];
	}), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = true), a = r.slice().reverse().reduce(function(r, n) {
		return n(i, e, r) || r;
	}, a), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a;
}
function _initializerDefineProperty(e, i, r, l) {
	r && Object.defineProperty(e, i, {
		enumerable: r.enumerable,
		configurable: r.configurable,
		writable: r.writable,
		value: r.initializer ? r.initializer.call(l) : void 0
	});
}
var _dec, _dec2, _class, _descriptor, _descriptor2, _Layout;
var Layout = (_dec = consume(InspectContextName), _dec2 = consume(ModeContextName), _class = (_Layout = class Layout extends Component {
	constructor(...args) {
		super(...args);
		_initializerDefineProperty(this, "inheritedInspect", _descriptor, this);
		_initializerDefineProperty(this, "inheritedMode", _descriptor2, this);
	}
	get preset() {
		return this.args.preset ?? "page";
	}
	get rootClass() {
		return ["boxel-layout", `boxel-layout--${this.preset}`].join(" ");
	}
	get inspect() {
		const mode = this.args.mode ?? this.inheritedMode;
		return this.args.inspect ?? this.inheritedInspect ?? mode === "inspect";
	}
	get runtimePolicy() {
		const policy = { ...this.args.runtimePolicy ?? {} };
		if (!this.inspect) policy.adornments = {
			focus: "none",
			selection: "none",
			source: "none",
			context: "none",
			hover: "none",
			inspect: "none",
			...policy.adornments ?? {}
		};
		return Object.keys(policy).length > 0 ? policy : void 0;
	}
	get target() {
		return this.args.target ?? (this.inspect ? void 0 : "structure");
	}
}, setComponentTemplate(precompileTemplate("<FoundationLayout class={{this.rootClass}} data-bx-layout-preset={{this.preset}} @id={{@id}} @focusKey={{@focusKey}} @surfacePath={{@surfacePath}} @space={{@space}} @model={{@model}} @field={{@field}} @fields={{@fields}} @schema={{@schema}} @coord={{@coord}} @identity={{@identity}} @key={{@key}} @identityPart={{@identityPart}} @tag={{@tag}} @inline={{@inline}} @role={{@role}} @pattern={{@pattern}} @preset={{this.preset}} @aspects={{@aspects}} @runtimePolicy={{this.runtimePolicy}} @runtimeTraversal={{@runtimeTraversal}} @runtimeTraversalModel={{@runtimeTraversalModel}} @runtimeSelection={{@runtimeSelection}} @runtimeKeyboard={{@runtimeKeyboard}} @runtimeMovement={{@runtimeMovement}} @runtimePointer={{@runtimePointer}} @runtimeEdit={{@runtimeEdit}} @accepts={{@accepts}} @payloadType={{@payloadType}} @scope={{@scope}} @depth={{@depth}} @expanded={{@expanded}} @onSelect={{@onSelect}} @onActivate={{@onActivate}} @scrollOnSelect={{@scrollOnSelect}} @scrollTarget={{@scrollTarget}} @scrollAnchor={{@scrollAnchor}} @hoverSignal={{@hoverSignal}} @hoverAnchor={{@hoverAnchor}} @onExpand={{@onExpand}} @onCollapse={{@onCollapse}} @demo={{@demo}} @posture={{@posture}} @mode={{@mode}} @inspect={{@inspect}} @changeRoute={{@changeRoute}} @target={{this.target}} @targetScope={{@targetScope}} @coordinateSpace={{@coordinateSpace}} @at={{@at}} @change={{@change}} @lift={{@lift}} @liftData={{@liftData}} @inlineEdit={{@inlineEdit}} @editValue={{@editValue}} @editLabel={{@editLabel}} @editMultiline={{@editMultiline}} @onEditInput={{@onEditInput}} ...attributes>\n  {{yield}}\n</FoundationLayout>\n\n<style scoped>\n  :where(.boxel-layout) {\n    box-sizing: border-box;\n    min-width: 0;\n    color: var(--boxel-layout-fg, inherit);\n  }\n\n  :where(.boxel-layout > [data-surface-component]) {\n    min-width: 0;\n  }\n\n  :where(.boxel-layout--bare) {\n    display: revert;\n    width: revert;\n    margin: revert;\n    padding: revert;\n  }\n\n  :where(.boxel-layout--page) {\n    display: grid;\n    width: min(100%, var(--boxel-layout-max-inline-size, 72rem));\n    margin-inline: auto;\n    padding: var(--boxel-layout-padding, clamp(1.25rem, 4vw, 2.5rem));\n    gap: var(--boxel-layout-gap, 1.5rem);\n  }\n\n  :where(.boxel-layout--page > [data-surface-component]) {\n    display: grid;\n    gap: var(--boxel-layout-block-gap, 0.75rem);\n  }\n\n  :where(.boxel-layout--notebook) {\n    display: grid;\n    width: 100%;\n    padding: var(--boxel-layout-padding, 1rem);\n    gap: var(--boxel-layout-gap, 0.875rem);\n    background: var(--boxel-layout-bg, #f8fafc);\n  }\n\n  :where(.boxel-layout--notebook > [data-surface-component]) {\n    display: grid;\n    gap: var(--boxel-layout-block-gap, 0.5rem);\n    padding-block: var(--boxel-layout-block-padding, 0.625rem);\n    border-top: 1px solid var(--boxel-layout-divider, #e2e8f0);\n  }\n\n  :where(.boxel-layout--notebook > [data-surface-component]:first-child) {\n    border-top: 0;\n    padding-top: 0;\n  }\n\n  :where(.boxel-layout--tools) {\n    display: grid;\n    width: 100%;\n    align-content: start;\n    gap: var(--boxel-layout-gap, 0.625rem);\n    padding: var(--boxel-layout-padding, 0.75rem);\n    border: 1px solid var(--boxel-layout-border, #d1d5db);\n    border-radius: var(--boxel-layout-radius, 8px);\n    background: var(--boxel-layout-bg, #f9fafb);\n  }\n\n  :where(.boxel-layout--tools > [data-surface-component]) {\n    display: grid;\n    gap: var(--boxel-layout-block-gap, 0.375rem);\n    padding-block: var(--boxel-layout-block-padding, 0.375rem);\n    border-bottom: 1px solid var(--boxel-layout-divider, #e5e7eb);\n  }\n\n  :where(.boxel-layout--tools > [data-surface-component]:last-child) {\n    border-bottom: 0;\n    padding-bottom: 0;\n  }\n</style>", {
	strictMode: true,
	scope: () => ({ FoundationLayout: Layout$1 })
}), _Layout), _Layout), _descriptor = _applyDecoratedDescriptor(_class.prototype, "inheritedInspect", [_dec], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "inheritedMode", [_dec2], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _class);
//#endregion
export { Layout };
