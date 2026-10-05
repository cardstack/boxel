import { Resource } from "ember-modify-based-class-resource";
import { cached, tracked } from "@glimmer/tracking";
import { registerDestructor } from "@ember/destroyable";
import { scheduleOnce } from "@ember/runloop";
import Component from "@glimmer/component";
import ContextProvider from "ember-provide-consume-context/components/context-provider";
import { precompileTemplate } from "@ember/template-compilation";
import { setComponentTemplate } from "@ember/component";
import { modifier } from "ember-modifier";
import { action } from "@ember/object";
import { on } from "@ember/modifier";
import { concat, fn, hash } from "@ember/helper";
import { add, element, eq, lt } from "@cardstack/boxel-ui/helpers";
import { ExclamationCircle, FailureBordered, LoadingIndicator, SuccessBordered, Warning } from "@cardstack/boxel-ui/icons";
import { guidFor } from "@ember/object/internals";
import { consume, provide } from "ember-provide-consume-context";
import { autoUpdate, computePosition, flip, hide, offset, shift } from "@floating-ui/dom";
import { htmlSafe } from "@ember/template";
import templateOnly from "@ember/component/template-only";
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/utils.js
function functionalUpdate(updater, input) {
	return typeof updater === "function" ? updater(input) : updater;
}
function cloneState(value) {
	if (Array.isArray(value)) return value.map(cloneState);
	if (value && typeof value === "object") {
		const proto = Object.getPrototypeOf(value);
		if (proto !== Object.prototype && proto !== null) return value;
		const copy = {};
		for (const key of Object.keys(value)) copy[key] = cloneState(value[key]);
		return copy;
	}
	return value;
}
function noop() {}
function makeStateUpdater(key, instance) {
	return (updater) => {
		var _atoms;
		(((_atoms = instance.options.atoms) === null || _atoms === void 0 ? void 0 : _atoms[key]) ?? instance.baseAtoms[key]).set((old) => functionalUpdate(updater, old));
	};
}
function isFunction(d) {
	return d instanceof Function;
}
function isNumberArray(d) {
	return Array.isArray(d) && d.every((val) => typeof val === "number");
}
function flattenBy(arr, getChildren) {
	const flat = [];
	const recurse = (subArr) => {
		subArr.forEach((item) => {
			flat.push(item);
			const children = getChildren(item);
			if (children.length) recurse(children);
		});
	};
	recurse(arr);
	return flat;
}
var $internalMemoFnMeta = Symbol("memoFnMeta");
/**
* @internal
*/
function setMemoFnMeta(fn, meta) {
	Object.defineProperty(fn, $internalMemoFnMeta, { value: meta });
}
/**
* @internal
*/
function getMemoFnMeta(fn) {
	return (typeof fn === "function" && fn[$internalMemoFnMeta]) ?? null;
}
var memo = ({ fn, memoDeps, onAfterCompare, onAfterUpdate, onBeforeCompare, onBeforeUpdate }) => {
	let deps = [];
	let result;
	const memoizedFn = (depArgs) => {
		onBeforeCompare === null || onBeforeCompare === void 0 || onBeforeCompare();
		const newDeps = memoDeps === null || memoDeps === void 0 ? void 0 : memoDeps(depArgs);
		const depsChanged = !newDeps || newDeps.length !== (deps === null || deps === void 0 ? void 0 : deps.length) || newDeps.some((dep, index) => (deps === null || deps === void 0 ? void 0 : deps[index]) !== dep);
		onAfterCompare === null || onAfterCompare === void 0 || onAfterCompare(depsChanged);
		if (!depsChanged) return result;
		deps = newDeps;
		onBeforeUpdate === null || onBeforeUpdate === void 0 || onBeforeUpdate();
		result = fn(...newDeps ?? []);
		onAfterUpdate === null || onAfterUpdate === void 0 || onAfterUpdate(result);
		return result;
	};
	setMemoFnMeta(memoizedFn, { originalArgsLength: fn.length });
	return memoizedFn;
};
var pad = (str, num) => {
	str = String(str);
	while (str.length < num) str = " " + str;
	return str;
};
function tableMemo({ feature, fnName, objectId, onAfterUpdate, table, ...memoOptions }) {
	let beforeCompareTime;
	let afterCompareTime;
	let startCalcTime;
	let endCalcTime;
	let runCount = 0;
	let debug;
	let debugCache;
	if (process.env.NODE_ENV === "development") {
		const { debugCache: _debugCache, debugAll } = table.options;
		debugCache = _debugCache;
		const { parentName } = getFunctionNameInfo(fnName, ".");
		debug = debugAll || table.options[`debug${(parentName != "table" ? parentName + "s" : parentName).replace(parentName, parentName.charAt(0).toUpperCase() + parentName.slice(1))}`] || (feature ? table.options[`debug${feature.charAt(0).toUpperCase() + feature.slice(1)}`] : false);
	}
	function logTime(time, depsChanged) {
		var _memoOptions$memoDeps;
		const runType = runCount === 0 ? "(1st run)" : depsChanged ? "(rerun #" + runCount + ")" : "(cache)";
		runCount++;
		console.groupCollapsed(`%c⏱ ${pad(`${time.toFixed(1)} ms`, 12)} %c${runType}%c ${fnName}%c ${objectId ? `(${fnName.split(".")[0]}Id: ${objectId})` : ""}`, `font-size: .6rem; font-weight: bold; ${depsChanged ? `color: hsl(
        ${Math.max(0, Math.min(120 - Math.log10(time) * 60, 120))}deg 100% 31%);` : ""} `, `color: ${runCount < 2 ? "#FF00FF" : "#FF1493"}`, "color: #666", "color: #87CEEB");
		console.info({
			feature,
			state: table.store.state,
			deps: (_memoOptions$memoDeps = memoOptions.memoDeps) === null || _memoOptions$memoDeps === void 0 ? void 0 : _memoOptions$memoDeps.toString()
		});
		console.trace();
		console.groupEnd();
	}
	const debugOptions = process.env.NODE_ENV === "development" ? {
		onBeforeCompare: () => {
			if (debugCache) beforeCompareTime = performance.now();
		},
		onAfterCompare: (depsChanged) => {
			if (debugCache) {
				afterCompareTime = performance.now();
				const compareTime = Math.round((afterCompareTime - beforeCompareTime) * 100) / 100;
				if (!depsChanged) logTime(compareTime, depsChanged);
			}
		},
		onBeforeUpdate: () => {
			if (debug) startCalcTime = performance.now();
		},
		onAfterUpdate: () => {
			if (debug) {
				endCalcTime = performance.now();
				logTime(Math.round((endCalcTime - startCalcTime) * 100) / 100, true);
			}
			queueMicrotask(() => onAfterUpdate === null || onAfterUpdate === void 0 ? void 0 : onAfterUpdate());
		}
	} : { onAfterUpdate: () => {
		queueMicrotask(() => onAfterUpdate === null || onAfterUpdate === void 0 ? void 0 : onAfterUpdate());
	} };
	return memo({
		...memoOptions,
		...debugOptions
	});
}
/**
* Assumes that a function name is in the format of `parentName_fnKey` and returns the `fnKey` and `fnName` in the format of `parentName.fnKey`.
*/
function getFunctionNameInfo(staticFnName, splitBy = "_") {
	const [parentName, fnKey] = staticFnName.split(splitBy);
	return {
		fnKey,
		fnName: `${parentName}.${fnKey}`,
		parentName
	};
}
/**
* Assigns Table API methods directly to the table instance.
* Unlike row/cell/column/header, the table is a singleton so methods are assigned directly.
*/
function assignTableAPIs(feature, table, apis) {
	for (const [staticFnName, { fn, memoDeps }] of Object.entries(apis)) {
		const { fnKey, fnName } = getFunctionNameInfo(staticFnName);
		table[fnKey] = memoDeps ? tableMemo({
			memoDeps,
			fn,
			fnName,
			table,
			feature
		}) : fn;
	}
}
/**
* Assigns API methods to a prototype object for memory-efficient method sharing.
* All instances created with this prototype will share the same method references.
*
* For memoized methods, the memo state is lazily created and stored on each instance.
* This provides the best of both worlds: shared method code + per-instance caching.
*/
function assignPrototypeAPIs(feature, prototype, table, apis) {
	for (const [staticFnName, { fn, memoDeps }] of Object.entries(apis)) {
		const { fnKey, fnName } = getFunctionNameInfo(staticFnName);
		if (memoDeps) {
			const memoKey = `_memo_${fnKey}`;
			prototype[fnKey] = function(...args) {
				if (!this[memoKey]) {
					const self = this;
					this[memoKey] = tableMemo({
						memoDeps: () => memoDeps(self),
						fn: (...deps) => fn(self, ...deps),
						fnName,
						objectId: self.id,
						table,
						feature
					});
				}
				return this[memoKey](...args);
			};
		} else prototype[fnKey] = function(...args) {
			return fn(this, ...args);
		};
		setMemoFnMeta(prototype[fnKey], { originalArgsLength: fn.length });
	}
}
/**
* Looks to run the memoized function with the builder pattern on the object if it exists, otherwise fallback to the static method passed in.
*/
function callMemoOrStaticFn(obj, fnKey, staticFn, ...args) {
	var _obj$fnKey;
	return ((_obj$fnKey = obj[fnKey]) === null || _obj$fnKey === void 0 ? void 0 : _obj$fnKey.call(obj, ...args)) ?? staticFn(obj, ...args);
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/core/cells/coreCellsFeature.utils.js
function cell_getValue(cell) {
	return cell.row.getValue(cell.column.id);
}
function cell_renderValue(cell) {
	return cell.getValue() ?? cell.table.options.renderFallbackValue;
}
function cell_getContext(cell) {
	return {
		table: cell.table,
		column: cell.column,
		row: cell.row,
		cell,
		getValue: () => cell.getValue(),
		renderValue: () => cell.renderValue()
	};
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/core/cells/coreCellsFeature.js
function constructCoreCellsFeature() {
	return { assignCellPrototype: (prototype, table) => {
		assignPrototypeAPIs("coreCellsFeature", prototype, table, {
			cell_getValue: { fn: (cell) => cell_getValue(cell) },
			cell_renderValue: { fn: (cell) => cell_renderValue(cell) },
			cell_getContext: {
				fn: (cell) => cell_getContext(cell),
				memoDeps: (cell) => [cell]
			}
		});
	} };
}
/**
* The Core Cells feature provides the core cell functionality.
*/
var coreCellsFeature = constructCoreCellsFeature();
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/core/headers/constructHeader.js
/**
* Creates or retrieves the header prototype for a table.
* The prototype is cached on the table and shared by all header instances.
*/
function getHeaderPrototype(table) {
	if (!table._headerPrototype) {
		table._headerPrototype = { table };
		for (const feature of Object.values(table._features)) {
			var _feature$assignHeader;
			(_feature$assignHeader = feature.assignHeaderPrototype) === null || _feature$assignHeader === void 0 || _feature$assignHeader.call(feature, table._headerPrototype, table);
		}
	}
	return table._headerPrototype;
}
function constructHeader(table, column, options) {
	const headerPrototype = getHeaderPrototype(table);
	const header = Object.create(headerPrototype);
	header.colSpan = 0;
	header.column = column;
	header.depth = options.depth;
	header.headerGroup = null;
	header.id = options.id ?? column.id;
	header.index = options.index;
	header.isPlaceholder = !!options.isPlaceholder;
	header.placeholderId = options.placeholderId;
	header.rowSpan = 0;
	header.subHeaders = [];
	return header;
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-visibility/columnVisibilityFeature.utils.js
function getDefaultColumnVisibilityState() {
	return {};
}
function column_toggleVisibility(column, visible) {
	if (column_getCanHide(column)) table_setColumnVisibility(column.table, (old) => ({
		...old,
		[column.id]: visible ?? !callMemoOrStaticFn(column, "getIsVisible", column_getIsVisible)
	}));
}
function column_getIsVisible(column) {
	var _column$table$atoms$c;
	const childColumns = column.columns;
	return (childColumns.length ? childColumns.some((childColumn) => callMemoOrStaticFn(childColumn, "getIsVisible", column_getIsVisible)) : (_column$table$atoms$c = column.table.atoms.columnVisibility) === null || _column$table$atoms$c === void 0 || (_column$table$atoms$c = _column$table$atoms$c.get()) === null || _column$table$atoms$c === void 0 ? void 0 : _column$table$atoms$c[column.id]) ?? true;
}
function column_getCanHide(column) {
	return (column.columnDef.enableHiding ?? true) && (column.table.options.enableHiding ?? true);
}
function column_getToggleVisibilityHandler(column) {
	return (e) => {
		column_toggleVisibility(column, e.target.checked);
	};
}
function row_getAllVisibleCells(row) {
	return row.getAllCells().filter((cell) => callMemoOrStaticFn(cell.column, "getIsVisible", column_getIsVisible));
}
function row_getVisibleCells(left, center, right) {
	return [
		...left,
		...center,
		...right
	];
}
function table_getVisibleFlatColumns(table) {
	return table.getAllFlatColumns().filter((column) => callMemoOrStaticFn(column, "getIsVisible", column_getIsVisible));
}
function table_getVisibleLeafColumns(table) {
	return table.getAllLeafColumns().filter((column) => callMemoOrStaticFn(column, "getIsVisible", column_getIsVisible));
}
function table_setColumnVisibility(table, updater) {
	var _table$options$onColu, _table$options;
	(_table$options$onColu = (_table$options = table.options).onColumnVisibilityChange) === null || _table$options$onColu === void 0 || _table$options$onColu.call(_table$options, updater);
}
function table_resetColumnVisibility(table, defaultState) {
	table_setColumnVisibility(table, defaultState ? {} : cloneState(table.initialState.columnVisibility ?? {}));
}
function table_toggleAllColumnsVisible(table, value) {
	value = value ?? !table_getIsAllColumnsVisible(table);
	table_setColumnVisibility(table, table.getAllLeafColumns().reduce((obj, column) => ({
		...obj,
		[column.id]: !value ? !column_getCanHide(column) : value
	}), {}));
}
function table_getIsAllColumnsVisible(table) {
	return !table.getAllLeafColumns().some((column) => !callMemoOrStaticFn(column, "getIsVisible", column_getIsVisible));
}
function table_getIsSomeColumnsVisible(table) {
	return table.getAllLeafColumns().some((column) => callMemoOrStaticFn(column, "getIsVisible", column_getIsVisible));
}
function table_getToggleAllColumnsVisibilityHandler(table) {
	return (e) => {
		table_toggleAllColumnsVisible(table, e.target.checked);
	};
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/core/headers/buildHeaderGroups.js
function buildHeaderGroups(allColumns, columnsToGroup, table, headerFamily) {
	var _headerGroups$;
	let maxDepth = 0;
	const findMaxDepth = (columns, depth = 1) => {
		maxDepth = Math.max(maxDepth, depth);
		columns.filter((column) => callMemoOrStaticFn(column, "getIsVisible", column_getIsVisible)).forEach((column) => {
			if (column.columns.length) findMaxDepth(column.columns, depth + 1);
		}, 0);
	};
	findMaxDepth(allColumns);
	const headerGroups = [];
	const constructHeaderGroup = (headersToGroup, depth) => {
		const headerGroup = {
			depth,
			id: [headerFamily, `${depth}`].filter(Boolean).join("_"),
			headers: []
		};
		const pendingParentHeaders = [];
		headersToGroup.forEach((headerToGroup) => {
			const latestPendingParentHeader = [...pendingParentHeaders].reverse()[0];
			const isLeafHeader = headerToGroup.column.depth === headerGroup.depth;
			let column;
			let isPlaceholder = false;
			if (isLeafHeader && headerToGroup.column.parent) column = headerToGroup.column.parent;
			else {
				column = headerToGroup.column;
				isPlaceholder = true;
			}
			if (latestPendingParentHeader && latestPendingParentHeader.column === column) latestPendingParentHeader.subHeaders.push(headerToGroup);
			else {
				const header = constructHeader(table, column, {
					id: [
						headerFamily,
						depth,
						column.id,
						headerToGroup.id
					].filter(Boolean).join("_"),
					isPlaceholder,
					placeholderId: isPlaceholder ? `${pendingParentHeaders.filter((d) => d.column === column).length}` : void 0,
					depth,
					index: pendingParentHeaders.length
				});
				header.subHeaders.push(headerToGroup);
				pendingParentHeaders.push(header);
			}
			headerGroup.headers.push(headerToGroup);
			headerToGroup.headerGroup = headerGroup;
		});
		headerGroups.push(headerGroup);
		if (depth > 0) constructHeaderGroup(pendingParentHeaders, depth - 1);
	};
	constructHeaderGroup(columnsToGroup.map((column, index) => constructHeader(table, column, {
		depth: maxDepth,
		index
	})), maxDepth - 1);
	headerGroups.reverse();
	const recurseHeadersForSpans = (headers) => {
		return headers.filter((header) => callMemoOrStaticFn(header.column, "getIsVisible", column_getIsVisible)).map((header) => {
			let colSpan = 0;
			let rowSpan = 0;
			let childRowSpans = [0];
			if (header.subHeaders.length) {
				childRowSpans = [];
				recurseHeadersForSpans(header.subHeaders).forEach(({ colSpan: childColSpan, rowSpan: childRowSpan }) => {
					colSpan += childColSpan;
					childRowSpans.push(childRowSpan);
				});
			} else colSpan = 1;
			const minChildRowSpan = Math.min(...childRowSpans);
			rowSpan = rowSpan + minChildRowSpan;
			header.colSpan = colSpan;
			header.rowSpan = rowSpan;
			return {
				colSpan,
				rowSpan
			};
		});
	};
	recurseHeadersForSpans(((_headerGroups$ = headerGroups[0]) === null || _headerGroups$ === void 0 ? void 0 : _headerGroups$.headers) ?? []);
	return headerGroups;
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/core/columns/constructColumn.js
/**
* Creates or retrieves the column prototype for a table.
* The prototype is cached on the table and shared by all column instances.
*/
function getColumnPrototype(table) {
	if (!table._columnPrototype) {
		table._columnPrototype = { table };
		for (const feature of Object.values(table._features)) {
			var _feature$assignColumn;
			(_feature$assignColumn = feature.assignColumnPrototype) === null || _feature$assignColumn === void 0 || _feature$assignColumn.call(feature, table._columnPrototype, table);
		}
	}
	return table._columnPrototype;
}
function constructColumn(table, columnDef, depth, parent) {
	const resolvedColumnDef = {
		...table.getDefaultColumnDef(),
		...columnDef
	};
	const accessorKey = resolvedColumnDef.accessorKey;
	const id = resolvedColumnDef.id ?? (accessorKey ? accessorKey.replaceAll(".", "_") : void 0) ?? (typeof resolvedColumnDef.header === "string" ? resolvedColumnDef.header : void 0);
	let accessorFn;
	if (resolvedColumnDef.accessorFn) accessorFn = resolvedColumnDef.accessorFn;
	else if (accessorKey) if (accessorKey.includes(".")) accessorFn = (originalRow) => {
		let result = originalRow;
		for (const key of accessorKey.split(".")) {
			result = result === null || result === void 0 ? void 0 : result[key];
			if (process.env.NODE_ENV === "development" && result === void 0) console.warn(`"${key}" in deeply nested key "${accessorKey}" returned undefined.`);
		}
		return result;
	};
	else accessorFn = (originalRow) => originalRow[resolvedColumnDef.accessorKey];
	if (!id) {
		if (process.env.NODE_ENV === "development") throw new Error(resolvedColumnDef.accessorFn ? `coreColumnsFeature require an id when using an accessorFn` : `coreColumnsFeature require an id when using a non-string header`);
		throw new Error();
	}
	const columnPrototype = getColumnPrototype(table);
	const column = Object.create(columnPrototype);
	column.accessorFn = accessorFn;
	column.columnDef = resolvedColumnDef;
	column.columns = [];
	column.depth = depth;
	column.id = `${String(id)}`;
	column.parent = parent;
	return column;
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-pinning/columnPinningFeature.utils.js
function getDefaultColumnPinningState() {
	return {
		left: [],
		right: []
	};
}
function column_pin(column, position) {
	const columnIds = column.getLeafColumns().map((d) => d.id).filter(Boolean);
	table_setColumnPinning(column.table, (old) => {
		if (position === "right") return {
			left: old.left.filter((d) => !columnIds.includes(d)),
			right: [...old.right.filter((d) => !columnIds.includes(d)), ...columnIds]
		};
		if (position === "left") return {
			left: [...old.left.filter((d) => !columnIds.includes(d)), ...columnIds],
			right: old.right.filter((d) => !columnIds.includes(d))
		};
		return {
			left: old.left.filter((d) => !columnIds.includes(d)),
			right: old.right.filter((d) => !columnIds.includes(d))
		};
	});
}
function column_getCanPin(column) {
	return column.getLeafColumns().some((leafColumn) => (leafColumn.columnDef.enablePinning ?? true) && (column.table.options.enableColumnPinning ?? true));
}
function column_getIsPinned(column) {
	var _column$table$atoms$c;
	const leafColumnIds = column.getLeafColumns().map((d) => d.id);
	const { left, right } = ((_column$table$atoms$c = column.table.atoms.columnPinning) === null || _column$table$atoms$c === void 0 ? void 0 : _column$table$atoms$c.get()) ?? getDefaultColumnPinningState();
	const isLeft = leafColumnIds.some((d) => left.includes(d));
	const isRight = leafColumnIds.some((d) => right.includes(d));
	return isLeft ? "left" : isRight ? "right" : false;
}
function column_getPinnedIndex(column) {
	var _column$table$atoms$c2;
	const position = column_getIsPinned(column);
	return position ? ((_column$table$atoms$c2 = column.table.atoms.columnPinning) === null || _column$table$atoms$c2 === void 0 || (_column$table$atoms$c2 = _column$table$atoms$c2.get()) === null || _column$table$atoms$c2 === void 0 ? void 0 : _column$table$atoms$c2[position].indexOf(column.id)) ?? -1 : 0;
}
function row_getCenterVisibleCells(row) {
	var _row$table$atoms$colu;
	const allCells = callMemoOrStaticFn(row, "getAllVisibleCells", row_getAllVisibleCells);
	const { left, right } = ((_row$table$atoms$colu = row.table.atoms.columnPinning) === null || _row$table$atoms$colu === void 0 ? void 0 : _row$table$atoms$colu.get()) ?? getDefaultColumnPinningState();
	const leftAndRight = [...left, ...right];
	return allCells.filter((d) => !leftAndRight.includes(d.column.id));
}
function row_getLeftVisibleCells(row) {
	var _row$table$atoms$colu2;
	const allCells = callMemoOrStaticFn(row, "getAllVisibleCells", row_getAllVisibleCells);
	const { left } = ((_row$table$atoms$colu2 = row.table.atoms.columnPinning) === null || _row$table$atoms$colu2 === void 0 ? void 0 : _row$table$atoms$colu2.get()) ?? getDefaultColumnPinningState();
	const cells = left.map((columnId) => allCells.find((cell) => cell.column.id === columnId)).filter(Boolean);
	cells.forEach((cell) => {
		cell.position = "left";
	});
	return cells;
}
function row_getRightVisibleCells(row) {
	var _row$table$atoms$colu3;
	const allCells = callMemoOrStaticFn(row, "getAllVisibleCells", row_getAllVisibleCells);
	const { right } = ((_row$table$atoms$colu3 = row.table.atoms.columnPinning) === null || _row$table$atoms$colu3 === void 0 ? void 0 : _row$table$atoms$colu3.get()) ?? getDefaultColumnPinningState();
	const cells = right.map((columnId) => allCells.find((cell) => cell.column.id === columnId)).filter(Boolean);
	cells.forEach((cell) => {
		cell.position = "right";
	});
	return cells;
}
function table_setColumnPinning(table, updater) {
	var _table$options$onColu, _table$options;
	(_table$options$onColu = (_table$options = table.options).onColumnPinningChange) === null || _table$options$onColu === void 0 || _table$options$onColu.call(_table$options, updater);
}
function table_resetColumnPinning(table, defaultState) {
	table_setColumnPinning(table, defaultState ? getDefaultColumnPinningState() : cloneState(table.initialState.columnPinning ?? getDefaultColumnPinningState()));
}
function table_getIsSomeColumnsPinned(table, position) {
	var _table$atoms$columnPi;
	const pinningState = (_table$atoms$columnPi = table.atoms.columnPinning) === null || _table$atoms$columnPi === void 0 ? void 0 : _table$atoms$columnPi.get();
	if (!position) return Boolean((pinningState === null || pinningState === void 0 ? void 0 : pinningState.left.length) || (pinningState === null || pinningState === void 0 ? void 0 : pinningState.right.length));
	return Boolean(pinningState === null || pinningState === void 0 ? void 0 : pinningState[position].length);
}
function table_getLeftHeaderGroups(table) {
	var _table$atoms$columnPi2;
	const allColumns = table.getAllColumns();
	const leafColumns = callMemoOrStaticFn(table, "getVisibleLeafColumns", table_getVisibleLeafColumns);
	const { left } = ((_table$atoms$columnPi2 = table.atoms.columnPinning) === null || _table$atoms$columnPi2 === void 0 ? void 0 : _table$atoms$columnPi2.get()) ?? getDefaultColumnPinningState();
	return buildHeaderGroups(allColumns, left.map((columnId) => leafColumns.find((d) => d.id === columnId)).filter(Boolean), table, "left");
}
function table_getRightHeaderGroups(table) {
	var _table$atoms$columnPi3;
	const allColumns = table.getAllColumns();
	const leafColumns = callMemoOrStaticFn(table, "getVisibleLeafColumns", table_getVisibleLeafColumns);
	const { right } = ((_table$atoms$columnPi3 = table.atoms.columnPinning) === null || _table$atoms$columnPi3 === void 0 ? void 0 : _table$atoms$columnPi3.get()) ?? getDefaultColumnPinningState();
	return buildHeaderGroups(allColumns, right.map((columnId) => leafColumns.find((d) => d.id === columnId)).filter(Boolean), table, "right");
}
function table_getCenterHeaderGroups(table) {
	var _table$atoms$columnPi4;
	const allColumns = table.getAllColumns();
	let leafColumns = callMemoOrStaticFn(table, "getVisibleLeafColumns", table_getVisibleLeafColumns);
	const { left, right } = ((_table$atoms$columnPi4 = table.atoms.columnPinning) === null || _table$atoms$columnPi4 === void 0 ? void 0 : _table$atoms$columnPi4.get()) ?? getDefaultColumnPinningState();
	const leftAndRight = [...left, ...right];
	leafColumns = leafColumns.filter((column) => !leftAndRight.includes(column.id));
	return buildHeaderGroups(allColumns, leafColumns, table, "center");
}
function table_getLeftFooterGroups(table) {
	return [...callMemoOrStaticFn(table, "getLeftHeaderGroups", table_getLeftHeaderGroups)].reverse();
}
function table_getRightFooterGroups(table) {
	return [...callMemoOrStaticFn(table, "getRightHeaderGroups", table_getRightHeaderGroups)].reverse();
}
function table_getCenterFooterGroups(table) {
	return [...callMemoOrStaticFn(table, "getCenterHeaderGroups", table_getCenterHeaderGroups)].reverse();
}
function table_getLeftFlatHeaders(table) {
	return callMemoOrStaticFn(table, "getLeftHeaderGroups", table_getLeftHeaderGroups).map((headerGroup) => {
		return headerGroup.headers;
	}).flat();
}
function table_getRightFlatHeaders(table) {
	return callMemoOrStaticFn(table, "getRightHeaderGroups", table_getRightHeaderGroups).map((headerGroup) => {
		return headerGroup.headers;
	}).flat();
}
function table_getCenterFlatHeaders(table) {
	return callMemoOrStaticFn(table, "getCenterHeaderGroups", table_getCenterHeaderGroups).map((headerGroup) => {
		return headerGroup.headers;
	}).flat();
}
function table_getLeftLeafHeaders(table) {
	return callMemoOrStaticFn(table, "getLeftFlatHeaders", table_getLeftFlatHeaders).filter((header) => !header.subHeaders.length);
}
function table_getRightLeafHeaders(table) {
	return callMemoOrStaticFn(table, "getRightFlatHeaders", table_getRightFlatHeaders).filter((header) => !header.subHeaders.length);
}
function table_getCenterLeafHeaders(table) {
	return callMemoOrStaticFn(table, "getCenterFlatHeaders", table_getCenterFlatHeaders).filter((header) => !header.subHeaders.length);
}
function table_getLeftLeafColumns(table) {
	var _table$atoms$columnPi5;
	const { left } = ((_table$atoms$columnPi5 = table.atoms.columnPinning) === null || _table$atoms$columnPi5 === void 0 ? void 0 : _table$atoms$columnPi5.get()) ?? getDefaultColumnPinningState();
	return left.map((columnId) => table.getAllLeafColumns().find((column) => column.id === columnId)).filter(Boolean);
}
function table_getRightLeafColumns(table) {
	var _table$atoms$columnPi6;
	const { right } = ((_table$atoms$columnPi6 = table.atoms.columnPinning) === null || _table$atoms$columnPi6 === void 0 ? void 0 : _table$atoms$columnPi6.get()) ?? getDefaultColumnPinningState();
	return right.map((columnId) => table.getAllLeafColumns().find((column) => column.id === columnId)).filter(Boolean);
}
function table_getCenterLeafColumns(table) {
	var _table$atoms$columnPi7;
	const { left, right } = ((_table$atoms$columnPi7 = table.atoms.columnPinning) === null || _table$atoms$columnPi7 === void 0 ? void 0 : _table$atoms$columnPi7.get()) ?? getDefaultColumnPinningState();
	const leftAndRight = [...left, ...right];
	return table.getAllLeafColumns().filter((d) => !leftAndRight.includes(d.id));
}
function table_getLeftVisibleLeafColumns(table) {
	return callMemoOrStaticFn(table, "getLeftLeafColumns", table_getLeftLeafColumns).filter((column) => callMemoOrStaticFn(column, "getIsVisible", column_getIsVisible));
}
function table_getRightVisibleLeafColumns(table) {
	return callMemoOrStaticFn(table, "getRightLeafColumns", table_getRightLeafColumns).filter((column) => callMemoOrStaticFn(column, "getIsVisible", column_getIsVisible));
}
function table_getCenterVisibleLeafColumns(table) {
	return callMemoOrStaticFn(table, "getCenterLeafColumns", table_getCenterLeafColumns).filter((column) => callMemoOrStaticFn(column, "getIsVisible", column_getIsVisible));
}
function table_getPinnedVisibleLeafColumns(table, position) {
	return !position ? callMemoOrStaticFn(table, "getVisibleLeafColumns", table_getVisibleLeafColumns) : position === "left" ? callMemoOrStaticFn(table, "getLeftVisibleLeafColumns", table_getLeftVisibleLeafColumns) : position === "right" ? callMemoOrStaticFn(table, "getRightVisibleLeafColumns", table_getRightVisibleLeafColumns) : callMemoOrStaticFn(table, "getCenterVisibleLeafColumns", table_getCenterVisibleLeafColumns);
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-ordering/columnOrderingFeature.utils.js
function getDefaultColumnOrderState() {
	return [];
}
function column_getIndex(column, position) {
	return table_getPinnedVisibleLeafColumns(column.table, position).findIndex((d) => d.id === column.id);
}
function column_getIsFirstColumn(column, position) {
	var _columns$;
	return ((_columns$ = table_getPinnedVisibleLeafColumns(column.table, position)[0]) === null || _columns$ === void 0 ? void 0 : _columns$.id) === column.id;
}
function column_getIsLastColumn(column, position) {
	var _columns;
	const columns = table_getPinnedVisibleLeafColumns(column.table, position);
	return ((_columns = columns[columns.length - 1]) === null || _columns === void 0 ? void 0 : _columns.id) === column.id;
}
function table_setColumnOrder(table, updater) {
	var _table$options$onColu, _table$options;
	(_table$options$onColu = (_table$options = table.options).onColumnOrderChange) === null || _table$options$onColu === void 0 || _table$options$onColu.call(_table$options, updater);
}
function table_resetColumnOrder(table, defaultState) {
	table_setColumnOrder(table, defaultState ? [] : cloneState(table.initialState.columnOrder ?? []));
}
function table_getOrderColumnsFn(table) {
	var _table$atoms$columnOr;
	const columnOrder = (_table$atoms$columnOr = table.atoms.columnOrder) === null || _table$atoms$columnOr === void 0 ? void 0 : _table$atoms$columnOr.get();
	return (columns) => {
		let orderedColumns = [];
		if (!(columnOrder === null || columnOrder === void 0 ? void 0 : columnOrder.length)) orderedColumns = columns;
		else {
			const columnOrderCopy = [...columnOrder];
			const columnsCopy = [...columns];
			while (columnsCopy.length && columnOrderCopy.length) {
				const targetColumnId = columnOrderCopy.shift();
				const foundIndex = columnsCopy.findIndex((d) => d.id === targetColumnId);
				if (foundIndex > -1) orderedColumns.push(columnsCopy.splice(foundIndex, 1)[0]);
			}
			orderedColumns = [...orderedColumns, ...columnsCopy];
		}
		return orderColumns(table, orderedColumns);
	};
}
function orderColumns(table, leafColumns) {
	var _table$atoms$grouping;
	const grouping = ((_table$atoms$grouping = table.atoms.grouping) === null || _table$atoms$grouping === void 0 ? void 0 : _table$atoms$grouping.get()) ?? [];
	const { groupedColumnMode } = table.options;
	if (!grouping.length || !groupedColumnMode) return leafColumns;
	const nonGroupingColumns = leafColumns.filter((col) => !grouping.includes(col.id));
	if (groupedColumnMode === "remove") return nonGroupingColumns;
	return [...grouping.map((g) => leafColumns.find((col) => col.id === g)).filter(Boolean), ...nonGroupingColumns];
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/core/columns/coreColumnsFeature.utils.js
function column_getFlatColumns(column) {
	return [column, ...column.columns.flatMap((col) => col.getFlatColumns())];
}
function column_getLeafColumns(column) {
	if (column.columns.length) {
		const leafColumns = column.columns.flatMap((col) => col.getLeafColumns());
		return callMemoOrStaticFn(column.table, "getOrderColumns", table_getOrderColumnsFn)(leafColumns);
	}
	return [column];
}
function table_getDefaultColumnDef(table) {
	return {
		header: (props) => {
			const resolvedColumnDef = props.header.column.columnDef;
			if (resolvedColumnDef.accessorKey) return resolvedColumnDef.accessorKey;
			if (resolvedColumnDef.accessorFn) return resolvedColumnDef.id;
			return null;
		},
		cell: (props) => {
			var _props$renderValue, _props$renderValue$to;
			return ((_props$renderValue = props.renderValue()) === null || _props$renderValue === void 0 || (_props$renderValue$to = _props$renderValue.toString) === null || _props$renderValue$to === void 0 ? void 0 : _props$renderValue$to.call(_props$renderValue)) ?? null;
		},
		...Object.values(table._features).reduce((obj, feature) => {
			var _feature$getDefaultCo;
			return Object.assign(obj, (_feature$getDefaultCo = feature.getDefaultColumnDef) === null || _feature$getDefaultCo === void 0 ? void 0 : _feature$getDefaultCo.call(feature));
		}, {}),
		...table.options.defaultColumn
	};
}
function table_getAllColumns(table) {
	const recurseColumns = (colDefs, parent, depth = 0) => {
		return colDefs.map((columnDef) => {
			const column = constructColumn(table, columnDef, depth, parent);
			const groupingColumnDef = columnDef;
			column.columns = groupingColumnDef.columns ? recurseColumns(groupingColumnDef.columns, column, depth + 1) : [];
			return column;
		});
	};
	return recurseColumns(table.options.columns);
}
function table_getAllFlatColumns(table) {
	return table.getAllColumns().flatMap((column) => column.getFlatColumns());
}
function table_getAllFlatColumnsById(table) {
	return table.getAllFlatColumns().reduce((acc, column) => {
		acc[column.id] = column;
		return acc;
	}, {});
}
function table_getAllLeafColumns(table) {
	const leafColumns = table.getAllColumns().flatMap((c) => c.getLeafColumns());
	return callMemoOrStaticFn(table, "getOrderColumns", table_getOrderColumnsFn)(leafColumns);
}
function table_getColumn(table, columnId) {
	const column = table.getAllFlatColumnsById()[columnId];
	if (process.env.NODE_ENV === "development" && !column) console.warn(`[Table] Column with id '${columnId}' does not exist.`);
	return column;
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/core/columns/coreColumnsFeature.js
function constructCoreColumnsFeature() {
	return {
		assignColumnPrototype: (prototype, table) => {
			assignPrototypeAPIs("coreColumnsFeature", prototype, table, {
				column_getFlatColumns: {
					fn: (column) => column_getFlatColumns(column),
					memoDeps: (column) => [column.table.options.columns]
				},
				column_getLeafColumns: {
					fn: (column) => column_getLeafColumns(column),
					memoDeps: (column) => {
						var _column$table$atoms$c, _column$table$atoms$g;
						return [
							(_column$table$atoms$c = column.table.atoms.columnOrder) === null || _column$table$atoms$c === void 0 ? void 0 : _column$table$atoms$c.get(),
							(_column$table$atoms$g = column.table.atoms.grouping) === null || _column$table$atoms$g === void 0 ? void 0 : _column$table$atoms$g.get(),
							column.table.options.columns,
							column.table.options.groupedColumnMode
						];
					}
				}
			});
		},
		constructTableAPIs: (table) => {
			assignTableAPIs("coreColumnsFeature", table, {
				table_getDefaultColumnDef: {
					fn: () => table_getDefaultColumnDef(table),
					memoDeps: () => [table.options.defaultColumn]
				},
				table_getAllColumns: {
					fn: () => table_getAllColumns(table),
					memoDeps: () => [table.options.columns]
				},
				table_getAllFlatColumns: {
					fn: () => table_getAllFlatColumns(table),
					memoDeps: () => [table.options.columns]
				},
				table_getAllFlatColumnsById: {
					fn: () => table_getAllFlatColumnsById(table),
					memoDeps: () => [table.options.columns]
				},
				table_getAllLeafColumns: {
					fn: () => table_getAllLeafColumns(table),
					memoDeps: () => {
						var _table$atoms$columnOr, _table$atoms$grouping;
						return [
							(_table$atoms$columnOr = table.atoms.columnOrder) === null || _table$atoms$columnOr === void 0 ? void 0 : _table$atoms$columnOr.get(),
							(_table$atoms$grouping = table.atoms.grouping) === null || _table$atoms$grouping === void 0 ? void 0 : _table$atoms$grouping.get(),
							table.options.columns,
							table.options.groupedColumnMode
						];
					}
				},
				table_getColumn: { fn: (columnId) => table_getColumn(table, columnId) }
			});
		}
	};
}
/**
* The Core Columns feature provides the core column functionality.
*/
var coreColumnsFeature = constructCoreColumnsFeature();
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/core/headers/coreHeadersFeature.utils.js
function header_getLeafHeaders(header) {
	const leafHeaders = [];
	const recurseHeader = (h) => {
		if (h.subHeaders.length) h.subHeaders.map(recurseHeader);
		leafHeaders.push(h);
	};
	recurseHeader(header);
	return leafHeaders;
}
function header_getContext(header) {
	return {
		column: header.column,
		header,
		table: header.column.table
	};
}
function table_getHeaderGroups(table) {
	var _table$atoms$columnPi;
	const { left, right } = ((_table$atoms$columnPi = table.atoms.columnPinning) === null || _table$atoms$columnPi === void 0 ? void 0 : _table$atoms$columnPi.get()) ?? getDefaultColumnPinningState();
	const allColumns = table.getAllColumns();
	const leafColumns = callMemoOrStaticFn(table, "getVisibleLeafColumns", table_getVisibleLeafColumns);
	const leftColumns = left.map((columnId) => leafColumns.find((d) => d.id === columnId)).filter(Boolean);
	const rightColumns = right.map((columnId) => leafColumns.find((d) => d.id === columnId)).filter(Boolean);
	const centerColumns = leafColumns.filter((column) => !left.includes(column.id) && !right.includes(column.id));
	return buildHeaderGroups(allColumns, [
		...leftColumns,
		...centerColumns,
		...rightColumns
	], table);
}
function table_getFooterGroups(table) {
	return [...table.getHeaderGroups()].reverse();
}
function table_getFlatHeaders(table) {
	return table.getHeaderGroups().map((headerGroup) => {
		return headerGroup.headers;
	}).flat();
}
function table_getLeafHeaders(table) {
	var _left$, _center$, _right$;
	const left = callMemoOrStaticFn(table, "getLeftHeaderGroups", table_getLeftHeaderGroups);
	const center = callMemoOrStaticFn(table, "getCenterHeaderGroups", table_getCenterHeaderGroups);
	const right = callMemoOrStaticFn(table, "getRightHeaderGroups", table_getRightHeaderGroups);
	return [
		...((_left$ = left[0]) === null || _left$ === void 0 ? void 0 : _left$.headers) ?? [],
		...((_center$ = center[0]) === null || _center$ === void 0 ? void 0 : _center$.headers) ?? [],
		...((_right$ = right[0]) === null || _right$ === void 0 ? void 0 : _right$.headers) ?? []
	].map((header) => {
		return header.getLeafHeaders();
	}).flat();
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/core/headers/coreHeadersFeature.js
function constructCoreHeadersFeature() {
	return {
		assignHeaderPrototype: (prototype, table) => {
			assignPrototypeAPIs("coreHeadersFeature", prototype, table, {
				header_getLeafHeaders: {
					fn: (header) => header_getLeafHeaders(header),
					memoDeps: (header) => [header.column.table.options.columns]
				},
				header_getContext: {
					fn: (header) => header_getContext(header),
					memoDeps: (header) => [header.column.table.options.columns]
				}
			});
		},
		constructTableAPIs: (table) => {
			assignTableAPIs("coreHeadersFeature", table, {
				table_getHeaderGroups: {
					fn: () => table_getHeaderGroups(table),
					memoDeps: () => {
						var _table$atoms$columnOr, _table$atoms$grouping, _table$atoms$columnPi, _table$atoms$columnVi;
						return [
							table.options.columns,
							(_table$atoms$columnOr = table.atoms.columnOrder) === null || _table$atoms$columnOr === void 0 ? void 0 : _table$atoms$columnOr.get(),
							(_table$atoms$grouping = table.atoms.grouping) === null || _table$atoms$grouping === void 0 ? void 0 : _table$atoms$grouping.get(),
							(_table$atoms$columnPi = table.atoms.columnPinning) === null || _table$atoms$columnPi === void 0 ? void 0 : _table$atoms$columnPi.get(),
							(_table$atoms$columnVi = table.atoms.columnVisibility) === null || _table$atoms$columnVi === void 0 ? void 0 : _table$atoms$columnVi.get(),
							table.options.groupedColumnMode
						];
					}
				},
				table_getFooterGroups: {
					fn: () => table_getFooterGroups(table),
					memoDeps: () => [table.getHeaderGroups()]
				},
				table_getFlatHeaders: {
					fn: () => table_getFlatHeaders(table),
					memoDeps: () => [table.getHeaderGroups()]
				},
				table_getLeafHeaders: {
					fn: () => table_getLeafHeaders(table),
					memoDeps: () => [
						callMemoOrStaticFn(table, "getLeftHeaderGroups", table_getLeftHeaderGroups),
						callMemoOrStaticFn(table, "getCenterHeaderGroups", table_getCenterHeaderGroups),
						callMemoOrStaticFn(table, "getRightHeaderGroups", table_getRightHeaderGroups)
					]
				}
			});
		}
	};
}
/**
* The Core Headers feature provides the core header functionality.
*/
var coreHeadersFeature = constructCoreHeadersFeature();
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/core/rows/constructRow.js
/**
* Creates or retrieves the row prototype for a table.
* The prototype is cached on the table and shared by all row instances.
*/
function getRowPrototype(table) {
	if (!table._rowPrototype) {
		table._rowPrototype = { table };
		for (const feature of Object.values(table._features)) {
			var _feature$assignRowPro;
			(_feature$assignRowPro = feature.assignRowPrototype) === null || _feature$assignRowPro === void 0 || _feature$assignRowPro.call(feature, table._rowPrototype, table);
		}
	}
	return table._rowPrototype;
}
var constructRow = (table, id, original, rowIndex, depth, subRows, parentId) => {
	const rowPrototype = getRowPrototype(table);
	const row = Object.create(rowPrototype);
	row._uniqueValuesCache = {};
	row._valuesCache = {};
	row.depth = depth;
	row.id = id;
	row.index = rowIndex;
	row.original = original;
	row.parentId = parentId;
	row.subRows = subRows ?? [];
	for (const feature of Object.values(table._features)) {
		var _feature$initRowInsta;
		(_feature$initRowInsta = feature.initRowInstanceData) === null || _feature$initRowInsta === void 0 || _feature$initRowInsta.call(feature, row);
	}
	return row;
};
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/row-pagination/rowPaginationFeature.utils.js
var defaultPageIndex = 0;
var defaultPageSize = 10;
function getDefaultPaginationState() {
	return {
		pageIndex: defaultPageIndex,
		pageSize: defaultPageSize
	};
}
function table_autoResetPageIndex(table) {
	if (table.options.autoResetAll ?? table.options.autoResetPageIndex ?? !table.options.manualPagination) table_resetPageIndex(table);
}
function table_setPagination(table, updater) {
	var _table$options$onPagi, _table$options;
	const safeUpdater = (old) => {
		return functionalUpdate(updater, old);
	};
	return (_table$options$onPagi = (_table$options = table.options).onPaginationChange) === null || _table$options$onPagi === void 0 ? void 0 : _table$options$onPagi.call(_table$options, safeUpdater);
}
function table_resetPagination(table, defaultState) {
	table_setPagination(table, defaultState ? getDefaultPaginationState() : cloneState(table.initialState.pagination ?? getDefaultPaginationState()));
}
function table_setPageIndex(table, updater) {
	table_setPagination(table, (old) => {
		let pageIndex = functionalUpdate(updater, old.pageIndex);
		const maxPageIndex = typeof table.options.pageCount === "undefined" || table.options.pageCount === -1 ? Number.MAX_SAFE_INTEGER : table.options.pageCount - 1;
		pageIndex = Math.max(0, Math.min(pageIndex, maxPageIndex));
		return {
			...old,
			pageIndex
		};
	});
}
function table_resetPageIndex(table, defaultState) {
	var _table$atoms$paginati, _table$initialState$p;
	const currentPageIndex = ((_table$atoms$paginati = table.atoms.pagination) === null || _table$atoms$paginati === void 0 || (_table$atoms$paginati = _table$atoms$paginati.get()) === null || _table$atoms$paginati === void 0 ? void 0 : _table$atoms$paginati.pageIndex) ?? defaultPageIndex;
	const newPageIndex = defaultState ? defaultPageIndex : ((_table$initialState$p = table.initialState.pagination) === null || _table$initialState$p === void 0 ? void 0 : _table$initialState$p.pageIndex) ?? defaultPageIndex;
	if (newPageIndex === currentPageIndex) return;
	table_setPageIndex(table, newPageIndex);
}
function table_resetPageSize(table, defaultState) {
	var _table$atoms$paginati2, _table$initialState$p2;
	const currentPageSize = ((_table$atoms$paginati2 = table.atoms.pagination) === null || _table$atoms$paginati2 === void 0 || (_table$atoms$paginati2 = _table$atoms$paginati2.get()) === null || _table$atoms$paginati2 === void 0 ? void 0 : _table$atoms$paginati2.pageSize) ?? defaultPageSize;
	const newPageSize = defaultState ? defaultPageSize : ((_table$initialState$p2 = table.initialState.pagination) === null || _table$initialState$p2 === void 0 ? void 0 : _table$initialState$p2.pageSize) ?? defaultPageSize;
	if (newPageSize === currentPageSize) return;
	table_setPageSize(table, newPageSize);
}
function table_setPageSize(table, updater) {
	table_setPagination(table, (old) => {
		const pageSize = Math.max(1, functionalUpdate(updater, old.pageSize));
		const topRowIndex = old.pageSize * old.pageIndex;
		const pageIndex = Math.floor(topRowIndex / pageSize);
		return {
			...old,
			pageIndex,
			pageSize
		};
	});
}
function table_getPageOptions(table) {
	const pageCount = table_getPageCount(table);
	let pageOptions = [];
	if (pageCount && pageCount > 0) pageOptions = [...new Array(pageCount)].fill(null).map((_, i) => i);
	return pageOptions;
}
function table_getCanPreviousPage(table) {
	var _table$atoms$paginati3;
	return (((_table$atoms$paginati3 = table.atoms.pagination) === null || _table$atoms$paginati3 === void 0 || (_table$atoms$paginati3 = _table$atoms$paginati3.get()) === null || _table$atoms$paginati3 === void 0 ? void 0 : _table$atoms$paginati3.pageIndex) ?? 0) > 0;
}
function table_getCanNextPage(table) {
	var _table$atoms$paginati4;
	const pageIndex = ((_table$atoms$paginati4 = table.atoms.pagination) === null || _table$atoms$paginati4 === void 0 || (_table$atoms$paginati4 = _table$atoms$paginati4.get()) === null || _table$atoms$paginati4 === void 0 ? void 0 : _table$atoms$paginati4.pageIndex) ?? defaultPageIndex;
	const pageCount = table_getPageCount(table);
	if (pageCount === -1) return true;
	if (pageCount === 0) return false;
	return pageIndex < pageCount - 1;
}
function table_previousPage(table) {
	return table_setPageIndex(table, (old) => old - 1);
}
function table_nextPage(table) {
	return table_setPageIndex(table, (old) => {
		return old + 1;
	});
}
function table_firstPage(table) {
	return table_setPageIndex(table, 0);
}
function table_lastPage(table) {
	return table_setPageIndex(table, table_getPageCount(table) - 1);
}
function table_getPageCount(table) {
	var _table$atoms$paginati5;
	return table.options.pageCount ?? Math.ceil(table_getRowCount(table) / (((_table$atoms$paginati5 = table.atoms.pagination) === null || _table$atoms$paginati5 === void 0 || (_table$atoms$paginati5 = _table$atoms$paginati5.get()) === null || _table$atoms$paginati5 === void 0 ? void 0 : _table$atoms$paginati5.pageSize) ?? defaultPageSize));
}
function table_getRowCount(table) {
	return table.options.rowCount ?? table.getPrePaginatedRowModel().rows.length;
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/core/row-models/createCoreRowModel.js
function createCoreRowModel() {
	return (_table) => {
		const table = _table;
		return tableMemo({
			feature: "coreRowModelsFeature",
			table,
			fnName: "table.getCoreRowModel",
			memoDeps: () => [table.options.data],
			fn: () => _createCoreRowModel(table, table.options.data),
			onAfterUpdate: () => table_autoResetPageIndex(table)
		});
	};
}
function _createCoreRowModel(table, data) {
	const rowModel = {
		rows: [],
		flatRows: [],
		rowsById: {}
	};
	const accessRows = (originalRows, depth = 0, parentRow) => {
		const rows = [];
		for (let i = 0; i < originalRows.length; i++) {
			const originalRow = originalRows[i];
			const row = constructRow(table, table.getRowId(originalRow, i, parentRow), originalRow, i, depth, void 0, parentRow === null || parentRow === void 0 ? void 0 : parentRow.id);
			rowModel.flatRows.push(row);
			rowModel.rowsById[row.id] = row;
			rows.push(row);
			if (table.options.getSubRows) {
				var _row$originalSubRows;
				row.originalSubRows = table.options.getSubRows(originalRow, i);
				if ((_row$originalSubRows = row.originalSubRows) === null || _row$originalSubRows === void 0 ? void 0 : _row$originalSubRows.length) row.subRows = accessRows(row.originalSubRows, depth + 1, row);
			}
		}
		return rows;
	};
	rowModel.rows = accessRows(data);
	return rowModel;
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/core/row-models/coreRowModelsFeature.utils.js
function table_getCoreRowModel(table) {
	if (!table._rowModels.coreRowModel) {
		var _table$options$_rowMo, _table$options$_rowMo2;
		table._rowModels.coreRowModel = ((_table$options$_rowMo = table.options._rowModels) === null || _table$options$_rowMo === void 0 || (_table$options$_rowMo2 = _table$options$_rowMo.coreRowModel) === null || _table$options$_rowMo2 === void 0 ? void 0 : _table$options$_rowMo2.call(_table$options$_rowMo, table)) ?? createCoreRowModel()(table);
	}
	return table._rowModels.coreRowModel();
}
function table_getPreFilteredRowModel(table) {
	return table.getCoreRowModel();
}
function table_getFilteredRowModel(table) {
	if (!table._rowModels.filteredRowModel) {
		var _table$options$_rowMo3, _table$options$_rowMo4;
		table._rowModels.filteredRowModel = (_table$options$_rowMo3 = table.options._rowModels) === null || _table$options$_rowMo3 === void 0 || (_table$options$_rowMo4 = _table$options$_rowMo3.filteredRowModel) === null || _table$options$_rowMo4 === void 0 ? void 0 : _table$options$_rowMo4.call(_table$options$_rowMo3, table);
	}
	if (table.options.manualFiltering || !table._rowModels.filteredRowModel) return table.getPreFilteredRowModel();
	return table._rowModels.filteredRowModel();
}
function table_getPreGroupedRowModel(table) {
	return table.getFilteredRowModel();
}
function table_getGroupedRowModel(table) {
	if (!table._rowModels.groupedRowModel) {
		var _table$options$_rowMo5, _table$options$_rowMo6;
		table._rowModels.groupedRowModel = (_table$options$_rowMo5 = table.options._rowModels) === null || _table$options$_rowMo5 === void 0 || (_table$options$_rowMo6 = _table$options$_rowMo5.groupedRowModel) === null || _table$options$_rowMo6 === void 0 ? void 0 : _table$options$_rowMo6.call(_table$options$_rowMo5, table);
	}
	if (table.options.manualGrouping || !table._rowModels.groupedRowModel) return table.getPreGroupedRowModel();
	return table._rowModels.groupedRowModel();
}
function table_getPreSortedRowModel(table) {
	return table.getGroupedRowModel();
}
function table_getSortedRowModel(table) {
	if (!table._rowModels.sortedRowModel) {
		var _table$options$_rowMo7, _table$options$_rowMo8;
		table._rowModels.sortedRowModel = (_table$options$_rowMo7 = table.options._rowModels) === null || _table$options$_rowMo7 === void 0 || (_table$options$_rowMo8 = _table$options$_rowMo7.sortedRowModel) === null || _table$options$_rowMo8 === void 0 ? void 0 : _table$options$_rowMo8.call(_table$options$_rowMo7, table);
	}
	if (table.options.manualSorting || !table._rowModels.sortedRowModel) return table.getPreSortedRowModel();
	return table._rowModels.sortedRowModel();
}
function table_getPreExpandedRowModel(table) {
	return table.getSortedRowModel();
}
function table_getExpandedRowModel(table) {
	if (!table._rowModels.expandedRowModel) {
		var _table$options$_rowMo9, _table$options$_rowMo10;
		table._rowModels.expandedRowModel = (_table$options$_rowMo9 = table.options._rowModels) === null || _table$options$_rowMo9 === void 0 || (_table$options$_rowMo10 = _table$options$_rowMo9.expandedRowModel) === null || _table$options$_rowMo10 === void 0 ? void 0 : _table$options$_rowMo10.call(_table$options$_rowMo9, table);
	}
	if (table.options.manualExpanding || !table._rowModels.expandedRowModel) return table.getPreExpandedRowModel();
	return table._rowModels.expandedRowModel();
}
function table_getPrePaginatedRowModel(table) {
	return table.getExpandedRowModel();
}
function table_getPaginatedRowModel(table) {
	if (!table._rowModels.paginatedRowModel) {
		var _table$options$_rowMo11, _table$options$_rowMo12;
		table._rowModels.paginatedRowModel = (_table$options$_rowMo11 = table.options._rowModels) === null || _table$options$_rowMo11 === void 0 || (_table$options$_rowMo12 = _table$options$_rowMo11.paginatedRowModel) === null || _table$options$_rowMo12 === void 0 ? void 0 : _table$options$_rowMo12.call(_table$options$_rowMo11, table);
	}
	if (table.options.manualPagination || !table._rowModels.paginatedRowModel) return table.getPrePaginatedRowModel();
	return table._rowModels.paginatedRowModel();
}
function table_getRowModel(table) {
	return table.getPaginatedRowModel();
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/core/row-models/coreRowModelsFeature.js
function constructCoreRowModelsFeature() {
	return { constructTableAPIs: (table) => {
		assignTableAPIs("coreRowModelsFeature", table, {
			table_getCoreRowModel: { fn: () => table_getCoreRowModel(table) },
			table_getPreFilteredRowModel: { fn: () => table_getPreFilteredRowModel(table) },
			table_getFilteredRowModel: { fn: () => table_getFilteredRowModel(table) },
			table_getPreGroupedRowModel: { fn: () => table_getPreGroupedRowModel(table) },
			table_getGroupedRowModel: { fn: () => table_getGroupedRowModel(table) },
			table_getPreSortedRowModel: { fn: () => table_getPreSortedRowModel(table) },
			table_getSortedRowModel: { fn: () => table_getSortedRowModel(table) },
			table_getPreExpandedRowModel: { fn: () => table_getPreExpandedRowModel(table) },
			table_getExpandedRowModel: { fn: () => table_getExpandedRowModel(table) },
			table_getPrePaginatedRowModel: { fn: () => table_getPrePaginatedRowModel(table) },
			table_getPaginatedRowModel: { fn: () => table_getPaginatedRowModel(table) },
			table_getRowModel: { fn: () => table_getRowModel(table) }
		});
	} };
}
/**
* The Core Row Models feature provides the core row model functionality.
*/
var coreRowModelsFeature = constructCoreRowModelsFeature();
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/core/cells/constructCell.js
/**
* Creates or retrieves the cell prototype for a table.
* The prototype is cached on the table and shared by all cell instances.
*/
function getCellPrototype(table) {
	if (!table._cellPrototype) {
		table._cellPrototype = { table };
		for (const feature of Object.values(table._features)) {
			var _feature$assignCellPr;
			(_feature$assignCellPr = feature.assignCellPrototype) === null || _feature$assignCellPr === void 0 || _feature$assignCellPr.call(feature, table._cellPrototype, table);
		}
	}
	return table._cellPrototype;
}
function constructCell(column, row, table) {
	const cellPrototype = getCellPrototype(table);
	const cell = Object.create(cellPrototype);
	cell.column = column;
	cell.id = `${row.id}_${column.id}`;
	cell.row = row;
	return cell;
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/core/rows/coreRowsFeature.utils.js
function row_getValue(row, columnId) {
	if (row._valuesCache.hasOwnProperty(columnId)) return row._valuesCache[columnId];
	const column = row.table.getColumn(columnId);
	if (!(column === null || column === void 0 ? void 0 : column.accessorFn)) return;
	row._valuesCache[columnId] = column.accessorFn(row.original, row.index);
	return row._valuesCache[columnId];
}
function row_getUniqueValues(row, columnId) {
	if (row._uniqueValuesCache.hasOwnProperty(columnId)) return row._uniqueValuesCache[columnId];
	const column = row.table.getColumn(columnId);
	if (!(column === null || column === void 0 ? void 0 : column.accessorFn)) return;
	if (!column.columnDef.getUniqueValues) {
		row._uniqueValuesCache[columnId] = [row.getValue(columnId)];
		return row._uniqueValuesCache[columnId];
	}
	row._uniqueValuesCache[columnId] = column.columnDef.getUniqueValues(row.original, row.index);
	return row._uniqueValuesCache[columnId];
}
function row_renderValue(row, columnId) {
	return row.getValue(columnId) ?? row.table.options.renderFallbackValue;
}
function row_getLeafRows(row) {
	return flattenBy(row.subRows, (d) => d.subRows);
}
function row_getParentRow(row) {
	return row.parentId ? row.table.getRow(row.parentId, true) : void 0;
}
function row_getParentRows(row) {
	const parentRows = [];
	let currentRow = row;
	while (true) {
		const parentRow = currentRow.getParentRow();
		if (!parentRow) break;
		parentRows.push(parentRow);
		currentRow = parentRow;
	}
	return parentRows.reverse();
}
function row_getAllCells(row) {
	return row.table.getAllLeafColumns().map((column) => {
		return constructCell(column, row, row.table);
	});
}
function row_getAllCellsByColumnId(row) {
	return row.getAllCells().reduce((acc, cell) => {
		acc[cell.column.id] = cell;
		return acc;
	}, {});
}
function table_getRowId(originalRow, table, index, parent) {
	var _table$options$getRow, _table$options;
	return ((_table$options$getRow = (_table$options = table.options).getRowId) === null || _table$options$getRow === void 0 ? void 0 : _table$options$getRow.call(_table$options, originalRow, index, parent)) ?? `${parent ? [parent.id, index].join(".") : index}`;
}
function table_getRow(table, rowId, searchAll) {
	let row = (searchAll ? table.getPrePaginatedRowModel() : table.getRowModel()).rowsById[rowId];
	if (!row) {
		row = table.getCoreRowModel().rowsById[rowId];
		if (!row) {
			if (process.env.NODE_ENV === "development") throw new Error(`getRow could not find row with ID: ${rowId}`);
			throw new Error();
		}
	}
	return row;
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/core/rows/coreRowsFeature.js
function constructCoreRowsFeature() {
	return {
		assignRowPrototype: (prototype, table) => {
			assignPrototypeAPIs("coreRowsFeature", prototype, table, {
				row_getAllCellsByColumnId: {
					fn: (row) => row_getAllCellsByColumnId(row),
					memoDeps: (row) => [row.getAllCells()]
				},
				row_getAllCells: {
					fn: (row) => row_getAllCells(row),
					memoDeps: (row) => [row.table.getAllLeafColumns()]
				},
				row_getLeafRows: { fn: (row) => row_getLeafRows(row) },
				row_getParentRow: { fn: (row) => row_getParentRow(row) },
				row_getParentRows: { fn: (row) => row_getParentRows(row) },
				row_getUniqueValues: { fn: (row, columnId) => row_getUniqueValues(row, columnId) },
				row_getValue: { fn: (row, columnId) => row_getValue(row, columnId) },
				row_renderValue: { fn: (row, columnId) => row_renderValue(row, columnId) }
			});
		},
		constructTableAPIs: (table) => {
			assignTableAPIs("coreRowsFeature", table, {
				table_getRowId: { fn: (originalRow, index, parent) => table_getRowId(originalRow, table, index, parent) },
				table_getRow: { fn: (id, searchAll) => table_getRow(table, id, searchAll) }
			});
		}
	};
}
/**
* The Core Rows feature provides the core row functionality.
*/
var coreRowsFeature = constructCoreRowsFeature();
//#endregion
//#region node_modules/.pnpm/@tanstack+store@0.11.0/node_modules/@tanstack/store/dist/alien.js
var ReactiveFlags = /* @__PURE__ */ function(ReactiveFlags) {
	ReactiveFlags[ReactiveFlags["None"] = 0] = "None";
	ReactiveFlags[ReactiveFlags["Mutable"] = 1] = "Mutable";
	ReactiveFlags[ReactiveFlags["Watching"] = 2] = "Watching";
	ReactiveFlags[ReactiveFlags["RecursedCheck"] = 4] = "RecursedCheck";
	ReactiveFlags[ReactiveFlags["Recursed"] = 8] = "Recursed";
	ReactiveFlags[ReactiveFlags["Dirty"] = 16] = "Dirty";
	ReactiveFlags[ReactiveFlags["Pending"] = 32] = "Pending";
	return ReactiveFlags;
}({});
/* @__NO_SIDE_EFFECTS__ */
function createReactiveSystem({ update, notify, unwatched }) {
	return {
		link,
		unlink,
		propagate,
		checkDirty,
		shallowPropagate
	};
	function link(dep, sub, version) {
		const prevDep = sub.depsTail;
		if (prevDep !== void 0 && prevDep.dep === dep) return;
		const nextDep = prevDep !== void 0 ? prevDep.nextDep : sub.deps;
		if (nextDep !== void 0 && nextDep.dep === dep) {
			nextDep.version = version;
			sub.depsTail = nextDep;
			return;
		}
		const prevSub = dep.subsTail;
		if (prevSub !== void 0 && prevSub.version === version && prevSub.sub === sub) return;
		const newLink = sub.depsTail = dep.subsTail = {
			version,
			dep,
			sub,
			prevDep,
			nextDep,
			prevSub,
			nextSub: void 0
		};
		if (nextDep !== void 0) nextDep.prevDep = newLink;
		if (prevDep !== void 0) prevDep.nextDep = newLink;
		else sub.deps = newLink;
		if (prevSub !== void 0) prevSub.nextSub = newLink;
		else dep.subs = newLink;
	}
	function unlink(link, sub = link.sub) {
		const dep = link.dep;
		const prevDep = link.prevDep;
		const nextDep = link.nextDep;
		const nextSub = link.nextSub;
		const prevSub = link.prevSub;
		if (nextDep !== void 0) nextDep.prevDep = prevDep;
		else sub.depsTail = prevDep;
		if (prevDep !== void 0) prevDep.nextDep = nextDep;
		else sub.deps = nextDep;
		if (nextSub !== void 0) nextSub.prevSub = prevSub;
		else dep.subsTail = prevSub;
		if (prevSub !== void 0) prevSub.nextSub = nextSub;
		else if ((dep.subs = nextSub) === void 0) unwatched(dep);
		return nextDep;
	}
	function propagate(link) {
		let next = link.nextSub;
		let stack;
		top: do {
			const sub = link.sub;
			let flags = sub.flags;
			if (!(flags & (ReactiveFlags.RecursedCheck | ReactiveFlags.Recursed | ReactiveFlags.Dirty | ReactiveFlags.Pending))) sub.flags = flags | ReactiveFlags.Pending;
			else if (!(flags & (ReactiveFlags.RecursedCheck | ReactiveFlags.Recursed))) flags = ReactiveFlags.None;
			else if (!(flags & ReactiveFlags.RecursedCheck)) sub.flags = flags & ~ReactiveFlags.Recursed | ReactiveFlags.Pending;
			else if (!(flags & (ReactiveFlags.Dirty | ReactiveFlags.Pending)) && isValidLink(link, sub)) {
				sub.flags = flags | (ReactiveFlags.Recursed | ReactiveFlags.Pending);
				flags &= ReactiveFlags.Mutable;
			} else flags = ReactiveFlags.None;
			if (flags & ReactiveFlags.Watching) notify(sub);
			if (flags & ReactiveFlags.Mutable) {
				const subSubs = sub.subs;
				if (subSubs !== void 0) {
					const nextSub = (link = subSubs).nextSub;
					if (nextSub !== void 0) {
						stack = {
							value: next,
							prev: stack
						};
						next = nextSub;
					}
					continue;
				}
			}
			if ((link = next) !== void 0) {
				next = link.nextSub;
				continue;
			}
			while (stack !== void 0) {
				link = stack.value;
				stack = stack.prev;
				if (link !== void 0) {
					next = link.nextSub;
					continue top;
				}
			}
			break;
		} while (true);
	}
	function checkDirty(link, sub) {
		let stack;
		let checkDepth = 0;
		let dirty = false;
		top: do {
			const dep = link.dep;
			const flags = dep.flags;
			if (sub.flags & ReactiveFlags.Dirty) dirty = true;
			else if ((flags & (ReactiveFlags.Mutable | ReactiveFlags.Dirty)) === (ReactiveFlags.Mutable | ReactiveFlags.Dirty)) {
				if (update(dep)) {
					const subs = dep.subs;
					if (subs.nextSub !== void 0) shallowPropagate(subs);
					dirty = true;
				}
			} else if ((flags & (ReactiveFlags.Mutable | ReactiveFlags.Pending)) === (ReactiveFlags.Mutable | ReactiveFlags.Pending)) {
				if (link.nextSub !== void 0 || link.prevSub !== void 0) stack = {
					value: link,
					prev: stack
				};
				link = dep.deps;
				sub = dep;
				++checkDepth;
				continue;
			}
			if (!dirty) {
				const nextDep = link.nextDep;
				if (nextDep !== void 0) {
					link = nextDep;
					continue;
				}
			}
			while (checkDepth--) {
				const firstSub = sub.subs;
				const hasMultipleSubs = firstSub.nextSub !== void 0;
				if (hasMultipleSubs) {
					link = stack.value;
					stack = stack.prev;
				} else link = firstSub;
				if (dirty) {
					if (update(sub)) {
						if (hasMultipleSubs) shallowPropagate(firstSub);
						sub = link.sub;
						continue;
					}
					dirty = false;
				} else sub.flags &= ~ReactiveFlags.Pending;
				sub = link.sub;
				const nextDep = link.nextDep;
				if (nextDep !== void 0) {
					link = nextDep;
					continue top;
				}
			}
			return dirty;
		} while (true);
	}
	function shallowPropagate(link) {
		do {
			const sub = link.sub;
			const flags = sub.flags;
			if ((flags & (ReactiveFlags.Pending | ReactiveFlags.Dirty)) === ReactiveFlags.Pending) {
				sub.flags = flags | ReactiveFlags.Dirty;
				if ((flags & (ReactiveFlags.Watching | ReactiveFlags.RecursedCheck)) === ReactiveFlags.Watching) notify(sub);
			}
		} while ((link = link.nextSub) !== void 0);
	}
	function isValidLink(checkLink, sub) {
		let link = sub.depsTail;
		while (link !== void 0) {
			if (link === checkLink) return true;
			link = link.prevDep;
		}
		return false;
	}
}
//#endregion
//#region node_modules/.pnpm/@tanstack+store@0.11.0/node_modules/@tanstack/store/dist/atom.js
function toObserver(nextHandler, errorHandler, completionHandler) {
	const isObserver = typeof nextHandler === "object";
	const self = isObserver ? nextHandler : void 0;
	return {
		next: (isObserver ? nextHandler.next : nextHandler)?.bind(self),
		error: (isObserver ? nextHandler.error : errorHandler)?.bind(self),
		complete: (isObserver ? nextHandler.complete : completionHandler)?.bind(self)
	};
}
var queuedEffects = [];
var cycle = 0;
var { link, unlink, propagate, checkDirty, shallowPropagate } = /* @__PURE__ */ createReactiveSystem({
	update(atom) {
		return atom._update();
	},
	notify(effect) {
		queuedEffects[queuedEffectsLength++] = effect;
		effect.flags &= ~ReactiveFlags.Watching;
	},
	unwatched(atom) {
		if (atom.depsTail !== void 0) {
			atom.depsTail = void 0;
			atom.flags = ReactiveFlags.Mutable | ReactiveFlags.Dirty;
			purgeDeps(atom);
		}
	}
});
var notifyIndex = 0;
var queuedEffectsLength = 0;
var activeSub;
var batchDepth = 0;
function batch(fn) {
	try {
		++batchDepth;
		fn();
	} finally {
		if (!--batchDepth) flush();
	}
}
function purgeDeps(sub) {
	const depsTail = sub.depsTail;
	let dep = depsTail !== void 0 ? depsTail.nextDep : sub.deps;
	while (dep !== void 0) dep = unlink(dep, sub);
}
function flush() {
	if (batchDepth > 0) return;
	while (notifyIndex < queuedEffectsLength) {
		const effect = queuedEffects[notifyIndex];
		queuedEffects[notifyIndex++] = void 0;
		effect.notify();
	}
	notifyIndex = 0;
	queuedEffectsLength = 0;
}
function createAtom(valueOrFn, options) {
	const isComputed = typeof valueOrFn === "function";
	const getter = valueOrFn;
	const atom = {
		_snapshot: isComputed ? void 0 : valueOrFn,
		subs: void 0,
		subsTail: void 0,
		deps: void 0,
		depsTail: void 0,
		flags: isComputed ? ReactiveFlags.None : ReactiveFlags.Mutable,
		get() {
			if (activeSub !== void 0) link(atom, activeSub, cycle);
			return atom._snapshot;
		},
		subscribe(observerOrFn) {
			const obs = toObserver(observerOrFn);
			const observed = { current: false };
			const e = effect(() => {
				atom.get();
				if (!observed.current) observed.current = true;
				else obs.next?.(atom._snapshot);
			});
			return { unsubscribe: () => {
				e.stop();
			} };
		},
		_update(getValue) {
			const prevSub = activeSub;
			const compare = options?.compare ?? Object.is;
			if (isComputed) {
				activeSub = atom;
				++cycle;
				atom.depsTail = void 0;
			} else if (getValue === void 0) return false;
			if (isComputed) atom.flags = ReactiveFlags.Mutable | ReactiveFlags.RecursedCheck;
			try {
				const oldValue = atom._snapshot;
				const newValue = typeof getValue === "function" ? getValue(oldValue) : getValue === void 0 && isComputed ? getter(oldValue) : getValue;
				if (oldValue === void 0 || !compare(oldValue, newValue)) {
					atom._snapshot = newValue;
					return true;
				}
				return false;
			} finally {
				activeSub = prevSub;
				if (isComputed) atom.flags &= ~ReactiveFlags.RecursedCheck;
				purgeDeps(atom);
			}
		}
	};
	if (isComputed) {
		atom.flags = ReactiveFlags.Mutable | ReactiveFlags.Dirty;
		atom.get = function() {
			const flags = atom.flags;
			if (flags & ReactiveFlags.Dirty || flags & ReactiveFlags.Pending && checkDirty(atom.deps, atom)) {
				if (atom._update()) {
					const subs = atom.subs;
					if (subs !== void 0) shallowPropagate(subs);
				}
			} else if (flags & ReactiveFlags.Pending) atom.flags = flags & ~ReactiveFlags.Pending;
			if (activeSub !== void 0) link(atom, activeSub, cycle);
			return atom._snapshot;
		};
	} else atom.set = function(valueOrFn) {
		if (atom._update(valueOrFn)) {
			const subs = atom.subs;
			if (subs !== void 0) {
				propagate(subs);
				shallowPropagate(subs);
				flush();
			}
		}
	};
	return atom;
}
function effect(fn) {
	const run = () => {
		const prevSub = activeSub;
		activeSub = effectObj;
		++cycle;
		effectObj.depsTail = void 0;
		effectObj.flags = ReactiveFlags.Watching | ReactiveFlags.RecursedCheck;
		try {
			return fn();
		} finally {
			activeSub = prevSub;
			effectObj.flags &= ~ReactiveFlags.RecursedCheck;
			purgeDeps(effectObj);
		}
	};
	const effectObj = {
		deps: void 0,
		depsTail: void 0,
		subs: void 0,
		subsTail: void 0,
		flags: ReactiveFlags.Watching | ReactiveFlags.RecursedCheck,
		notify() {
			const flags = this.flags;
			if (flags & ReactiveFlags.Dirty || flags & ReactiveFlags.Pending && checkDirty(this.deps, this)) run();
			else this.flags = ReactiveFlags.Watching;
		},
		stop() {
			this.flags = ReactiveFlags.None;
			this.depsTail = void 0;
			purgeDeps(this);
		}
	};
	run();
	return effectObj;
}
//#endregion
//#region node_modules/.pnpm/@tanstack+store@0.11.0/node_modules/@tanstack/store/dist/store.js
var Store = class {
	constructor(valueOrFn, actionsFactory) {
		this.atom = createAtom(valueOrFn);
		this.get = this.get.bind(this);
		this.setState = this.setState.bind(this);
		this.subscribe = this.subscribe.bind(this);
		if (actionsFactory) this.actions = actionsFactory(this);
	}
	setState(updater) {
		this.atom.set(updater);
	}
	get state() {
		return this.atom.get();
	}
	get() {
		return this.state;
	}
	subscribe(observerOrFn) {
		return this.atom.subscribe(toObserver(observerOrFn));
	}
};
var ReadonlyStore = class {
	constructor(valueOrFn) {
		this.atom = createAtom(valueOrFn);
	}
	get state() {
		return this.atom.get();
	}
	get() {
		return this.state;
	}
	subscribe(observerOrFn) {
		return this.atom.subscribe(toObserver(observerOrFn));
	}
};
function createStore(valueOrFn, actions) {
	if (typeof valueOrFn === "function") return new ReadonlyStore(valueOrFn);
	if (actions) return new Store(valueOrFn, actions);
	return new Store(valueOrFn);
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/core/table/coreTablesFeature.utils.js
function table_reset(table) {
	const snap = cloneState(table.initialState);
	batch(() => {
		for (const key of Object.keys(snap)) table.baseAtoms[key].set(snap[key]);
	});
}
function table_mergeOptions(table, newOptions) {
	if (table.options.mergeOptions) return table.options.mergeOptions(table.options, newOptions);
	return {
		...table.options,
		...newOptions
	};
}
function table_setOptions(table, updater) {
	const mergedOptions = table_mergeOptions(table, functionalUpdate(updater, table.options));
	table.optionsStore.setState(() => mergedOptions);
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/core/table/coreTablesFeature.js
function constructCoreTablesFeature() {
	return { constructTableAPIs: (table) => {
		assignTableAPIs("coreTablesFeature", table, {
			table_reset: { fn: () => table_reset(table) },
			table_setOptions: { fn: (updater) => table_setOptions(table, updater) }
		});
	} };
}
/**
* The Core Tables feature provides the core table functionality for handling state and options.
*/
var coreTablesFeature = constructCoreTablesFeature();
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/core/coreFeatures.js
var coreFeatures = {
	coreCellsFeature,
	coreColumnsFeature,
	coreHeadersFeature,
	coreRowModelsFeature,
	coreRowsFeature,
	coreTablesFeature
};
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/helpers/columnHelper.js
/**
* A helper utility for creating column definitions with slightly better type inference for each individual column.
* The `TValue` generic is inferred based on the accessor key or function provided.
* **Note:** From a JavaScript perspective, the functions in these helpers do not do anything. They are only used to help TypeScript infer the correct types for the column definitions.
* @example
* ```tsx
* const helper = createColumnHelper<typeof _features, Person>() // _features is the result of `tableFeatures({})` helper
* const columns = [
*  helper.display({ id: 'actions', header: 'Actions' }),
*  helper.accessor('firstName', {}),
*  helper.accessor((row) => row.lastName, {}
* ]
* ```
*/
function createColumnHelper() {
	return {
		accessor: (accessor, column) => {
			return typeof accessor === "function" ? {
				...column,
				accessorFn: accessor
			} : {
				...column,
				accessorKey: accessor
			};
		},
		columns: (columns) => columns,
		display: (column) => column,
		group: (column) => column
	};
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/helpers/tableFeatures.js
/**
* A helper function to help define the features that are to be imported and applied to a table instance.
* Use this utility to make it easier to have the correct type inference for the features that are being imported.
* **Note:** It is recommended to use this utility statically outside of a component.
* @example
* ```
* import { tableFeatures, columnVisibilityFeature, rowPinningFeature } from '@tanstack/react-table'
* const _features = tableFeatures({ columnVisibilityFeature, rowPinningFeature });
* const table = useTable({ _features, rowModels: {}, columns, data });
* ```
*/
function tableFeatures(features) {
	return features;
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/helpers/tableOptions.js
function tableOptions(options) {
	return options;
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/core/table/constructTable.js
function getInitialTableState(features, initialState = {}) {
	Object.values(features).forEach((feature) => {
		var _feature$getInitialSt;
		initialState = ((_feature$getInitialSt = feature.getInitialState) === null || _feature$getInitialSt === void 0 ? void 0 : _feature$getInitialSt.call(feature, initialState)) ?? initialState;
	});
	return cloneState(initialState);
}
function constructTable(tableOptions) {
	const table = {
		_features: {
			...coreFeatures,
			...tableOptions._features
		},
		_rowModels: {},
		_rowModelFns: {},
		get options() {
			return this.optionsStore.state;
		},
		set options(value) {
			this.optionsStore.setState(() => value);
		},
		baseAtoms: {},
		atoms: {}
	};
	const featuresList = Object.values(table._features);
	table.optionsStore = createStore({
		...featuresList.reduce((obj, feature) => {
			var _feature$getDefaultTa;
			return Object.assign(obj, (_feature$getDefaultTa = feature.getDefaultTableOptions) === null || _feature$getDefaultTa === void 0 ? void 0 : _feature$getDefaultTa.call(feature, table));
		}, {}),
		...tableOptions
	});
	table.initialState = getInitialTableState(table._features, table.options.initialState);
	const stateKeys = Object.keys(table.initialState);
	for (const key of stateKeys) {
		table.baseAtoms[key] = createAtom(table.initialState[key]);
		table.atoms[key] = createAtom(() => {
			var _opts$atoms;
			const opts = table.optionsStore.state;
			const state = opts.state;
			if (key in (state ?? {})) return state[key];
			const externalAtom = (_opts$atoms = opts.atoms) === null || _opts$atoms === void 0 ? void 0 : _opts$atoms[key];
			if (externalAtom) return externalAtom.get();
			return table.baseAtoms[key].get();
		});
	}
	table.store = createStore(() => {
		const snapshot = {};
		for (const key of stateKeys) snapshot[key] = table.atoms[key].get();
		return snapshot;
	});
	if (process.env.NODE_ENV === "development" && (tableOptions.debugAll || tableOptions.debugTable)) {
		const features = Object.keys(table._features);
		const rowModels = Object.keys(table.options._rowModels || {});
		const states = Object.keys(table.initialState);
		console.log(`Constructing Table Instance

  Features:   ${features.join("\n              ")}

  Row Models: ${rowModels.length ? rowModels.join("\n              ") : "(none)"}

  States:     ${states.join("\n              ")}`);
	}
	for (const feature of featuresList) {
		var _feature$constructTab;
		(_feature$constructTab = feature.constructTableAPIs) === null || _feature$constructTab === void 0 || _feature$constructTab.call(feature, table);
	}
	return table;
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/fns/aggregationFns.js
/**
* Aggregation function for summing up the values of a column.
*/
var aggregationFn_sum = (columnId, _leafRows, childRows) => {
	return childRows.reduce((sumValue, next) => {
		const nextValue = next.getValue(columnId);
		return sumValue + (typeof nextValue === "number" ? nextValue : 0);
	}, 0);
};
/**
* Aggregation function for finding the minimum value of a column.
*/
var aggregationFn_min = (columnId, _leafRows, childRows) => {
	let minValue;
	childRows.forEach((row) => {
		const value = row.getValue(columnId);
		if (value != null && typeof value === "number" && (minValue === void 0 || value < minValue)) minValue = value;
	});
	return minValue;
};
/**
* Aggregation function for finding the maximum value of a column.
*/
var aggregationFn_max = (columnId, _leafRows, childRows) => {
	let maxValue;
	childRows.forEach((row) => {
		const value = row.getValue(columnId);
		if (value != null && typeof value === "number" && (maxValue === void 0 || value > maxValue)) maxValue = value;
	});
	return maxValue;
};
/**
* Aggregation function for finding the extent (min and max) of a column.
*/
var aggregationFn_extent = (columnId, _leafRows, childRows) => {
	let minValue;
	let maxValue;
	childRows.forEach((row) => {
		const value = row.getValue(columnId);
		if (value != null && typeof value === "number") if (minValue === void 0) minValue = maxValue = value;
		else {
			if (minValue > value) minValue = value;
			if (maxValue < value) maxValue = value;
		}
	});
	return [minValue, maxValue];
};
/**
* Aggregation function for finding the mean (average) of a column.
*/
var aggregationFn_mean = (columnId, leafRows) => {
	let count = 0;
	let sumValue = 0;
	leafRows.forEach((row) => {
		const value = row.getValue(columnId);
		if (value != null && typeof value === "number") {
			++count;
			sumValue += value;
		} else if (value != null) {
			const numValue = +value;
			if (!Number.isNaN(numValue)) {
				++count;
				sumValue += numValue;
			}
		}
	});
	if (count) return sumValue / count;
};
/**
* Aggregation function for finding the median value of a column.
*/
var aggregationFn_median = (columnId, leafRows) => {
	if (!leafRows.length) return;
	const values = leafRows.map((row) => row.getValue(columnId));
	if (!isNumberArray(values)) return;
	if (values.length === 1) return values[0];
	const mid = Math.floor(values.length / 2);
	const nums = values.sort((a, b) => a - b);
	return values.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
};
/**
* Aggregation function for finding the unique values of a column.
*/
var aggregationFn_unique = (columnId, leafRows) => {
	return Array.from(new Set(leafRows.map((d) => d.getValue(columnId))).values());
};
/**
* Aggregation function for finding the count of unique values of a column.
*/
var aggregationFn_uniqueCount = (columnId, leafRows) => {
	return new Set(leafRows.map((d) => d.getValue(columnId))).size;
};
/**
* Aggregation function for counting the number of rows in a column.
*/
var aggregationFn_count = (_columnId, leafRows) => {
	return leafRows.length;
};
var aggregationFns = {
	sum: aggregationFn_sum,
	min: aggregationFn_min,
	max: aggregationFn_max,
	extent: aggregationFn_extent,
	mean: aggregationFn_mean,
	median: aggregationFn_median,
	unique: aggregationFn_unique,
	uniqueCount: aggregationFn_uniqueCount,
	count: aggregationFn_count
};
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/fns/filterFns.js
/**
* Filter function for checking if a value is exactly equal to a given value. (JS === comparison)
*/
var filterFn_equals = (row, columnId, filterValue) => {
	return row.getValue(columnId) === filterValue;
};
filterFn_equals.autoRemove = (val) => testFalsy(val);
/**
* Filter function for checking if a value is weakly equal to a given value. (JS == comparison)
*/
var filterFn_weakEquals = (row, columnId, filterValue) => {
	return row.getValue(columnId) == filterValue;
};
filterFn_weakEquals.autoRemove = (val) => testFalsy(val);
/**
* Filter function for checking if a string includes a given substring. (Case-sensitive)
*/
var filterFn_includesStringSensitive = (row, columnId, filterValue) => {
	var _row$getValue;
	return Boolean((_row$getValue = row.getValue(columnId)) === null || _row$getValue === void 0 ? void 0 : _row$getValue.toString().includes(filterValue.toString()));
};
filterFn_includesStringSensitive.autoRemove = (val) => testFalsy(val);
/**
* Filter function for checking if a string includes a given substring. (Non-case-sensitive)
*/
var filterFn_includesString = (row, columnId, filterValue) => {
	var _row$getValue2;
	return Boolean((_row$getValue2 = row.getValue(columnId)) === null || _row$getValue2 === void 0 ? void 0 : _row$getValue2.toString().toLowerCase().includes(filterValue.toString().toLowerCase()));
};
filterFn_includesString.autoRemove = (val) => testFalsy(val);
/**
* Filter function for checking if a string is exactly equal to a given string. (Non-case-sensitive)
*/
var filterFn_equalsString = (row, columnId, filterValue) => {
	var _row$getValue3;
	return ((_row$getValue3 = row.getValue(columnId)) === null || _row$getValue3 === void 0 ? void 0 : _row$getValue3.toString().toLowerCase()) === filterValue.toLowerCase();
};
filterFn_equalsString.autoRemove = (val) => testFalsy(val);
/**
* Filter function for checking if a string is exactly equal to a given string. (Case-sensitive)
*/
var filterFn_equalsStringSensitive = (row, columnId, filterValue) => {
	var _row$getValue4;
	return ((_row$getValue4 = row.getValue(columnId)) === null || _row$getValue4 === void 0 ? void 0 : _row$getValue4.toString()) === filterValue;
};
filterFn_equalsStringSensitive.autoRemove = (val) => testFalsy(val);
/**
* Filter function for checking if a number is greater than a given number.
*/
var filterFn_greaterThan = (row, columnId, filterValue) => {
	const rowValue = row.getValue(columnId);
	const numericRowValue = rowValue === null || rowValue === void 0 ? 0 : +rowValue;
	const numericFilterValue = +filterValue;
	if (!isNaN(numericFilterValue) && !isNaN(numericRowValue)) return numericRowValue > numericFilterValue;
	return (rowValue ?? "").toString().toLowerCase().trim() > filterValue.toString().toLowerCase().trim();
};
filterFn_greaterThan.resolveFilterValue = (val) => testFalsy(val);
/**
* Filter function for checking if a number is greater than or equal to a given number.
*/
var filterFn_greaterThanOrEqualTo = (row, columnId, filterValue) => {
	return filterFn_greaterThan(row, columnId, filterValue) || filterFn_equals(row, columnId, filterValue);
};
filterFn_greaterThanOrEqualTo.resolveFilterValue = (val) => testFalsy(val);
/**
* Filter function for checking if a number is less than a given number.
*/
var filterFn_lessThan = (row, columnId, filterValue) => {
	return !filterFn_greaterThanOrEqualTo(row, columnId, filterValue);
};
filterFn_lessThan.resolveFilterValue = (val) => testFalsy(val);
/**
* Filter function for checking if a number is less than or equal to a given number.
*/
var filterFn_lessThanOrEqualTo = (row, columnId, filterValue) => {
	return !filterFn_greaterThan(row, columnId, filterValue);
};
filterFn_lessThanOrEqualTo.resolveFilterValue = (val) => testFalsy(val);
/**
* Filter function for checking if a number or a string is between two given values.
*/
var filterFn_between = (row, columnId, filterValues) => (["", void 0].includes(filterValues[0]) || filterFn_greaterThan(row, columnId, filterValues[0])) && (!isNaN(+filterValues[0]) && !isNaN(+filterValues[1]) && +filterValues[0] > +filterValues[1] || ["", void 0].includes(filterValues[1]) || filterFn_lessThan(row, columnId, filterValues[1]));
filterFn_between.autoRemove = (val) => !val;
/**
* Filter function for checking if a number or a string is between two given values or equal to them.
*/
var filterFn_betweenInclusive = (row, columnId, filterValues) => (["", void 0].includes(filterValues[0]) || filterFn_greaterThanOrEqualTo(row, columnId, filterValues[0])) && (!isNaN(+filterValues[0]) && !isNaN(+filterValues[1]) && +filterValues[0] > +filterValues[1] || ["", void 0].includes(filterValues[1]) || filterFn_lessThanOrEqualTo(row, columnId, filterValues[1]));
filterFn_betweenInclusive.autoRemove = (val) => !val;
/**
* Filter function for checking if a number is within a given range.
*/
var filterFn_inNumberRange = (row, columnId, filterValue) => {
	const [min, max] = filterValue;
	const rowValue = row.getValue(columnId);
	return rowValue >= min && rowValue <= max;
};
filterFn_inNumberRange.resolveFilterValue = (val) => {
	const [unsafeMin, unsafeMax] = val;
	const parsedMin = typeof unsafeMin !== "number" ? parseFloat(unsafeMin) : unsafeMin;
	const parsedMax = typeof unsafeMax !== "number" ? parseFloat(unsafeMax) : unsafeMax;
	let min = unsafeMin === null || Number.isNaN(parsedMin) ? -Infinity : parsedMin;
	let max = unsafeMax === null || Number.isNaN(parsedMax) ? Infinity : parsedMax;
	if (min > max) {
		const temp = min;
		min = max;
		max = temp;
	}
	return [min, max];
};
filterFn_inNumberRange.autoRemove = (val) => testFalsy(val) || testFalsy(val[0]) && testFalsy(val[1]);
/**
* Filter function for checking if an array has a given value.
*/
var filterFn_arrHas = (row, columnId, filterValue) => {
	return filterValue.some((val) => row.getValue(columnId) === val);
};
/**
* Filter function for checking if an array includes a given value.
*/
var filterFn_arrIncludes = (row, columnId, filterValue) => {
	return filterValue.some((val) => row.getValue(columnId).includes(val));
};
filterFn_arrIncludes.autoRemove = (val) => testFalsy(val) || !(val === null || val === void 0 ? void 0 : val.length);
/**
* Filter function for checking if an array includes all of the given values.
*/
var filterFn_arrIncludesAll = (row, columnId, filterValue) => {
	const value = row.getValue(columnId);
	if (!Array.isArray(value)) return false;
	return !filterValue.some((val) => !value.includes(val));
};
filterFn_arrIncludesAll.autoRemove = (val) => testFalsy(val) || !(val === null || val === void 0 ? void 0 : val.length);
/**
* Filter function for checking if an array includes any of the given values.
*/
var filterFn_arrIncludesSome = (row, columnId, filterValue) => {
	const value = row.getValue(columnId);
	if (!Array.isArray(value)) return false;
	return filterValue.some((val) => value.includes(val));
};
filterFn_arrIncludesSome.autoRemove = (val) => testFalsy(val) || !(val === null || val === void 0 ? void 0 : val.length);
var filterFns = {
	arrIncludes: filterFn_arrIncludes,
	arrIncludesAll: filterFn_arrIncludesAll,
	arrHas: filterFn_arrHas,
	arrIncludesSome: filterFn_arrIncludesSome,
	between: filterFn_between,
	betweenInclusive: filterFn_betweenInclusive,
	equals: filterFn_equals,
	equalsString: filterFn_equalsString,
	inNumberRange: filterFn_inNumberRange,
	includesString: filterFn_includesString,
	includesStringSensitive: filterFn_includesStringSensitive,
	weakEquals: filterFn_weakEquals
};
function testFalsy(val) {
	return val === void 0 || val === null || val === "";
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/fns/sortFns.js
var reSplitAlphaNumeric = /([0-9]+)/gm;
var sortFn_alphanumeric = (rowA, rowB, columnId) => {
	return compareAlphanumeric(toString(rowA.getValue(columnId)).toLowerCase(), toString(rowB.getValue(columnId)).toLowerCase());
};
var sortFn_alphanumericCaseSensitive = (rowA, rowB, columnId) => {
	return compareAlphanumeric(toString(rowA.getValue(columnId)), toString(rowB.getValue(columnId)));
};
var sortFn_text = (rowA, rowB, columnId) => {
	return compareBasic(toString(rowA.getValue(columnId)).toLowerCase(), toString(rowB.getValue(columnId)).toLowerCase());
};
var sortFn_textCaseSensitive = (rowA, rowB, columnId) => {
	return compareBasic(toString(rowA.getValue(columnId)), toString(rowB.getValue(columnId)));
};
var sortFn_datetime = (rowA, rowB, columnId) => {
	const a = rowA.getValue(columnId);
	const b = rowB.getValue(columnId);
	return a > b ? 1 : a < b ? -1 : 0;
};
var sortFn_basic = (rowA, rowB, columnId) => {
	return compareBasic(rowA.getValue(columnId), rowB.getValue(columnId));
};
function compareBasic(a, b) {
	return a === b ? 0 : a > b ? 1 : -1;
}
function toString(a) {
	if (typeof a === "number") {
		if (isNaN(a) || a === Infinity || a === -Infinity) return "";
		return String(a);
	}
	if (typeof a === "string") return a;
	return "";
}
function compareAlphanumeric(aStr, bStr) {
	const a = aStr.split(reSplitAlphaNumeric).filter(Boolean);
	const b = bStr.split(reSplitAlphaNumeric).filter(Boolean);
	while (a.length && b.length) {
		const aa = a.shift();
		const bb = b.shift();
		const an = parseInt(aa, 10);
		const bn = parseInt(bb, 10);
		const combo = [an, bn].sort();
		if (isNaN(combo[0])) {
			if (aa > bb) return 1;
			if (bb > aa) return -1;
			continue;
		}
		if (isNaN(combo[1])) return isNaN(an) ? -1 : 1;
		if (an > bn) return 1;
		if (bn > an) return -1;
	}
	return a.length - b.length;
}
var sortFns = {
	alphanumeric: sortFn_alphanumeric,
	alphanumericCaseSensitive: sortFn_alphanumericCaseSensitive,
	basic: sortFn_basic,
	datetime: sortFn_datetime,
	text: sortFn_text,
	textCaseSensitive: sortFn_textCaseSensitive
};
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-faceting/columnFacetingFeature.utils.js
function column_getFacetedMinMaxValues(column, table) {
	var _table$options$_rowMo, _table$options$_rowMo2;
	return (((_table$options$_rowMo = table.options._rowModels) === null || _table$options$_rowMo === void 0 || (_table$options$_rowMo2 = _table$options$_rowMo.facetedMinMaxValues) === null || _table$options$_rowMo2 === void 0 ? void 0 : _table$options$_rowMo2.call(_table$options$_rowMo, table, column.id)) ?? (() => void 0))();
}
function column_getFacetedRowModel(column, table) {
	var _table$options$_rowMo3, _table$options$_rowMo4;
	return (((_table$options$_rowMo3 = table.options._rowModels) === null || _table$options$_rowMo3 === void 0 || (_table$options$_rowMo4 = _table$options$_rowMo3.facetedRowModel) === null || _table$options$_rowMo4 === void 0 ? void 0 : _table$options$_rowMo4.call(_table$options$_rowMo3, table, (column === null || column === void 0 ? void 0 : column.id) ?? "")) ?? (() => table.getPreFilteredRowModel()))();
}
function column_getFacetedUniqueValues(column, table) {
	var _table$options$_rowMo5, _table$options$_rowMo6;
	return (((_table$options$_rowMo5 = table.options._rowModels) === null || _table$options$_rowMo5 === void 0 || (_table$options$_rowMo6 = _table$options$_rowMo5.facetedUniqueValues) === null || _table$options$_rowMo6 === void 0 ? void 0 : _table$options$_rowMo6.call(_table$options$_rowMo5, table, column.id)) ?? (() => /* @__PURE__ */ new Map()))();
}
function table_getGlobalFacetedMinMaxValues(table) {
	var _table$options$_rowMo7, _table$options$_rowMo8;
	return (((_table$options$_rowMo7 = table.options._rowModels) === null || _table$options$_rowMo7 === void 0 || (_table$options$_rowMo8 = _table$options$_rowMo7.facetedMinMaxValues) === null || _table$options$_rowMo8 === void 0 ? void 0 : _table$options$_rowMo8.call(_table$options$_rowMo7, table, "__global__")) ?? (() => void 0))();
}
function table_getGlobalFacetedRowModel(table) {
	var _table$options$_rowMo9, _table$options$_rowMo10;
	return (((_table$options$_rowMo9 = table.options._rowModels) === null || _table$options$_rowMo9 === void 0 || (_table$options$_rowMo10 = _table$options$_rowMo9.facetedRowModel) === null || _table$options$_rowMo10 === void 0 ? void 0 : _table$options$_rowMo10.call(_table$options$_rowMo9, table, "__global__")) ?? (() => table.getPreFilteredRowModel()))();
}
function table_getGlobalFacetedUniqueValues(table) {
	var _table$options$_rowMo11, _table$options$_rowMo12;
	return (((_table$options$_rowMo11 = table.options._rowModels) === null || _table$options$_rowMo11 === void 0 || (_table$options$_rowMo12 = _table$options$_rowMo11.facetedUniqueValues) === null || _table$options$_rowMo12 === void 0 ? void 0 : _table$options$_rowMo12.call(_table$options$_rowMo11, table, "__global__")) ?? (() => /* @__PURE__ */ new Map()))();
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-faceting/columnFacetingFeature.js
function constructColumnFacetingFeature() {
	return {
		assignColumnPrototype: (prototype, table) => {
			assignPrototypeAPIs("columnFacetingFeature", prototype, table, {
				column_getFacetedRowModel: {
					memoDeps: () => {
						var _table$atoms$columnFi, _table$atoms$globalFi;
						return [
							table.getPreFilteredRowModel().rows,
							(_table$atoms$columnFi = table.atoms.columnFilters) === null || _table$atoms$columnFi === void 0 ? void 0 : _table$atoms$columnFi.get(),
							(_table$atoms$globalFi = table.atoms.globalFilter) === null || _table$atoms$globalFi === void 0 ? void 0 : _table$atoms$globalFi.get(),
							table.getFilteredRowModel().rows
						];
					},
					fn: (column) => column_getFacetedRowModel(column, column.table)
				},
				column_getFacetedMinMaxValues: {
					memoDeps: (column) => [callMemoOrStaticFn(column, "getFacetedRowModel", column_getFacetedRowModel, column.table).flatRows],
					fn: (column) => column_getFacetedMinMaxValues(column, column.table)
				},
				column_getFacetedUniqueValues: {
					memoDeps: (column) => [callMemoOrStaticFn(column, "getFacetedRowModel", column_getFacetedRowModel, column.table).flatRows],
					fn: (column) => column_getFacetedUniqueValues(column, column.table)
				}
			});
		},
		constructTableAPIs: (table) => {
			assignTableAPIs("columnFacetingFeature", table, {
				table_getGlobalFacetedRowModel: {
					memoDeps: () => {
						var _table$atoms$columnFi2, _table$atoms$globalFi2;
						return [
							table.getPreFilteredRowModel().rows,
							(_table$atoms$columnFi2 = table.atoms.columnFilters) === null || _table$atoms$columnFi2 === void 0 ? void 0 : _table$atoms$columnFi2.get(),
							(_table$atoms$globalFi2 = table.atoms.globalFilter) === null || _table$atoms$globalFi2 === void 0 ? void 0 : _table$atoms$globalFi2.get(),
							table.getFilteredRowModel().rows
						];
					},
					fn: () => table_getGlobalFacetedRowModel(table)
				},
				table_getGlobalFacetedMinMaxValues: {
					memoDeps: () => [callMemoOrStaticFn(table, "getGlobalFacetedRowModel", table_getGlobalFacetedRowModel).flatRows],
					fn: () => table_getGlobalFacetedMinMaxValues(table)
				},
				table_getGlobalFacetedUniqueValues: {
					memoDeps: () => [callMemoOrStaticFn(table, "getGlobalFacetedRowModel", table_getGlobalFacetedRowModel).flatRows],
					fn: () => table_getGlobalFacetedUniqueValues(table)
				}
			});
		}
	};
}
/**
* The Column Faceting feature adds column faceting APIs to the column objects.
*/
var columnFacetingFeature = constructColumnFacetingFeature();
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-filtering/columnFilteringFeature.utils.js
function getDefaultColumnFiltersState() {
	return [];
}
function column_getAutoFilterFn(column) {
	const filterFns = column.table._rowModelFns.filterFns;
	const firstRow = column.table.getCoreRowModel().flatRows[0];
	const value = firstRow ? firstRow.getValue(column.id) : void 0;
	if (typeof value === "string") return filterFns === null || filterFns === void 0 ? void 0 : filterFns.includesString;
	if (typeof value === "number") return filterFns === null || filterFns === void 0 ? void 0 : filterFns.inNumberRange;
	if (typeof value === "boolean") return filterFns === null || filterFns === void 0 ? void 0 : filterFns.equals;
	if (value !== null && typeof value === "object") return filterFns === null || filterFns === void 0 ? void 0 : filterFns.equals;
	if (Array.isArray(value)) return filterFns === null || filterFns === void 0 ? void 0 : filterFns.arrIncludes;
	return filterFns === null || filterFns === void 0 ? void 0 : filterFns.weakEquals;
}
function column_getFilterFn(column) {
	let filterFn = null;
	const filterFns = column.table._rowModelFns.filterFns;
	filterFn = isFunction(column.columnDef.filterFn) ? column.columnDef.filterFn : column.columnDef.filterFn === "auto" ? column_getAutoFilterFn(column) : filterFns === null || filterFns === void 0 ? void 0 : filterFns[column.columnDef.filterFn];
	if (process.env.NODE_ENV === "development" && !filterFn) console.warn(`Could not find a valid 'column.filterFn' for column with the ID: ${column.id}.`);
	return filterFn;
}
function column_getCanFilter(column) {
	return (column.columnDef.enableColumnFilter ?? true) && (column.table.options.enableColumnFilters ?? true) && (column.table.options.enableFilters ?? true) && !!column.accessorFn;
}
function column_getIsFiltered(column) {
	return column_getFilterIndex(column) > -1;
}
function column_getFilterValue(column) {
	var _column$table$atoms$c;
	return (_column$table$atoms$c = column.table.atoms.columnFilters) === null || _column$table$atoms$c === void 0 || (_column$table$atoms$c = _column$table$atoms$c.get()) === null || _column$table$atoms$c === void 0 || (_column$table$atoms$c = _column$table$atoms$c.find((d) => d.id === column.id)) === null || _column$table$atoms$c === void 0 ? void 0 : _column$table$atoms$c.value;
}
function column_getFilterIndex(column) {
	var _column$table$atoms$c2;
	return ((_column$table$atoms$c2 = column.table.atoms.columnFilters) === null || _column$table$atoms$c2 === void 0 || (_column$table$atoms$c2 = _column$table$atoms$c2.get()) === null || _column$table$atoms$c2 === void 0 ? void 0 : _column$table$atoms$c2.findIndex((d) => d.id === column.id)) ?? -1;
}
function column_setFilterValue(column, value) {
	table_setColumnFilters(column.table, (old) => {
		const filterFn = column_getFilterFn(column);
		const previousFilter = old.find((d) => d.id === column.id);
		const newFilter = functionalUpdate(value, previousFilter ? previousFilter.value : void 0);
		if (shouldAutoRemoveFilter(filterFn, newFilter, column)) return old.filter((d) => d.id !== column.id);
		const newFilterObj = {
			id: column.id,
			value: newFilter
		};
		if (previousFilter) return old.map((d) => {
			if (d.id === column.id) return newFilterObj;
			return d;
		});
		if (old.length) return [...old, newFilterObj];
		return [newFilterObj];
	});
}
function table_setColumnFilters(table, updater) {
	var _table$options$onColu, _table$options;
	const leafColumns = table.getAllLeafColumns();
	const updateFn = (old) => {
		return functionalUpdate(updater, old).filter((filter) => {
			const column = leafColumns.find((d) => d.id === filter.id);
			if (column) {
				if (shouldAutoRemoveFilter(column_getFilterFn(column), filter.value, column)) return false;
			}
			return true;
		});
	};
	(_table$options$onColu = (_table$options = table.options).onColumnFiltersChange) === null || _table$options$onColu === void 0 || _table$options$onColu.call(_table$options, updateFn);
}
function table_resetColumnFilters(table, defaultState) {
	table_setColumnFilters(table, defaultState ? [] : cloneState(table.initialState.columnFilters ?? []));
}
function shouldAutoRemoveFilter(filterFn, value, column) {
	return (filterFn && filterFn.autoRemove ? filterFn.autoRemove(value, column) : false) || typeof value === "undefined" || typeof value === "string" && !value;
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-filtering/columnFilteringFeature.js
function constructColumnFilteringFeature() {
	return {
		getInitialState: (initialState) => {
			return {
				columnFilters: getDefaultColumnFiltersState(),
				...initialState
			};
		},
		getDefaultColumnDef: () => {
			return { filterFn: "auto" };
		},
		getDefaultTableOptions: (table) => {
			return {
				onColumnFiltersChange: makeStateUpdater("columnFilters", table),
				filterFromLeafRows: false,
				maxLeafRowFilterDepth: 100
			};
		},
		assignColumnPrototype: (prototype, table) => {
			assignPrototypeAPIs("columnFilteringFeature", prototype, table, {
				column_getAutoFilterFn: { fn: (column) => column_getAutoFilterFn(column) },
				column_getFilterFn: { fn: (column) => column_getFilterFn(column) },
				column_getCanFilter: { fn: (column) => column_getCanFilter(column) },
				column_getIsFiltered: { fn: (column) => column_getIsFiltered(column) },
				column_getFilterValue: { fn: (column) => column_getFilterValue(column) },
				column_getFilterIndex: { fn: (column) => column_getFilterIndex(column) },
				column_setFilterValue: { fn: (column, value) => column_setFilterValue(column, value) }
			});
		},
		initRowInstanceData: (row) => {
			row.columnFilters = {};
			row.columnFiltersMeta = {};
		},
		constructTableAPIs: (table) => {
			assignTableAPIs("columnFilteringFeature", table, {
				table_setColumnFilters: { fn: (updater) => table_setColumnFilters(table, updater) },
				table_resetColumnFilters: { fn: (defaultState) => table_resetColumnFilters(table, defaultState) }
			});
		}
	};
}
/**
* The Column Filtering feature adds column filtering state and APIs to the table, row, and column objects.
* **Note:** This does not include Global Filtering. The globalFilteringFeature feature has been split out into its own standalone feature.
*/
var columnFilteringFeature = constructColumnFilteringFeature();
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-grouping/columnGroupingFeature.utils.js
function getDefaultGroupingState() {
	return [];
}
function column_toggleGrouping(column) {
	table_setGrouping(column.table, (old) => {
		if (old.includes(column.id)) return old.filter((d) => d !== column.id);
		return [...old, column.id];
	});
}
function column_getCanGroup(column) {
	return (column.columnDef.enableGrouping ?? true) && (column.table.options.enableGrouping ?? true) && (!!column.accessorFn || !!column.columnDef.getGroupingValue);
}
function column_getIsGrouped(column) {
	var _column$table$atoms$g;
	return !!((_column$table$atoms$g = column.table.atoms.grouping) === null || _column$table$atoms$g === void 0 || (_column$table$atoms$g = _column$table$atoms$g.get()) === null || _column$table$atoms$g === void 0 ? void 0 : _column$table$atoms$g.includes(column.id));
}
function column_getGroupedIndex(column) {
	var _column$table$atoms$g2;
	return ((_column$table$atoms$g2 = column.table.atoms.grouping) === null || _column$table$atoms$g2 === void 0 || (_column$table$atoms$g2 = _column$table$atoms$g2.get()) === null || _column$table$atoms$g2 === void 0 ? void 0 : _column$table$atoms$g2.indexOf(column.id)) ?? -1;
}
function column_getToggleGroupingHandler(column) {
	const canGroup = column_getCanGroup(column);
	return () => {
		if (!canGroup) return;
		column_toggleGrouping(column);
	};
}
function column_getAutoAggregationFn(column) {
	const aggregationFns = column.table._rowModelFns.aggregationFns;
	const firstRow = column.table.getCoreRowModel().flatRows[0];
	const value = firstRow === null || firstRow === void 0 ? void 0 : firstRow.getValue(column.id);
	if (typeof value === "number") return aggregationFns === null || aggregationFns === void 0 ? void 0 : aggregationFns.sum;
	if (Object.prototype.toString.call(value) === "[object Date]") return aggregationFns === null || aggregationFns === void 0 ? void 0 : aggregationFns.extent;
}
function column_getAggregationFn(column) {
	const aggregationFns = column.table._rowModelFns.aggregationFns;
	return isFunction(column.columnDef.aggregationFn) ? column.columnDef.aggregationFn : column.columnDef.aggregationFn === "auto" ? column_getAutoAggregationFn(column) : aggregationFns === null || aggregationFns === void 0 ? void 0 : aggregationFns[column.columnDef.aggregationFn];
}
function table_setGrouping(table, updater) {
	var _table$options$onGrou, _table$options;
	(_table$options$onGrou = (_table$options = table.options).onGroupingChange) === null || _table$options$onGrou === void 0 || _table$options$onGrou.call(_table$options, updater);
}
function table_resetGrouping(table, defaultState) {
	table_setGrouping(table, defaultState ? [] : cloneState(table.initialState.grouping ?? []));
}
function row_getIsGrouped(row) {
	return !!row.groupingColumnId;
}
function row_getGroupingValue(row, columnId) {
	var _row$_groupingValuesC, _row$_groupingValuesC2;
	if ((_row$_groupingValuesC = row._groupingValuesCache) === null || _row$_groupingValuesC === void 0 ? void 0 : _row$_groupingValuesC.hasOwnProperty(columnId)) return row._groupingValuesCache[columnId];
	const column = table_getColumn(row.table, columnId);
	if (!column.columnDef.getGroupingValue) return row.getValue(columnId);
	if (row._groupingValuesCache) row._groupingValuesCache[columnId] = column.columnDef.getGroupingValue(row.original);
	return (_row$_groupingValuesC2 = row._groupingValuesCache) === null || _row$_groupingValuesC2 === void 0 ? void 0 : _row$_groupingValuesC2[columnId];
}
function cell_getIsGrouped(cell) {
	const row = cell.row;
	return column_getIsGrouped(cell.column) && cell.column.id === row.groupingColumnId;
}
function cell_getIsPlaceholder(cell) {
	return !cell_getIsGrouped(cell) && column_getIsGrouped(cell.column);
}
function cell_getIsAggregated(cell) {
	return !cell_getIsGrouped(cell) && !cell_getIsPlaceholder(cell) && !!cell.row.subRows.length;
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-grouping/columnGroupingFeature.js
function constructColumnGroupingFeature() {
	return {
		getInitialState: (initialState) => {
			return {
				grouping: getDefaultGroupingState(),
				...initialState
			};
		},
		getDefaultColumnDef: () => {
			return {
				aggregatedCell: ({ getValue }) => {
					var _getValue, _getValue$toString;
					return ((_getValue = getValue()) === null || _getValue === void 0 || (_getValue$toString = _getValue.toString) === null || _getValue$toString === void 0 ? void 0 : _getValue$toString.call(_getValue)) ?? null;
				},
				aggregationFn: "auto"
			};
		},
		getDefaultTableOptions: (table) => {
			return {
				onGroupingChange: makeStateUpdater("grouping", table),
				groupedColumnMode: "reorder"
			};
		},
		assignCellPrototype: (prototype, table) => {
			assignPrototypeAPIs("columnGroupingFeature", prototype, table, {
				cell_getIsGrouped: { fn: (cell) => cell_getIsGrouped(cell) },
				cell_getIsPlaceholder: { fn: (cell) => cell_getIsPlaceholder(cell) },
				cell_getIsAggregated: { fn: (cell) => cell_getIsAggregated(cell) }
			});
		},
		assignColumnPrototype: (prototype, table) => {
			assignPrototypeAPIs("columnGroupingFeature", prototype, table, {
				column_toggleGrouping: { fn: (column) => column_toggleGrouping(column) },
				column_getCanGroup: { fn: (column) => column_getCanGroup(column) },
				column_getIsGrouped: { fn: (column) => column_getIsGrouped(column) },
				column_getGroupedIndex: { fn: (column) => column_getGroupedIndex(column) },
				column_getToggleGroupingHandler: { fn: (column) => column_getToggleGroupingHandler(column) },
				column_getAutoAggregationFn: { fn: (column) => column_getAutoAggregationFn(column) },
				column_getAggregationFn: { fn: (column) => column_getAggregationFn(column) }
			});
		},
		assignRowPrototype: (prototype, table) => {
			assignPrototypeAPIs("columnGroupingFeature", prototype, table, {
				row_getIsGrouped: { fn: (row) => row_getIsGrouped(row) },
				row_getGroupingValue: { fn: (row, columnId) => row_getGroupingValue(row, columnId) }
			});
		},
		initRowInstanceData: (row) => {
			row._groupingValuesCache = {};
		},
		constructTableAPIs: (table) => {
			assignTableAPIs("columnGroupingFeature", table, {
				table_setGrouping: { fn: (updater) => table_setGrouping(table, updater) },
				table_resetGrouping: { fn: (defaultState) => table_resetGrouping(table, defaultState) }
			});
		}
	};
}
/**
* The (Column) Grouping feature adds column grouping state and APIs to the table, row, column, and cell objects.
*/
var columnGroupingFeature = constructColumnGroupingFeature();
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-ordering/columnOrderingFeature.js
function constructColumnOrderingFeature() {
	return {
		getInitialState: (initialState) => {
			return {
				columnOrder: getDefaultColumnOrderState(),
				...initialState
			};
		},
		getDefaultTableOptions: (table) => {
			return { onColumnOrderChange: makeStateUpdater("columnOrder", table) };
		},
		assignColumnPrototype: (prototype, table) => {
			assignPrototypeAPIs("columnOrderingFeature", prototype, table, {
				column_getIndex: {
					fn: (column, position) => column_getIndex(column, position),
					memoDeps: (column, position) => {
						var _column$table$atoms$c, _column$table$atoms$c2, _column$table$atoms$g;
						return [
							position,
							(_column$table$atoms$c = column.table.atoms.columnOrder) === null || _column$table$atoms$c === void 0 ? void 0 : _column$table$atoms$c.get(),
							(_column$table$atoms$c2 = column.table.atoms.columnPinning) === null || _column$table$atoms$c2 === void 0 ? void 0 : _column$table$atoms$c2.get(),
							(_column$table$atoms$g = column.table.atoms.grouping) === null || _column$table$atoms$g === void 0 ? void 0 : _column$table$atoms$g.get()
						];
					}
				},
				column_getIsFirstColumn: { fn: (column, position) => column_getIsFirstColumn(column, position) },
				column_getIsLastColumn: { fn: (column, position) => column_getIsLastColumn(column, position) }
			});
		},
		constructTableAPIs: (table) => {
			assignTableAPIs("columnOrderingFeature", table, {
				table_setColumnOrder: { fn: (updater) => table_setColumnOrder(table, updater) },
				table_resetColumnOrder: { fn: (defaultState) => table_resetColumnOrder(table, defaultState) },
				table_getOrderColumnsFn: {
					fn: () => table_getOrderColumnsFn(table),
					memoDeps: () => {
						var _table$atoms$columnOr, _table$atoms$grouping;
						return [
							(_table$atoms$columnOr = table.atoms.columnOrder) === null || _table$atoms$columnOr === void 0 ? void 0 : _table$atoms$columnOr.get(),
							(_table$atoms$grouping = table.atoms.grouping) === null || _table$atoms$grouping === void 0 ? void 0 : _table$atoms$grouping.get(),
							table.options.groupedColumnMode
						];
					}
				}
			});
		}
	};
}
/**
* The Column Ordering feature adds column ordering state and APIs to the table and column objects.
*/
var columnOrderingFeature = constructColumnOrderingFeature();
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-pinning/columnPinningFeature.js
function constructColumnPinningFeature() {
	return {
		getInitialState: (initialState) => {
			return {
				columnPinning: {
					...getDefaultColumnPinningState(),
					...initialState.columnPinning
				},
				...initialState
			};
		},
		getDefaultTableOptions: (table) => {
			return { onColumnPinningChange: makeStateUpdater("columnPinning", table) };
		},
		assignColumnPrototype: (prototype, table) => {
			assignPrototypeAPIs("columnPinningFeature", prototype, table, {
				column_pin: { fn: (column, position) => column_pin(column, position) },
				column_getCanPin: { fn: (column) => column_getCanPin(column) },
				column_getPinnedIndex: { fn: (column) => column_getPinnedIndex(column) },
				column_getIsPinned: { fn: (column) => column_getIsPinned(column) }
			});
		},
		assignRowPrototype: (prototype, table) => {
			assignPrototypeAPIs("columnPinningFeature", prototype, table, {
				row_getCenterVisibleCells: {
					fn: (row) => row_getCenterVisibleCells(row),
					memoDeps: (row) => {
						var _row$table$atoms$colu, _row$table$atoms$colu2;
						return [
							row.getAllCells(),
							(_row$table$atoms$colu = row.table.atoms.columnPinning) === null || _row$table$atoms$colu === void 0 ? void 0 : _row$table$atoms$colu.get(),
							(_row$table$atoms$colu2 = row.table.atoms.columnVisibility) === null || _row$table$atoms$colu2 === void 0 ? void 0 : _row$table$atoms$colu2.get()
						];
					}
				},
				row_getLeftVisibleCells: {
					fn: (row) => row_getLeftVisibleCells(row),
					memoDeps: (row) => {
						var _row$table$atoms$colu3, _row$table$atoms$colu4;
						return [
							row.getAllCells(),
							(_row$table$atoms$colu3 = row.table.atoms.columnPinning) === null || _row$table$atoms$colu3 === void 0 || (_row$table$atoms$colu3 = _row$table$atoms$colu3.get()) === null || _row$table$atoms$colu3 === void 0 ? void 0 : _row$table$atoms$colu3.left,
							(_row$table$atoms$colu4 = row.table.atoms.columnVisibility) === null || _row$table$atoms$colu4 === void 0 ? void 0 : _row$table$atoms$colu4.get()
						];
					}
				},
				row_getRightVisibleCells: {
					fn: (row) => row_getRightVisibleCells(row),
					memoDeps: (row) => {
						var _row$table$atoms$colu5, _row$table$atoms$colu6;
						return [
							row.getAllCells(),
							(_row$table$atoms$colu5 = row.table.atoms.columnPinning) === null || _row$table$atoms$colu5 === void 0 || (_row$table$atoms$colu5 = _row$table$atoms$colu5.get()) === null || _row$table$atoms$colu5 === void 0 ? void 0 : _row$table$atoms$colu5.right,
							(_row$table$atoms$colu6 = row.table.atoms.columnVisibility) === null || _row$table$atoms$colu6 === void 0 ? void 0 : _row$table$atoms$colu6.get()
						];
					}
				}
			});
		},
		constructTableAPIs: (table) => {
			assignTableAPIs("columnPinningFeature", table, {
				table_setColumnPinning: { fn: (updater) => table_setColumnPinning(table, updater) },
				table_resetColumnPinning: { fn: (defaultState) => table_resetColumnPinning(table, defaultState) },
				table_getIsSomeColumnsPinned: { fn: (position) => table_getIsSomeColumnsPinned(table, position) },
				table_getLeftHeaderGroups: {
					fn: () => table_getLeftHeaderGroups(table),
					memoDeps: () => {
						var _table$atoms$columnPi, _table$atoms$columnOr;
						return [
							table.getAllColumns(),
							callMemoOrStaticFn(table, "getVisibleLeafColumns", table_getVisibleLeafColumns),
							(_table$atoms$columnPi = table.atoms.columnPinning) === null || _table$atoms$columnPi === void 0 || (_table$atoms$columnPi = _table$atoms$columnPi.get()) === null || _table$atoms$columnPi === void 0 ? void 0 : _table$atoms$columnPi.left,
							(_table$atoms$columnOr = table.atoms.columnOrder) === null || _table$atoms$columnOr === void 0 ? void 0 : _table$atoms$columnOr.get()
						];
					}
				},
				table_getCenterHeaderGroups: {
					fn: () => table_getCenterHeaderGroups(table),
					memoDeps: () => {
						var _table$atoms$columnPi2, _table$atoms$columnOr2;
						return [
							table.getAllColumns(),
							callMemoOrStaticFn(table, "getVisibleLeafColumns", table_getVisibleLeafColumns),
							(_table$atoms$columnPi2 = table.atoms.columnPinning) === null || _table$atoms$columnPi2 === void 0 ? void 0 : _table$atoms$columnPi2.get(),
							(_table$atoms$columnOr2 = table.atoms.columnOrder) === null || _table$atoms$columnOr2 === void 0 ? void 0 : _table$atoms$columnOr2.get()
						];
					}
				},
				table_getRightHeaderGroups: {
					fn: () => table_getRightHeaderGroups(table),
					memoDeps: () => {
						var _table$atoms$columnPi3, _table$atoms$columnOr3;
						return [
							table.getAllColumns(),
							callMemoOrStaticFn(table, "getVisibleLeafColumns", table_getVisibleLeafColumns),
							(_table$atoms$columnPi3 = table.atoms.columnPinning) === null || _table$atoms$columnPi3 === void 0 || (_table$atoms$columnPi3 = _table$atoms$columnPi3.get()) === null || _table$atoms$columnPi3 === void 0 ? void 0 : _table$atoms$columnPi3.right,
							(_table$atoms$columnOr3 = table.atoms.columnOrder) === null || _table$atoms$columnOr3 === void 0 ? void 0 : _table$atoms$columnOr3.get()
						];
					}
				},
				table_getLeftFooterGroups: {
					fn: () => table_getLeftFooterGroups(table),
					memoDeps: () => [callMemoOrStaticFn(table, "getLeftHeaderGroups", table_getLeftHeaderGroups)]
				},
				table_getCenterFooterGroups: {
					fn: () => table_getCenterFooterGroups(table),
					memoDeps: () => [callMemoOrStaticFn(table, "getCenterHeaderGroups", table_getCenterHeaderGroups)]
				},
				table_getRightFooterGroups: {
					fn: () => table_getRightFooterGroups(table),
					memoDeps: () => [callMemoOrStaticFn(table, "getRightHeaderGroups", table_getRightHeaderGroups)]
				},
				table_getLeftFlatHeaders: {
					fn: () => table_getLeftFlatHeaders(table),
					memoDeps: () => [callMemoOrStaticFn(table, "getLeftHeaderGroups", table_getLeftHeaderGroups)]
				},
				table_getRightFlatHeaders: {
					fn: () => table_getRightFlatHeaders(table),
					memoDeps: () => [callMemoOrStaticFn(table, "getRightHeaderGroups", table_getRightHeaderGroups)]
				},
				table_getCenterFlatHeaders: {
					fn: () => table_getCenterFlatHeaders(table),
					memoDeps: () => [callMemoOrStaticFn(table, "getCenterHeaderGroups", table_getCenterHeaderGroups)]
				},
				table_getLeftLeafHeaders: {
					fn: () => table_getLeftLeafHeaders(table),
					memoDeps: () => [callMemoOrStaticFn(table, "getLeftHeaderGroups", table_getLeftHeaderGroups)]
				},
				table_getRightLeafHeaders: {
					fn: () => table_getRightLeafHeaders(table),
					memoDeps: () => [callMemoOrStaticFn(table, "getRightHeaderGroups", table_getRightHeaderGroups)]
				},
				table_getCenterLeafHeaders: {
					fn: () => table_getCenterLeafHeaders(table),
					memoDeps: () => [callMemoOrStaticFn(table, "getCenterHeaderGroups", table_getCenterHeaderGroups)]
				},
				table_getLeftLeafColumns: {
					fn: () => table_getLeftLeafColumns(table),
					memoDeps: () => {
						var _table$atoms$columnPi4;
						return [table.options.columns, (_table$atoms$columnPi4 = table.atoms.columnPinning) === null || _table$atoms$columnPi4 === void 0 ? void 0 : _table$atoms$columnPi4.get()];
					}
				},
				table_getRightLeafColumns: {
					fn: () => table_getRightLeafColumns(table),
					memoDeps: () => {
						var _table$atoms$columnPi5;
						return [table.options.columns, (_table$atoms$columnPi5 = table.atoms.columnPinning) === null || _table$atoms$columnPi5 === void 0 ? void 0 : _table$atoms$columnPi5.get()];
					}
				},
				table_getCenterLeafColumns: {
					fn: () => table_getCenterLeafColumns(table),
					memoDeps: () => {
						var _table$atoms$columnPi6;
						return [table.options.columns, (_table$atoms$columnPi6 = table.atoms.columnPinning) === null || _table$atoms$columnPi6 === void 0 ? void 0 : _table$atoms$columnPi6.get()];
					}
				},
				table_getLeftVisibleLeafColumns: {
					fn: () => table_getLeftVisibleLeafColumns(table),
					memoDeps: () => {
						var _table$atoms$columnPi7, _table$atoms$columnVi;
						return [
							table.options.columns,
							(_table$atoms$columnPi7 = table.atoms.columnPinning) === null || _table$atoms$columnPi7 === void 0 ? void 0 : _table$atoms$columnPi7.get(),
							(_table$atoms$columnVi = table.atoms.columnVisibility) === null || _table$atoms$columnVi === void 0 ? void 0 : _table$atoms$columnVi.get()
						];
					}
				},
				table_getCenterVisibleLeafColumns: {
					fn: () => table_getCenterVisibleLeafColumns(table),
					memoDeps: () => {
						var _table$atoms$columnPi8, _table$atoms$columnVi2;
						return [
							table.options.columns,
							(_table$atoms$columnPi8 = table.atoms.columnPinning) === null || _table$atoms$columnPi8 === void 0 ? void 0 : _table$atoms$columnPi8.get(),
							(_table$atoms$columnVi2 = table.atoms.columnVisibility) === null || _table$atoms$columnVi2 === void 0 ? void 0 : _table$atoms$columnVi2.get()
						];
					}
				},
				table_getRightVisibleLeafColumns: {
					fn: () => table_getRightVisibleLeafColumns(table),
					memoDeps: () => {
						var _table$atoms$columnPi9, _table$atoms$columnVi3;
						return [
							table.options.columns,
							(_table$atoms$columnPi9 = table.atoms.columnPinning) === null || _table$atoms$columnPi9 === void 0 ? void 0 : _table$atoms$columnPi9.get(),
							(_table$atoms$columnVi3 = table.atoms.columnVisibility) === null || _table$atoms$columnVi3 === void 0 ? void 0 : _table$atoms$columnVi3.get()
						];
					}
				}
			});
		}
	};
}
/**
* The Column Pinning feature adds column pinning state and APIs to the table, row, and column objects.
*/
var columnPinningFeature = constructColumnPinningFeature();
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-sizing/columnSizingFeature.utils.js
function getDefaultColumnSizingState() {
	return {};
}
function getDefaultColumnSizingColumnDef() {
	return {
		size: 150,
		minSize: 20,
		maxSize: Number.MAX_SAFE_INTEGER
	};
}
function column_getSize(column) {
	var _column$table$atoms$c;
	const defaultSizes = getDefaultColumnSizingColumnDef();
	const columnSize = (_column$table$atoms$c = column.table.atoms.columnSizing) === null || _column$table$atoms$c === void 0 || (_column$table$atoms$c = _column$table$atoms$c.get()) === null || _column$table$atoms$c === void 0 ? void 0 : _column$table$atoms$c[column.id];
	return Math.min(Math.max(column.columnDef.minSize ?? defaultSizes.minSize, columnSize ?? column.columnDef.size ?? defaultSizes.size), column.columnDef.maxSize ?? defaultSizes.maxSize);
}
function column_getStart(column, position) {
	return callMemoOrStaticFn(column.table, "getPinnedVisibleLeafColumns", table_getPinnedVisibleLeafColumns, position).slice(0, callMemoOrStaticFn(column, "getIndex", column_getIndex, position)).reduce((sum, c) => sum + column_getSize(c), 0);
}
function column_getAfter(column, position) {
	return callMemoOrStaticFn(column.table, "getPinnedVisibleLeafColumns", table_getPinnedVisibleLeafColumns, position).slice(callMemoOrStaticFn(column, "getIndex", column_getIndex, position) + 1).reduce((sum, c) => sum + column_getSize(c), 0);
}
function column_resetSize(column) {
	table_setColumnSizing(column.table, ({ [column.id]: _, ...rest }) => {
		return rest;
	});
}
function header_getSize(header) {
	let sum = 0;
	const recurse = (h) => {
		if (h.subHeaders.length) h.subHeaders.forEach(recurse);
		else sum += column_getSize(h.column);
	};
	recurse(header);
	return sum;
}
function header_getStart(header) {
	if (header.index > 0) {
		var _header$headerGroup;
		const prevSiblingHeader = (_header$headerGroup = header.headerGroup) === null || _header$headerGroup === void 0 ? void 0 : _header$headerGroup.headers[header.index - 1];
		if (prevSiblingHeader) return header_getStart(prevSiblingHeader) + header_getSize(prevSiblingHeader);
	}
	return 0;
}
function table_setColumnSizing(table, updater) {
	var _table$options$onColu, _table$options;
	(_table$options$onColu = (_table$options = table.options).onColumnSizingChange) === null || _table$options$onColu === void 0 || _table$options$onColu.call(_table$options, updater);
}
function table_resetColumnSizing(table, defaultState) {
	table_setColumnSizing(table, defaultState ? {} : cloneState(table.initialState.columnSizing ?? {}));
}
function table_getTotalSize(table) {
	var _table$getHeaderGroup;
	return ((_table$getHeaderGroup = table.getHeaderGroups()[0]) === null || _table$getHeaderGroup === void 0 ? void 0 : _table$getHeaderGroup.headers.reduce((sum, header) => {
		return sum + header_getSize(header);
	}, 0)) ?? 0;
}
function table_getLeftTotalSize(table) {
	var _callMemoOrStaticFn$;
	return ((_callMemoOrStaticFn$ = callMemoOrStaticFn(table, "getLeftHeaderGroups", table_getLeftHeaderGroups)[0]) === null || _callMemoOrStaticFn$ === void 0 ? void 0 : _callMemoOrStaticFn$.headers.reduce((sum, header) => {
		return sum + header_getSize(header);
	}, 0)) ?? 0;
}
function table_getCenterTotalSize(table) {
	var _callMemoOrStaticFn$2;
	return ((_callMemoOrStaticFn$2 = callMemoOrStaticFn(table, "getCenterHeaderGroups", table_getCenterHeaderGroups)[0]) === null || _callMemoOrStaticFn$2 === void 0 ? void 0 : _callMemoOrStaticFn$2.headers.reduce((sum, header) => {
		return sum + header_getSize(header);
	}, 0)) ?? 0;
}
function table_getRightTotalSize(table) {
	var _callMemoOrStaticFn$3;
	return ((_callMemoOrStaticFn$3 = callMemoOrStaticFn(table, "getRightHeaderGroups", table_getRightHeaderGroups)[0]) === null || _callMemoOrStaticFn$3 === void 0 ? void 0 : _callMemoOrStaticFn$3.headers.reduce((sum, header) => {
		return sum + header_getSize(header);
	}, 0)) ?? 0;
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-resizing/columnResizingFeature.utils.js
function getDefaultColumnResizingState() {
	return {
		startOffset: null,
		startSize: null,
		deltaOffset: null,
		deltaPercentage: null,
		isResizingColumn: false,
		columnSizingStart: []
	};
}
function column_getCanResize(column) {
	return (column.columnDef.enableResizing ?? true) && (column.table.options.enableColumnResizing ?? true);
}
function column_getIsResizing(column) {
	var _column$table$atoms$c;
	return ((_column$table$atoms$c = column.table.atoms.columnResizing) === null || _column$table$atoms$c === void 0 || (_column$table$atoms$c = _column$table$atoms$c.get()) === null || _column$table$atoms$c === void 0 ? void 0 : _column$table$atoms$c.isResizingColumn) === column.id;
}
function header_getResizeHandler(header, _contextDocument) {
	const column = table_getColumn(header.column.table, header.column.id);
	const canResize = column_getCanResize(column);
	return (event) => {
		var _persist;
		if (!canResize) return;
		(_persist = event.persist) === null || _persist === void 0 || _persist.call(event);
		if (isTouchStartEvent(event)) {
			if (event.touches.length > 1) return;
		}
		const startSize = header_getSize(header);
		const columnSizingStart = header.getLeafHeaders().map((leafHeader) => [leafHeader.column.id, column_getSize(leafHeader.column)]);
		const clientX = isTouchStartEvent(event) ? Math.round(event.touches[0].clientX) : event.clientX;
		const newColumnSizing = {};
		const updateOffset = (eventType, clientXPos) => {
			if (typeof clientXPos !== "number") return;
			table_setColumnResizing(column.table, (old) => {
				const deltaDirection = column.table.options.columnResizeDirection === "rtl" ? -1 : 1;
				const deltaOffset = (clientXPos - (old.startOffset ?? 0)) * deltaDirection;
				const startSize = old.startSize ?? 0;
				const deltaPercentage = Math.max(startSize > 0 ? deltaOffset / startSize : 0, -.999999);
				old.columnSizingStart.forEach(([columnId, headerSize]) => {
					newColumnSizing[columnId] = Math.round(Math.max(headerSize > 0 ? headerSize + headerSize * deltaPercentage : deltaOffset / old.columnSizingStart.length, 0) * 100) / 100;
				});
				return {
					...old,
					deltaOffset,
					deltaPercentage
				};
			});
			if (column.table.options.columnResizeMode === "onChange" || eventType === "end") table_setColumnSizing(column.table, (old) => ({
				...old,
				...newColumnSizing
			}));
		};
		const onMove = (clientXPos) => updateOffset("move", clientXPos);
		const onEnd = (clientXPos) => {
			updateOffset("end", clientXPos);
			table_setColumnResizing(column.table, (old) => ({
				...old,
				isResizingColumn: false,
				startOffset: null,
				startSize: null,
				deltaOffset: null,
				deltaPercentage: null,
				columnSizingStart: []
			}));
		};
		const contextDocument = _contextDocument || typeof document !== "undefined" ? document : null;
		const mouseEvents = {
			moveHandler: (e) => onMove(e.clientX),
			upHandler: (e) => {
				contextDocument === null || contextDocument === void 0 || contextDocument.removeEventListener("mousemove", mouseEvents.moveHandler);
				contextDocument === null || contextDocument === void 0 || contextDocument.removeEventListener("mouseup", mouseEvents.upHandler);
				onEnd(e.clientX);
			}
		};
		const touchEvents = {
			moveHandler: (touchEvent) => {
				if (touchEvent.cancelable) {
					touchEvent.preventDefault();
					touchEvent.stopPropagation();
				}
				onMove(touchEvent.touches[0].clientX);
				return false;
			},
			upHandler: (e) => {
				var _e$touches$;
				contextDocument === null || contextDocument === void 0 || contextDocument.removeEventListener("touchmove", touchEvents.moveHandler);
				contextDocument === null || contextDocument === void 0 || contextDocument.removeEventListener("touchend", touchEvents.upHandler);
				if (e.cancelable) {
					e.preventDefault();
					e.stopPropagation();
				}
				onEnd((_e$touches$ = e.touches[0]) === null || _e$touches$ === void 0 ? void 0 : _e$touches$.clientX);
			}
		};
		const passiveIfSupported = passiveEventSupported() ? { passive: false } : false;
		if (isTouchStartEvent(event)) {
			contextDocument === null || contextDocument === void 0 || contextDocument.addEventListener("touchmove", touchEvents.moveHandler, passiveIfSupported);
			contextDocument === null || contextDocument === void 0 || contextDocument.addEventListener("touchend", touchEvents.upHandler, passiveIfSupported);
		} else {
			contextDocument === null || contextDocument === void 0 || contextDocument.addEventListener("mousemove", mouseEvents.moveHandler, passiveIfSupported);
			contextDocument === null || contextDocument === void 0 || contextDocument.addEventListener("mouseup", mouseEvents.upHandler, passiveIfSupported);
		}
		table_setColumnResizing(column.table, (old) => ({
			...old,
			startOffset: clientX,
			startSize,
			deltaOffset: 0,
			deltaPercentage: 0,
			columnSizingStart,
			isResizingColumn: column.id
		}));
	};
}
function table_setColumnResizing(table, updater) {
	var _table$options$onColu, _table$options;
	(_table$options$onColu = (_table$options = table.options).onColumnResizingChange) === null || _table$options$onColu === void 0 || _table$options$onColu.call(_table$options, updater);
}
function table_resetHeaderSizeInfo(table, defaultState) {
	table_setColumnResizing(table, defaultState ? getDefaultColumnResizingState() : cloneState(table.initialState.columnResizing ?? getDefaultColumnResizingState()));
}
function passiveEventSupported() {
	let passiveSupported = null;
	if (typeof passiveSupported === "boolean") return passiveSupported;
	let supported = false;
	try {
		const options = { get passive() {
			supported = true;
			return false;
		} };
		const noop = () => {};
		window.addEventListener("test", noop, options);
		window.removeEventListener("test", noop);
	} catch (err) {
		supported = false;
	}
	passiveSupported = supported;
	return passiveSupported;
}
function isTouchStartEvent(e) {
	return e.type === "touchstart";
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-resizing/columnResizingFeature.js
function constructColumnResizingFeature() {
	return {
		getInitialState: (initialState) => {
			return {
				columnResizing: getDefaultColumnResizingState(),
				...initialState
			};
		},
		getDefaultTableOptions: (table) => {
			return {
				columnResizeMode: "onEnd",
				columnResizeDirection: "ltr",
				onColumnResizingChange: makeStateUpdater("columnResizing", table)
			};
		},
		assignColumnPrototype: (prototype, table) => {
			assignPrototypeAPIs("columnResizingFeature", prototype, table, {
				column_getCanResize: { fn: (column) => column_getCanResize(column) },
				column_getIsResizing: { fn: (column) => column_getIsResizing(column) }
			});
		},
		assignHeaderPrototype: (prototype, table) => {
			assignPrototypeAPIs("columnResizingFeature", prototype, table, { header_getResizeHandler: { fn: (header, _contextDocument) => header_getResizeHandler(header, _contextDocument) } });
		},
		constructTableAPIs: (table) => {
			assignTableAPIs("columnResizingFeature", table, {
				table_setColumnResizing: { fn: (updater) => table_setColumnResizing(table, updater) },
				table_resetHeaderSizeInfo: { fn: (defaultState) => table_resetHeaderSizeInfo(table, defaultState) }
			});
		}
	};
}
/**
* The Column Resizing feature adds column resizing state and APIs to the table and column objects.
* **Note:** This is dependent on the Column Sizing feature.
*/
var columnResizingFeature = constructColumnResizingFeature();
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-sizing/columnSizingFeature.js
function constructColumnSizingFeature() {
	return {
		getInitialState: (initialState) => {
			return {
				columnSizing: getDefaultColumnSizingState(),
				...initialState
			};
		},
		getDefaultColumnDef: () => {
			return getDefaultColumnSizingColumnDef();
		},
		getDefaultTableOptions: (table) => {
			return { onColumnSizingChange: makeStateUpdater("columnSizing", table) };
		},
		assignColumnPrototype: (prototype, table) => {
			assignPrototypeAPIs("columnSizingFeature", prototype, table, {
				column_getSize: { fn: (column) => column_getSize(column) },
				column_getStart: {
					fn: (column, position) => column_getStart(column, position),
					memoDeps: (column, position) => {
						var _column$table$atoms$c;
						return [
							position,
							callMemoOrStaticFn(column.table, "getPinnedVisibleLeafColumns", table_getPinnedVisibleLeafColumns, position),
							(_column$table$atoms$c = column.table.atoms.columnSizing) === null || _column$table$atoms$c === void 0 ? void 0 : _column$table$atoms$c.get()
						];
					}
				},
				column_getAfter: {
					fn: (column, position) => column_getAfter(column, position),
					memoDeps: (column, position) => {
						var _column$table$atoms$c2;
						return [
							position,
							callMemoOrStaticFn(column.table, "getPinnedVisibleLeafColumns", table_getPinnedVisibleLeafColumns, position),
							(_column$table$atoms$c2 = column.table.atoms.columnSizing) === null || _column$table$atoms$c2 === void 0 ? void 0 : _column$table$atoms$c2.get()
						];
					}
				},
				column_resetSize: { fn: (column) => column_resetSize(column) }
			});
		},
		assignHeaderPrototype: (prototype, table) => {
			assignPrototypeAPIs("columnSizingFeature", prototype, table, {
				header_getSize: { fn: (header) => header_getSize(header) },
				header_getStart: { fn: (header) => header_getStart(header) }
			});
		},
		constructTableAPIs: (table) => {
			assignTableAPIs("columnSizingFeature", table, {
				table_setColumnSizing: { fn: (updater) => table_setColumnSizing(table, updater) },
				table_resetColumnSizing: { fn: (defaultState) => table_resetColumnSizing(table, defaultState) },
				table_getTotalSize: { fn: () => table_getTotalSize(table) },
				table_getLeftTotalSize: { fn: () => table_getLeftTotalSize(table) },
				table_getCenterTotalSize: { fn: () => table_getCenterTotalSize(table) },
				table_getRightTotalSize: { fn: () => table_getRightTotalSize(table) }
			});
		}
	};
}
/**
* The Column Sizing feature adds column sizing state and APIs to the table, header, and column objects.
* **Note:** This does not include column resizing. The columnResizingFeature feature has been split out into its own standalone feature.
*/
var columnSizingFeature = constructColumnSizingFeature();
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-visibility/columnVisibilityFeature.js
function constructColumnVisibilityFeature() {
	return {
		getInitialState: (initialState) => {
			return {
				columnVisibility: getDefaultColumnVisibilityState(),
				...initialState
			};
		},
		getDefaultTableOptions: (table) => {
			return { onColumnVisibilityChange: makeStateUpdater("columnVisibility", table) };
		},
		assignColumnPrototype: (prototype, table) => {
			assignPrototypeAPIs("columnVisibilityFeature", prototype, table, {
				column_getIsVisible: {
					fn: (column) => column_getIsVisible(column),
					memoDeps: (column) => {
						var _column$table$atoms$c;
						return [
							column.table.options.columns,
							(_column$table$atoms$c = column.table.atoms.columnVisibility) === null || _column$table$atoms$c === void 0 ? void 0 : _column$table$atoms$c.get(),
							column.columns
						];
					}
				},
				column_getCanHide: { fn: (column) => column_getCanHide(column) },
				column_getToggleVisibilityHandler: { fn: (column) => column_getToggleVisibilityHandler(column) },
				column_toggleVisibility: { fn: (column, visible) => column_toggleVisibility(column, visible) }
			});
		},
		assignRowPrototype: (prototype, table) => {
			assignPrototypeAPIs("columnVisibilityFeature", prototype, table, {
				row_getAllVisibleCells: {
					fn: (row) => row_getAllVisibleCells(row),
					memoDeps: (row) => {
						var _row$table$atoms$colu;
						return [row.getAllCells(), (_row$table$atoms$colu = row.table.atoms.columnVisibility) === null || _row$table$atoms$colu === void 0 ? void 0 : _row$table$atoms$colu.get()];
					}
				},
				row_getVisibleCells: {
					fn: (row, left, center, right) => row_getVisibleCells(left, center, right),
					memoDeps: (row) => [
						row_getLeftVisibleCells(row),
						row_getCenterVisibleCells(row),
						row_getRightVisibleCells(row)
					]
				}
			});
		},
		constructTableAPIs: (table) => {
			assignTableAPIs("columnVisibilityFeature", table, {
				table_getVisibleFlatColumns: {
					fn: () => table_getVisibleFlatColumns(table),
					memoDeps: () => {
						var _table$atoms$columnVi, _table$atoms$columnOr;
						return [
							(_table$atoms$columnVi = table.atoms.columnVisibility) === null || _table$atoms$columnVi === void 0 ? void 0 : _table$atoms$columnVi.get(),
							(_table$atoms$columnOr = table.atoms.columnOrder) === null || _table$atoms$columnOr === void 0 ? void 0 : _table$atoms$columnOr.get(),
							table.options.columns
						];
					}
				},
				table_getVisibleLeafColumns: {
					fn: () => table_getVisibleLeafColumns(table),
					memoDeps: () => {
						var _table$atoms$columnVi2, _table$atoms$columnOr2;
						return [
							(_table$atoms$columnVi2 = table.atoms.columnVisibility) === null || _table$atoms$columnVi2 === void 0 ? void 0 : _table$atoms$columnVi2.get(),
							(_table$atoms$columnOr2 = table.atoms.columnOrder) === null || _table$atoms$columnOr2 === void 0 ? void 0 : _table$atoms$columnOr2.get(),
							table.options.columns
						];
					}
				},
				table_setColumnVisibility: { fn: (updater) => table_setColumnVisibility(table, updater) },
				table_resetColumnVisibility: { fn: (defaultState) => table_resetColumnVisibility(table, defaultState) },
				table_toggleAllColumnsVisible: { fn: (value) => table_toggleAllColumnsVisible(table, value) },
				table_getIsAllColumnsVisible: { fn: () => table_getIsAllColumnsVisible(table) },
				table_getIsSomeColumnsVisible: { fn: () => table_getIsSomeColumnsVisible(table) },
				table_getToggleAllColumnsVisibilityHandler: { fn: () => table_getToggleAllColumnsVisibilityHandler(table) }
			});
		}
	};
}
/**
* The Column Visibility feature adds column visibility state and APIs to the table, row, and column objects.
*/
var columnVisibilityFeature = constructColumnVisibilityFeature();
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/global-filtering/globalFilteringFeature.utils.js
function column_getCanGlobalFilter(column) {
	var _column$table$options, _column$table$options2;
	return (column.columnDef.enableGlobalFilter ?? true) && (column.table.options.enableGlobalFilter ?? true) && (column.table.options.enableFilters ?? true) && (((_column$table$options = (_column$table$options2 = column.table.options).getColumnCanGlobalFilter) === null || _column$table$options === void 0 ? void 0 : _column$table$options.call(_column$table$options2, column)) ?? true) && !!column.accessorFn;
}
function table_getGlobalAutoFilterFn() {
	return filterFn_includesString;
}
function table_getGlobalFilterFn(table) {
	const { globalFilterFn } = table.options;
	const filterFns = table._rowModelFns.filterFns;
	return isFunction(globalFilterFn) ? globalFilterFn : globalFilterFn === "auto" ? table_getGlobalAutoFilterFn() : filterFns === null || filterFns === void 0 ? void 0 : filterFns[globalFilterFn];
}
function table_setGlobalFilter(table, updater) {
	var _table$options$onGlob, _table$options;
	(_table$options$onGlob = (_table$options = table.options).onGlobalFilterChange) === null || _table$options$onGlob === void 0 || _table$options$onGlob.call(_table$options, updater);
}
function table_resetGlobalFilter(table, defaultState) {
	table_setGlobalFilter(table, defaultState ? void 0 : cloneState(table.initialState.globalFilter));
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/global-filtering/globalFilteringFeature.js
function constructGlobalFilteringFeature() {
	return {
		getInitialState: (initialState) => {
			return {
				globalFilter: void 0,
				...initialState
			};
		},
		getDefaultTableOptions: (table) => {
			return {
				onGlobalFilterChange: makeStateUpdater("globalFilter", table),
				globalFilterFn: "auto",
				getColumnCanGlobalFilter: (column) => {
					var _table$getCoreRowMode;
					const value = (_table$getCoreRowMode = table.getCoreRowModel().flatRows[0]) === null || _table$getCoreRowMode === void 0 || (_table$getCoreRowMode = _table$getCoreRowMode.getAllCellsByColumnId()[column.id]) === null || _table$getCoreRowMode === void 0 ? void 0 : _table$getCoreRowMode.getValue();
					return typeof value === "string" || typeof value === "number";
				}
			};
		},
		assignColumnPrototype: (prototype, table) => {
			assignPrototypeAPIs("globalFilteringFeature", prototype, table, { column_getCanGlobalFilter: { fn: (column) => column_getCanGlobalFilter(column) } });
		},
		constructTableAPIs: (table) => {
			assignTableAPIs("globalFilteringFeature", table, {
				table_getGlobalAutoFilterFn: { fn: () => table_getGlobalAutoFilterFn() },
				table_getGlobalFilterFn: { fn: () => table_getGlobalFilterFn(table) },
				table_setGlobalFilter: { fn: (updater) => table_setGlobalFilter(table, updater) },
				table_resetGlobalFilter: { fn: (defaultState) => table_resetGlobalFilter(table, defaultState) }
			});
		}
	};
}
/**
* The Global Filtering feature adds global filtering state and APIs to the table and column objects.
* **Note:** This is dependent on the columnFilteringFeature feature.
*/
var globalFilteringFeature = constructGlobalFilteringFeature();
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/row-expanding/rowExpandingFeature.utils.js
function getDefaultExpandedState() {
	return {};
}
function table_autoResetExpanded(table) {
	if (table.options.autoResetAll ?? table.options.autoResetExpanded ?? !table.options.manualExpanding) queueMicrotask(() => table_resetExpanded(table));
}
function table_setExpanded(table, updater) {
	var _table$options$onExpa, _table$options;
	(_table$options$onExpa = (_table$options = table.options).onExpandedChange) === null || _table$options$onExpa === void 0 || _table$options$onExpa.call(_table$options, updater);
}
function table_toggleAllRowsExpanded(table, expanded) {
	if (expanded ?? !table_getIsAllRowsExpanded(table)) table_setExpanded(table, true);
	else table_setExpanded(table, {});
}
function table_resetExpanded(table, defaultState) {
	table_setExpanded(table, defaultState ? {} : cloneState(table.initialState.expanded ?? {}));
}
function table_getCanSomeRowsExpand(table) {
	return table.getPrePaginatedRowModel().flatRows.some((row) => row_getCanExpand(row));
}
function table_getToggleAllRowsExpandedHandler(table) {
	return (e) => {
		var _persist;
		(_persist = e.persist) === null || _persist === void 0 || _persist.call(e);
		table_toggleAllRowsExpanded(table);
	};
}
function table_getIsSomeRowsExpanded(table) {
	var _table$atoms$expanded;
	const expanded = ((_table$atoms$expanded = table.atoms.expanded) === null || _table$atoms$expanded === void 0 ? void 0 : _table$atoms$expanded.get()) ?? {};
	return expanded === true || Object.values(expanded).some(Boolean);
}
function table_getIsAllRowsExpanded(table) {
	var _table$atoms$expanded2;
	const expanded = ((_table$atoms$expanded2 = table.atoms.expanded) === null || _table$atoms$expanded2 === void 0 ? void 0 : _table$atoms$expanded2.get()) ?? {};
	if (expanded === true) return true;
	if (!Object.keys(expanded).length) return false;
	if (table.getRowModel().flatRows.some((row) => !row_getIsExpanded(row))) return false;
	return true;
}
function table_getExpandedDepth(table) {
	var _table$atoms$expanded3, _table$atoms$expanded4;
	let maxDepth = 0;
	(((_table$atoms$expanded3 = table.atoms.expanded) === null || _table$atoms$expanded3 === void 0 ? void 0 : _table$atoms$expanded3.get()) === true ? Object.keys(table.getRowModel().rowsById) : Object.keys(((_table$atoms$expanded4 = table.atoms.expanded) === null || _table$atoms$expanded4 === void 0 ? void 0 : _table$atoms$expanded4.get()) ?? {})).forEach((id) => {
		const splitId = id.split(".");
		maxDepth = Math.max(maxDepth, splitId.length);
	});
	return maxDepth;
}
function row_toggleExpanded(row, expanded) {
	table_setExpanded(row.table, (old) => {
		const exists = old === true ? true : !!old[row.id];
		let oldExpanded = {};
		if (old === true) Object.keys(row.table.getRowModel().rowsById).forEach((rowId) => {
			oldExpanded[rowId] = true;
		});
		else oldExpanded = old;
		expanded = expanded ?? !exists;
		if (!exists && expanded) return {
			...oldExpanded,
			[row.id]: true
		};
		if (exists && !expanded) {
			const { [row.id]: _, ...rest } = oldExpanded;
			return rest;
		}
		return old;
	});
}
function row_getIsExpanded(row) {
	var _row$table$atoms$expa, _row$table$options$ge, _row$table$options;
	const expanded = ((_row$table$atoms$expa = row.table.atoms.expanded) === null || _row$table$atoms$expa === void 0 ? void 0 : _row$table$atoms$expa.get()) ?? {};
	return !!(((_row$table$options$ge = (_row$table$options = row.table.options).getIsRowExpanded) === null || _row$table$options$ge === void 0 ? void 0 : _row$table$options$ge.call(_row$table$options, row)) ?? (expanded === true || expanded[row.id]));
}
function row_getCanExpand(row) {
	var _row$table$options$ge2, _row$table$options2;
	return ((_row$table$options$ge2 = (_row$table$options2 = row.table.options).getRowCanExpand) === null || _row$table$options$ge2 === void 0 ? void 0 : _row$table$options$ge2.call(_row$table$options2, row)) ?? ((row.table.options.enableExpanding ?? true) && !!row.subRows.length);
}
function row_getIsAllParentsExpanded(row) {
	let isFullyExpanded = true;
	let currentRow = row;
	while (isFullyExpanded && currentRow.parentId) {
		currentRow = row.table.getRow(currentRow.parentId, true);
		isFullyExpanded = row_getIsExpanded(row);
	}
	return isFullyExpanded;
}
function row_getToggleExpandedHandler(row) {
	const canExpand = row_getCanExpand(row);
	return () => {
		if (!canExpand) return;
		row_toggleExpanded(row);
	};
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/row-expanding/rowExpandingFeature.js
function constructRowExpandingFeature() {
	return {
		getInitialState: (initialState) => {
			return {
				expanded: getDefaultExpandedState(),
				...initialState
			};
		},
		getDefaultTableOptions: (table) => {
			return {
				onExpandedChange: makeStateUpdater("expanded", table),
				paginateExpandedRows: true
			};
		},
		assignRowPrototype: (prototype, table) => {
			assignPrototypeAPIs("rowExpandingFeature", prototype, table, {
				row_toggleExpanded: { fn: (row, expanded) => row_toggleExpanded(row, expanded) },
				row_getIsExpanded: { fn: (row) => row_getIsExpanded(row) },
				row_getCanExpand: { fn: (row) => row_getCanExpand(row) },
				row_getIsAllParentsExpanded: { fn: (row) => row_getIsAllParentsExpanded(row) },
				row_getToggleExpandedHandler: { fn: (row) => row_getToggleExpandedHandler(row) }
			});
		},
		constructTableAPIs: (table) => {
			assignTableAPIs("rowExpandingFeature", table, {
				table_autoResetExpanded: { fn: () => table_autoResetExpanded(table) },
				table_setExpanded: { fn: (updater) => table_setExpanded(table, updater) },
				table_toggleAllRowsExpanded: { fn: (expanded) => table_toggleAllRowsExpanded(table, expanded) },
				table_resetExpanded: { fn: (defaultState) => table_resetExpanded(table, defaultState) },
				table_getCanSomeRowsExpand: { fn: () => table_getCanSomeRowsExpand(table) },
				table_getToggleAllRowsExpandedHandler: { fn: () => table_getToggleAllRowsExpandedHandler(table) },
				table_getIsSomeRowsExpanded: { fn: () => table_getIsSomeRowsExpanded(table) },
				table_getIsAllRowsExpanded: { fn: () => table_getIsAllRowsExpanded(table) },
				table_getExpandedDepth: { fn: () => table_getExpandedDepth(table) }
			});
		}
	};
}
/**
* The Row Expanding feature adds row expanding state and APIs to the table and row objects.
*/
var rowExpandingFeature = constructRowExpandingFeature();
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/row-pagination/rowPaginationFeature.js
function constructRowPaginationFeature() {
	return {
		getInitialState: (initialState) => {
			return {
				...initialState,
				pagination: {
					...getDefaultPaginationState(),
					...initialState.pagination
				}
			};
		},
		getDefaultTableOptions: (table) => {
			return { onPaginationChange: makeStateUpdater("pagination", table) };
		},
		constructTableAPIs: (table) => {
			assignTableAPIs("rowPaginationFeature", table, {
				table_autoResetPageIndex: { fn: () => table_autoResetPageIndex(table) },
				table_setPagination: { fn: (updater) => table_setPagination(table, updater) },
				table_resetPagination: { fn: (defaultState) => table_resetPagination(table, defaultState) },
				table_setPageIndex: { fn: (updater) => table_setPageIndex(table, updater) },
				table_resetPageIndex: { fn: (defaultState) => table_resetPageIndex(table, defaultState) },
				table_setPageSize: { fn: (updater) => table_setPageSize(table, updater) },
				table_getPageCount: { fn: () => table_getPageCount(table) },
				table_resetPageSize: { fn: (defaultState) => table_resetPageSize(table, defaultState) },
				table_getPageOptions: { fn: () => table_getPageOptions(table) },
				table_getCanPreviousPage: { fn: () => table_getCanPreviousPage(table) },
				table_getCanNextPage: { fn: () => table_getCanNextPage(table) },
				table_previousPage: { fn: () => table_previousPage(table) },
				table_nextPage: { fn: () => table_nextPage(table) },
				table_firstPage: { fn: () => table_firstPage(table) },
				table_lastPage: { fn: () => table_lastPage(table) },
				table_getRowCount: { fn: () => table_getRowCount(table) }
			});
		}
	};
}
/**
* The (Row) Pagination feature adds pagination state and APIs to the table object.
*/
var rowPaginationFeature = constructRowPaginationFeature();
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/row-pinning/rowPinningFeature.utils.js
function getDefaultRowPinningState() {
	return {
		top: [],
		bottom: []
	};
}
function table_setRowPinning(table, updater) {
	var _table$options$onRowP, _table$options;
	(_table$options$onRowP = (_table$options = table.options).onRowPinningChange) === null || _table$options$onRowP === void 0 || _table$options$onRowP.call(_table$options, updater);
}
function table_resetRowPinning(table, defaultState) {
	table_setRowPinning(table, defaultState ? getDefaultRowPinningState() : cloneState(table.initialState.rowPinning ?? getDefaultRowPinningState()));
}
function table_getIsSomeRowsPinned(table, position) {
	var _table$atoms$rowPinni;
	const rowPinning = (_table$atoms$rowPinni = table.atoms.rowPinning) === null || _table$atoms$rowPinni === void 0 ? void 0 : _table$atoms$rowPinni.get();
	if (!position) return Boolean((rowPinning === null || rowPinning === void 0 ? void 0 : rowPinning.top.length) || (rowPinning === null || rowPinning === void 0 ? void 0 : rowPinning.bottom.length));
	return Boolean(rowPinning === null || rowPinning === void 0 ? void 0 : rowPinning[position].length);
}
function table_getPinnedRows(table, position) {
	var _table$atoms$rowPinni2;
	const visibleRows = table.getRowModel().rows;
	const pinnedRowIds = ((_table$atoms$rowPinni2 = table.atoms.rowPinning) === null || _table$atoms$rowPinni2 === void 0 || (_table$atoms$rowPinni2 = _table$atoms$rowPinni2.get()) === null || _table$atoms$rowPinni2 === void 0 ? void 0 : _table$atoms$rowPinni2[position]) ?? [];
	const filteredRows = (table.options.keepPinnedRows ?? true ? pinnedRowIds.map((rowId) => {
		const row = table.getRow(rowId, true);
		return row_getIsAllParentsExpanded(row) ? row : null;
	}) : pinnedRowIds.map((rowId) => visibleRows.find((row) => row.id === rowId))).filter((r) => !!r);
	filteredRows.forEach((row) => {
		row.position = position;
	});
	return filteredRows;
}
function table_getTopRows(table) {
	return table_getPinnedRows(table, "top");
}
function table_getBottomRows(table) {
	return table_getPinnedRows(table, "bottom");
}
function table_getCenterRows(table) {
	var _table$atoms$rowPinni3;
	const { top, bottom } = ((_table$atoms$rowPinni3 = table.atoms.rowPinning) === null || _table$atoms$rowPinni3 === void 0 ? void 0 : _table$atoms$rowPinni3.get()) ?? getDefaultRowPinningState();
	const allRows = table.getRowModel().rows;
	const topAndBottom = new Set([...top, ...bottom]);
	return allRows.filter((d) => !topAndBottom.has(d.id));
}
function row_getCanPin(row) {
	const { enableRowPinning } = row.table.options;
	if (typeof enableRowPinning === "function") return enableRowPinning(row);
	return enableRowPinning ?? true;
}
function row_getIsPinned(row) {
	var _row$table$atoms$rowP;
	const { top, bottom } = ((_row$table$atoms$rowP = row.table.atoms.rowPinning) === null || _row$table$atoms$rowP === void 0 ? void 0 : _row$table$atoms$rowP.get()) ?? getDefaultRowPinningState();
	return top.includes(row.id) ? "top" : bottom.includes(row.id) ? "bottom" : false;
}
function row_getPinnedIndex(row) {
	const position = row_getIsPinned(row);
	if (!position) return -1;
	return (position === "top" ? callMemoOrStaticFn(row.table, "getTopRows", table_getTopRows) : callMemoOrStaticFn(row.table, "getBottomRows", table_getBottomRows)).map(({ id }) => id).indexOf(row.id);
}
function row_pin(row, position, includeLeafRows, includeParentRows) {
	const leafRowIds = includeLeafRows ? row.getLeafRows().map(({ id }) => id) : [];
	const parentRowIds = includeParentRows ? row.getParentRows().map(({ id }) => id) : [];
	const rowIds = new Set([
		...parentRowIds,
		row.id,
		...leafRowIds
	]);
	table_setRowPinning(row.table, (old) => {
		if (position === "bottom") return {
			top: old.top.filter((d) => !rowIds.has(d)),
			bottom: [...old.bottom.filter((d) => !rowIds.has(d)), ...Array.from(rowIds)]
		};
		if (position === "top") return {
			top: [...old.top.filter((d) => !rowIds.has(d)), ...Array.from(rowIds)],
			bottom: old.bottom.filter((d) => !rowIds.has(d))
		};
		return {
			top: old.top.filter((d) => !rowIds.has(d)),
			bottom: old.bottom.filter((d) => !rowIds.has(d))
		};
	});
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/row-pinning/rowPinningFeature.js
function constructRowPinningFeature() {
	return {
		getInitialState: (initialState) => {
			return {
				...initialState,
				rowPinning: {
					...getDefaultRowPinningState(),
					...initialState.rowPinning
				}
			};
		},
		getDefaultTableOptions: (table) => {
			return { onRowPinningChange: makeStateUpdater("rowPinning", table) };
		},
		assignRowPrototype: (prototype, table) => {
			assignPrototypeAPIs("rowPinningFeature", prototype, table, {
				row_getCanPin: { fn: (row) => row_getCanPin(row) },
				row_getIsPinned: { fn: (row) => row_getIsPinned(row) },
				row_getPinnedIndex: {
					fn: (row) => row_getPinnedIndex(row),
					memoDeps: (row) => {
						var _row$table$atoms$rowP;
						return [row.table.getRowModel().rows, (_row$table$atoms$rowP = row.table.atoms.rowPinning) === null || _row$table$atoms$rowP === void 0 ? void 0 : _row$table$atoms$rowP.get()];
					}
				},
				row_pin: { fn: (row, position, includeLeafRows, includeParentRows) => row_pin(row, position, includeLeafRows, includeParentRows) }
			});
		},
		constructTableAPIs: (table) => {
			assignTableAPIs("rowPinningFeature", table, {
				table_setRowPinning: { fn: (updater) => table_setRowPinning(table, updater) },
				table_resetRowPinning: { fn: (defaultState) => table_resetRowPinning(table, defaultState) },
				table_getIsSomeRowsPinned: { fn: (position) => table_getIsSomeRowsPinned(table, position) },
				table_getTopRows: {
					fn: () => table_getTopRows(table),
					memoDeps: () => {
						var _table$atoms$rowPinni;
						return [table.getRowModel().rows, (_table$atoms$rowPinni = table.atoms.rowPinning) === null || _table$atoms$rowPinni === void 0 || (_table$atoms$rowPinni = _table$atoms$rowPinni.get()) === null || _table$atoms$rowPinni === void 0 ? void 0 : _table$atoms$rowPinni.top];
					}
				},
				table_getBottomRows: {
					fn: () => table_getBottomRows(table),
					memoDeps: () => {
						var _table$atoms$rowPinni2;
						return [table.getRowModel().rows, (_table$atoms$rowPinni2 = table.atoms.rowPinning) === null || _table$atoms$rowPinni2 === void 0 || (_table$atoms$rowPinni2 = _table$atoms$rowPinni2.get()) === null || _table$atoms$rowPinni2 === void 0 ? void 0 : _table$atoms$rowPinni2.bottom];
					}
				},
				table_getCenterRows: {
					fn: () => table_getCenterRows(table),
					memoDeps: () => {
						var _table$atoms$rowPinni3;
						return [table.getRowModel().rows, (_table$atoms$rowPinni3 = table.atoms.rowPinning) === null || _table$atoms$rowPinni3 === void 0 ? void 0 : _table$atoms$rowPinni3.get()];
					}
				}
			});
		}
	};
}
/**
* The Row Pinning feature adds row pinning state and APIs to the table and row objects.
*/
var rowPinningFeature = constructRowPinningFeature();
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/row-selection/rowSelectionFeature.utils.js
function getDefaultRowSelectionState() {
	return {};
}
function table_setRowSelection(table, updater) {
	var _table$options$onRowS, _table$options;
	(_table$options$onRowS = (_table$options = table.options).onRowSelectionChange) === null || _table$options$onRowS === void 0 || _table$options$onRowS.call(_table$options, updater);
}
function table_resetRowSelection(table, defaultState) {
	table_setRowSelection(table, defaultState ? {} : cloneState(table.initialState.rowSelection ?? {}));
}
function table_toggleAllRowsSelected(table, value) {
	table_setRowSelection(table, (old) => {
		value = typeof value !== "undefined" ? value : !table_getIsAllRowsSelected(table);
		const rowSelection = { ...old };
		const preGroupedFlatRows = table.getPreGroupedRowModel().flatRows;
		if (value) preGroupedFlatRows.forEach((row) => {
			if (!row_getCanSelect(row)) return;
			rowSelection[row.id] = true;
		});
		else preGroupedFlatRows.forEach((row) => {
			delete rowSelection[row.id];
		});
		return rowSelection;
	});
}
function table_toggleAllPageRowsSelected(table, value) {
	table_setRowSelection(table, (old) => {
		const resolvedValue = typeof value !== "undefined" ? value : !table_getIsAllPageRowsSelected(table);
		const rowSelection = { ...old };
		table.getRowModel().rows.forEach((row) => {
			mutateRowIsSelected(rowSelection, row.id, resolvedValue, true, table);
		});
		return rowSelection;
	});
}
function table_getPreSelectedRowModel(table) {
	return table.getCoreRowModel();
}
function table_getSelectedRowModel(table) {
	var _table$atoms$rowSelec;
	const rowModel = table.getCoreRowModel();
	if (!Object.keys(((_table$atoms$rowSelec = table.atoms.rowSelection) === null || _table$atoms$rowSelec === void 0 ? void 0 : _table$atoms$rowSelec.get()) ?? {}).length) return {
		rows: [],
		flatRows: [],
		rowsById: {}
	};
	return selectRowsFn(rowModel);
}
function table_getFilteredSelectedRowModel(table) {
	var _table$atoms$rowSelec2;
	const rowModel = table.getCoreRowModel();
	if (!Object.keys(((_table$atoms$rowSelec2 = table.atoms.rowSelection) === null || _table$atoms$rowSelec2 === void 0 ? void 0 : _table$atoms$rowSelec2.get()) ?? {}).length) return {
		rows: [],
		flatRows: [],
		rowsById: {}
	};
	return selectRowsFn(rowModel);
}
function table_getGroupedSelectedRowModel(table) {
	var _table$atoms$rowSelec3;
	const rowModel = table.getCoreRowModel();
	if (!Object.keys(((_table$atoms$rowSelec3 = table.atoms.rowSelection) === null || _table$atoms$rowSelec3 === void 0 ? void 0 : _table$atoms$rowSelec3.get()) ?? {}).length) return {
		rows: [],
		flatRows: [],
		rowsById: {}
	};
	return selectRowsFn(rowModel);
}
function table_getIsAllRowsSelected(table) {
	var _table$atoms$rowSelec4;
	const preGroupedFlatRows = table.getFilteredRowModel().flatRows;
	const rowSelection = ((_table$atoms$rowSelec4 = table.atoms.rowSelection) === null || _table$atoms$rowSelec4 === void 0 ? void 0 : _table$atoms$rowSelec4.get()) ?? {};
	let isAllRowsSelected = Boolean(preGroupedFlatRows.length && Object.keys(rowSelection).length);
	if (isAllRowsSelected) {
		if (preGroupedFlatRows.some((row) => row_getCanSelect(row) && !rowSelection[row.id])) isAllRowsSelected = false;
	}
	return isAllRowsSelected;
}
function table_getIsAllPageRowsSelected(table) {
	var _table$atoms$rowSelec5;
	const paginationFlatRows = table.getPaginatedRowModel().flatRows.filter((row) => row_getCanSelect(row));
	const rowSelection = ((_table$atoms$rowSelec5 = table.atoms.rowSelection) === null || _table$atoms$rowSelec5 === void 0 ? void 0 : _table$atoms$rowSelec5.get()) ?? {};
	let isAllPageRowsSelected = !!paginationFlatRows.length;
	if (isAllPageRowsSelected && paginationFlatRows.some((row) => !rowSelection[row.id])) isAllPageRowsSelected = false;
	return isAllPageRowsSelected;
}
function table_getIsSomeRowsSelected(table) {
	var _table$atoms$rowSelec6;
	const totalSelected = Object.keys(((_table$atoms$rowSelec6 = table.atoms.rowSelection) === null || _table$atoms$rowSelec6 === void 0 ? void 0 : _table$atoms$rowSelec6.get()) ?? {}).length;
	return totalSelected > 0 && totalSelected < table.getFilteredRowModel().flatRows.length;
}
function table_getIsSomePageRowsSelected(table) {
	const paginationFlatRows = table.getPaginatedRowModel().flatRows;
	return table_getIsAllPageRowsSelected(table) ? false : paginationFlatRows.filter((row) => row_getCanSelect(row)).some((row) => row_getIsSelected(row) || row_getIsSomeSelected(row));
}
function table_getToggleAllRowsSelectedHandler(table) {
	return (e) => {
		table_toggleAllRowsSelected(table, e.target.checked);
	};
}
function table_getToggleAllPageRowsSelectedHandler(table) {
	return (e) => {
		table_toggleAllPageRowsSelected(table, e.target.checked);
	};
}
function row_toggleSelected(row, value, opts) {
	const isSelected = row_getIsSelected(row);
	table_setRowSelection(row.table, (old) => {
		value = typeof value !== "undefined" ? value : !isSelected;
		if (row_getCanSelect(row) && isSelected === value) return old;
		const selectedRowIds = { ...old };
		mutateRowIsSelected(selectedRowIds, row.id, value, (opts === null || opts === void 0 ? void 0 : opts.selectChildren) ?? true, row.table);
		return selectedRowIds;
	});
}
function row_getIsSelected(row) {
	return isRowSelected(row);
}
function row_getIsSomeSelected(row) {
	return isSubRowSelected(row) === "some";
}
function row_getIsAllSubRowsSelected(row) {
	return isSubRowSelected(row) === "all";
}
function row_getCanSelect(row) {
	const options = row.table.options;
	if (typeof options.enableRowSelection === "function") return options.enableRowSelection(row);
	return options.enableRowSelection ?? true;
}
function row_getCanSelectSubRows(row) {
	const options = row.table.options;
	if (typeof options.enableSubRowSelection === "function") return options.enableSubRowSelection(row);
	return options.enableSubRowSelection ?? true;
}
function row_getCanMultiSelect(row) {
	const options = row.table.options;
	if (typeof options.enableMultiRowSelection === "function") return options.enableMultiRowSelection(row);
	return options.enableMultiRowSelection ?? true;
}
function row_getToggleSelectedHandler(row) {
	const canSelect = row_getCanSelect(row);
	return (e) => {
		if (!canSelect) return;
		row_toggleSelected(row, e.target.checked);
	};
}
var mutateRowIsSelected = (selectedRowIds, rowId, value, includeChildren, table) => {
	const row = table.getRow(rowId, true);
	if (value) {
		if (!row_getCanMultiSelect(row)) Object.keys(selectedRowIds).forEach((key) => delete selectedRowIds[key]);
		if (row_getCanSelect(row)) selectedRowIds[rowId] = true;
	} else delete selectedRowIds[rowId];
	if (includeChildren && row.subRows.length && row_getCanSelectSubRows(row)) row.subRows.forEach((r) => mutateRowIsSelected(selectedRowIds, r.id, value, includeChildren, table));
};
function selectRowsFn(rowModel) {
	const newSelectedFlatRows = [];
	const newSelectedRowsById = {};
	const recurseRows = (rows, depth = 0) => {
		return rows.map((row) => {
			const isSelected = isRowSelected(row);
			if (isSelected) {
				newSelectedFlatRows.push(row);
				newSelectedRowsById[row.id] = row;
			}
			if (row.subRows.length) row = {
				...row,
				subRows: recurseRows(row.subRows, depth + 1)
			};
			if (isSelected) return row;
		}).filter((x) => !!x);
	};
	return {
		rows: recurseRows(rowModel.rows),
		flatRows: newSelectedFlatRows,
		rowsById: newSelectedRowsById
	};
}
function isRowSelected(row) {
	var _row$table$atoms$rowS;
	return (((_row$table$atoms$rowS = row.table.atoms.rowSelection) === null || _row$table$atoms$rowS === void 0 ? void 0 : _row$table$atoms$rowS.get()) ?? {})[row.id] ?? false;
}
function isSubRowSelected(row) {
	if (!row.subRows.length) return false;
	let allChildrenSelected = true;
	let someSelected = false;
	row.subRows.forEach((subRow) => {
		if (someSelected && !allChildrenSelected) return;
		if (row_getCanSelect(subRow)) if (isRowSelected(subRow)) someSelected = true;
		else allChildrenSelected = false;
		if (subRow.subRows.length) {
			const subRowChildrenSelected = isSubRowSelected(subRow);
			if (subRowChildrenSelected === "all") someSelected = true;
			else if (subRowChildrenSelected === "some") {
				someSelected = true;
				allChildrenSelected = false;
			} else allChildrenSelected = false;
		}
	});
	return allChildrenSelected ? "all" : someSelected ? "some" : false;
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/row-selection/rowSelectionFeature.js
function constructRowSelectionFeature() {
	return {
		getInitialState: (initialState) => {
			return {
				rowSelection: getDefaultRowSelectionState(),
				...initialState
			};
		},
		getDefaultTableOptions: (table) => {
			return {
				onRowSelectionChange: makeStateUpdater("rowSelection", table),
				enableRowSelection: true,
				enableMultiRowSelection: true,
				enableSubRowSelection: true
			};
		},
		assignRowPrototype: (prototype, table) => {
			assignPrototypeAPIs("rowSelectionFeature", prototype, table, {
				row_toggleSelected: { fn: (row, value, opts) => row_toggleSelected(row, value, opts) },
				row_getIsSelected: { fn: (row) => row_getIsSelected(row) },
				row_getIsSomeSelected: { fn: (row) => row_getIsSomeSelected(row) },
				row_getIsAllSubRowsSelected: { fn: (row) => row_getIsAllSubRowsSelected(row) },
				row_getCanSelect: { fn: (row) => row_getCanSelect(row) },
				row_getCanSelectSubRows: { fn: (row) => row_getCanSelectSubRows(row) },
				row_getCanMultiSelect: { fn: (row) => row_getCanMultiSelect(row) },
				row_getToggleSelectedHandler: { fn: (row) => row_getToggleSelectedHandler(row) }
			});
		},
		constructTableAPIs: (table) => {
			assignTableAPIs("rowSelectionFeature", table, {
				table_setRowSelection: { fn: (updater) => table_setRowSelection(table, updater) },
				table_resetRowSelection: { fn: (defaultState) => table_resetRowSelection(table, defaultState) },
				table_toggleAllRowsSelected: { fn: (value) => table_toggleAllRowsSelected(table, value) },
				table_toggleAllPageRowsSelected: { fn: (value) => table_toggleAllPageRowsSelected(table, value) },
				table_getPreSelectedRowModel: { fn: () => table_getPreSelectedRowModel(table) },
				table_getSelectedRowModel: {
					fn: () => table_getSelectedRowModel(table),
					memoDeps: () => {
						var _table$atoms$rowSelec;
						return [(_table$atoms$rowSelec = table.atoms.rowSelection) === null || _table$atoms$rowSelec === void 0 ? void 0 : _table$atoms$rowSelec.get(), table.getCoreRowModel()];
					}
				},
				table_getFilteredSelectedRowModel: {
					fn: () => table_getFilteredSelectedRowModel(table),
					memoDeps: () => {
						var _table$atoms$rowSelec2;
						return [(_table$atoms$rowSelec2 = table.atoms.rowSelection) === null || _table$atoms$rowSelec2 === void 0 ? void 0 : _table$atoms$rowSelec2.get(), table.getFilteredRowModel()];
					}
				},
				table_getGroupedSelectedRowModel: {
					fn: () => table_getGroupedSelectedRowModel(table),
					memoDeps: () => {
						var _table$atoms$rowSelec3;
						return [(_table$atoms$rowSelec3 = table.atoms.rowSelection) === null || _table$atoms$rowSelec3 === void 0 ? void 0 : _table$atoms$rowSelec3.get(), table.getSortedRowModel()];
					}
				},
				table_getIsAllRowsSelected: { fn: () => table_getIsAllRowsSelected(table) },
				table_getIsAllPageRowsSelected: { fn: () => table_getIsAllPageRowsSelected(table) },
				table_getIsSomeRowsSelected: { fn: () => table_getIsSomeRowsSelected(table) },
				table_getIsSomePageRowsSelected: { fn: () => table_getIsSomePageRowsSelected(table) },
				table_getToggleAllRowsSelectedHandler: { fn: () => table_getToggleAllRowsSelectedHandler(table) },
				table_getToggleAllPageRowsSelectedHandler: { fn: () => table_getToggleAllPageRowsSelectedHandler(table) }
			});
		}
	};
}
/**
* The Row Selection feature adds row selection state and APIs to the table and row objects.
*/
var rowSelectionFeature = constructRowSelectionFeature();
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/row-sorting/rowSortingFeature.utils.js
function getDefaultSortingState() {
	return [];
}
function table_setSorting(table, updater) {
	var _table$options$onSort, _table$options;
	(_table$options$onSort = (_table$options = table.options).onSortingChange) === null || _table$options$onSort === void 0 || _table$options$onSort.call(_table$options, updater);
}
function table_resetSorting(table, defaultState) {
	table_setSorting(table, defaultState ? [] : cloneState(table.initialState.sorting ?? []));
}
function column_getAutoSortFn(column) {
	const sortFns = column.table._rowModelFns.sortFns;
	let sortFn;
	const firstRows = column.table.getFilteredRowModel().flatRows.slice(10);
	let isString = false;
	for (const row of firstRows) {
		const value = row.getValue(column.id);
		if (Object.prototype.toString.call(value) === "[object Date]") sortFn = sortFns === null || sortFns === void 0 ? void 0 : sortFns.datetime;
		if (typeof value === "string") {
			isString = true;
			if (value.split(reSplitAlphaNumeric).length > 1) sortFn = sortFns === null || sortFns === void 0 ? void 0 : sortFns.alphanumeric;
		}
	}
	if (isString) sortFn = sortFns === null || sortFns === void 0 ? void 0 : sortFns.text;
	return sortFn ?? sortFn_basic;
}
function column_getAutoSortDir(column) {
	const firstRow = column.table.getFilteredRowModel().flatRows[0];
	if (typeof (firstRow ? firstRow.getValue(column.id) : void 0) === "string") return "asc";
	return "desc";
}
function column_getSortFn(column) {
	const sortFns = column.table._rowModelFns.sortFns;
	return isFunction(column.columnDef.sortFn) ? column.columnDef.sortFn : column.columnDef.sortFn === "auto" ? column_getAutoSortFn(column) : (sortFns === null || sortFns === void 0 ? void 0 : sortFns[column.columnDef.sortFn]) ?? sortFn_basic;
}
function column_toggleSorting(column, desc, multi) {
	const nextSortingOrder = column_getNextSortingOrder(column);
	const hasManualValue = typeof desc !== "undefined";
	table_setSorting(column.table, (old) => {
		const existingSorting = old.find((d) => d.id === column.id);
		const existingIndex = old.findIndex((d) => d.id === column.id);
		let newSorting = [];
		let sortAction;
		const nextDesc = hasManualValue ? desc : nextSortingOrder === "desc";
		if (old.length && column_getCanMultiSort(column) && multi) if (existingSorting) sortAction = "toggle";
		else sortAction = "add";
		else if (old.length && existingIndex !== old.length - 1) sortAction = "replace";
		else if (existingSorting) sortAction = "toggle";
		else sortAction = "replace";
		if (sortAction === "toggle") {
			if (!hasManualValue) {
				if (!nextSortingOrder) sortAction = "remove";
			}
		}
		if (sortAction === "add") {
			newSorting = [...old, {
				id: column.id,
				desc: nextDesc
			}];
			newSorting.splice(0, newSorting.length - (column.table.options.maxMultiSortColCount ?? Number.MAX_SAFE_INTEGER));
		} else if (sortAction === "toggle") newSorting = old.map((d) => {
			if (d.id === column.id) return {
				...d,
				desc: nextDesc
			};
			return d;
		});
		else if (sortAction === "remove") newSorting = old.filter((d) => d.id !== column.id);
		else newSorting = [{
			id: column.id,
			desc: nextDesc
		}];
		return newSorting;
	});
}
function column_getFirstSortDir(column) {
	return column.columnDef.sortDescFirst ?? column.table.options.sortDescFirst ?? column_getAutoSortDir(column) === "desc" ? "desc" : "asc";
}
function column_getNextSortingOrder(column, multi) {
	const firstSortDirection = column_getFirstSortDir(column);
	const isSorted = column_getIsSorted(column);
	if (!isSorted) return firstSortDirection;
	if (isSorted !== firstSortDirection && (column.table.options.enableSortingRemoval ?? true) && (multi ? column.table.options.enableMultiRemove ?? true : true)) return false;
	return isSorted === "desc" ? "asc" : "desc";
}
function column_getCanSort(column) {
	return (column.columnDef.enableSorting ?? true) && (column.table.options.enableSorting ?? true) && !!column.accessorFn;
}
function column_getCanMultiSort(column) {
	return column.columnDef.enableMultiSort ?? column.table.options.enableMultiSort ?? !!column.accessorFn;
}
function column_getIsSorted(column) {
	var _column$table$atoms$s;
	const columnSort = (_column$table$atoms$s = column.table.atoms.sorting) === null || _column$table$atoms$s === void 0 || (_column$table$atoms$s = _column$table$atoms$s.get()) === null || _column$table$atoms$s === void 0 ? void 0 : _column$table$atoms$s.find((d) => d.id === column.id);
	return !columnSort ? false : columnSort.desc ? "desc" : "asc";
}
function column_getSortIndex(column) {
	var _column$table$atoms$s2;
	return ((_column$table$atoms$s2 = column.table.atoms.sorting) === null || _column$table$atoms$s2 === void 0 || (_column$table$atoms$s2 = _column$table$atoms$s2.get()) === null || _column$table$atoms$s2 === void 0 ? void 0 : _column$table$atoms$s2.findIndex((d) => d.id === column.id)) ?? -1;
}
function column_clearSorting(column) {
	table_setSorting(column.table, (old) => old.length ? old.filter((d) => d.id !== column.id) : []);
}
function column_getToggleSortingHandler(column) {
	const canSort = column_getCanSort(column);
	return (e) => {
		var _persist, _column$table$options, _column$table$options2;
		if (!canSort) return;
		(_persist = e.persist) === null || _persist === void 0 || _persist.call(e);
		column_toggleSorting(column, void 0, column_getCanMultiSort(column) ? (_column$table$options = (_column$table$options2 = column.table.options).isMultiSortEvent) === null || _column$table$options === void 0 ? void 0 : _column$table$options.call(_column$table$options2, e) : false);
	};
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/row-sorting/rowSortingFeature.js
function constructRowSortingFeature() {
	return {
		getInitialState(initialState) {
			return {
				sorting: getDefaultSortingState(),
				...initialState
			};
		},
		getDefaultColumnDef() {
			return {
				sortFn: "auto",
				sortUndefined: 1
			};
		},
		getDefaultTableOptions(table) {
			return {
				onSortingChange: makeStateUpdater("sorting", table),
				isMultiSortEvent: (e) => {
					return e.shiftKey;
				}
			};
		},
		assignColumnPrototype(prototype, table) {
			assignPrototypeAPIs("rowSortingFeature", prototype, table, {
				"column.getAutoSortFn": { fn: (column) => column_getAutoSortFn(column) },
				"column.getAutoSortDir": { fn: (column) => column_getAutoSortDir(column) },
				column_getSortFn: { fn: (column) => column_getSortFn(column) },
				column_toggleSorting: { fn: (column, desc, multi) => column_toggleSorting(column, desc, multi) },
				column_getFirstSortDir: { fn: (column) => column_getFirstSortDir(column) },
				column_getNextSortingOrder: { fn: (column, multi) => column_getNextSortingOrder(column, multi) },
				column_getCanSort: { fn: (column) => column_getCanSort(column) },
				column_getCanMultiSort: { fn: (column) => column_getCanMultiSort(column) },
				column_getIsSorted: { fn: (column) => column_getIsSorted(column) },
				column_getSortIndex: { fn: (column) => column_getSortIndex(column) },
				column_clearSorting: { fn: (column) => column_clearSorting(column) },
				column_getToggleSortingHandler: { fn: (column) => column_getToggleSortingHandler(column) }
			});
		},
		constructTableAPIs(table) {
			assignTableAPIs("rowSortingFeature", table, {
				table_setSorting: { fn: (updater) => table_setSorting(table, updater) },
				table_resetSorting: { fn: (defaultState) => table_resetSorting(table, defaultState) }
			});
		}
	};
}
/**
* The (Row) Sorting feature adds sorting state and APIs to the table and column objects.
*/
var rowSortingFeature = constructRowSortingFeature();
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/stockFeatures.js
var stockFeatures = {
	columnFacetingFeature,
	columnFilteringFeature,
	columnGroupingFeature,
	columnOrderingFeature,
	columnPinningFeature,
	columnResizingFeature,
	columnSizingFeature,
	columnVisibilityFeature,
	globalFilteringFeature,
	rowExpandingFeature,
	rowPaginationFeature,
	rowPinningFeature,
	rowSelectionFeature,
	rowSortingFeature
};
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/table-reactivity/tableReactivityFeature.js
function constructReactivityFeature(bindings) {
	return { constructTableAPIs: (table) => {
		table.optionsStore = bindStore(table.optionsStore, bindings.optionsNotifier);
		table.atoms = bindAtoms(table.atoms, bindings.stateNotifier);
	} };
}
var bindStore = (store, notifier) => {
	const stateDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(store), "state");
	Object.defineProperty(store, "state", {
		configurable: true,
		enumerable: true,
		get() {
			notifier === null || notifier === void 0 || notifier();
			return stateDescriptor.get.call(store);
		}
	});
	return store;
};
var bindAtoms = (atoms, notifier) => {
	if (!notifier) return atoms;
	const wrappedCache = /* @__PURE__ */ new Map();
	return new Proxy(atoms, { get(target, prop, receiver) {
		const atom = Reflect.get(target, prop, receiver);
		if (!atom || typeof prop !== "string" || !isAtomLike(atom)) return atom;
		if (wrappedCache.has(prop)) return wrappedCache.get(prop);
		const originalGet = atom.get.bind(atom);
		const wrapped = new Proxy(atom, { get(atomTarget, atomProp, atomReceiver) {
			if (atomProp === "get") return () => {
				notifier();
				return originalGet();
			};
			return Reflect.get(atomTarget, atomProp, atomReceiver);
		} });
		wrappedCache.set(prop, wrapped);
		return wrapped;
	} });
};
function isAtomLike(value) {
	return typeof value === "object" && value !== null && typeof value.get === "function";
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-faceting/createFacetedMinMaxValues.js
function createFacetedMinMaxValues() {
	return (_table, columnId) => {
		const table = _table;
		return tableMemo({
			feature: "columnFacetingFeature",
			fn: (flatRows) => _createFacetedMinMaxValues(columnId, flatRows),
			fnName: "table.getFacetedMinMaxValues",
			memoDeps: () => {
				const column = table.getColumn(columnId);
				if (!column) return [table.getPreFilteredRowModel().flatRows];
				return [callMemoOrStaticFn(column, "getFacetedRowModel", column_getFacetedRowModel, table).flatRows];
			},
			table
		});
	};
}
function _createFacetedMinMaxValues(columnId, flatRows) {
	if (!flatRows.length) return void 0;
	const numericValues = flatRows.map((flatRow) => flatRow.getValue(columnId)).map(Number).filter((value) => !Number.isNaN(value));
	if (!numericValues.length) return void 0;
	let facetedMinValue = numericValues[0];
	let facetedMaxValue = numericValues[0];
	for (const value of numericValues) {
		if (value < facetedMinValue) facetedMinValue = value;
		if (value > facetedMaxValue) facetedMaxValue = value;
	}
	return [facetedMinValue, facetedMaxValue];
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-filtering/filterRowsUtils.js
function filterRows(rows, filterRowImpl, table) {
	if (table.options.filterFromLeafRows) return filterRowModelFromLeafs(rows, filterRowImpl, table);
	return filterRowModelFromRoot(rows, filterRowImpl, table);
}
function filterRowModelFromLeafs(rowsToFilter, filterRow, table) {
	const newFilteredFlatRows = [];
	const newFilteredRowsById = {};
	const maxDepth = table.options.maxLeafRowFilterDepth ?? 100;
	const recurseFilterRows = (rowsToFilter, depth = 0) => {
		const filteredRows = [];
		for (let row of rowsToFilter) {
			const newRow = constructRow(table, row.id, row.original, row.index, row.depth, void 0, row.parentId);
			newRow.columnFilters = row.columnFilters;
			if (row.subRows.length && depth < maxDepth) {
				newRow.subRows = recurseFilterRows(row.subRows, depth + 1);
				row = newRow;
				if (filterRow(row) && !newRow.subRows.length) {
					filteredRows.push(row);
					newFilteredRowsById[row.id] = row;
					newFilteredFlatRows.push(row);
					continue;
				}
				if (filterRow(row) || newRow.subRows.length) {
					filteredRows.push(row);
					newFilteredRowsById[row.id] = row;
					newFilteredFlatRows.push(row);
					continue;
				}
			} else {
				row = newRow;
				if (filterRow(row)) {
					filteredRows.push(row);
					newFilteredRowsById[row.id] = row;
					newFilteredFlatRows.push(row);
				}
			}
		}
		return filteredRows;
	};
	return {
		rows: recurseFilterRows(rowsToFilter),
		flatRows: newFilteredFlatRows,
		rowsById: newFilteredRowsById
	};
}
function filterRowModelFromRoot(rowsToFilter, filterRow, table) {
	const newFilteredFlatRows = [];
	const newFilteredRowsById = {};
	const maxDepth = table.options.maxLeafRowFilterDepth ?? 100;
	const recurseFilterRows = (rowsToFilter, depth = 0) => {
		const filteredRows = [];
		for (let row of rowsToFilter) if (filterRow(row)) {
			if (row.subRows.length && depth < maxDepth) {
				const newRow = constructRow(table, row.id, row.original, row.index, row.depth, void 0, row.parentId);
				newRow.subRows = recurseFilterRows(row.subRows, depth + 1);
				row = newRow;
			}
			filteredRows.push(row);
			newFilteredFlatRows.push(row);
			newFilteredRowsById[row.id] = row;
		}
		return filteredRows;
	};
	return {
		rows: recurseFilterRows(rowsToFilter),
		flatRows: newFilteredFlatRows,
		rowsById: newFilteredRowsById
	};
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-faceting/createFacetedRowModel.js
function createFacetedRowModel() {
	return (_table, columnId) => {
		const table = _table;
		return tableMemo({
			feature: "columnFacetingFeature",
			table,
			fnName: "createFacetedRowModel",
			memoDeps: () => {
				var _table$atoms$columnFi, _table$atoms$globalFi;
				return [
					table.getPreFilteredRowModel(),
					(_table$atoms$columnFi = table.atoms.columnFilters) === null || _table$atoms$columnFi === void 0 ? void 0 : _table$atoms$columnFi.get(),
					(_table$atoms$globalFi = table.atoms.globalFilter) === null || _table$atoms$globalFi === void 0 ? void 0 : _table$atoms$globalFi.get(),
					table.getFilteredRowModel()
				];
			},
			fn: (preRowModel, columnFilters, globalFilter) => _createFacetedRowModel(table, columnId, preRowModel, columnFilters, globalFilter)
		});
	};
}
function _createFacetedRowModel(table, columnId, preRowModel, columnFilters, globalFilter) {
	if (!preRowModel.rows.length || !(columnFilters === null || columnFilters === void 0 ? void 0 : columnFilters.length) && !globalFilter) return preRowModel;
	const filterableIds = [...(columnFilters === null || columnFilters === void 0 ? void 0 : columnFilters.map((d) => d.id).filter((d) => d !== columnId)) ?? [], globalFilter ? "__global__" : void 0].filter(Boolean);
	const filterRowsImpl = (row) => {
		for (const colId of filterableIds) {
			var _row$columnFilters;
			if (((_row$columnFilters = row.columnFilters) === null || _row$columnFilters === void 0 ? void 0 : _row$columnFilters[colId]) === false) return false;
		}
		return true;
	};
	return filterRows(preRowModel.rows, filterRowsImpl, table);
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-faceting/createFacetedUniqueValues.js
function createFacetedUniqueValues() {
	return (_table, columnId) => {
		const table = _table;
		return tableMemo({
			feature: "columnFacetingFeature",
			table,
			fnName: "table.getFacetedUniqueValues",
			memoDeps: () => {
				const column = table.getColumn(columnId);
				if (!column) return [table.getPreFilteredRowModel().flatRows];
				return [callMemoOrStaticFn(column, "getFacetedRowModel", column_getFacetedRowModel, table).flatRows];
			},
			fn: (flatRows) => _createFacetedUniqueValues(columnId, flatRows)
		});
	};
}
function _createFacetedUniqueValues(columnId, flatRows) {
	const facetedUniqueValues = /* @__PURE__ */ new Map();
	for (const row of flatRows) {
		const values = row.getUniqueValues(columnId);
		for (const value of values) if (facetedUniqueValues.has(value)) facetedUniqueValues.set(value, (facetedUniqueValues.get(value) ?? 0) + 1);
		else facetedUniqueValues.set(value, 1);
	}
	return facetedUniqueValues;
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-filtering/createFilteredRowModel.js
function createFilteredRowModel(filterFns) {
	return (_table) => {
		const table = _table;
		if (!table._rowModelFns.filterFns) table._rowModelFns.filterFns = filterFns;
		return tableMemo({
			feature: "columnFilteringFeature",
			table,
			fnName: "table.getFilteredRowModel",
			memoDeps: () => {
				var _table$atoms$columnFi, _table$atoms$globalFi;
				return [
					table.getPreFilteredRowModel(),
					(_table$atoms$columnFi = table.atoms.columnFilters) === null || _table$atoms$columnFi === void 0 ? void 0 : _table$atoms$columnFi.get(),
					(_table$atoms$globalFi = table.atoms.globalFilter) === null || _table$atoms$globalFi === void 0 ? void 0 : _table$atoms$globalFi.get()
				];
			},
			fn: () => _createFilteredRowModel(table),
			onAfterUpdate: () => table_autoResetPageIndex(table)
		});
	};
}
function _createFilteredRowModel(table) {
	var _table$atoms$columnFi2, _table$atoms$globalFi2;
	const rowModel = table.getPreFilteredRowModel();
	const columnFilters = (_table$atoms$columnFi2 = table.atoms.columnFilters) === null || _table$atoms$columnFi2 === void 0 ? void 0 : _table$atoms$columnFi2.get();
	const globalFilter = (_table$atoms$globalFi2 = table.atoms.globalFilter) === null || _table$atoms$globalFi2 === void 0 ? void 0 : _table$atoms$globalFi2.get();
	if (!rowModel.rows.length || !(columnFilters === null || columnFilters === void 0 ? void 0 : columnFilters.length) && !globalFilter) {
		for (const row of rowModel.flatRows) {
			row.columnFilters = {};
			row.columnFiltersMeta = {};
		}
		return rowModel;
	}
	const resolvedColumnFilters = [];
	const resolvedGlobalFilters = [];
	columnFilters === null || columnFilters === void 0 || columnFilters.forEach((columnFilter) => {
		var _filterFn$resolveFilt;
		const column = table_getColumn(table, columnFilter.id);
		if (!column) return;
		const filterFn = column_getFilterFn(column);
		resolvedColumnFilters.push({
			id: columnFilter.id,
			filterFn,
			resolvedValue: ((_filterFn$resolveFilt = filterFn.resolveFilterValue) === null || _filterFn$resolveFilt === void 0 ? void 0 : _filterFn$resolveFilt.call(filterFn, columnFilter.value)) ?? columnFilter.value
		});
	});
	const filterableIds = (columnFilters === null || columnFilters === void 0 ? void 0 : columnFilters.map((d) => d.id)) ?? [];
	const globalFilterFn = table_getGlobalFilterFn(table);
	const globallyFilterableColumns = table.getAllLeafColumns().filter((column) => column_getCanGlobalFilter(column));
	if (globalFilter && globalFilterFn && globallyFilterableColumns.length) {
		filterableIds.push("__global__");
		globallyFilterableColumns.forEach((column) => {
			var _globalFilterFn$resol;
			resolvedGlobalFilters.push({
				id: column.id,
				filterFn: globalFilterFn,
				resolvedValue: ((_globalFilterFn$resol = globalFilterFn.resolveFilterValue) === null || _globalFilterFn$resol === void 0 ? void 0 : _globalFilterFn$resol.call(globalFilterFn, globalFilter)) ?? globalFilter
			});
		});
	}
	for (const row of rowModel.flatRows) {
		row.columnFilters = {};
		if (resolvedColumnFilters.length) for (const currentColumnFilter of resolvedColumnFilters) {
			const id = currentColumnFilter.id;
			row.columnFilters[id] = currentColumnFilter.filterFn(row, id, currentColumnFilter.resolvedValue, (filterMeta) => {
				!row.columnFiltersMeta ? row.columnFiltersMeta = {} : row.columnFiltersMeta[id] = filterMeta;
			});
		}
		if (resolvedGlobalFilters.length) {
			for (const currentGlobalFilter of resolvedGlobalFilters) {
				const id = currentGlobalFilter.id;
				if (currentGlobalFilter.filterFn(row, id, currentGlobalFilter.resolvedValue, (filterMeta) => {
					!row.columnFiltersMeta ? row.columnFiltersMeta = {} : row.columnFiltersMeta[id] = filterMeta;
				})) {
					row.columnFilters.__global__ = true;
					break;
				}
			}
			if (row.columnFilters.__global__ !== true) row.columnFilters.__global__ = false;
		}
	}
	const filterRowsImpl = (row) => {
		for (const columnId of filterableIds) if (row.columnFilters[columnId] === false) return false;
		return true;
	};
	return filterRows(rowModel.rows, filterRowsImpl, table);
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/column-grouping/createGroupedRowModel.js
function createGroupedRowModel(aggregationFns) {
	return (_table) => {
		const table = _table;
		if (!table._rowModelFns.aggregationFns) table._rowModelFns.aggregationFns = aggregationFns;
		return tableMemo({
			feature: "columnGroupingFeature",
			table,
			fnName: "table.getGroupedRowModel",
			memoDeps: () => {
				var _table$atoms$grouping;
				return [(_table$atoms$grouping = table.atoms.grouping) === null || _table$atoms$grouping === void 0 ? void 0 : _table$atoms$grouping.get(), table.getPreGroupedRowModel()];
			},
			fn: () => _createGroupedRowModel(table),
			onAfterUpdate: () => {
				table_autoResetExpanded(table);
				table_autoResetPageIndex(table);
			}
		});
	};
}
function _createGroupedRowModel(table) {
	var _table$atoms$grouping2;
	const rowModel = table.getPreGroupedRowModel();
	const grouping = (_table$atoms$grouping2 = table.atoms.grouping) === null || _table$atoms$grouping2 === void 0 ? void 0 : _table$atoms$grouping2.get();
	if (!rowModel.rows.length || !(grouping === null || grouping === void 0 ? void 0 : grouping.length)) {
		rowModel.rows.forEach((row) => {
			row.depth = 0;
			row.parentId = void 0;
		});
		return rowModel;
	}
	const existingGrouping = grouping.filter((columnId) => table_getColumn(table, columnId));
	const groupedFlatRows = [];
	const groupedRowsById = {};
	const groupUpRecursively = (rows, depth = 0, parentId) => {
		if (depth >= existingGrouping.length) return rows.map((row) => {
			row.depth = depth;
			groupedFlatRows.push(row);
			groupedRowsById[row.id] = row;
			if (row.subRows.length) row.subRows = groupUpRecursively(row.subRows, depth + 1, row.id);
			return row;
		});
		const columnId = existingGrouping[depth];
		const rowGroupsMap = groupBy(rows, columnId);
		return Array.from(rowGroupsMap.entries()).map(([groupingValue, groupedRows], index) => {
			let id = `${columnId}:${groupingValue}`;
			id = parentId ? `${parentId}>${id}` : id;
			const subRows = groupUpRecursively(groupedRows, depth + 1, id);
			subRows.forEach((subRow) => {
				subRow.parentId = id;
			});
			const leafRows = depth ? flattenBy(groupedRows, (row) => row.subRows) : groupedRows;
			const row = constructRow(table, id, leafRows[0].original, index, depth, void 0, parentId);
			Object.assign(row, {
				groupingColumnId: columnId,
				groupingValue,
				subRows,
				leafRows,
				getValue: (colId) => {
					var _row$_groupingValuesC;
					if (existingGrouping.includes(colId)) {
						if (row._valuesCache.hasOwnProperty(colId)) return row._valuesCache[colId];
						if (groupedRows[0]) row._valuesCache[colId] = groupedRows[0].getValue(colId) ?? void 0;
						return row._valuesCache[colId];
					}
					if ((_row$_groupingValuesC = row._groupingValuesCache) === null || _row$_groupingValuesC === void 0 ? void 0 : _row$_groupingValuesC.hasOwnProperty(colId)) return row._groupingValuesCache[colId];
					const aggregateFn = column_getAggregationFn(table.getColumn(colId));
					if (!row._groupingValuesCache) row._groupingValuesCache = {};
					if (aggregateFn) {
						row._groupingValuesCache[colId] = aggregateFn(colId, leafRows, groupedRows);
						return row._groupingValuesCache[colId];
					}
				}
			});
			subRows.forEach((subRow) => {
				groupedFlatRows.push(subRow);
				groupedRowsById[subRow.id] = subRow;
			});
			return row;
		});
	};
	const groupedRows = groupUpRecursively(rowModel.rows, 0);
	groupedRows.forEach((subRow) => {
		groupedFlatRows.push(subRow);
		groupedRowsById[subRow.id] = subRow;
	});
	return {
		rows: groupedRows,
		flatRows: groupedFlatRows,
		rowsById: groupedRowsById
	};
}
function groupBy(rows, columnId) {
	const groupMap = /* @__PURE__ */ new Map();
	return rows.reduce((map, row) => {
		const resKey = `${row_getGroupingValue(row, columnId)}`;
		const previous = map.get(resKey);
		if (!previous) map.set(resKey, [row]);
		else previous.push(row);
		return map;
	}, groupMap);
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/row-expanding/createExpandedRowModel.js
function createExpandedRowModel() {
	return (_table) => {
		const table = _table;
		return tableMemo({
			feature: "rowExpandingFeature",
			table,
			fnName: "table.getExpandedRowModel",
			memoDeps: () => {
				var _table$atoms$expanded;
				return [
					(_table$atoms$expanded = table.atoms.expanded) === null || _table$atoms$expanded === void 0 ? void 0 : _table$atoms$expanded.get(),
					table.getPreExpandedRowModel(),
					table.options.paginateExpandedRows
				];
			},
			fn: () => _createExpandedRowModel(table)
		});
	};
}
function _createExpandedRowModel(table) {
	var _table$atoms$expanded2;
	const rowModel = table.getPreExpandedRowModel();
	const expanded = (_table$atoms$expanded2 = table.atoms.expanded) === null || _table$atoms$expanded2 === void 0 ? void 0 : _table$atoms$expanded2.get();
	if (!rowModel.rows.length || expanded !== true && !Object.keys(expanded ?? {}).length) return rowModel;
	if (!table.options.paginateExpandedRows) return rowModel;
	return expandRows(rowModel);
}
function expandRows(rowModel) {
	const expandedRows = [];
	const handleRow = (row) => {
		expandedRows.push(row);
		if (row.subRows.length && row_getIsExpanded(row)) row.subRows.forEach(handleRow);
	};
	rowModel.rows.forEach(handleRow);
	return {
		rows: expandedRows,
		flatRows: rowModel.flatRows,
		rowsById: rowModel.rowsById
	};
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/row-pagination/createPaginatedRowModel.js
function createPaginatedRowModel() {
	return (_table) => {
		const table = _table;
		return tableMemo({
			feature: "rowPaginationFeature",
			table,
			fnName: "table.getPaginatedRowModel",
			memoDeps: () => {
				var _table$atoms$paginati, _table$atoms$expanded;
				return [
					table.getPrePaginatedRowModel(),
					(_table$atoms$paginati = table.atoms.pagination) === null || _table$atoms$paginati === void 0 ? void 0 : _table$atoms$paginati.get(),
					table.options.paginateExpandedRows ? (_table$atoms$expanded = table.atoms.expanded) === null || _table$atoms$expanded === void 0 ? void 0 : _table$atoms$expanded.get() : void 0
				];
			},
			fn: () => _createPaginatedRowModel(table)
		});
	};
}
function _createPaginatedRowModel(table) {
	var _table$atoms$paginati2;
	const prePaginatedRowModel = table.getPrePaginatedRowModel();
	const pagination = (_table$atoms$paginati2 = table.atoms.pagination) === null || _table$atoms$paginati2 === void 0 ? void 0 : _table$atoms$paginati2.get();
	if (!prePaginatedRowModel.rows.length) return prePaginatedRowModel;
	const { pageSize, pageIndex } = pagination ?? getDefaultPaginationState();
	const { rows, flatRows, rowsById } = prePaginatedRowModel;
	const pageStart = pageSize * pageIndex;
	const pageEnd = pageStart + pageSize;
	const paginatedRows = rows.slice(pageStart, pageEnd);
	let paginatedRowModel;
	if (!table.options.paginateExpandedRows) paginatedRowModel = expandRows({
		rows: paginatedRows,
		flatRows,
		rowsById
	});
	else paginatedRowModel = {
		rows: paginatedRows,
		flatRows,
		rowsById
	};
	paginatedRowModel.flatRows = [];
	const handleRow = (row) => {
		paginatedRowModel.flatRows.push(row);
		if (row.subRows.length) row.subRows.forEach(handleRow);
	};
	paginatedRowModel.rows.forEach(handleRow);
	return paginatedRowModel;
}
//#endregion
//#region node_modules/.pnpm/@tanstack+table-core@9.0.0-alpha.36/node_modules/@tanstack/table-core/dist/features/row-sorting/createSortedRowModel.js
function createSortedRowModel(sortFns) {
	return (_table) => {
		const table = _table;
		if (!table._rowModelFns.sortFns) table._rowModelFns.sortFns = sortFns;
		return tableMemo({
			feature: "rowSortingFeature",
			table,
			fnName: "table.getSortedRowModel",
			memoDeps: () => {
				var _table$atoms$sorting;
				return [(_table$atoms$sorting = table.atoms.sorting) === null || _table$atoms$sorting === void 0 ? void 0 : _table$atoms$sorting.get(), table.getPreSortedRowModel()];
			},
			fn: () => _createSortedRowModel(table),
			onAfterUpdate: () => table_autoResetPageIndex(table)
		});
	};
}
function _createSortedRowModel(table) {
	var _table$atoms$sorting2;
	const preSortedRowModel = table.getPreSortedRowModel();
	const sorting = (_table$atoms$sorting2 = table.atoms.sorting) === null || _table$atoms$sorting2 === void 0 ? void 0 : _table$atoms$sorting2.get();
	if (!preSortedRowModel.rows.length || !(sorting === null || sorting === void 0 ? void 0 : sorting.length)) return preSortedRowModel;
	const sortedFlatRows = [];
	const availableSorting = sorting.filter((sort) => column_getCanSort(table.getColumn(sort.id)));
	const columnInfoById = {};
	availableSorting.forEach((sortEntry) => {
		const column = table.getColumn(sortEntry.id);
		if (!column) return;
		columnInfoById[sortEntry.id] = {
			sortUndefined: column.columnDef.sortUndefined,
			invertSorting: column.columnDef.invertSorting,
			sortFn: column_getSortFn(column)
		};
	});
	const sortData = (rows) => {
		const sortedData = rows.map((row) => {
			return Object.assign(Object.create(Object.getPrototypeOf(row)), row);
		});
		sortedData.sort((rowA, rowB) => {
			for (const sortEntry of availableSorting) {
				const columnInfo = columnInfoById[sortEntry.id];
				const sortUndefined = columnInfo.sortUndefined;
				const isDesc = sortEntry.desc;
				let sortInt = 0;
				if (sortUndefined) {
					const aValue = rowA.getValue(sortEntry.id);
					const bValue = rowB.getValue(sortEntry.id);
					const aUndefined = aValue === void 0;
					const bUndefined = bValue === void 0;
					if (aUndefined || bUndefined) {
						if (sortUndefined === "first") return aUndefined ? -1 : 1;
						if (sortUndefined === "last") return aUndefined ? 1 : -1;
						sortInt = aUndefined && bUndefined ? 0 : aUndefined ? sortUndefined : -sortUndefined;
					}
				}
				if (sortInt === 0) sortInt = columnInfo.sortFn(rowA, rowB, sortEntry.id);
				if (sortInt !== 0) {
					if (isDesc) sortInt *= -1;
					if (columnInfo.invertSorting) sortInt *= -1;
					return sortInt;
				}
			}
			return rowA.index - rowB.index;
		});
		sortedData.forEach((row) => {
			sortedFlatRows.push(row);
			if (row.subRows.length) row.subRows = sortData(row.subRows);
		});
		return sortedData;
	};
	return {
		rows: sortData(preSortedRowModel.rows),
		flatRows: sortedFlatRows,
		rowsById: preSortedRowModel.rowsById
	};
}
//#endregion
//#region dist/coordinate-debugger-DMx2ibI_.js
function _applyDecoratedDescriptor$1(i, e, r, n, l) {
	var a = {};
	return Object.keys(n).forEach(function(i) {
		a[i] = n[i];
	}), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = true), a = r.slice().reverse().reduce(function(r, n) {
		return n(i, e, r) || r;
	}, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a;
}
function _defineProperty$1(e, r, t) {
	return (r = _toPropertyKey$1(r)) in e ? Object.defineProperty(e, r, {
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
function _toPrimitive$1(t, r) {
	if ("object" != typeof t || !t) return t;
	var e = t[Symbol.toPrimitive];
	if (void 0 !== e) {
		var i = e.call(t, r);
		if ("object" != typeof i) return i;
		throw new TypeError("@@toPrimitive must return a primitive value.");
	}
	return ("string" === r ? String : Number)(t);
}
function _toPropertyKey$1(t) {
	var i = _toPrimitive$1(t, "string");
	return "symbol" == typeof i ? i : i + "";
}
var SCOPED_CSS_ATTRIBUTE = /^data-scopedcss-[0-9a-f]{10}-[0-9a-f]{10}$/;
var SurfaceScopeContextName = "boxel-surface:scope";
var SurfaceScopeRelay = class {
	constructor(parent) {
		_defineProperty$1(this, "local", /* @__PURE__ */ new Map());
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
var runtimeRoots$1 = /* @__PURE__ */ new WeakMap();
var liftRoots = /* @__PURE__ */ new WeakMap();
var surfaceElements = /* @__PURE__ */ new WeakMap();
function registerSurfaceDomRoot(element, ladder, runtime) {
	roots.set(element, ladder);
	if (runtime) runtimeRoots$1.set(element, runtime);
	return () => {
		roots.delete(element);
		runtimeRoots$1.delete(element);
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
		const runtime = runtimeRoots$1.get(current);
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
function surfaceElementsForIds(root, ids, runtime) {
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	const activeRuntime = runtime ?? surfaceRuntimeForElement(root);
	const elementsById = activeRuntime ? surfaceElements.get(activeRuntime) : void 0;
	for (const id of ids) {
		const registered = elementsById?.get(id);
		if (registered) {
			let addedRegisteredElement = false;
			for (const element of registered) {
				const inRoot = root.contains(element);
				const inSameRuntimeLift = !inRoot && activeRuntime !== void 0 && element.closest("[data-bx-lift]") !== null && surfaceRuntimeForElement(element) === activeRuntime;
				if (!element.isConnected || !inRoot && !inSameRuntimeLift || seen.has(element)) continue;
				out.push(element);
				seen.add(element);
				addedRegisteredElement = true;
			}
			if (addedRegisteredElement) continue;
		}
		const fallback = findSurfaceElementById(root, id);
		if (fallback && !seen.has(fallback)) {
			out.push(fallback);
			seen.add(fallback);
		}
	}
	return out;
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
function findSurfaceElementById(root, id) {
	if (surfaceElementMatchesId(root, id)) return root;
	for (const element of root.querySelectorAll("[data-ladder-id], [data-id], [data-bx-grid-traversal-id], [id]")) if (surfaceElementMatchesId(element, id)) return element;
	return null;
}
function surfaceElementMatchesId(element, id) {
	return element.getAttribute("data-ladder-id") === id || element.getAttribute("data-id") === id || element.dataset["bxGridTraversalId"] === id || element.id === id;
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
var StyleId$2 = "boxel-surface-coordinate-debugger-styles";
function ensureStyles$2(document) {
	if (document.getElementById(StyleId$2)) return;
	const style = document.createElement("style");
	style.id = StyleId$2;
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
	ensureStyles$2(document);
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
var _class$e, _descriptor$a, _descriptor2$7, _descriptor3$2$1;
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
		_defineProperty$1(this, "_nodes", /* @__PURE__ */ new Map());
		_defineProperty$1(this, "_children", /* @__PURE__ */ new Map());
		_initializerDefineProperty$1(this, "_focusPath", _descriptor$a, this);
		_initializerDefineProperty$1(this, "_selection", _descriptor2$7, this);
		_initializerDefineProperty$1(this, "_hoveredId", _descriptor3$2$1, this);
		_defineProperty$1(this, "_pendingFocusKey", null);
		_defineProperty$1(this, "_restoredFocusId", null);
		_defineProperty$1(this, "_selectionAnchor", null);
		_defineProperty$1(this, "_subs", /* @__PURE__ */ new Set());
		_defineProperty$1(this, "isFocused", (id) => this.focusedId === id);
		_defineProperty$1(this, "isHovered", (id) => this._hoveredId === id);
		/** True when `id` is anywhere on the focus path (including the
		*  deepest entry). Useful for "ancestor of focus" highlighting. */
		_defineProperty$1(this, "isOnFocusPath", (id) => this._focusPath.includes(id));
		_defineProperty$1(this, "isSelected", (id) => {
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
}), _descriptor3$2$1 = _applyDecoratedDescriptor$1(_class$e.prototype, "_hoveredId", [tracked], {
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
		_defineProperty$1(this, "nodes", /* @__PURE__ */ new Map());
		_defineProperty$1(this, "children", /* @__PURE__ */ new Map());
		_defineProperty$1(this, "program", compileFociProgram([]));
		_defineProperty$1(this, "pathCache", /* @__PURE__ */ new Map());
		_defineProperty$1(this, "scopeIdCache", /* @__PURE__ */ new Map());
		_defineProperty$1(this, "focusPath", []);
		_defineProperty$1(this, "selections", /* @__PURE__ */ new Map());
		_defineProperty$1(this, "selectionActivatedAt", /* @__PURE__ */ new Map());
		_defineProperty$1(this, "activeScopeId", null);
		_defineProperty$1(this, "hoveredId", null);
		_defineProperty$1(this, "input", null);
		_defineProperty$1(this, "overlay", null);
		_defineProperty$1(this, "transfer", null);
		_defineProperty$1(this, "coordinateRevisions", /* @__PURE__ */ new Map());
		_defineProperty$1(this, "logEntries", []);
		_defineProperty$1(this, "snapshotVersionValue", 0);
		_defineProperty$1(this, "snapshotVersionKey", "");
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
		if (isArrowKey$1(key)) return this.move(directionFromArrowKey(key), options);
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
function isArrowKey$1(key) {
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
		_defineProperty$1(this, "store", createFociStore());
		_defineProperty$1(this, "records", /* @__PURE__ */ new Map());
		_defineProperty$1(this, "siblingOrders", /* @__PURE__ */ new Map());
		_defineProperty$1(this, "subscribers", /* @__PURE__ */ new Set());
		_defineProperty$1(this, "scopedSubscribers", {
			selection: /* @__PURE__ */ new Set(),
			topology: /* @__PURE__ */ new Set(),
			input: /* @__PURE__ */ new Set(),
			viewport: /* @__PURE__ */ new Set()
		});
		_defineProperty$1(this, "viewportState", { ...DEFAULT_VIEWPORT });
		_defineProperty$1(this, "pendingSelect", null);
		_defineProperty$1(this, "projectionCache", /* @__PURE__ */ new Map());
		_defineProperty$1(this, "batchDepth", 0);
		_defineProperty$1(this, "pendingReload", false);
		_defineProperty$1(this, "pendingNotify", false);
		_defineProperty$1(this, "pendingNotifyScopes", /* @__PURE__ */ new Set());
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
		x: finiteNumber$1(viewport.x, fallback.x),
		y: finiteNumber$1(viewport.y, fallback.y),
		zoom: positiveNumber(viewport.zoom, fallback.zoom),
		width: nonNegativeNumber(viewport.width, fallback.width),
		height: nonNegativeNumber(viewport.height, fallback.height)
	};
}
function viewportsEqual(a, b) {
	return a.x === b.x && a.y === b.y && a.zoom === b.zoom && a.width === b.width && a.height === b.height;
}
function finiteNumber$1(value, fallback) {
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
		_defineProperty$1(this, "active", /* @__PURE__ */ new Map());
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
var LAYERS = SURFACE_LAYERS;
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
function clipSurfaceLayerRect(rect, clip) {
	const rectRight = rect.left + rect.width;
	const rectBottom = rect.top + rect.height;
	const left = Math.max(rect.left, clip.left);
	const top = Math.max(rect.top, clip.top);
	const right = Math.min(rectRight, clip.right);
	const bottom = Math.min(rectBottom, clip.bottom);
	if (right <= left || bottom <= top) return null;
	const clippedLeft = left > rect.left;
	const clippedTop = top > rect.top;
	const clippedRight = right < rectRight;
	const clippedBottom = bottom < rectBottom;
	const width = right - left;
	const height = bottom - top;
	return {
		...rect,
		left,
		top,
		width,
		height,
		...rect.radius ? { radius: clampSurfaceLayerRadii({
			topLeft: clippedLeft || clippedTop ? 0 : rect.radius.topLeft,
			topRight: clippedRight || clippedTop ? 0 : rect.radius.topRight,
			bottomRight: clippedRight || clippedBottom ? 0 : rect.radius.bottomRight,
			bottomLeft: clippedLeft || clippedBottom ? 0 : rect.radius.bottomLeft
		}, width, height) } : {}
	};
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
function escapeAttributeValue$1(value) {
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
		_defineProperty$1(this, "resolver", void 0);
		_defineProperty$1(this, "sources", /* @__PURE__ */ new Map());
		_defineProperty$1(this, "hoverTimer", null);
		_defineProperty$1(this, "dismissTimer", null);
		_defineProperty$1(this, "lastClosedAt", 0);
		_defineProperty$1(this, "hoverPauseMs", void 0);
		_defineProperty$1(this, "dismissGraceMs", void 0);
		_defineProperty$1(this, "dismissCooldownMs", void 0);
		_defineProperty$1(this, "sourceAria", null);
		_defineProperty$1(this, "nextFocusToken", 1);
		_defineProperty$1(this, "open", (source, edges, kind) => {
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
		_defineProperty$1(this, "openForMode", (source, edges, mode, open) => {
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
		_defineProperty$1(this, "openForModeBySourceId", (sourceId, mode, open, sourceOverride = {}) => {
			const registered = this.sources.get(sourceId);
			if (!registered) return false;
			return this.openForMode({
				...registered.source,
				...sourceOverride
			}, registered.edges, mode, open);
		});
		_defineProperty$1(this, "scheduleHover", (source, edges, mode) => {
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
		_defineProperty$1(this, "scheduleDismissDetails", () => {
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
		_defineProperty$1(this, "cancelDismiss", () => {
			this.cancelDismissTimer();
		});
		_defineProperty$1(this, "escalate", (kind) => {
			const active = this.active;
			if (!active) return;
			this.open(active.source, { [kind]: { presentation: kind } }, kind);
		});
		_defineProperty$1(this, "close", () => {
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
		return id ? `[data-ladder-id="${escapeAttributeValue$1(id)}"]` : "";
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
var _dec$4, _dec2$1$1, _dec3$1, _dec4$1, _dec5$1, _dec6$1, _class$c, _descriptor$8, _descriptor2$6, _descriptor3$1$1, _descriptor4$1$1, _descriptor5$1$1, _descriptor6$1$1, _Lift;
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
function topmostKeyboardLift$1() {
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
		if (topmostKeyboardLift$1() !== element) return;
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
var Lift = (_dec$4 = consume(SurfaceScopeContextName), _dec2$1$1 = consume(LadderContextName), _dec3$1 = consume(SurfaceRuntimeContextName), _dec4$1 = consume(LiftContextName), _dec5$1 = consume(ModeContextName), _dec6$1 = consume(InspectContextName), _class$c = (_Lift = class Lift extends Component {
	constructor(...args) {
		super(...args);
		_defineProperty$1(this, "instanceId", `bx-lift-${++nextLiftInstanceId}`);
		_initializerDefineProperty$1(this, "inheritedScopeRelay", _descriptor$8, this);
		_initializerDefineProperty$1(this, "inheritedLadder", _descriptor2$6, this);
		_initializerDefineProperty$1(this, "inheritedRuntime", _descriptor3$1$1, this);
		_initializerDefineProperty$1(this, "inheritedLiftManager", _descriptor4$1$1, this);
		_initializerDefineProperty$1(this, "inheritedMode", _descriptor5$1$1, this);
		_initializerDefineProperty$1(this, "inheritedInspect", _descriptor6$1$1, this);
		_defineProperty$1(this, "localScopeRelay", void 0);
		/** Default action when the user clicks the corner glyph. With
		*  exactly one escalation target, fire that. Otherwise rotate
		*  through targets. */
		_defineProperty$1(this, "fireEscalateNext", () => {
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
		_defineProperty$1(this, "handleScrimClick", () => {
			this.args.onDismiss?.();
		});
		_defineProperty$1(this, "anchoredLift", anchoredLift);
		_defineProperty$1(this, "shadowAnchor", shadowAnchor);
		_defineProperty$1(this, "liftFocus", liftFocusModifier);
		_defineProperty$1(this, "trapLiftFocus", trapLiftFocusModifier);
		_defineProperty$1(this, "delegateLiftKeyboard", delegateLiftKeyboardModifier);
		_defineProperty$1(this, "dismissOnOutside", dismissOnOutside);
		_defineProperty$1(this, "allocateLiftLayer", allocateLiftLayer);
		_defineProperty$1(this, "liftSurfaceRoot", liftSurfaceRoot);
		_defineProperty$1(this, "cleanupClosedLift", cleanupClosedLiftModifier);
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
}), _descriptor2$6 = _applyDecoratedDescriptor$1(_class$c.prototype, "inheritedLadder", [_dec2$1$1], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor3$1$1 = _applyDecoratedDescriptor$1(_class$c.prototype, "inheritedRuntime", [_dec3$1], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor4$1$1 = _applyDecoratedDescriptor$1(_class$c.prototype, "inheritedLiftManager", [_dec4$1], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor5$1$1 = _applyDecoratedDescriptor$1(_class$c.prototype, "inheritedMode", [_dec5$1], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor6$1$1 = _applyDecoratedDescriptor$1(_class$c.prototype, "inheritedInspect", [_dec6$1], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _class$c);
var FormFieldContextName = "boxel-surface:form-field";
var _dec$3, _dec2$2, _dec3$2, _dec4$2, _dec5$2, _dec6, _dec7, _dec8, _dec9, _dec0, _dec1, _dec10, _dec11, _dec12, _dec13, _dec14, _dec15, _dec16, _dec17, _dec18, _dec19, _class$b, _descriptor$7$1, _descriptor2$5, _descriptor3$4, _descriptor4$3, _descriptor5$2, _descriptor6$2, _descriptor7$1, _descriptor8, _descriptor9, _descriptor0, _descriptor1, _descriptor10, _SurfaceComponent, _dec20, _dec21, _dec22, _dec23, _dec24, _dec25, _dec26, _dec27, _dec28, _dec29, _dec30, _dec31, _dec32, _dec33, _dec34, _class2$1, _descriptor11, _descriptor12, _descriptor13, _Environment, _dec35, _class3$1, _descriptor14, _descriptor15, _descriptor16, _Cell$1;
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
var SurfaceComponent = (_dec$3 = consume(LadderContextName), _dec2$2 = consume(SurfaceRuntimeContextName), _dec3$2 = consume(ParentIdContextName), _dec4$2 = consume(ParentContextName), _dec5$2 = consume(DemoContextName), _dec6 = consume(ModeContextName), _dec7 = consume(InspectContextName), _dec8 = consume(ChangeRouteContextName), _dec9 = consume(PathContextName), _dec0 = consume(CoordinateSpaceContextName), _dec1 = consume(LiftContextName), _dec10 = consume(SurfaceScopeContextName), _dec11 = provide(ParentIdContextName), _dec12 = provide(ParentContextName), _dec13 = provide(DemoContextName), _dec14 = provide(ModeContextName), _dec15 = provide(InspectContextName), _dec16 = provide(ChangeRouteContextName), _dec17 = provide(PathContextName), _dec18 = provide(CoordinateSpaceContextName), _dec19 = provide(SurfaceScopeContextName), _class$b = (_SurfaceComponent = class SurfaceComponent extends Component {
	constructor(...args) {
		super(...args);
		_defineProperty$1(this, "generatedId", void 0);
		_initializerDefineProperty$1(this, "inheritedLadder", _descriptor$7$1, this);
		_initializerDefineProperty$1(this, "inheritedSurfaceRuntime", _descriptor2$5, this);
		_initializerDefineProperty$1(this, "inheritedParentId", _descriptor3$4, this);
		_initializerDefineProperty$1(this, "inheritedParentSurface", _descriptor4$3, this);
		_initializerDefineProperty$1(this, "inheritedDemo", _descriptor5$2, this);
		_initializerDefineProperty$1(this, "inheritedMode", _descriptor6$2, this);
		_initializerDefineProperty$1(this, "inheritedInspect", _descriptor7$1, this);
		_initializerDefineProperty$1(this, "inheritedChangeRoute", _descriptor8, this);
		_initializerDefineProperty$1(this, "inheritedSurfacePath", _descriptor9, this);
		_initializerDefineProperty$1(this, "inheritedCoordinateSpace", _descriptor0, this);
		_initializerDefineProperty$1(this, "inheritedLiftManager", _descriptor1, this);
		_initializerDefineProperty$1(this, "inheritedScopeRelay", _descriptor10, this);
		_defineProperty$1(this, "localScopeRelay", void 0);
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
}), _SurfaceComponent), _SurfaceComponent), _descriptor$7$1 = _applyDecoratedDescriptor$1(_class$b.prototype, "inheritedLadder", [_dec$3], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor2$5 = _applyDecoratedDescriptor$1(_class$b.prototype, "inheritedSurfaceRuntime", [_dec2$2], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor3$4 = _applyDecoratedDescriptor$1(_class$b.prototype, "inheritedParentId", [_dec3$2], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor4$3 = _applyDecoratedDescriptor$1(_class$b.prototype, "inheritedParentSurface", [_dec4$2], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor5$2 = _applyDecoratedDescriptor$1(_class$b.prototype, "inheritedDemo", [_dec5$2], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor6$2 = _applyDecoratedDescriptor$1(_class$b.prototype, "inheritedMode", [_dec6], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor7$1 = _applyDecoratedDescriptor$1(_class$b.prototype, "inheritedInspect", [_dec7], {
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
_dec20 = consume(PathContextName), _dec21 = consume(CoordinateSpaceContextName), _dec22 = consume(SurfaceScopeContextName), _dec23 = provide(LadderContextName), _dec24 = provide(SurfaceRuntimeContextName), _dec25 = provide(ParentIdContextName), _dec26 = provide(ParentContextName), _dec27 = provide(DemoContextName), _dec28 = provide(ModeContextName), _dec29 = provide(InspectContextName), _dec30 = provide(ChangeRouteContextName), _dec31 = provide(PathContextName), _dec32 = provide(CoordinateSpaceContextName), _dec33 = provide(LiftContextName), _dec34 = provide(SurfaceScopeContextName), _class2$1 = (_Environment = class Environment extends Component {
	constructor(owner, args) {
		super(owner, args);
		_defineProperty$1(this, "localLadder", createFocusLadder());
		_defineProperty$1(this, "localRuntime", createSurfaceRuntime());
		_defineProperty$1(this, "localLiftManager", createLiftManager());
		_defineProperty$1(this, "generatedId", void 0);
		_initializerDefineProperty$1(this, "inheritedSurfacePath", _descriptor11, this);
		_initializerDefineProperty$1(this, "inheritedCoordinateSpace", _descriptor12, this);
		_initializerDefineProperty$1(this, "inheritedScopeRelay", _descriptor13, this);
		_defineProperty$1(this, "localScopeRelay", void 0);
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
}), _Environment), _Environment), _descriptor11 = _applyDecoratedDescriptor$1(_class2$1.prototype, "inheritedSurfacePath", [_dec20], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor12 = _applyDecoratedDescriptor$1(_class2$1.prototype, "inheritedCoordinateSpace", [_dec21], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor13 = _applyDecoratedDescriptor$1(_class2$1.prototype, "inheritedScopeRelay", [_dec22], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _applyDecoratedDescriptor$1(_class2$1.prototype, "coordinateSchema", [cached], Object.getOwnPropertyDescriptor(_class2$1.prototype, "coordinateSchema"), _class2$1.prototype), _applyDecoratedDescriptor$1(_class2$1.prototype, "id", [cached], Object.getOwnPropertyDescriptor(_class2$1.prototype, "id"), _class2$1.prototype), _applyDecoratedDescriptor$1(_class2$1.prototype, "focusKey", [cached], Object.getOwnPropertyDescriptor(_class2$1.prototype, "focusKey"), _class2$1.prototype), _applyDecoratedDescriptor$1(_class2$1.prototype, "coordinate", [cached], Object.getOwnPropertyDescriptor(_class2$1.prototype, "coordinate"), _class2$1.prototype), _applyDecoratedDescriptor$1(_class2$1.prototype, "coordinateSpaceId", [cached], Object.getOwnPropertyDescriptor(_class2$1.prototype, "coordinateSpaceId"), _class2$1.prototype), _applyDecoratedDescriptor$1(_class2$1.prototype, "runtimeGridCoordinate", [cached], Object.getOwnPropertyDescriptor(_class2$1.prototype, "runtimeGridCoordinate"), _class2$1.prototype), _applyDecoratedDescriptor$1(_class2$1.prototype, "runtimePolicy", [cached], Object.getOwnPropertyDescriptor(_class2$1.prototype, "runtimePolicy"), _class2$1.prototype), _applyDecoratedDescriptor$1(_class2$1.prototype, "providedLadder", [_dec23], Object.getOwnPropertyDescriptor(_class2$1.prototype, "providedLadder"), _class2$1.prototype), _applyDecoratedDescriptor$1(_class2$1.prototype, "providedSurfaceRuntime", [_dec24], Object.getOwnPropertyDescriptor(_class2$1.prototype, "providedSurfaceRuntime"), _class2$1.prototype), _applyDecoratedDescriptor$1(_class2$1.prototype, "providedParentId", [_dec25], Object.getOwnPropertyDescriptor(_class2$1.prototype, "providedParentId"), _class2$1.prototype), _applyDecoratedDescriptor$1(_class2$1.prototype, "providedParentSurface", [_dec26], Object.getOwnPropertyDescriptor(_class2$1.prototype, "providedParentSurface"), _class2$1.prototype), _applyDecoratedDescriptor$1(_class2$1.prototype, "providedDemo", [_dec27], Object.getOwnPropertyDescriptor(_class2$1.prototype, "providedDemo"), _class2$1.prototype), _applyDecoratedDescriptor$1(_class2$1.prototype, "providedMode", [_dec28], Object.getOwnPropertyDescriptor(_class2$1.prototype, "providedMode"), _class2$1.prototype), _applyDecoratedDescriptor$1(_class2$1.prototype, "providedInspect", [_dec29], Object.getOwnPropertyDescriptor(_class2$1.prototype, "providedInspect"), _class2$1.prototype), _applyDecoratedDescriptor$1(_class2$1.prototype, "providedChangeRoute", [_dec30], Object.getOwnPropertyDescriptor(_class2$1.prototype, "providedChangeRoute"), _class2$1.prototype), _applyDecoratedDescriptor$1(_class2$1.prototype, "providedSurfacePath", [_dec31], Object.getOwnPropertyDescriptor(_class2$1.prototype, "providedSurfacePath"), _class2$1.prototype), _applyDecoratedDescriptor$1(_class2$1.prototype, "providedCoordinateSpaceContext", [_dec32], Object.getOwnPropertyDescriptor(_class2$1.prototype, "providedCoordinateSpaceContext"), _class2$1.prototype), _applyDecoratedDescriptor$1(_class2$1.prototype, "providedLiftManager", [_dec33], Object.getOwnPropertyDescriptor(_class2$1.prototype, "providedLiftManager"), _class2$1.prototype), _applyDecoratedDescriptor$1(_class2$1.prototype, "providedScopeRelay", [_dec34], Object.getOwnPropertyDescriptor(_class2$1.prototype, "providedScopeRelay"), _class2$1.prototype);
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
var Cell$1 = (_dec35 = consume(FormFieldContextName), _class3$1 = (_Cell$1 = class Cell extends SurfaceComponent {
	constructor(...args) {
		super(...args);
		_defineProperty$1(this, "cellGuid", guidFor(this));
		_initializerDefineProperty$1(this, "inheritedFormField", _descriptor14, this);
		_initializerDefineProperty$1(this, "detectedCellSurface", _descriptor15, this);
		_initializerDefineProperty$1(this, "detectedState", _descriptor16, this);
		_defineProperty$1(this, "detectCell", modifier((el) => {
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
}), _Cell$1), _Cell$1), _descriptor14 = _applyDecoratedDescriptor$1(_class3$1.prototype, "inheritedFormField", [_dec35], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor15 = _applyDecoratedDescriptor$1(_class3$1.prototype, "detectedCellSurface", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return "form";
	}
}), _descriptor16 = _applyDecoratedDescriptor$1(_class3$1.prototype, "detectedState", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return "none";
	}
}), _class3$1);
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
var _class$a, _descriptor$6$2, _descriptor2$4, _FormField;
var FormField = (_class$a = (_FormField = class FormField extends Component {
	constructor(...args) {
		super(...args);
		_defineProperty$1(this, "guid", guidFor(this));
		_initializerDefineProperty$1(this, "inheritedLayout", _descriptor$6$2, this);
		_initializerDefineProperty$1(this, "inheritedDensity", _descriptor2$4, this);
		_defineProperty$1(this, "inheritFormChrome", modifier((el) => {
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
}), _FormField), _FormField), _descriptor$6$2 = _applyDecoratedDescriptor$1(_class$a.prototype, "inheritedLayout", [tracked], {
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
var _dec$2, _class$9, _descriptor$5$2, _EmailCell;
var EmailCell = (_dec$2 = consume(FormFieldContextName), _class$9 = (_EmailCell = class EmailCell extends Component {
	constructor(...args) {
		super(...args);
		_initializerDefineProperty$1(this, "inheritedFormField", _descriptor$5$2, this);
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
		Cell: Cell$1,
		on
	})
}), _EmailCell), _EmailCell), _descriptor$5$2 = _applyDecoratedDescriptor$1(_class$9.prototype, "inheritedFormField", [_dec$2], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _applyDecoratedDescriptor$1(_class$9.prototype, "handleInput", [action], Object.getOwnPropertyDescriptor(_class$9.prototype, "handleInput"), _class$9.prototype), _class$9);
var _class$8$1, _NumberCell;
var NumberCell = (_class$8$1 = (_NumberCell = class NumberCell extends Component {
	get value() {
		return this.args.value === void 0 ? "" : String(this.args.value);
	}
	handleInput(event) {
		this.args.onInput?.(event.target.value);
	}
}, setComponentTemplate(precompileTemplate("{{#if @prefix}}\n  {{#if @suffix}}\n    <Cell @state={{@state}} @disabled={{@disabled}} @readonly={{@readonly}}>\n      <:pre>{{@prefix}}</:pre>\n      <:default>\n        <input class=\"boxel-input\" type=\"number\" value={{this.value}} placeholder={{@placeholder}} disabled={{@disabled}} readonly={{@readonly}} min={{@min}} max={{@max}} step={{@step}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n      </:default>\n      <:post>{{@suffix}}</:post>\n    </Cell>\n  {{else}}\n    <Cell @state={{@state}} @disabled={{@disabled}} @readonly={{@readonly}}>\n      <:pre>{{@prefix}}</:pre>\n      <:default>\n        <input class=\"boxel-input\" type=\"number\" value={{this.value}} placeholder={{@placeholder}} disabled={{@disabled}} readonly={{@readonly}} min={{@min}} max={{@max}} step={{@step}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n      </:default>\n    </Cell>\n  {{/if}}\n{{else if @suffix}}\n  <Cell @state={{@state}} @disabled={{@disabled}} @readonly={{@readonly}}>\n    <:default>\n      <input class=\"boxel-input\" type=\"number\" value={{this.value}} placeholder={{@placeholder}} disabled={{@disabled}} readonly={{@readonly}} min={{@min}} max={{@max}} step={{@step}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n    </:default>\n    <:post>{{@suffix}}</:post>\n  </Cell>\n{{else}}\n  <Cell @state={{@state}} @disabled={{@disabled}} @readonly={{@readonly}}>\n    <input class=\"boxel-input\" type=\"number\" value={{this.value}} placeholder={{@placeholder}} disabled={{@disabled}} readonly={{@readonly}} min={{@min}} max={{@max}} step={{@step}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n  </Cell>\n{{/if}}", {
	strictMode: true,
	scope: () => ({
		Cell: Cell$1,
		on
	})
}), _NumberCell), _NumberCell), _applyDecoratedDescriptor$1(_class$8$1.prototype, "handleInput", [action], Object.getOwnPropertyDescriptor(_class$8$1.prototype, "handleInput"), _class$8$1.prototype), _class$8$1);
var _class$7$2, _SwitchCell;
var SwitchCell = (_class$7$2 = (_SwitchCell = class SwitchCell extends Component {
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
		Cell: Cell$1,
		on
	})
}), _SwitchCell), _SwitchCell), _applyDecoratedDescriptor$1(_class$7$2.prototype, "toggle", [action], Object.getOwnPropertyDescriptor(_class$7$2.prototype, "toggle"), _class$7$2.prototype), _class$7$2);
var _class$6$2, _TextCell;
var TextCell = (_class$6$2 = (_TextCell = class TextCell extends Component {
	handleInput(event) {
		this.args.onInput?.(event.target.value);
	}
	get inputType() {
		return this.args.type ?? "text";
	}
}, setComponentTemplate(precompileTemplate("{{#if @prefix}}\n  {{#if @suffix}}\n    <Cell @state={{@state}} @disabled={{@disabled}} @readonly={{@readonly}}>\n      <:pre>{{@prefix}}</:pre>\n      <:default>\n        {{#if @multiline}}\n          <textarea class=\"boxel-input\" value={{@value}} placeholder={{@placeholder}} disabled={{@disabled}} readonly={{@readonly}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n        {{else}}\n          <input class=\"boxel-input\" type={{this.inputType}} value={{@value}} placeholder={{@placeholder}} autocomplete={{@autocomplete}} disabled={{@disabled}} readonly={{@readonly}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n        {{/if}}\n      </:default>\n      <:post>{{@suffix}}</:post>\n    </Cell>\n  {{else}}\n    <Cell @state={{@state}} @disabled={{@disabled}} @readonly={{@readonly}}>\n      <:pre>{{@prefix}}</:pre>\n      <:default>\n        {{#if @multiline}}\n          <textarea class=\"boxel-input\" value={{@value}} placeholder={{@placeholder}} disabled={{@disabled}} readonly={{@readonly}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n        {{else}}\n          <input class=\"boxel-input\" type={{this.inputType}} value={{@value}} placeholder={{@placeholder}} autocomplete={{@autocomplete}} disabled={{@disabled}} readonly={{@readonly}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n        {{/if}}\n      </:default>\n    </Cell>\n  {{/if}}\n{{else if @suffix}}\n  <Cell @state={{@state}} @disabled={{@disabled}} @readonly={{@readonly}}>\n    <:default>\n      {{#if @multiline}}\n        <textarea class=\"boxel-input\" value={{@value}} placeholder={{@placeholder}} disabled={{@disabled}} readonly={{@readonly}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n      {{else}}\n        <input class=\"boxel-input\" type={{this.inputType}} value={{@value}} placeholder={{@placeholder}} autocomplete={{@autocomplete}} disabled={{@disabled}} readonly={{@readonly}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n      {{/if}}\n    </:default>\n    <:post>{{@suffix}}</:post>\n  </Cell>\n{{else}}\n  <Cell @state={{@state}} @disabled={{@disabled}} @readonly={{@readonly}}>\n    {{#if @multiline}}\n      <textarea class=\"boxel-input\" value={{@value}} placeholder={{@placeholder}} disabled={{@disabled}} readonly={{@readonly}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n    {{else}}\n      <input class=\"boxel-input\" type={{this.inputType}} value={{@value}} placeholder={{@placeholder}} autocomplete={{@autocomplete}} disabled={{@disabled}} readonly={{@readonly}} data-test-boxel-input {{on \"input\" this.handleInput}} />\n    {{/if}}\n  </Cell>\n{{/if}}", {
	strictMode: true,
	scope: () => ({
		Cell: Cell$1,
		on
	})
}), _TextCell), _TextCell), _applyDecoratedDescriptor$1(_class$6$2.prototype, "handleInput", [action], Object.getOwnPropertyDescriptor(_class$6$2.prototype, "handleInput"), _class$6$2.prototype), _class$6$2);
var _class$5$2, _FormResolvedField;
var FormResolvedField = (_class$5$2 = (_FormResolvedField = class FormResolvedField extends Component {
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
}), _FormResolvedField), _FormResolvedField), _applyDecoratedDescriptor$1(_class$5$2.prototype, "updateText", [action], Object.getOwnPropertyDescriptor(_class$5$2.prototype, "updateText"), _class$5$2.prototype), _applyDecoratedDescriptor$1(_class$5$2.prototype, "updateNumber", [action], Object.getOwnPropertyDescriptor(_class$5$2.prototype, "updateNumber"), _class$5$2.prototype), _applyDecoratedDescriptor$1(_class$5$2.prototype, "updateBoolean", [action], Object.getOwnPropertyDescriptor(_class$5$2.prototype, "updateBoolean"), _class$5$2.prototype), _class$5$2);
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
var _class$4$2 = (_FormSection = class FormSection extends Component {
	constructor(...args) {
		super(...args);
		_initializerDefineProperty$1(this, "openOverride", _descriptor$4$2, this);
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
}), _FormSection), _FormSection), _descriptor$4$2 = _applyDecoratedDescriptor$1(_class$4$2.prototype, "openOverride", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _FormSection;
_applyDecoratedDescriptor$1(_class$4$2.prototype, "toggle", [action], Object.getOwnPropertyDescriptor(_class$4$2.prototype, "toggle"), _class$4$2.prototype);
var _class$3$2, _descriptor$3$2, _descriptor2$3$1, _FormTabs;
var FormTabsContextName = "boxel-surface:form-tabs";
var FormTabRegisterEventName = "bx-form-tab-register";
_class$3$2 = (_FormTabs = class FormTabs extends Component {
	constructor(...args) {
		super(...args);
		_initializerDefineProperty$1(this, "tabs", _descriptor$3$2, this);
		_initializerDefineProperty$1(this, "activeOverride", _descriptor2$3$1, this);
		_defineProperty$1(this, "tabUpdaters", /* @__PURE__ */ new Map());
		_defineProperty$1(this, "registerTab", (tab, updateActiveId) => {
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
}), _FormTabs), _FormTabs), _descriptor$3$2 = _applyDecoratedDescriptor$1(_class$3$2.prototype, "tabs", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return [];
	}
}), _descriptor2$3$1 = _applyDecoratedDescriptor$1(_class$3$2.prototype, "activeOverride", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _applyDecoratedDescriptor$1(_class$3$2.prototype, "select", [action], Object.getOwnPropertyDescriptor(_class$3$2.prototype, "select"), _class$3$2.prototype), _applyDecoratedDescriptor$1(_class$3$2.prototype, "selectFromEvent", [action], Object.getOwnPropertyDescriptor(_class$3$2.prototype, "selectFromEvent"), _class$3$2.prototype), _applyDecoratedDescriptor$1(_class$3$2.prototype, "registerFromEvent", [action], Object.getOwnPropertyDescriptor(_class$3$2.prototype, "registerFromEvent"), _class$3$2.prototype);
var _dec$1$1 = consume(FormTabsContextName), _class$2$2 = (_FormTab = class FormTab extends Component {
	constructor(...args) {
		super(...args);
		_defineProperty$1(this, "guid", guidFor(this));
		_initializerDefineProperty$1(this, "eventActiveId", _descriptor$2$2, this);
		_initializerDefineProperty$1(this, "tabs", _descriptor2$2$1, this);
		_defineProperty$1(this, "register", modifier((el) => {
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
}), _FormTab), _FormTab), _descriptor$2$2 = _applyDecoratedDescriptor$1(_class$2$2.prototype, "eventActiveId", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor2$2$1 = _applyDecoratedDescriptor$1(_class$2$2.prototype, "tabs", [_dec$1$1], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _FormTab;
var _class$1$9, _descriptor$1$8, _descriptor2$1$1, _FormWizard;
var FormWizardContextName = "boxel-surface:form-wizard";
var FormStepRegisterEventName = "bx-form-step-register";
_class$1$9 = (_FormWizard = class FormWizard extends Component {
	constructor(...args) {
		super(...args);
		_initializerDefineProperty$1(this, "steps", _descriptor$1$8, this);
		_initializerDefineProperty$1(this, "activeOverride", _descriptor2$1$1, this);
		_defineProperty$1(this, "stepUpdaters", /* @__PURE__ */ new Map());
		_defineProperty$1(this, "registerStep", (step, updateActiveId) => {
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
}), _FormWizard), _FormWizard), _descriptor$1$8 = _applyDecoratedDescriptor$1(_class$1$9.prototype, "steps", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return [];
	}
}), _descriptor2$1$1 = _applyDecoratedDescriptor$1(_class$1$9.prototype, "activeOverride", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _applyDecoratedDescriptor$1(_class$1$9.prototype, "select", [action], Object.getOwnPropertyDescriptor(_class$1$9.prototype, "select"), _class$1$9.prototype), _applyDecoratedDescriptor$1(_class$1$9.prototype, "selectFromEvent", [action], Object.getOwnPropertyDescriptor(_class$1$9.prototype, "selectFromEvent"), _class$1$9.prototype), _applyDecoratedDescriptor$1(_class$1$9.prototype, "previous", [action], Object.getOwnPropertyDescriptor(_class$1$9.prototype, "previous"), _class$1$9.prototype), _applyDecoratedDescriptor$1(_class$1$9.prototype, "next", [action], Object.getOwnPropertyDescriptor(_class$1$9.prototype, "next"), _class$1$9.prototype), _applyDecoratedDescriptor$1(_class$1$9.prototype, "registerFromEvent", [action], Object.getOwnPropertyDescriptor(_class$1$9.prototype, "registerFromEvent"), _class$1$9.prototype);
var _dec$5 = consume(FormWizardContextName), _class$10 = (_FormStep = class FormStep extends Component {
	constructor(...args) {
		super(...args);
		_defineProperty$1(this, "guid", guidFor(this));
		_initializerDefineProperty$1(this, "eventActiveId", _descriptor$10, this);
		_initializerDefineProperty$1(this, "wizard", _descriptor2$8, this);
		_defineProperty$1(this, "register", modifier((el) => {
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
//#region dist/lift-binding-DYIHoQTn.js
function finiteNumber(value) {
	if (value === null || value === void 0 || value === "") return null;
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}
function trimNumericString(value) {
	return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(8)));
}
function clamp$1(value, min, max) {
	return Math.min(max, Math.max(min, value));
}
modifier((element, _positional, opts) => {
	let previewFrame = null;
	let commitFrame = null;
	let latestInputEvent = null;
	let activeRangePointer = null;
	const priorKeyboardOwner = element.getAttribute("data-surface-keyboard-owner");
	if (opts.keyboardStep !== void 0) element.setAttribute("data-surface-keyboard-owner", "value");
	const stopSurfacePointerRouting = (event) => {
		event.stopPropagation();
	};
	const cancelPreview = () => {
		if (previewFrame !== null) cancelAnimationFrame(previewFrame);
		previewFrame = null;
	};
	const cancelCommit = () => {
		if (commitFrame !== null) cancelAnimationFrame(commitFrame);
		commitFrame = null;
	};
	const flushPreview = () => {
		previewFrame = null;
		if (!latestInputEvent) return;
		opts.onPreview?.(element.value, latestInputEvent, element);
	};
	const flushCommit = () => {
		commitFrame = null;
		if (!latestInputEvent) return;
		opts.onCommit?.(element.value, latestInputEvent, element);
	};
	const schedulePreview = (event) => {
		latestInputEvent = event;
		if (opts.onPreview && previewFrame === null) previewFrame = requestAnimationFrame(flushPreview);
	};
	const scheduleFrameCommit = (event) => {
		latestInputEvent = event;
		if (opts.commitMode === "frame" && opts.onCommit && commitFrame === null) commitFrame = requestAnimationFrame(flushCommit);
	};
	const setRangeValueFromPointer = (event) => {
		const rect = element.getBoundingClientRect();
		if (rect.width <= 0) return;
		const min = finiteNumber(opts.keyboardMin) ?? finiteNumber(element.min) ?? 0;
		const max = finiteNumber(opts.keyboardMax) ?? finiteNumber(element.max) ?? 100;
		const step = element.step === "any" ? null : finiteNumber(element.step) ?? finiteNumber(element.getAttribute("step")) ?? 1;
		const ratio = clamp$1((event.clientX - rect.left) / rect.width, 0, 1);
		let next = min + (max - min) * ratio;
		if (step !== null && step > 0) next = Math.round((next - min) / step) * step + min;
		element.value = trimNumericString(clamp$1(next, min, max));
	};
	const beginRangePointer = (event) => {
		if (element.type !== "range" || event.button !== 0) return;
		activeRangePointer = event.pointerId;
		element.focus({ preventScroll: true });
		element.setPointerCapture?.(event.pointerId);
		event.preventDefault();
		event.stopPropagation();
		setRangeValueFromPointer(event);
		schedulePreview(event);
		scheduleFrameCommit(event);
	};
	const updateRangePointer = (event) => {
		if (activeRangePointer !== event.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		setRangeValueFromPointer(event);
		schedulePreview(event);
		scheduleFrameCommit(event);
	};
	const endRangePointer = (event) => {
		if (activeRangePointer !== event.pointerId) return;
		activeRangePointer = null;
		element.releasePointerCapture?.(event.pointerId);
		event.preventDefault();
		event.stopPropagation();
		setRangeValueFromPointer(event);
		latestInputEvent = event;
		cancelPreview();
		if (opts.onPreview) flushPreview();
		if (opts.commitMode !== "frame") {
			cancelCommit();
			opts.onCommit?.(element.value, event, element);
		}
	};
	const onInput = (event) => {
		schedulePreview(event);
		scheduleFrameCommit(event);
	};
	const onChange = (event) => {
		latestInputEvent = event;
		cancelPreview();
		if (opts.onPreview) flushPreview();
		if (opts.commitMode !== "frame") {
			cancelCommit();
			opts.onCommit?.(element.value, event, element);
		}
	};
	const onKeydown = (event) => {
		const step = opts.keyboardStep;
		if (step === void 0) return;
		const direction = event.key === "ArrowUp" || event.key === "ArrowRight" ? 1 : event.key === "ArrowDown" || event.key === "ArrowLeft" ? -1 : 0;
		if (direction === 0) return;
		const base = finiteNumber(element.value) ?? finiteNumber(element.getAttribute("value")) ?? 0;
		const amount = event.shiftKey ? opts.keyboardShiftStep ?? step * 10 : step;
		const min = finiteNumber(opts.keyboardMin) ?? finiteNumber(element.min);
		const max = finiteNumber(opts.keyboardMax) ?? finiteNumber(element.max);
		let next = base + amount * direction;
		if (min !== null) next = Math.max(min, next);
		if (max !== null) next = Math.min(max, next);
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		element.value = trimNumericString(next);
		latestInputEvent = event;
		opts.onPreview?.(element.value, event, element);
		opts.onCommit?.(element.value, event, element);
	};
	element.addEventListener("input", onInput);
	element.addEventListener("change", onChange);
	element.addEventListener("keydown", onKeydown);
	element.addEventListener("pointerdown", beginRangePointer, true);
	element.addEventListener("pointermove", updateRangePointer, true);
	element.addEventListener("pointerup", endRangePointer, true);
	element.addEventListener("pointercancel", endRangePointer, true);
	element.addEventListener("click", stopSurfacePointerRouting, true);
	element.addEventListener("dblclick", stopSurfacePointerRouting, true);
	return () => {
		element.removeEventListener("input", onInput);
		element.removeEventListener("change", onChange);
		element.removeEventListener("keydown", onKeydown);
		element.removeEventListener("pointerdown", beginRangePointer, true);
		element.removeEventListener("pointermove", updateRangePointer, true);
		element.removeEventListener("pointerup", endRangePointer, true);
		element.removeEventListener("pointercancel", endRangePointer, true);
		element.removeEventListener("click", stopSurfacePointerRouting, true);
		element.removeEventListener("dblclick", stopSurfacePointerRouting, true);
		if (priorKeyboardOwner === null) element.removeAttribute("data-surface-keyboard-owner");
		else element.setAttribute("data-surface-keyboard-owner", priorKeyboardOwner);
		cancelPreview();
		cancelCommit();
	};
});
var SURFACE_GEOMETRY_CHANGE_EVENT = "surface:geometrychange";
function dispatchSurfaceGeometryChange(element) {
	element.dispatchEvent(new CustomEvent(SURFACE_GEOMETRY_CHANGE_EVENT, {
		bubbles: true,
		composed: true
	}));
}
function releaseSurfaceGridDomFocus(root) {
	const rootElement = rootElementFor$1(root);
	const active = rootElement?.ownerDocument.activeElement;
	if (!rootElement || !(active instanceof HTMLElement)) return false;
	if (!rootElement.contains(active)) return false;
	const activeGridCell = active.closest("[data-surface-component=\"cell\"][role=\"gridcell\"], [role=\"gridcell\"]");
	if (!activeGridCell || !rootElement.contains(activeGridCell)) return false;
	if (surfaceTargetRetainsFocus$3(active, activeGridCell)) return false;
	active.blur();
	return rootElement.ownerDocument.activeElement !== active;
}
function rootElementFor$1(root) {
	if (root && "nodeType" in root && root.nodeType === 1) return root;
	if (root && "documentElement" in root) return root.querySelector("[data-surface-grid-binding=\"active\"]") ?? root.documentElement;
	if (typeof document !== "undefined") return document.querySelector("[data-surface-grid-binding=\"active\"]") ?? document.documentElement;
	return null;
}
function surfaceTargetRetainsFocus$3(target, selectedCell) {
	if (!target) return false;
	if (selectedCell?.contains(target) && isSurfaceTextEntryTarget(target)) return true;
	if (target.closest("[data-bx-lift]")) return true;
	const keyboardOwner = target.closest("[data-surface-keyboard-owner]");
	return Boolean(keyboardOwner && selectedCell?.contains(keyboardOwner));
}
function createSurfaceDomBindingCache(revision = 0) {
	return {
		revision,
		elementLists: /* @__PURE__ */ new WeakMap(),
		rects: /* @__PURE__ */ new WeakMap()
	};
}
function cachedElementList(cache, owner, key, collect) {
	if (!cache) return collect();
	let lists = cache.elementLists.get(owner);
	if (!lists) {
		lists = /* @__PURE__ */ new Map();
		cache.elementLists.set(owner, lists);
	}
	const cached = lists.get(key);
	if (cached) return cached;
	const collected = collect();
	lists.set(key, collected);
	return collected;
}
function cachedRectForElement(element, cache) {
	const cached = cache?.rects.get(element);
	if (cached) return cached;
	const rect = element.getBoundingClientRect();
	cache?.rects.set(element, rect);
	return rect;
}
var DEFAULT_CELL_SELECTOR = "[data-surface-component=\"cell\"][role=\"gridcell\"], [role=\"gridcell\"]";
var DEFAULT_ROW_SELECTOR = "[data-surface-component=\"row\"][role=\"row\"], [role=\"row\"]";
var GRID_KEYS = new Set([
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"Home",
	"End",
	"PageUp",
	"PageDown",
	"Tab",
	"Enter",
	"F2",
	"Escape",
	" ",
	"Spacebar"
]);
modifier((element, _positional, options) => {
	const view = element.ownerDocument.defaultView ?? window;
	let frame = 0;
	let runtime;
	let unsubscribe;
	let retryCount = 0;
	let hasHydratedSelection = false;
	let localActiveCellId = null;
	let cache = createSurfaceDomBindingCache();
	const schedule = () => {
		if (frame !== 0) return;
		frame = view.requestAnimationFrame(paint);
	};
	const invalidate = () => {
		cache = createSurfaceDomBindingCache(cache.revision + 1);
	};
	const invalidateAndSchedule = () => {
		invalidate();
		schedule();
	};
	const syncRuntime = () => {
		const next = surfaceRuntimeForElement(element);
		if (next !== runtime) {
			unsubscribe?.();
			runtime = next;
			unsubscribe = runtime?.subscribeSelection(schedule);
		}
		return runtime;
	};
	const paint = () => {
		frame = 0;
		const active = options.active !== false;
		element.dataset["surfaceGridBinding"] = active ? "active" : "inactive";
		const currentRuntime = syncRuntime();
		if (!active) return;
		if (!currentRuntime) {
			if (retryCount < 120) {
				retryCount += 1;
				schedule();
			}
			return;
		}
		retryCount = 0;
		const projection = currentRuntime.projection({ mode: gridModeFor(element) });
		const runtimeActiveId = activeSelectionId$1(currentRuntime);
		let activeId = localActiveCellId ?? element.dataset["surfaceGridActiveId"] ?? runtimeActiveId;
		if (runtimeActiveId && !localActiveCellId && !element.dataset["surfaceGridActiveId"]) {
			delete element.dataset["surfaceGridSelectionCleared"];
			hasHydratedSelection = true;
			localActiveCellId = runtimeActiveId;
		}
		if (element.dataset["surfaceGridSelectionCleared"] === "true") {
			hasHydratedSelection = true;
			localActiveCellId = null;
			activeId = null;
		}
		if (!activeId && !hasHydratedSelection) {
			const seededCell = cells(element, options, cache).find((cell) => cell.dataset["selected"] === "true" || cell.classList.contains("is-selected") || cell.classList.contains("is-runtime-selected"));
			const seededId = seededCell ? surfaceIdFor$1(seededCell) : null;
			if (seededId) {
				currentRuntime.select(seededId, { restoreSource: true });
				localActiveCellId = seededId;
				activeId = seededId;
			}
			hasHydratedSelection = true;
		}
		let activeCell = activeId ? cellById(element, activeId, options, cache) : null;
		if (!activeCell) {
			activeId = runtimeActiveId;
			activeCell = activeId ? cellById(element, activeId, options, cache) : null;
		}
		const activePosition = activeCell ? selectionForCell(element, activeCell, options, cache) : null;
		for (const cell of cells(element, options, cache)) {
			const id = surfaceIdFor$1(cell);
			const projected = id ? projection.nodeMap.get(id) : void 0;
			const selected = Boolean(id && (projected?.selected || projected?.focused || id === activeId));
			cell.dataset["runtimeSelected"] = selected ? "true" : "false";
			cell.dataset["selected"] = selected ? "true" : "false";
			cell.classList.toggle("is-runtime-selected", selected);
			if (projected?.tabIndex === null) cell.removeAttribute("tabindex");
			else if (projected?.tabIndex !== void 0) cell.tabIndex = projected.tabIndex;
			else cell.tabIndex = selected ? 0 : -1;
		}
		for (const [rowIndex, row] of rows(element, options, cache).entries()) {
			const selected = activePosition?.rowIndex === rowIndex;
			row.dataset["runtimeSelectedRow"] = selected ? "true" : "false";
			row.classList.toggle("is-runtime-selected-row", selected);
		}
		for (const header of columnHeaders(element, cache)) {
			const selected = activePosition?.colKey !== void 0 && header.dataset["colKey"] === activePosition.colKey;
			header.dataset["runtimeSelectedCol"] = selected ? "true" : "false";
			header.classList.toggle("is-runtime-selected-col", selected);
		}
	};
	const selectCell = (cell, event, opts = {}) => {
		if (options.active === false) return false;
		const currentRuntime = syncRuntime();
		const id = surfaceIdFor$1(cell);
		if (!currentRuntime || !id) return false;
		delete element.dataset["surfaceGridSelectionCleared"];
		hasHydratedSelection = true;
		localActiveCellId = id;
		element.dataset["surfaceGridActiveId"] = id;
		currentRuntime.select(id, {
			range: opts.range,
			restoreSource: true
		});
		focusCell(cell, opts.reveal ?? true);
		const selection = selectionForCell(element, cell, options, cache);
		options.onSelect?.(selection, event);
		const syncLocalSelection = () => {
			if (element.dataset["surfaceGridActiveId"] !== id) return;
			const selectedCell = cellById(element, id, options) ?? cellAtPosition(element, selection, options) ?? cell;
			if (!element.contains(selectedCell)) return;
			paintLocalSelection(element, id, selectedCell, options);
			focusCell(selectedCell, opts.reveal ?? true);
		};
		syncLocalSelection();
		view.requestAnimationFrame(() => {
			syncLocalSelection();
			view.requestAnimationFrame(syncLocalSelection);
			view.setTimeout(syncLocalSelection, 0);
		});
		schedule();
		return true;
	};
	const clearSelection = (event) => {
		const currentRuntime = syncRuntime();
		if (!(currentRuntime ? activeSelectionId$1(currentRuntime) ?? localActiveCellId : localActiveCellId)) return false;
		element.dataset["surfaceGridSelectionCleared"] = "true";
		hasHydratedSelection = true;
		localActiveCellId = null;
		delete element.dataset["surfaceGridActiveId"];
		currentRuntime?.clearInteractionState();
		releaseSurfaceGridDomFocus(element);
		options.onClear?.(event);
		schedule();
		return true;
	};
	const activateCell = (cell, event) => {
		selectCell(cell, event, { reveal: true });
		const activeRuntime = syncRuntime();
		const id = surfaceIdFor$1(cell);
		if (activeRuntime && id && activeSelectionId$1(activeRuntime) === id) activeRuntime.dispatch({ type: "activate" });
		options.onActivate?.(selectionForCell(element, cell, options, cache), event);
	};
	const onClick = (event) => {
		if (options.active === false) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (target.closest("[data-bx-lift]")) return;
		if (surfaceTargetOwnsPointerEvent(target)) return;
		const cell = closestCell(element, target, options);
		if (!cell) return;
		if (target.closest("[data-surface-activate-cell]")) {
			activateCell(cell, event);
			return;
		}
		selectCell(cell, event, {
			range: event.shiftKey,
			reveal: false
		});
	};
	const onClickBoundary = (event) => {
		if (options.active === false) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (!element.contains(target)) return;
		if (target.closest("[data-bx-lift]")) return;
		event.stopPropagation();
	};
	const onDblClick = (event) => {
		if (options.active === false) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (surfaceTargetOwnsPointerEvent(target)) return;
		const cell = closestCell(element, target, options);
		if (!cell) return;
		activateCell(cell, event);
		event.stopPropagation();
	};
	const onKeydown = (event) => {
		if (options.active === false) return;
		if (!GRID_KEYS.has(event.key)) return;
		if (event.defaultPrevented) return;
		if (event.target instanceof Element && event.target.closest("[data-bx-lift]")) return;
		if (surfaceTargetOwnsKeyboardEvent(event) || surfaceElementOwnsKeyboardEvent(element.ownerDocument.activeElement, event.key)) return;
		const currentRuntime = syncRuntime();
		if (!currentRuntime) return;
		const current = activeCellElement(element, currentRuntime, options, cache, localActiveCellId ?? element.dataset["surfaceGridActiveId"] ?? null) ?? closestCell(element, element.ownerDocument.activeElement, options);
		if (!current && !isGridEntryKey(event.key)) return;
		if (event.key === "Escape") {
			if (clearSelection(event)) consume$1(event);
			return;
		}
		if (event.key === "Enter" || event.key === "F2") {
			const cell = current ?? cells(element, options, cache)[0];
			if (!cell) return;
			consume$1(event);
			activateCell(cell, event);
			return;
		}
		if ((event.key === " " || event.key === "Spacebar") && current) {
			const atom = current.querySelector("button[role=\"checkbox\"], button[role=\"switch\"], .ss-star, [data-surface-atom-editor]");
			if (atom) {
				consume$1(event);
				atom.click();
				selectCell(current, event, { reveal: false });
				return;
			}
		}
		const next = current ? nextCellForKey(element, current, event, options, cache) : cells(element, options, cache)[0] ?? null;
		if (!next) return;
		consume$1(event);
		selectCell(next, event, {
			range: event.shiftKey && event.key !== "Tab",
			reveal: true
		});
	};
	const mutationObserver = new MutationObserver(invalidateAndSchedule);
	mutationObserver.observe(element, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: [
			"data-ladder-id",
			"data-selected",
			"data-surface-component",
			"role",
			"data-surface-grid-selection-cleared"
		]
	});
	element.addEventListener("click", onClick, true);
	element.addEventListener("click", onClickBoundary);
	element.addEventListener("dblclick", onDblClick);
	element.addEventListener("keydown", onKeydown);
	view.addEventListener("keydown", onKeydown, true);
	syncRuntime();
	schedule();
	return () => {
		if (frame !== 0) view.cancelAnimationFrame(frame);
		unsubscribe?.();
		mutationObserver.disconnect();
		element.removeEventListener("click", onClick, true);
		element.removeEventListener("click", onClickBoundary);
		element.removeEventListener("dblclick", onDblClick);
		element.removeEventListener("keydown", onKeydown);
		view.removeEventListener("keydown", onKeydown, true);
	};
});
function consume$1(event) {
	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation();
}
function gridModeFor(element) {
	const mode = element.closest("[data-surface-mode]")?.getAttribute("data-surface-mode");
	return mode === "change" || mode === "inspect" ? mode : "use";
}
function isGridEntryKey(key) {
	return key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight" || key === "Home" || key === "End" || key === "PageUp" || key === "PageDown" || key === "Tab";
}
function activeSelectionId$1(runtime) {
	const snapshot = runtime.snapshot();
	const activeScopeId = snapshot.activeScopeId;
	if (activeScopeId && snapshot.selections[activeScopeId]) return snapshot.selections[activeScopeId].headId;
	return snapshot.focusedId;
}
function activeCellElement(root, runtime, options, cache, fallbackId) {
	const fallbackCell = fallbackId ? cellById(root, fallbackId, options, cache) : null;
	if (fallbackCell) return fallbackCell;
	const activeId = activeSelectionId$1(runtime);
	return activeId ? cellById(root, activeId, options, cache) : null;
}
function cellById(root, id, options, cache) {
	return cells(root, options, cache).find((cell) => surfaceIdFor$1(cell) === id) ?? null;
}
function closestCell(root, target, options) {
	if (!target) return null;
	const selector = options.cellSelector ?? DEFAULT_CELL_SELECTOR;
	const cell = target.closest(selector);
	if (!cell || !root.contains(cell)) return null;
	if (cell.closest("[data-bx-lift]")) return null;
	return cell;
}
function cells(root, options, cache) {
	const selector = options.cellSelector ?? DEFAULT_CELL_SELECTOR;
	return cachedElementList(cache, root, `grid:cells:${selector}`, () => Array.from(root.querySelectorAll(selector)).filter((cell) => root.contains(cell) && isVisible$1(cell)));
}
function rows(root, options, cache) {
	const selector = options.rowSelector ?? DEFAULT_ROW_SELECTOR;
	return cachedElementList(cache, root, `grid:rows:${selector}`, () => Array.from(root.querySelectorAll(selector)).filter((row) => root.contains(row) && isVisible$1(row)));
}
function columnHeaders(root, cache) {
	return cachedElementList(cache, root, "grid:column-headers", () => Array.from(root.querySelectorAll("[data-col-key]")));
}
function rowCellsFor(row, allCells, options, cache) {
	const selector = options.cellSelector ?? DEFAULT_CELL_SELECTOR;
	return cachedElementList(cache, row, `grid:row-cells:${selector}`, () => Array.from(row.querySelectorAll(selector)).filter((candidate) => allCells.includes(candidate)));
}
function surfaceIdFor$1(element) {
	return element.getAttribute("data-ladder-id") ?? element.id ?? null;
}
function selectionForCell(root, cell, options, cache) {
	const allCells = cells(root, options, cache);
	const row = cell.closest(options.rowSelector ?? DEFAULT_ROW_SELECTOR);
	const allRows = rows(root, options, cache);
	const rowCells = row ? rowCellsFor(row, allCells, options, cache) : allCells;
	const id = surfaceIdFor$1(cell) ?? cell.id;
	return {
		id,
		focusKey: cell.dataset["surfaceFocusKey"],
		rowIndex: row ? allRows.indexOf(row) : Math.floor(allCells.indexOf(cell) / Math.max(1, rowCells.length)),
		colIndex: rowCells.indexOf(cell),
		rowKey: row?.dataset["rowKey"] ?? row?.id,
		colKey: cell.dataset["colKey"] ?? colKeyFromId(id)
	};
}
function cellAtPosition(root, selection, options) {
	const row = rows(root, options)[selection.rowIndex];
	if (!row) return null;
	return rowCellsFor(row, cells(root, options), options)[selection.colIndex] ?? null;
}
function paintLocalSelection(root, activeId, activeCell, options) {
	const activePosition = selectionForCell(root, activeCell, options);
	for (const cell of cells(root, options)) {
		const id = surfaceIdFor$1(cell);
		const selected = cell === activeCell || id === activeId;
		cell.dataset["runtimeSelected"] = selected ? "true" : "false";
		cell.dataset["selected"] = selected ? "true" : "false";
		cell.classList.toggle("is-runtime-selected", selected);
		cell.tabIndex = selected ? 0 : -1;
	}
	for (const [rowIndex, row] of rows(root, options).entries()) {
		const selected = activePosition.rowIndex === rowIndex;
		row.dataset["runtimeSelectedRow"] = selected ? "true" : "false";
		row.classList.toggle("is-runtime-selected-row", selected);
	}
	for (const header of columnHeaders(root)) {
		const selected = activePosition.colKey !== void 0 && header.dataset["colKey"] === activePosition.colKey;
		header.dataset["runtimeSelectedCol"] = selected ? "true" : "false";
		header.classList.toggle("is-runtime-selected-col", selected);
	}
}
function nextCellForKey(root, current, event, options, cache) {
	const allCells = cells(root, options, cache);
	const currentIndex = allCells.indexOf(current);
	if (currentIndex < 0) return allCells[0] ?? null;
	const row = current.closest(options.rowSelector ?? DEFAULT_ROW_SELECTOR);
	const rowCells = row ? rowCellsFor(row, allCells, options, cache) : [];
	const allRows = rows(root, options, cache);
	const rowIndex = row ? allRows.indexOf(row) : -1;
	const colIndex = rowCells.indexOf(current);
	const columns = Math.max(1, rowCells.length || inferredColumnCount(root, allCells, options, cache));
	let nextIndex = currentIndex;
	switch (event.key) {
		case "ArrowUp":
			nextIndex = Math.max(0, currentIndex - columns);
			break;
		case "ArrowDown":
			nextIndex = Math.min(allCells.length - 1, currentIndex + columns);
			break;
		case "ArrowLeft":
			if (rowCells.length && colIndex > 0) return rowCells[colIndex - 1] ?? current;
			nextIndex = currentIndex;
			break;
		case "ArrowRight":
			if (rowCells.length && colIndex >= 0 && colIndex < rowCells.length - 1) return rowCells[colIndex + 1] ?? current;
			nextIndex = currentIndex;
			break;
		case "Home":
			if (event.ctrlKey || event.metaKey) return allCells[0] ?? current;
			if (rowCells.length) return rowCells[0] ?? current;
			nextIndex = Math.floor(currentIndex / columns) * columns;
			break;
		case "End":
			if (event.ctrlKey || event.metaKey) return allCells[allCells.length - 1] ?? current;
			if (rowCells.length) return rowCells[rowCells.length - 1] ?? current;
			nextIndex = Math.min(allCells.length - 1, Math.floor(currentIndex / columns) * columns + columns - 1);
			break;
		case "PageUp":
			nextIndex = Math.max(0, currentIndex - columns * 10);
			break;
		case "PageDown":
			nextIndex = Math.min(allCells.length - 1, currentIndex + columns * 10);
			break;
		case "Tab":
			nextIndex = event.shiftKey ? Math.max(0, currentIndex - 1) : Math.min(allCells.length - 1, currentIndex + 1);
			break;
	}
	if (rowIndex >= 0 && colIndex >= 0 && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
		const nextRow = allRows[event.key === "ArrowUp" ? rowIndex - 1 : rowIndex + 1];
		const nextRowCell = nextRow ? rowCellsFor(nextRow, allCells, options, cache)[colIndex] : null;
		if (nextRowCell) return nextRowCell;
	}
	return allCells[nextIndex] ?? current;
}
function inferredColumnCount(root, allCells, options, cache) {
	const firstRow = rows(root, options, cache)[0];
	if (!firstRow) return allCells.length || 1;
	return rowCellsFor(firstRow, allCells, options, cache).length || 1;
}
function colKeyFromId(id) {
	return /^c-[^-]+-(.+)$/.exec(id)?.[1];
}
function focusCell(cell, reveal) {
	if (!surfaceTargetRetainsFocus$2(cell.ownerDocument.activeElement, cell)) cell.focus({ preventScroll: true });
	if (reveal) cell.scrollIntoView({
		block: "nearest",
		inline: "nearest"
	});
}
function surfaceTargetRetainsFocus$2(target, selectedCell) {
	if (!target) return false;
	if (selectedCell?.contains(target) && isSurfaceTextEntryTarget(target)) return true;
	if (target.closest("[data-bx-lift]")) return true;
	const keyboardOwner = target.closest("[data-surface-keyboard-owner]");
	return Boolean(keyboardOwner && selectedCell?.contains(keyboardOwner));
}
function isVisible$1(element) {
	return element.offsetParent !== null || element.getClientRects().length > 0;
}
function releaseSurfaceCanvasDomFocus(root) {
	const rootElement = rootElementFor(root);
	const active = rootElement?.ownerDocument.activeElement;
	if (!rootElement || !(active instanceof HTMLElement)) return false;
	if (!rootElement.contains(active)) return false;
	if (surfaceTargetRetainsFocus$1(active)) return false;
	const activeObject = active.closest("[data-surface-component=\"frame\"][data-canvas-object], [data-canvas-object], [data-surface-canvas-object]");
	if (!activeObject || !rootElement.contains(activeObject)) return false;
	active.blur();
	return rootElement.ownerDocument.activeElement !== active;
}
function rootElementFor(root) {
	if (root && "nodeType" in root && root.nodeType === 1) return root;
	if (root && "documentElement" in root) return root.querySelector("[data-surface-canvas-binding=\"active\"]") ?? root.documentElement;
	if (typeof document !== "undefined") return document.querySelector("[data-surface-canvas-binding=\"active\"]") ?? document.documentElement;
	return null;
}
function surfaceTargetRetainsFocus$1(target) {
	if (!target) return false;
	return isSurfaceTextEntryTarget(target) || target.closest("[data-surface-keyboard-owner], [data-bx-lift]") !== null;
}
var DEFAULT_OBJECT_SELECTOR = "[data-surface-component=\"frame\"][data-canvas-object], [data-canvas-object], [data-surface-canvas-object], [data-surface-scene-object], [data-scene-object]";
var DEFAULT_EDGE_SELECTOR = "[data-surface-component=\"edge\"], [data-surface-canvas-edge], .boxel-canvas__edge[data-id]";
var DEFAULT_DRAG_HANDLE_SELECTOR = "[data-surface-canvas-drag-handle]";
var DEFAULT_RESIZE_HANDLE_SELECTOR = "[data-surface-canvas-resize-handle]";
var DEFAULT_CONNECT_HANDLE_SELECTOR = "[data-surface-component=\"handle\"], [data-surface-canvas-handle], .boxel-canvas__handle";
var MARQUEE_STYLE_ID = "boxel-surface-canvas-marquee-styles";
var CANVAS_KEYS = new Set([
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"Tab",
	"Enter",
	"F2",
	"Escape",
	"Delete",
	"Backspace",
	"a",
	"A",
	"d",
	"D"
]);
modifier((element, _positional, options) => {
	const view = element.ownerDocument.defaultView ?? window;
	let frame = 0;
	let runtime;
	let unsubscribe;
	let retryCount = 0;
	let hasHydratedSelection = false;
	let cache = createSurfaceDomBindingCache();
	let activePointer = null;
	let activeMarquee = null;
	let activeConnection = null;
	let previousSelectedIds = /* @__PURE__ */ new Set();
	let previousTabIndexById = /* @__PURE__ */ new Map();
	let previousSelectionPaintRevision = -1;
	let previousBodyUserSelect = "";
	let suppressNextClick = false;
	const schedule = () => {
		if (frame !== 0) return;
		frame = view.requestAnimationFrame(paint);
	};
	const invalidate = () => {
		cache = createSurfaceDomBindingCache(cache.revision + 1);
	};
	const invalidateAndSchedule = () => {
		invalidate();
		schedule();
	};
	const invalidateGeometry = (object) => {
		invalidate();
		dispatchSurfaceGeometryChange(object);
	};
	const syncRuntime = () => {
		const next = options.runtime ?? surfaceRuntimeForElement(element);
		if (next !== runtime) {
			unsubscribe?.();
			runtime = next;
			unsubscribe = runtime?.subscribeSelection(schedule);
		}
		return runtime;
	};
	const paint = () => {
		frame = 0;
		const active = options.active !== false;
		element.dataset["surfaceCanvasBinding"] = active ? "active" : "inactive";
		const mode = canvasModeFor(element);
		element.dataset["surfaceCanvasMode"] = mode;
		element.dataset["surfaceCanvasCanMove"] = String(mode === "change" && canvasPointerDragEnabled(options));
		element.dataset["surfaceCanvasCanResize"] = String(mode === "change" && canvasPointerResizeEnabled(options));
		element.dataset["surfaceCanvasCanConnect"] = String(mode === "change" && canvasPointerConnectEnabled(options));
		element.dataset["surfaceCanvasCanMarquee"] = String(canvasPointerMarqueeEnabled(options));
		const currentRuntime = syncRuntime();
		if (!active) return;
		if (!currentRuntime) {
			if (retryCount < 120) {
				retryCount += 1;
				schedule();
			}
			return;
		}
		retryCount = 0;
		const projection = currentRuntime.projection({ mode: canvasModeFor(element) });
		let activeId = activeSelectionId(currentRuntime);
		if (activeId) {
			delete element.dataset["surfaceCanvasSelectionCleared"];
			hasHydratedSelection = true;
		}
		if (element.dataset["surfaceCanvasSelectionCleared"] === "true") hasHydratedSelection = true;
		if (!activeId && !hasHydratedSelection) {
			const seededObject = objects(element, options, cache).find((object) => object.dataset["selected"] === "true" || object.classList.contains("is-selected") || object.classList.contains("is-runtime-selected"));
			const seededId = seededObject ? surfaceIdFor(seededObject) : null;
			if (seededId) {
				currentRuntime.select(seededId, { restoreSource: true });
				activeId = seededId;
			}
			hasHydratedSelection = true;
		}
		const selectedIds = /* @__PURE__ */ new Set();
		const objectById = /* @__PURE__ */ new Map();
		const objectSelectionState = /* @__PURE__ */ new Map();
		const projectionById = /* @__PURE__ */ new Map();
		const tabIndexById = /* @__PURE__ */ new Map();
		for (const object of objects(element, options, cache)) {
			const id = surfaceIdFor(object);
			const projected = id ? projection.nodeMap.get(id) : void 0;
			const selected = Boolean(id && (projected?.selected || projected?.focused || id === activeId));
			if (id) {
				objectById.set(id, object);
				objectSelectionState.set(id, selected);
				projectionById.set(id, projected);
				tabIndexById.set(id, tabIndexForObjectProjection(selected, projected));
				if (selected) selectedIds.add(id);
			} else paintObjectSelectionState(object, selected, projected);
		}
		const forcePaint = previousSelectionPaintRevision !== cache.revision;
		const changedIds = forcePaint ? new Set(objectById.keys()) : symmetricDifference(previousSelectedIds, selectedIds);
		if (!forcePaint) {
			for (const [id, tabIndex] of tabIndexById) if (previousTabIndexById.get(id) !== tabIndex) changedIds.add(id);
		}
		for (const id of changedIds) {
			const object = objectById.get(id);
			if (!object) continue;
			paintObjectSelectionState(object, objectSelectionState.get(id) ?? false, projectionById.get(id));
		}
		previousSelectedIds = selectedIds;
		previousTabIndexById = tabIndexById;
		previousSelectionPaintRevision = cache.revision;
	};
	const selectObject = (object, event, opts = {}) => {
		if (options.active === false) return false;
		const currentRuntime = syncRuntime();
		const id = surfaceIdFor(object);
		if (!currentRuntime || !id) return false;
		delete element.dataset["surfaceCanvasSelectionCleared"];
		hasHydratedSelection = true;
		currentRuntime.select(id, {
			additive: opts.additive,
			range: opts.range,
			restoreSource: true
		});
		const selection = selectionForObject(element, object, options, cache, event);
		focusObject(object, opts.reveal ?? true, selection, options);
		options.onSelect?.(selection, event);
		schedule();
		return true;
	};
	const clearSelection = (event) => {
		const currentRuntime = syncRuntime();
		if (!currentRuntime) return false;
		if (!activeSelectionId(currentRuntime)) return false;
		element.dataset["surfaceCanvasSelectionCleared"] = "true";
		hasHydratedSelection = true;
		currentRuntime.clearInteractionState();
		releaseSurfaceCanvasDomFocus(element);
		options.onClear?.(event);
		schedule();
		return true;
	};
	const activateObject = (object, event) => {
		selectObject(object, event, { reveal: true });
		syncRuntime()?.dispatch({ type: "activate" });
		options.onActivate?.(selectionForObject(element, object, options, cache, event), event);
	};
	const onClick = (event) => {
		if (suppressNextClick) {
			suppressNextClick = false;
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			return;
		}
		if (options.active === false) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (target.closest("[data-bx-lift]")) return;
		if (surfaceTargetOwnsPointerEvent(target)) return;
		const object = closestObject(element, target, options);
		if (!object) {
			if (element.contains(target)) clearSelection(event);
			return;
		}
		if (target.closest("[data-surface-activate-frame]")) {
			activateObject(object, event);
			return;
		}
		selectObject(object, event, {
			reveal: false,
			additive: event.metaKey || event.ctrlKey,
			range: event.shiftKey
		});
	};
	const onPointerDown = (event) => {
		if (options.active === false || activePointer || activeMarquee || activeConnection) return;
		if (event.button !== 0) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (target.closest("[data-bx-lift]")) return;
		if (surfaceTargetOwnsPointerEvent(target)) return;
		if (canvasModeFor(element) === "change") {
			const connectHandle = closestConnectHandle(element, target, options);
			if (connectHandle && canvasPointerConnectEnabled(options)) {
				beginConnection(connectHandle, event);
				return;
			}
			const resizeHandle = closestResizeHandle(element, target, options);
			if (resizeHandle && canvasPointerResizeEnabled(options)) {
				const object = closestObject(element, resizeHandle, options);
				if (object && objectKindFor(object, options) !== "edge") {
					beginPointerResize(object, event);
					return;
				}
			}
			const object = closestObject(element, target, options);
			if (object && objectKindFor(object, options) !== "edge" && canvasPointerDragEnabled(options)) {
				if (!isCanvasDragStartTarget(object, target, options)) return;
				beginPointerMove(object, event);
				return;
			}
			if (object) return;
		} else if (closestObject(element, target, options)) return;
		if (canvasPointerMarqueeEnabled(options) && element.contains(target)) beginMarquee(event);
	};
	const onDblClick = (event) => {
		if (options.active === false) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (surfaceTargetOwnsPointerEvent(target)) return;
		const object = closestObject(element, target, options);
		if (!object) return;
		activateObject(object, event);
	};
	const onKeydown = (event) => {
		if (options.active === false) return;
		if (!CANVAS_KEYS.has(event.key)) return;
		if (event.defaultPrevented) return;
		if (event.target instanceof Element && event.target.closest("[data-bx-lift]")) return;
		if (surfaceTargetOwnsKeyboardEvent(event) || surfaceElementOwnsKeyboardEvent(element.ownerDocument.activeElement, event.key)) return;
		const currentRuntime = syncRuntime();
		if (!currentRuntime) return;
		const current = activeObjectElement(element, currentRuntime, options, cache) ?? closestObject(element, element.ownerDocument.activeElement, options);
		if (event.key === "Escape") {
			if (clearSelection(event)) consume$2(event);
			return;
		}
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
			consume$2(event);
			options.onSelectAll?.(event);
			return;
		}
		if (event.key === "Enter" || event.key === "F2") {
			const object = current ?? objects(element, options, cache)[0];
			if (!object) return;
			consume$2(event);
			activateObject(object, event);
			return;
		}
		if (event.key === "Delete" || event.key === "Backspace") {
			if (!current) return;
			consume$2(event);
			options.onDelete?.(selectionForObject(element, current, options, cache, event), event);
			return;
		}
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
			if (!current) return;
			consume$2(event);
			options.onDuplicate?.(selectionForObject(element, current, options, cache, event), event);
			return;
		}
		if (event.key === "Tab") {
			const next = current ? nextObjectInOrder(element, current, event.shiftKey ? -1 : 1, options, cache) : objects(element, options, cache)[0] ?? null;
			if (!next) return;
			consume$2(event);
			selectObject(next, event, { reveal: true });
			return;
		}
		if (isArrowKey(event.key)) {
			const object = current ?? objects(element, options, cache)[0];
			if (!object) return;
			consume$2(event);
			if (objectKindFor(object, options) === "edge") return;
			if (canvasModeFor(element) === "change") {
				const step = event.shiftKey ? 10 : 1;
				options.onNudge?.(selectionForObject(element, object, options, cache), arrowDelta(event.key, step), event);
				selectObject(object, event, { reveal: true });
				return;
			}
			const next = nearestObjectForArrow(element, object, event.key, options, cache);
			if (next) selectObject(next, event, { reveal: true });
		}
	};
	const mutationObserver = new MutationObserver(invalidateAndSchedule);
	mutationObserver.observe(element, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: [
			"class",
			"data-id",
			"data-ladder-id",
			"data-selected",
			"data-surface-canvas-edge",
			"data-surface-component",
			"data-canvas-object"
		]
	});
	element.addEventListener("click", onClick);
	element.addEventListener("dblclick", onDblClick);
	element.addEventListener("pointerdown", onPointerDown);
	element.addEventListener("keydown", onKeydown);
	view.addEventListener("keydown", onKeydown, true);
	view.addEventListener("scroll", invalidateAndSchedule, true);
	view.addEventListener("resize", invalidateAndSchedule);
	syncRuntime();
	schedule();
	return () => {
		if (frame !== 0) view.cancelAnimationFrame(frame);
		unsubscribe?.();
		mutationObserver.disconnect();
		endActivePointer("cancel");
		endActiveMarquee("cancel");
		endActiveConnection("cancel");
		element.removeEventListener("click", onClick);
		element.removeEventListener("dblclick", onDblClick);
		element.removeEventListener("pointerdown", onPointerDown);
		element.removeEventListener("keydown", onKeydown);
		view.removeEventListener("keydown", onKeydown, true);
		view.removeEventListener("scroll", invalidateAndSchedule, true);
		view.removeEventListener("resize", invalidateAndSchedule);
	};
	function beginPointerMove(object, event) {
		const selection = selectionForObject(element, object, options, cache);
		selectObject(object, event, {
			reveal: false,
			additive: event.metaKey || event.ctrlKey,
			range: event.shiftKey
		});
		activePointer = {
			kind: "move",
			object,
			selection,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			initialTransform: object.style.transform,
			initialWidth: object.offsetWidth,
			initialHeight: object.offsetHeight
		};
		beginPointerSession(object, event);
		options.onMove?.(selection, pointerMoveFor(event, activePointer, "start"), event);
	}
	function beginPointerResize(object, event) {
		const selection = selectionForObject(element, object, options, cache);
		selectObject(object, event, {
			reveal: false,
			additive: event.metaKey || event.ctrlKey,
			range: event.shiftKey
		});
		activePointer = {
			kind: "resize",
			object,
			selection,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			initialTransform: object.style.transform,
			initialWidth: object.offsetWidth,
			initialHeight: object.offsetHeight
		};
		beginPointerSession(object, event);
		options.onResize?.(selection, pointerResizeFor(event, activePointer, "start", options), event);
	}
	function beginPointerSession(object, event) {
		consumePointer(event);
		object.dataset["surfaceCanvasPointerActive"] = "true";
		element.dataset["surfaceCanvasPointerActive"] = activePointer?.kind ?? "true";
		previousBodyUserSelect = element.ownerDocument.body.style.userSelect;
		element.ownerDocument.body.style.userSelect = "none";
		view.addEventListener("pointermove", onWindowPointerMove, true);
		view.addEventListener("pointerup", onWindowPointerUp, true);
		view.addEventListener("pointercancel", onWindowPointerCancel, true);
	}
	function onWindowPointerMove(event) {
		if (activeConnection && event.pointerId === activeConnection.pointerId) {
			consumePointer(event);
			updateActiveConnection(event, "move");
			return;
		}
		if (activeMarquee && event.pointerId === activeMarquee.pointerId) {
			consumePointer(event);
			updateActiveMarquee(event, "move");
			return;
		}
		if (!activePointer || event.pointerId !== activePointer.pointerId) return;
		consumePointer(event);
		if (activePointer.kind === "move") {
			const move = snappedPointerMoveFor(event, activePointer, "move", options);
			applyMoveTransform(activePointer.object, activePointer.initialTransform, move.totalDx, move.totalDy);
			invalidateGeometry(activePointer.object);
			emitAutoPan(event, "move");
			options.onMove?.(activePointer.selection, move, event);
			return;
		}
		const resize = pointerResizeFor(event, activePointer, "move", options);
		activePointer.object.style.width = `${resize.width}px`;
		activePointer.object.style.height = `${resize.height}px`;
		invalidateGeometry(activePointer.object);
		emitAutoPan(event, "move");
		options.onResize?.(activePointer.selection, resize, event);
	}
	function onWindowPointerUp(event) {
		if (activeConnection && event.pointerId === activeConnection.pointerId) {
			consumePointer(event);
			endActiveConnection("end", event);
			return;
		}
		if (activeMarquee && event.pointerId === activeMarquee.pointerId) {
			consumePointer(event);
			endActiveMarquee("end", event);
			return;
		}
		if (!activePointer || event.pointerId !== activePointer.pointerId) return;
		consumePointer(event);
		endActivePointer("end", event);
	}
	function onWindowPointerCancel(event) {
		if (activeConnection && event.pointerId === activeConnection.pointerId) {
			consumePointer(event);
			endActiveConnection("cancel", event);
			return;
		}
		if (activeMarquee && event.pointerId === activeMarquee.pointerId) {
			consumePointer(event);
			endActiveMarquee("cancel", event);
			return;
		}
		if (!activePointer || event.pointerId !== activePointer.pointerId) return;
		consumePointer(event);
		endActivePointer("cancel", event);
	}
	function endActivePointer(phase, event) {
		if (!activePointer) return;
		const session = activePointer;
		activePointer = null;
		view.removeEventListener("pointermove", onWindowPointerMove, true);
		view.removeEventListener("pointerup", onWindowPointerUp, true);
		view.removeEventListener("pointercancel", onWindowPointerCancel, true);
		element.ownerDocument.body.style.userSelect = previousBodyUserSelect;
		delete element.dataset["surfaceCanvasPointerActive"];
		delete session.object.dataset["surfaceCanvasPointerActive"];
		if (session.kind === "move") {
			const move = event ? phase === "end" ? snappedPointerMoveFor(event, session, phase, options) : pointerMoveFor(event, session, phase) : pointerMoveForFallback(session, phase);
			if (phase === "cancel") {
				session.object.style.transform = session.initialTransform;
				dispatchSurfaceGeometryChange(session.object);
			}
			options.onMove?.(session.selection, move, event);
			if (phase === "end") view.requestAnimationFrame(() => {
				session.object.style.transform = session.initialTransform;
				dispatchSurfaceGeometryChange(session.object);
			});
		} else {
			const resize = event ? pointerResizeFor(event, session, phase, options) : pointerResizeForFallback(session, phase, options);
			if (phase === "cancel") {
				session.object.style.width = `${session.initialWidth}px`;
				session.object.style.height = `${session.initialHeight}px`;
				dispatchSurfaceGeometryChange(session.object);
			}
			options.onResize?.(session.selection, resize, event);
		}
		if (event) emitAutoPan(event, phase);
		invalidateGeometry(session.object);
	}
	function emitAutoPan(event, phase) {
		if (!canvasAutoPanEnabled(options)) return;
		const autoPan = autoPanForPointer(element, event, phase, options);
		if (!autoPan) return;
		if (phase === "move" && autoPan.dx === 0 && autoPan.dy === 0) return;
		options.onAutoPan?.(autoPan, event);
	}
	function beginConnection(handle, event) {
		const handleInfo = connectionHandleInfo(handle);
		if (!handleInfo.nodeId) return;
		consumePointer(event);
		activeConnection = {
			pointerId: event.pointerId,
			sourceId: handleInfo.nodeId,
			sourceHandleId: handleInfo.handleId,
			sourceHandleType: handleInfo.handleType,
			targetId: null,
			targetHandleId: null,
			targetHandleType: null
		};
		element.dataset["surfaceCanvasPointerActive"] = "connect";
		handle.dataset["surfaceCanvasConnectionSource"] = "true";
		previousBodyUserSelect = element.ownerDocument.body.style.userSelect;
		element.ownerDocument.body.style.userSelect = "none";
		syncRuntime()?.dispatch({
			type: "connectStart",
			sourceId: handleInfo.nodeId,
			sourceHandleId: handleInfo.handleId
		});
		view.addEventListener("pointermove", onWindowPointerMove, true);
		view.addEventListener("pointerup", onWindowPointerUp, true);
		view.addEventListener("pointercancel", onWindowPointerCancel, true);
		options.onConnectStart?.(connectionForSession(activeConnection, event, "start"), event);
	}
	function updateActiveConnection(event, phase) {
		if (!activeConnection) return null;
		const targetHandle = connectHandleAtPoint(element, event, options);
		const targetInfo = targetHandle ? connectionHandleInfo(targetHandle) : null;
		activeConnection.targetId = targetInfo?.nodeId ?? null;
		activeConnection.targetHandleId = targetInfo?.handleId ?? null;
		activeConnection.targetHandleType = targetInfo?.handleType ?? null;
		if (targetInfo?.nodeId) syncRuntime()?.dispatch({
			type: "connectOver",
			targetId: targetInfo.nodeId,
			targetHandleId: targetInfo.handleId
		});
		const connection = connectionForSession(activeConnection, event, phase);
		options.onConnectUpdate?.(connection, event);
		emitAutoPan(event, phase);
		return connection;
	}
	function endActiveConnection(phase, event) {
		if (!activeConnection) return;
		const connection = event ? updateActiveConnection(event, phase) : connectionForSessionFromFallback(activeConnection, phase);
		activeConnection = null;
		view.removeEventListener("pointermove", onWindowPointerMove, true);
		view.removeEventListener("pointerup", onWindowPointerUp, true);
		view.removeEventListener("pointercancel", onWindowPointerCancel, true);
		element.ownerDocument.body.style.userSelect = previousBodyUserSelect;
		delete element.dataset["surfaceCanvasPointerActive"];
		for (const source of element.querySelectorAll("[data-surface-canvas-connection-source=\"true\"]")) delete source.dataset["surfaceCanvasConnectionSource"];
		syncRuntime()?.dispatch({ type: "connectEnd" });
		if (connection && phase === "end" && connection.targetId) options.onConnect?.(connection, event);
		if (connection) options.onConnectEnd?.(connection, event);
	}
	function beginMarquee(event) {
		ensureMarqueeStyles(element.ownerDocument);
		consumePointer(event);
		const overlay = element.ownerDocument.createElement("div");
		overlay.className = "bx-surface-canvas-marquee";
		overlay.dataset["surfaceCanvasMarquee"] = "active";
		element.ownerDocument.body.append(overlay);
		activeMarquee = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			currentX: event.clientX,
			currentY: event.clientY,
			additive: event.metaKey || event.ctrlKey || event.shiftKey,
			overlay
		};
		element.dataset["surfaceCanvasPointerActive"] = "marquee";
		previousBodyUserSelect = element.ownerDocument.body.style.userSelect;
		element.ownerDocument.body.style.userSelect = "none";
		view.addEventListener("pointermove", onWindowPointerMove, true);
		view.addEventListener("pointerup", onWindowPointerUp, true);
		view.addEventListener("pointercancel", onWindowPointerCancel, true);
		applyMarqueeOverlay(activeMarquee);
		options.onMarqueeStart?.(marqueeForSession(element, activeMarquee, "start", options, cache), event);
	}
	function updateActiveMarquee(event, phase) {
		if (!activeMarquee) return;
		activeMarquee.currentX = event.clientX;
		activeMarquee.currentY = event.clientY;
		applyMarqueeOverlay(activeMarquee);
		options.onMarqueeUpdate?.(marqueeForSession(element, activeMarquee, phase, options, cache), event);
	}
	function endActiveMarquee(phase, event) {
		if (!activeMarquee) return;
		const session = activeMarquee;
		if (event) {
			session.currentX = event.clientX;
			session.currentY = event.clientY;
		}
		activeMarquee = null;
		view.removeEventListener("pointermove", onWindowPointerMove, true);
		view.removeEventListener("pointerup", onWindowPointerUp, true);
		view.removeEventListener("pointercancel", onWindowPointerCancel, true);
		element.ownerDocument.body.style.userSelect = previousBodyUserSelect;
		delete element.dataset["surfaceCanvasPointerActive"];
		session.overlay.remove();
		suppressNextClick = true;
		const marquee = marqueeForSession(element, session, phase, options, cache);
		if (phase === "end") {
			commitMarqueeSelection(marquee, event);
			options.onMarqueeCommit?.(marquee, event);
		} else options.onMarqueeUpdate?.(marquee, event);
	}
	function commitMarqueeSelection(marquee, event) {
		const currentRuntime = syncRuntime();
		if (!currentRuntime) return;
		if (marquee.ids.length === 0) {
			if (!marquee.additive) clearSelection(event);
			return;
		}
		delete element.dataset["surfaceCanvasSelectionCleared"];
		hasHydratedSelection = true;
		if (!marquee.additive) currentRuntime.clearInteractionState();
		for (const [index, id] of marquee.ids.entries()) currentRuntime.select(id, {
			additive: marquee.additive || index > 0,
			restoreSource: true
		});
		schedule();
	}
});
function consume$2(event) {
	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation();
}
function canvasModeFor(element) {
	const mode = element.closest("[data-surface-mode]")?.getAttribute("data-surface-mode");
	return mode === "change" || mode === "inspect" ? mode : "use";
}
function activeSelectionId(runtime) {
	const snapshot = runtime.snapshot();
	const activeScopeId = snapshot.activeScopeId;
	if (activeScopeId && snapshot.selections[activeScopeId]) return snapshot.selections[activeScopeId].headId;
	return snapshot.focusedId;
}
function activeObjectElement(root, runtime, options, cache) {
	const activeId = activeSelectionId(runtime);
	return activeId ? objectById(root, activeId, options, cache) : null;
}
function objectById(root, id, options, cache) {
	return objects(root, options, cache).find((object) => surfaceIdFor(object) === id) ?? null;
}
function closestObject(root, target, options) {
	if (!target) return null;
	const selector = canvasObjectSelector(options);
	const object = target.closest(selector);
	if (!object || !root.contains(object)) return null;
	if (object.closest("[data-bx-lift]")) return null;
	return object;
}
function objects(root, options, cache) {
	const selector = canvasObjectSelector(options);
	return cachedElementList(cache, root, `canvas:objects:${selector}`, () => Array.from(root.querySelectorAll(selector)).filter((object) => root.contains(object) && isVisible(object)));
}
function rectForObject(object, cache) {
	return cachedRectForElement(object, cache);
}
function surfaceIdFor(element) {
	return element.getAttribute("data-ladder-id") ?? element.getAttribute("data-id") ?? element.id ?? null;
}
function paintObjectSelectionState(object, selected, projected) {
	const selectedValue = selected ? "true" : "false";
	if (object.dataset["runtimeSelected"] !== selectedValue) object.dataset["runtimeSelected"] = selectedValue;
	if (object.dataset["selected"] !== selectedValue) object.dataset["selected"] = selectedValue;
	object.classList.toggle("is-runtime-selected", selected);
	const tabIndex = tabIndexForObjectProjection(selected, projected);
	if (tabIndex === null) object.removeAttribute("tabindex");
	else object.tabIndex = tabIndex;
}
function tabIndexForObjectProjection(selected, projected) {
	return projected?.tabIndex ?? (selected ? 0 : -1);
}
function symmetricDifference(left, right) {
	const changed = /* @__PURE__ */ new Set();
	for (const id of left) if (!right.has(id)) changed.add(id);
	for (const id of right) if (!left.has(id)) changed.add(id);
	return changed;
}
function selectionForObject(root, object, options, cache, event) {
	const allObjects = objects(root, options, cache);
	const rect = rectForObject(object, cache);
	const targetPayload = canvasTargetPayload(event?.target);
	return {
		id: surfaceIdFor(object) ?? object.id,
		focusKey: object.dataset["surfaceFocusKey"],
		kind: objectKindFor(object, options),
		field: targetPayload.field,
		payload: targetPayload.payload,
		index: allObjects.indexOf(object),
		x: rect.left,
		y: rect.top,
		width: rect.width,
		height: rect.height
	};
}
function canvasTargetPayload(target) {
	if (!(target instanceof Element)) return {};
	const payloadElement = closestCanvasPayloadElement(target);
	if (!payloadElement) return {};
	const payload = {};
	for (const { name, value } of Array.from(payloadElement.attributes)) {
		if (!name.startsWith("data-canvas-")) continue;
		const key = datasetPayloadKey(name.slice(12));
		if (key) payload[key] = value;
	}
	return {
		field: payload["field"],
		payload: Object.keys(payload).length > 0 ? payload : void 0
	};
}
function closestCanvasPayloadElement(target) {
	let cursor = target;
	while (cursor) {
		if (cursor instanceof HTMLElement && Array.from(cursor.attributes).some((attribute) => attribute.name.startsWith("data-canvas-"))) return cursor;
		cursor = cursor.parentElement;
	}
	return null;
}
function datasetPayloadKey(attributeSuffix) {
	return attributeSuffix.replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
}
function canvasObjectSelector(options) {
	return [options.objectSelector ?? DEFAULT_OBJECT_SELECTOR, options.edgeSelector ?? DEFAULT_EDGE_SELECTOR].filter((selector) => selector.trim().length > 0).join(", ");
}
function objectKindFor(object, options) {
	const edgeSelector = options.edgeSelector ?? DEFAULT_EDGE_SELECTOR;
	if (edgeSelector.trim().length > 0 && object.matches(edgeSelector)) return "edge";
	return object.getAttribute("data-surface-component") === "edge" || object.hasAttribute("data-surface-canvas-edge") || object.classList.contains("boxel-canvas__edge") ? "edge" : "frame";
}
function nextObjectInOrder(root, current, direction, options, cache) {
	const allObjects = objects(root, options, cache);
	if (allObjects.length === 0) return null;
	const currentIndex = allObjects.indexOf(current);
	return allObjects[currentIndex < 0 ? 0 : (currentIndex + direction + allObjects.length) % allObjects.length] ?? null;
}
function nearestObjectForArrow(root, current, key, options, cache) {
	const currentRect = rectForObject(current, cache);
	const currentCenter = centerOf(currentRect);
	let best = null;
	for (const candidate of objects(root, options, cache)) {
		if (candidate === current) continue;
		const rect = rectForObject(candidate, cache);
		const center = centerOf(rect);
		const dx = center.x - currentCenter.x;
		const dy = center.y - currentCenter.y;
		if (!isCandidateInDirection(key, dx, dy)) continue;
		const primary = key === "ArrowLeft" || key === "ArrowRight" ? Math.abs(dx) : Math.abs(dy);
		const secondary = key === "ArrowLeft" || key === "ArrowRight" ? Math.abs(dy) : Math.abs(dx);
		const overlapBias = overlapsOrthogonalAxis(key, currentRect, rect) ? -1e3 : 0;
		const score = primary * 100 + secondary + overlapBias;
		if (!best || score < best.score) best = {
			object: candidate,
			score
		};
	}
	return best?.object ?? current;
}
function centerOf(rect) {
	return {
		x: rect.left + rect.width / 2,
		y: rect.top + rect.height / 2
	};
}
function isCandidateInDirection(key, dx, dy) {
	switch (key) {
		case "ArrowLeft": return dx < 0 && Math.abs(dx) >= Math.abs(dy) * .2;
		case "ArrowRight": return dx > 0 && Math.abs(dx) >= Math.abs(dy) * .2;
		case "ArrowUp": return dy < 0 && Math.abs(dy) >= Math.abs(dx) * .2;
		case "ArrowDown": return dy > 0 && Math.abs(dy) >= Math.abs(dx) * .2;
		default: return false;
	}
}
function overlapsOrthogonalAxis(key, a, b) {
	if (key === "ArrowLeft" || key === "ArrowRight") return a.top <= b.bottom && b.top <= a.bottom;
	return a.left <= b.right && b.left <= a.right;
}
function isArrowKey(key) {
	return key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
}
function arrowDelta(key, step) {
	switch (key) {
		case "ArrowLeft": return {
			dx: -step,
			dy: 0
		};
		case "ArrowRight": return {
			dx: step,
			dy: 0
		};
		case "ArrowUp": return {
			dx: 0,
			dy: -step
		};
		case "ArrowDown": return {
			dx: 0,
			dy: step
		};
		default: return {
			dx: 0,
			dy: 0
		};
	}
}
function canvasPointerDragEnabled(options) {
	return options.pointerDrag ?? Boolean(options.onMove);
}
function canvasPointerResizeEnabled(options) {
	return options.pointerResize ?? Boolean(options.onResize);
}
function canvasPointerMarqueeEnabled(options) {
	return options.pointerMarquee ?? Boolean(options.onMarqueeStart || options.onMarqueeUpdate || options.onMarqueeCommit);
}
function canvasPointerConnectEnabled(options) {
	return options.pointerConnect ?? Boolean(options.onConnectStart || options.onConnectUpdate || options.onConnect || options.onConnectEnd);
}
function canvasAutoPanEnabled(options) {
	return options.autoPan ?? Boolean(options.onAutoPan);
}
function autoPanForPointer(root, event, phase, options) {
	const rect = root.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return null;
	const margin = options.autoPanMargin ?? 48;
	const maxSpeed = options.autoPanMaxSpeed ?? 18;
	return {
		dx: autoPanAxisDelta(event.clientX, rect.left, rect.right, margin, maxSpeed),
		dy: autoPanAxisDelta(event.clientY, rect.top, rect.bottom, margin, maxSpeed),
		pointerX: event.clientX,
		pointerY: event.clientY,
		margin,
		phase
	};
}
function autoPanAxisDelta(pointer, start, end, margin, maxSpeed) {
	if (margin <= 0 || maxSpeed <= 0) return 0;
	if (pointer < start + margin) {
		const pressure = (start + margin - pointer) / margin;
		return -Math.round(Math.min(1, Math.max(0, pressure)) * maxSpeed);
	}
	if (pointer > end - margin) {
		const pressure = (pointer - (end - margin)) / margin;
		return Math.round(Math.min(1, Math.max(0, pressure)) * maxSpeed);
	}
	return 0;
}
function ensureMarqueeStyles(document) {
	if (document.getElementById(MARQUEE_STYLE_ID)) return;
	const style = document.createElement("style");
	style.id = MARQUEE_STYLE_ID;
	style.textContent = `
    .bx-surface-canvas-marquee {
      position: fixed;
      z-index: 98;
      box-sizing: border-box;
      pointer-events: none;
      border: 1px solid var(--surface-decal-highlight, #00ffba);
      background: var(--surface-decal-highlight-fill-soft, rgba(0, 255, 186, 0.10));
      box-shadow: 0 0 0 3px var(--surface-decal-highlight-fill-soft, rgba(0, 255, 186, 0.10));
    }
  `;
	document.head.append(style);
}
function applyMarqueeOverlay(session) {
	const box = marqueeBoxForSession(session);
	session.overlay.style.left = `${box.left}px`;
	session.overlay.style.top = `${box.top}px`;
	session.overlay.style.width = `${box.width}px`;
	session.overlay.style.height = `${box.height}px`;
}
function marqueeForSession(root, session, phase, options, cache) {
	const box = marqueeBoxForSession(session);
	return {
		phase,
		startX: session.startX,
		startY: session.startY,
		currentX: session.currentX,
		currentY: session.currentY,
		left: box.left,
		top: box.top,
		right: box.right,
		bottom: box.bottom,
		width: box.width,
		height: box.height,
		pointerX: session.currentX,
		pointerY: session.currentY,
		ids: marqueeObjectIds(root, box, options, cache),
		additive: session.additive
	};
}
function marqueeBoxForSession(session) {
	const left = Math.min(session.startX, session.currentX);
	const top = Math.min(session.startY, session.currentY);
	const right = Math.max(session.startX, session.currentX);
	const bottom = Math.max(session.startY, session.currentY);
	return {
		left,
		top,
		right,
		bottom,
		width: right - left,
		height: bottom - top
	};
}
function marqueeObjectIds(root, box, options, cache) {
	const minSize = options.marqueeMinSize ?? 4;
	if (box.width < minSize && box.height < minSize) return [];
	const ids = [];
	for (const object of objects(root, options, cache)) {
		if (!rectsIntersect(rectForObject(object, cache), box)) continue;
		const id = surfaceIdFor(object);
		if (id) ids.push(id);
	}
	return ids;
}
function rectsIntersect(rect, box) {
	return rect.left <= box.right && rect.right >= box.left && rect.top <= box.bottom && rect.bottom >= box.top;
}
function closestResizeHandle(root, target, options) {
	const selector = options.resizeHandleSelector ?? DEFAULT_RESIZE_HANDLE_SELECTOR;
	const handle = target.closest(selector);
	return handle && root.contains(handle) ? handle : null;
}
function closestConnectHandle(root, target, options) {
	const selector = options.connectHandleSelector ?? DEFAULT_CONNECT_HANDLE_SELECTOR;
	if (selector.trim().length === 0) return null;
	const handle = target.closest(selector);
	return handle && root.contains(handle) ? handle : null;
}
function connectHandleAtPoint(root, event, options) {
	const elements = root.ownerDocument.elementsFromPoint(event.clientX, event.clientY);
	for (const element of elements) {
		const handle = closestConnectHandle(root, element, options);
		if (handle) return handle;
	}
	return null;
}
function connectionHandleInfo(handle) {
	return {
		nodeId: handle.getAttribute("data-nodeid") ?? handle.getAttribute("data-surface-node-id") ?? handle.getAttribute("data-ladder-id") ?? null,
		handleId: handle.getAttribute("data-handleid") ?? handle.getAttribute("data-surface-handle-id") ?? null,
		handleType: handle.getAttribute("data-handletype") ?? handle.getAttribute("data-surface-handle-type") ?? null
	};
}
function connectionForSession(session, event, phase) {
	return {
		phase,
		sourceId: session.sourceId,
		sourceHandleId: session.sourceHandleId,
		sourceHandleType: session.sourceHandleType,
		targetId: session.targetId,
		targetHandleId: session.targetHandleId,
		targetHandleType: session.targetHandleType,
		pointerX: event.clientX,
		pointerY: event.clientY
	};
}
function connectionForSessionFromFallback(session, phase) {
	return {
		phase,
		sourceId: session.sourceId,
		sourceHandleId: session.sourceHandleId,
		sourceHandleType: session.sourceHandleType,
		targetId: session.targetId,
		targetHandleId: session.targetHandleId,
		targetHandleType: session.targetHandleType,
		pointerX: 0,
		pointerY: 0
	};
}
function isCanvasDragStartTarget(object, target, options) {
	const selector = options.dragHandleSelector ?? DEFAULT_DRAG_HANDLE_SELECTOR;
	const handle = target.closest(selector);
	if (handle && object.contains(handle)) return true;
	if (object.querySelector(selector)) return false;
	return target.closest("button, input, textarea, select, [contenteditable]:not([contenteditable=false]), [data-surface-activate-frame], [data-surface-atom-editor]") === null;
}
function consumePointer(event) {
	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation();
}
function pointerMoveFor(event, session, phase) {
	const totalDx = event.clientX - session.startX;
	const totalDy = event.clientY - session.startY;
	return {
		phase,
		dx: totalDx,
		dy: totalDy,
		totalDx,
		totalDy,
		pointerX: event.clientX,
		pointerY: event.clientY
	};
}
function snappedPointerMoveFor(event, session, phase, options) {
	return applySnapPosition(session.selection, pointerMoveFor(event, session, phase), options, event);
}
function applySnapPosition(selection, move, options, event) {
	const snapped = options.snapPosition?.(selection, move, event);
	if (!snapped) return move;
	const totalDx = finiteOr(snapped.dx, snapped.x === void 0 ? move.totalDx : snapped.x - selection.x);
	const totalDy = finiteOr(snapped.dy, snapped.y === void 0 ? move.totalDy : snapped.y - selection.y);
	return {
		...move,
		dx: totalDx,
		dy: totalDy,
		totalDx,
		totalDy
	};
}
function finiteOr(value, fallback) {
	return value !== void 0 && Number.isFinite(value) ? value : fallback;
}
function pointerMoveForFallback(session, phase) {
	return {
		phase,
		dx: 0,
		dy: 0,
		totalDx: 0,
		totalDy: 0,
		pointerX: session.startX,
		pointerY: session.startY
	};
}
function pointerResizeFor(event, session, phase, options) {
	return resizeForDelta(session, event.clientX - session.startX, event.clientY - session.startY, phase, event.clientX, event.clientY, options);
}
function pointerResizeForFallback(session, phase, options) {
	return resizeForDelta(session, 0, 0, phase, session.startX, session.startY, options);
}
function resizeForDelta(session, dx, dy, phase, pointerX, pointerY, options) {
	const minWidth = options.minResizeWidth ?? 180;
	const minHeight = options.minResizeHeight ?? 120;
	return {
		phase,
		dx,
		dy,
		width: Math.max(minWidth, session.initialWidth + dx),
		height: Math.max(minHeight, session.initialHeight + dy),
		pointerX,
		pointerY
	};
}
function applyMoveTransform(object, initialTransform, dx, dy) {
	const base = initialTransform && initialTransform !== "none" ? `${initialTransform} ` : "";
	object.style.transform = `${base}translate3d(${Math.round(dx)}px, ${Math.round(dy)}px, 0)`;
}
function focusObject(object, reveal, selection, options) {
	if (!surfaceTargetRetainsFocus(object.ownerDocument.activeElement)) object.focus({ preventScroll: true });
	if (!reveal) return;
	const revealMode = options.reveal ?? "scroll";
	if (typeof revealMode === "function") {
		revealMode(object, selection);
		return;
	}
	if (revealMode === "pan") {
		options.onReveal?.(selection, object);
		return;
	}
	if (revealMode === "scroll") object.scrollIntoView({
		block: "nearest",
		inline: "nearest"
	});
}
function surfaceTargetRetainsFocus(target) {
	if (!target) return false;
	return isSurfaceTextEntryTarget(target) || target.closest("[data-surface-keyboard-owner], [data-bx-lift]") !== null;
}
function isVisible(element) {
	return element.offsetParent !== null || element.getClientRects().length > 0;
}
modifier((element, [target]) => {
	const frame = requestAnimationFrame(() => {
		const dest = target === "body" ? document.body : element.closest(target) ?? document.body;
		if (dest && element.parentElement !== dest) dest.appendChild(element);
	});
	return () => {
		cancelAnimationFrame(frame);
		element.remove();
	};
});
var multiUnit = modifier((cell, [ladder, cellId], opts = {}) => {
	if (!ladder || !cellId) return;
	const registry = /* @__PURE__ */ new Map();
	const paint = () => {
		for (const id of registry.keys()) {
			const el = cell.querySelector(`[data-ladder-id="${CSS.escape(id)}"]`);
			if (!el) continue;
			el.classList.toggle("is-ladder-focused", ladder.isFocused(id));
			el.classList.toggle("is-ladder-selected", ladder.isSelected(id));
		}
	};
	const sync = () => {
		const units = cell.querySelectorAll("[data-unit-key]");
		const seen = /* @__PURE__ */ new Set();
		for (const unit of Array.from(units)) {
			const key = unit.getAttribute("data-unit-key");
			if (!key) continue;
			const fullId = `${cellId}.${key}`;
			seen.add(fullId);
			if (unit.getAttribute("data-ladder-id") !== fullId) unit.setAttribute("data-ladder-id", fullId);
			if (!registry.has(fullId)) {
				const cleanup = ladder.register({
					id: fullId,
					surface: "unit",
					parentId: cellId
				});
				registry.set(fullId, cleanup);
			}
		}
		for (const [id, cleanup] of registry) if (!seen.has(id)) {
			cleanup();
			registry.delete(id);
		}
	};
	sync();
	const observer = new MutationObserver(sync);
	observer.observe(cell, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["data-unit-key"]
	});
	const onClick = (event) => {
		if (opts.skipClick) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		const unit = target.closest("[data-unit-key]");
		if (!unit || !cell.contains(unit)) return;
		const fullId = unit.getAttribute("data-ladder-id");
		if (!fullId) return;
		event.stopPropagation();
		event.stopImmediatePropagation();
		ladder.select(fullId, {
			additive: event.metaKey || event.ctrlKey,
			range: event.shiftKey
		});
	};
	cell.addEventListener("click", onClick, true);
	const unsubscribe = ladder.subscribe(() => paint());
	queueMicrotask(paint);
	return () => {
		observer.disconnect();
		cell.removeEventListener("click", onClick);
		unsubscribe();
		for (const cleanup of registry.values()) cleanup();
		registry.clear();
	};
});
var surfaceLiftBinding = modifier((element, _positional, args) => {
	const { state, contract, row, col, onSelect, onActivate } = args;
	const supportsDetails = contract.lift.includes("details");
	const supportsEdit = contract.lift.includes("edit");
	const openDetails = () => {
		if (!supportsDetails) return;
		state.scheduleHoverDetails(row, col, contract);
	};
	const refreshDetails = () => {
		if (!supportsDetails) return;
		if (state.isOpenFor(row, col)) return;
		state.scheduleHoverDetails(row, col, contract);
	};
	const dismissDetails = () => {
		state.scheduleDismissDetails();
	};
	const onPointerEnter = (event) => {
		if (event.pointerType !== "mouse") return;
		openDetails();
	};
	const onPointerMove = (event) => {
		if (event.pointerType !== "mouse") return;
		refreshDetails();
	};
	const onPointerLeave = (event) => {
		if (event.pointerType !== "mouse") return;
		dismissDetails();
	};
	const onMouseEnter = () => {
		openDetails();
	};
	const onMouseMove = () => {
		refreshDetails();
	};
	const onMouseLeave = () => {
		dismissDetails();
	};
	const onClick = (event) => {
		onSelect?.(row, col, event);
	};
	const onDblClick = (event) => {
		if (onActivate) {
			event.stopPropagation();
			onActivate(row, col);
			return;
		}
		if (!supportsEdit) return;
		event.stopPropagation();
		state.openEdit(row, col);
	};
	element.addEventListener("pointerenter", onPointerEnter);
	element.addEventListener("pointermove", onPointerMove);
	element.addEventListener("pointerleave", onPointerLeave);
	element.addEventListener("mouseenter", onMouseEnter);
	element.addEventListener("mousemove", onMouseMove);
	element.addEventListener("mouseleave", onMouseLeave);
	element.addEventListener("click", onClick);
	element.addEventListener("dblclick", onDblClick);
	return () => {
		element.removeEventListener("pointerenter", onPointerEnter);
		element.removeEventListener("pointermove", onPointerMove);
		element.removeEventListener("pointerleave", onPointerLeave);
		element.removeEventListener("mouseenter", onMouseEnter);
		element.removeEventListener("mousemove", onMouseMove);
		element.removeEventListener("mouseleave", onMouseLeave);
		element.removeEventListener("click", onClick);
		element.removeEventListener("dblclick", onDblClick);
	};
});
//#endregion
//#region dist/index.js
/**
* A `Surface` names a kind of rendering context with its own
* authority over focus, selection, and gesture. The list is
* deliberately small.
*
* Re-exported from `widget.ts` so consumers can import from a
* single module:
*   `import type { Surface } from '@cardstack/boxel-surface'`
*/
/**
* What the SURFACE is being rendered FOR. Same as the legacy
* `Intent` (`'preview' | 'editor'`) but extended with the higher-
* level intents the contract negotiation needs to distinguish —
* a "picker" pane behaves differently from an "editor" pane,
* for example.
*
* For now the spreadsheet only uses `'preview'` and `'editor'`;
* the rest are reserved for the broader Boxel use cases the design
* memo describes.
*/
/**
* Capability HINTS the widget gives the negotiator. Smaller and
* less prescriptive than the legacy `Trait` union — these answer
* questions like "is this widget a text input?" or "is committing
* on every keystroke safe?", not "should it use a popover?". The
* contract dimensions decide the latter.
*
* Names are deliberately verb-y / property-y so they read as
* statements about the widget's NATURE, not about UI choices.
*/
/**
* The kinds of lift a cell can offer. K.5 introduces this enum as
* a first-class contract dimension, replacing the legacy
* `contract.popup` field which named the CSS mechanism rather than
* the user intent.
*
*   details   Hover-triggered tooltip-light read-only inspection.
*   preview   Anchored card-style summary, sticky.
*   edit      Focused mutation surface (picker, calendar, formula).
*   tools     Action palette / command list.
*
* See `src/components/lift.gts` for the Lift shell that
* renders each kind.
*/
/**
* A `Contract` is the FULL run-time policy for a child
* surface mounted inside a parent surface. Every dimension is
* non-optional and resolves to a concrete enum value — the host
* never has to ask "what if focus is undefined?".
*
* 10 dimensions, ordered roughly from most-defining to least:
*
*   focus       Who owns the focus root?
*   selection   Who owns the selection model?
*   pointer     Who handles mouse-down?
*   keyboard    Who handles arrow keys / typing?
*   commit      When does an edit become permanent?
*   sizing      Who decides the editor's box size?
*   overflow    Are popups portaled past clipping?
*   popup       What lift surface does the editor open in?
*   layer       Which z-tier does the lift live on?
*   adornment   What chrome wraps the surface?
*
* Each enum value is intentionally short and English-readable so
* the contract dump is self-documenting in dev tools.
*/
/**
* The shape a SURFACE declares about itself: which capability hints
* it accepts, which contract dimensions it permits / forbids /
* defaults. Shipping policies (`GRID_CELL_POLICY`, etc.) live with
* the surface owner — for grid, in `boxel-grid`.
*
* Policies REFINE base contracts. They do NOT replace the lookup —
* the negotiator always starts from the base table.
*/
/**
* Per-instance overrides. The most-specific layer of refinement —
* a single column, a single tile, a single embed says "for this
* one, override these dimensions." Subject to safety rules: the
* negotiator will not honor an override that would unlock focus
* for a `'plane'`-level surface, for example.
*/
/**
* The "if everything else returns nothing, you get this" contract.
* Equivalent to a static read-only display: parent owns everything,
* child has no authority, no editor mounts. Safe to render anywhere.
*/
var FALLBACK_CONTRACT = {
	focus: "parent",
	selection: "parent",
	pointer: "parent-gesture",
	keyboard: "parent-shortcuts",
	commit: "preview-only",
	sizing: "intrinsic",
	overflow: "visible",
	lift: [],
	liftPlacement: "attached",
	liftFocus: "auto",
	liftSize: "comfortable",
	liftBackdrop: "tint",
	liftElevation: "raised",
	liftKeyboardModel: "compose",
	rangeable: false,
	advanceOnCommit: "stay",
	layer: "base",
	adornment: "none"
};
var BASE_CONTRACTS = {
	"layout>run": {
		focus: "parent",
		selection: "none",
		pointer: "parent-gesture",
		keyboard: "parent-shortcuts",
		commit: "preview-only",
		sizing: "intrinsic",
		overflow: "visible",
		lift: [],
		liftPlacement: "attached",
		liftFocus: "auto",
		liftSize: "comfortable",
		liftBackdrop: "tint",
		liftElevation: "raised",
		liftKeyboardModel: "compose",
		rangeable: false,
		advanceOnCommit: "stay",
		layer: "base",
		adornment: "none"
	},
	"layout>cell": {
		focus: "delegated",
		selection: "child",
		pointer: "child-interaction",
		keyboard: "child-text",
		commit: "on-blur",
		sizing: "fill",
		overflow: "clip",
		lift: ["details", "edit"],
		liftPlacement: "attached",
		liftFocus: "auto",
		liftSize: "comfortable",
		liftBackdrop: "tint",
		liftElevation: "raised",
		liftKeyboardModel: "compose",
		rangeable: false,
		advanceOnCommit: "down",
		layer: "popover",
		adornment: "hover"
	},
	"layout>unit": {
		focus: "delegated",
		selection: "child",
		pointer: "child-interaction",
		keyboard: "child-text",
		commit: "on-blur",
		sizing: "fill",
		overflow: "clip",
		lift: ["details", "edit"],
		liftPlacement: "attached",
		liftFocus: "auto",
		liftSize: "comfortable",
		liftBackdrop: "tint",
		liftElevation: "raised",
		liftKeyboardModel: "compose",
		rangeable: true,
		advanceOnCommit: "down",
		layer: "popover",
		adornment: "hover"
	},
	"cell>unit": {
		focus: "delegated",
		selection: "child",
		pointer: "child-interaction",
		keyboard: "child-text",
		commit: "on-blur",
		sizing: "intrinsic",
		overflow: "visible",
		lift: [],
		liftPlacement: "attached",
		liftFocus: "auto",
		liftSize: "comfortable",
		liftBackdrop: "tint",
		liftElevation: "raised",
		liftKeyboardModel: "compose",
		rangeable: false,
		advanceOnCommit: "stay",
		layer: "popover",
		adornment: "hover"
	},
	"layout>layout": {
		focus: "delegated",
		selection: "shared",
		pointer: "gesture-split",
		keyboard: "parent-shortcuts",
		commit: "draft",
		sizing: "intrinsic",
		overflow: "visible",
		lift: [
			"details",
			"preview",
			"edit"
		],
		liftPlacement: "plane",
		liftFocus: "auto",
		liftSize: "comfortable",
		liftBackdrop: "tint",
		liftElevation: "raised",
		liftKeyboardModel: "compose",
		rangeable: false,
		advanceOnCommit: "stay",
		layer: "base",
		adornment: "hover"
	},
	"layout>pane": {
		focus: "contained",
		selection: "child",
		pointer: "child-interaction",
		keyboard: "child-text",
		commit: "on-close",
		sizing: "fill",
		overflow: "scroll",
		lift: ["edit"],
		liftPlacement: "attached",
		liftFocus: "auto",
		liftSize: "comfortable",
		liftBackdrop: "tint",
		liftElevation: "raised",
		liftKeyboardModel: "compose",
		rangeable: false,
		advanceOnCommit: "stay",
		layer: "popover",
		adornment: "none"
	},
	"layout>plane": {
		focus: "trapped",
		selection: "child",
		pointer: "blocked",
		keyboard: "modal",
		commit: "explicit",
		sizing: "fill",
		overflow: "scroll",
		lift: ["edit"],
		liftPlacement: "plane",
		liftFocus: "auto",
		liftSize: "comfortable",
		liftBackdrop: "tint",
		liftElevation: "raised",
		liftKeyboardModel: "compose",
		rangeable: false,
		advanceOnCommit: "stay",
		layer: "modal",
		adornment: "none"
	},
	"pane>layout": {
		focus: "contained",
		selection: "child",
		pointer: "child-interaction",
		keyboard: "child-text",
		commit: "draft",
		sizing: "fill",
		overflow: "scroll",
		lift: ["edit"],
		liftPlacement: "attached",
		liftFocus: "auto",
		liftSize: "comfortable",
		liftBackdrop: "tint",
		liftElevation: "raised",
		liftKeyboardModel: "compose",
		rangeable: false,
		advanceOnCommit: "stay",
		layer: "popover",
		adornment: "none"
	},
	"pane>plane": {
		focus: "trapped",
		selection: "child",
		pointer: "blocked",
		keyboard: "modal",
		commit: "explicit",
		sizing: "fill",
		overflow: "scroll",
		lift: ["edit"],
		liftPlacement: "plane",
		liftFocus: "auto",
		liftSize: "comfortable",
		liftBackdrop: "tint",
		liftElevation: "raised",
		liftKeyboardModel: "compose",
		rangeable: false,
		advanceOnCommit: "stay",
		layer: "modal",
		adornment: "none"
	}
};
var CONTRACT_TABLES = /* @__PURE__ */ new Map();
CONTRACT_TABLES.set("base", BASE_CONTRACTS);
function registerContractTable(name, table) {
	CONTRACT_TABLES.set(name, table);
}
/**
* Look up the base contract for a (parent, child) pair across all
* registered shards. Search order: most-recently-registered wins
* (so package shards override base if there's a conflict — the
* package owns the surface, it knows best).
*/
function lookupBaseContract(parent, child) {
	const key = `${parent}>${child}`;
	const tables = [...CONTRACT_TABLES.values()].reverse();
	for (const table of tables) {
		const hit = table[key];
		if (hit) return { ...hit };
	}
	return { ...FALLBACK_CONTRACT };
}
/** Pass 1: intent refinement.
*  Preview vs editor changes commit + adornment + lift availability. */
function applyIntent(contract, input) {
	if (input.childIntent === "preview") return {
		...contract,
		commit: "preview-only",
		lift: [],
		layer: "base"
	};
	if (input.childIntent === "editor") {
		if (contract.commit === "preview-only") return {
			...contract,
			commit: "draft"
		};
	}
	return contract;
}
/** Pass 2: capability refinement.
*  Each capability hint may upgrade specific dimensions. */
function applyCapabilities(contract, caps) {
	let c = { ...contract };
	const has = (cap) => caps.includes(cap);
	if (has("text-input")) {
		c.keyboard = "child-text";
		c.pointer = "child-interaction";
	}
	if (has("live-write")) c.commit = "live";
	if (has("draft-commit") && c.commit !== "live") c.commit = "draft";
	const declaredLifts = /* @__PURE__ */ new Set();
	if (has("lift-details")) declaredLifts.add("details");
	if (has("lift-preview")) declaredLifts.add("preview");
	if (has("lift-edit")) declaredLifts.add("edit");
	if (has("lift-tools")) declaredLifts.add("tools");
	if (declaredLifts.size === 0) c.lift = [];
	else c.lift = [
		"details",
		"preview",
		"edit",
		"tools"
	].filter((k) => declaredLifts.has(k));
	if (has("plane-default") && c.lift.length > 0) {
		c.liftPlacement = "plane";
		c.layer = "modal";
		c.overflow = "portal";
	} else if (has("shadow-default") && c.lift.length > 0) {
		c.liftPlacement = "shadow";
		c.layer = "cell-lift";
		c.overflow = "portal";
	} else if (c.lift.length > 0 && c.liftPlacement === "attached") c.overflow = "portal";
	if (c.lift.length > 0) {
		const mostEscalated = c.lift[c.lift.length - 1];
		if (mostEscalated === "edit") {
			if (c.liftPlacement === "plane") {
				c.liftSize = "spacious";
				c.liftBackdrop = "scrim";
				c.liftElevation = "modal";
			} else if (c.liftPlacement === "shadow") {
				c.liftSize = "auto";
				c.liftBackdrop = "none";
				c.liftElevation = "elevated";
			} else {
				c.liftSize = "comfortable";
				c.liftBackdrop = "blur";
				c.liftElevation = "elevated";
			}
			if (has("arrow-nudge") && has("text-input")) c.liftKeyboardModel = "edit-number";
			else if (has("text-input") && !has("lift-edit")) c.liftKeyboardModel = "edit-text";
			else if (has("text-input") && has("lift-edit") && !c.lift.includes("details")) c.liftKeyboardModel = "edit-text";
			else c.liftKeyboardModel = "pick";
		} else if (mostEscalated === "tools") {
			c.liftSize = "compact";
			c.liftBackdrop = "none";
			c.liftElevation = "raised";
			c.liftKeyboardModel = "pick";
		} else {
			c.liftSize = "compact";
			c.liftBackdrop = "tint";
			c.liftElevation = "raised";
			c.liftKeyboardModel = "compose";
		}
	}
	if (has("commit-on-close") && c.lift.length > 0 && c.commit !== "live") c.commit = "on-close";
	if (has("hover-reveal") && c.adornment === "none") c.adornment = "hover";
	if (has("resizable")) c.sizing = "resizable";
	if (has("cq-size")) c.sizing = "measured";
	return c;
}
/** Pass 3: parent surface policy.
*  Apply the surface's overrides + drop forbidden capabilities
*  retroactively (a widget that asked for `popover` but the
*  surface forbids `popover` should fall back to inline). */
function applyParentPolicy(contract, caps, policy) {
	if (!policy) return {
		contract,
		caps
	};
	let nextCaps = caps;
	if (policy.permits || policy.forbids) {
		const permits = policy.permits ? new Set(policy.permits) : null;
		const forbids = new Set(policy.forbids ?? []);
		nextCaps = caps.filter((c) => {
			if (forbids.has(c)) return false;
			if (permits && !permits.has(c)) return false;
			return true;
		});
	}
	let nextContract = contract;
	if (policy.overrides) nextContract = {
		...contract,
		...policy.overrides
	};
	return {
		contract: nextContract,
		caps: nextCaps
	};
}
/** Pass 4: safety escalations.
*  Hard rules that no override or policy can bypass.
*
*  - A modal plane MUST trap focus, block pointer, and route
*    keyboard to modal.
*  - A child with `text-input` MUST give the child keyboard. */
function applySafetyEscalations(contract, input) {
	let c = { ...contract };
	if (c.lift.length > 0 && c.liftPlacement === "plane" || input.childSurface === "plane") {
		c.focus = "trapped";
		c.pointer = "blocked";
		c.keyboard = "modal";
		c.layer = "modal";
		c.commit = c.commit === "live" ? "live" : "explicit";
	}
	if (input.capabilities.includes("text-input")) {
		if (c.keyboard !== "modal") c.keyboard = "child-text";
	}
	return c;
}
/** Pass 5: instance overrides.
*  Applied LAST so a single column / tile can refine a final
*  dimension. Subject to safety: overrides cannot reverse a
*  safety escalation (the safety pass runs BEFORE overrides
*  conceptually but we re-apply safety after to make it true). */
function applyInstanceOverrides(contract, overrides, input) {
	if (!overrides) return contract;
	return applySafetyEscalations({
		...contract,
		...overrides
	}, input);
}
/**
* The main entry point. Pure function; same input → same output.
*
* Pipeline:
*   1. Look up base contract for (parent, child) — sharded across
*      all registered tables, last-registered wins.
*   2. Apply intent refinement (preview vs editor).
*   3. Apply capability hints (widget shape).
*   4. Apply parent surface policy (permits / forbids / overrides).
*   5. Apply safety escalations (modal / text-input).
*   6. Apply instance overrides + re-run safety.
*
* Stable shape — returns a NEW object every call (no aliasing).
*/
function negotiateContract(input) {
	let contract = lookupBaseContract(input.parentSurface, input.childSurface);
	contract = applyIntent(contract, input);
	contract = applyCapabilities(contract, input.capabilities);
	const policyApplied = applyParentPolicy(contract, input.capabilities, input.parentPolicy);
	contract = policyApplied.contract;
	const filteredCaps = policyApplied.caps;
	contract = applySafetyEscalations(contract, {
		...input,
		capabilities: filteredCaps
	});
	contract = applyInstanceOverrides(contract, input.instanceOverrides, {
		...input,
		capabilities: filteredCaps
	});
	return contract;
}
/**
* Convenience entry point. Take a widget's `capabilities` array
* (the new shape — `Capability[]`) and the surface pair,
* negotiate the contract. Most callers use this rather than
* `negotiateContract` directly because the parent/child
* intent + capability propagation is the boilerplate.
*/
function negotiateForWidget(args) {
	return negotiateContract({
		parentSurface: args.parentSurface,
		parentIntent: args.parentIntent ?? "editor",
		childSurface: args.childSurface,
		childIntent: args.childIntent,
		capabilities: args.widgetCapabilities ?? [],
		parentPolicy: args.parentPolicy,
		instanceOverrides: args.instanceOverrides
	});
}
var StyleId$1 = "boxel-surface-selection-decals-styles";
var DECAL_THEME_VARIABLES$1 = [
	"--boxel-highlight",
	"--surface-decal-highlight",
	"--surface-decal-highlight-fill",
	"--surface-decal-highlight-fill-soft"
];
function ensureStyles$1(document) {
	if (document.getElementById(StyleId$1)) return;
	const style = document.createElement("style");
	style.id = StyleId$1;
	style.textContent = `
    .bx-surface-selection-decal-layer {
      position: fixed;
      inset: 0;
      pointer-events: none;
      contain: layout style;
    }

    .bx-surface-selection-decal {
      position: fixed;
      box-sizing: border-box;
      pointer-events: none;
      border: 2px solid var(--surface-decal-highlight, #00ffba);
      border-radius: 2px;
      background: transparent;
      box-shadow:
        0 0 0 1px color-mix(in srgb, var(--surface-decal-highlight, #00ffba) 22%, transparent),
        0 0 0 4px var(--surface-decal-highlight-fill, rgba(0, 255, 186, 0.18));
    }

    .bx-surface-selection-decal--range {
      background: var(--surface-decal-highlight-fill-soft, rgba(0, 255, 186, 0.10));
    }
  `;
	document.head.append(style);
}
function syncDecalThemeVariables$1(source, target) {
	const styles = source.ownerDocument.defaultView?.getComputedStyle(source);
	if (!styles) return;
	for (const name of DECAL_THEME_VARIABLES$1) {
		const value = styles.getPropertyValue(name).trim();
		if (value) target.style.setProperty(name, value);
	}
}
function targetSelectors(targets) {
	if (!targets) return [];
	if (typeof targets === "string") return targets ? [targets] : [];
	return targets.filter((target) => target.length > 0);
}
function clipRectFor$1(document, element, selector) {
	const view = document.defaultView ?? window;
	const viewport = new DOMRect(0, 0, view.innerWidth, view.innerHeight);
	if (!selector) return viewport;
	const clip = element.closest(selector) ?? document.querySelector(selector);
	if (!clip) return viewport;
	return intersectDomRects$1(viewport, clip.getBoundingClientRect()) ?? viewport;
}
function intersectDomRects$1(a, b) {
	const left = Math.max(a.left, b.left);
	const top = Math.max(a.top, b.top);
	const right = Math.min(a.right, b.right);
	const bottom = Math.min(a.bottom, b.bottom);
	if (right <= left || bottom <= top) return null;
	return new DOMRect(left, top, right - left, bottom - top);
}
function rectForElement$1(element, clip) {
	const rect = intersectDomRects$1(element.getBoundingClientRect(), clip);
	if (!rect) return null;
	return {
		id: element.id || element.dataset["surfaceId"],
		left: rect.left,
		top: rect.top,
		width: rect.width,
		height: rect.height
	};
}
modifier((element, [targets], options) => {
	const document = element.ownerDocument;
	const view = document.defaultView ?? window;
	ensureStyles$1(document);
	const root = document.createElement("div");
	const z = SURFACE_LAYERS.allocate("selection");
	root.className = "bx-surface-selection-decal-layer";
	root.dataset["surfaceLayerTier"] = "selection";
	root.dataset["surfaceLayerZ"] = String(z);
	root.style.zIndex = String(z);
	document.body.append(root);
	let frame = 0;
	const render = () => {
		frame = 0;
		syncDecalThemeVariables$1(element, root);
		root.replaceChildren();
		if (options.active === false) return;
		const clip = clipRectFor$1(document, element, options.clipTo);
		const rects = targetSelectors(targets).map((selector) => document.querySelector(selector)).filter((target) => target !== null).map((target) => rectForElement$1(target, clip)).filter((rect) => rect !== null);
		const boxes = SURFACE_LAYERS.collapseSelectionBoxes(rects, { tolerance: options.tolerance });
		const variant = options.variant ?? "selection";
		for (const box of boxes) {
			const decal = document.createElement("div");
			decal.className = [
				"bx-surface-selection-decal",
				`bx-surface-selection-decal--${variant}`,
				options.className ?? ""
			].filter(Boolean).join(" ");
			decal.dataset["surfaceSelectionIds"] = box.ids.join(" ");
			decal.style.left = `${box.left}px`;
			decal.style.top = `${box.top}px`;
			decal.style.width = `${box.width}px`;
			decal.style.height = `${box.height}px`;
			root.append(decal);
		}
	};
	const schedule = () => {
		if (frame !== 0) return;
		frame = view.requestAnimationFrame(render);
	};
	schedule();
	view.addEventListener("scroll", schedule, true);
	view.addEventListener("resize", schedule);
	return () => {
		if (frame !== 0) view.cancelAnimationFrame(frame);
		view.removeEventListener("scroll", schedule, true);
		view.removeEventListener("resize", schedule);
		root.remove();
		SURFACE_LAYERS.release(z);
	};
});
var StyleId = "boxel-surface-decal-layer-styles";
var SVG_NS = "http://www.w3.org/2000/svg";
var DEFAULT_DECAL_STROKE_WIDTH = 2;
var DECAL_ZOOM_VARIABLE = "--surface-decal-zoom";
var DECAL_STROKE_WIDTH_VARIABLE = "--surface-decal-stroke-width";
var KIND_CLASS = { receiver: "drop-target" };
var DECAL_THEME_VARIABLES = [
	"--boxel-highlight",
	"--boxel-orange",
	"--boxel-lilac",
	"--boxel-lilac-lift",
	"--surface-decal-highlight",
	"--surface-decal-transfer",
	"--surface-decal-inspect",
	"--surface-decal-context",
	"--surface-decal-active-edit-bg",
	"--surface-decal-highlight-fill",
	"--surface-decal-highlight-fill-soft",
	"--surface-decal-transfer-fill",
	"--surface-decal-transfer-fill-soft",
	"--surface-decal-inspect-fill",
	"--surface-decal-context-fill",
	"--surface-decal-hover-fill"
];
function ensureStyles(document) {
	if (document.getElementById(StyleId)) return;
	const style = document.createElement("style");
	style.id = StyleId;
	style.textContent = `
    .bx-surface-decal-layer {
      position: fixed;
      inset: 0;
      pointer-events: none;
      contain: layout style;
      --surface-decal-stroke-width: 2px;
      --surface-decal-fine-stroke-width: max(1px, calc(var(--surface-decal-stroke-width) / 2));
      --surface-decal-halo-width: calc(var(--surface-decal-stroke-width) * 2);
      --surface-decal-inspect-halo-width: calc(var(--surface-decal-stroke-width) * 2.5);
    }

    .bx-surface-lift-decal-layer {
      position: fixed;
      inset: 0;
      pointer-events: none;
      contain: layout style;
      --surface-decal-stroke-width: 2px;
      --surface-decal-fine-stroke-width: max(1px, calc(var(--surface-decal-stroke-width) / 2));
      --surface-decal-halo-width: calc(var(--surface-decal-stroke-width) * 2);
      --surface-decal-inspect-halo-width: calc(var(--surface-decal-stroke-width) * 2.5);
    }

    .bx-surface-decal {
      position: fixed;
      box-sizing: border-box;
      pointer-events: none;
      border-radius: 2px;
      background: transparent;
    }

    .bx-surface-decal--focus,
    .bx-surface-decal--selection,
    .bx-surface-decal--lift-focus {
      border: var(--surface-decal-stroke-width) solid var(--surface-decal-highlight, #00ffba);
      box-shadow:
        0 0 0 var(--surface-decal-fine-stroke-width) color-mix(in srgb, var(--surface-decal-highlight, #00ffba) 22%, transparent),
        0 0 0 var(--surface-decal-halo-width) var(--surface-decal-highlight-fill, rgba(0, 255, 186, 0.18));
    }

    .bx-surface-decal--range {
      border: var(--surface-decal-stroke-width) solid var(--surface-decal-highlight, #00ffba);
      background: var(--surface-decal-highlight-fill-soft, rgba(0, 255, 186, 0.10));
      box-shadow:
        0 0 0 var(--surface-decal-fine-stroke-width) color-mix(in srgb, var(--surface-decal-highlight, #00ffba) 18%, transparent),
        0 0 0 var(--surface-decal-halo-width) var(--surface-decal-highlight-fill-soft, rgba(0, 255, 186, 0.10));
    }

    .bx-surface-decal--edit-anchor {
      border: var(--surface-decal-fine-stroke-width) solid color-mix(in srgb, var(--surface-decal-highlight, #00ffba) 32%, transparent);
      background: color-mix(in srgb, var(--surface-decal-highlight, #00ffba) 3%, transparent);
      box-shadow: 0 0 0 calc(var(--surface-decal-stroke-width) * 1.5) color-mix(in srgb, var(--surface-decal-highlight, #00ffba) 5%, transparent);
    }

    .bx-surface-decal--inspect {
      border: var(--surface-decal-stroke-width) solid var(--surface-decal-inspect, #a66dfa);
      box-shadow:
        0 0 0 var(--surface-decal-fine-stroke-width) color-mix(in srgb, var(--surface-decal-inspect, #a66dfa) 42%, transparent),
        0 0 0 var(--surface-decal-inspect-halo-width) var(--surface-decal-inspect-fill, rgba(166, 109, 250, 0.18)),
        0 0 18px color-mix(in srgb, var(--surface-decal-inspect, #a66dfa) 20%, transparent);
    }

    .bx-surface-decal--receiver,
    .bx-surface-decal--drop-target {
      border: var(--surface-decal-stroke-width) dashed var(--surface-decal-transfer, #ff7f00);
      background: var(--surface-decal-transfer-fill-soft, rgba(255, 127, 0, 0.08));
      box-shadow: 0 0 0 var(--surface-decal-halo-width) var(--surface-decal-transfer-fill, rgba(255, 127, 0, 0.16));
    }

    .bx-surface-decal--source,
    .bx-surface-decal--origin {
      border: var(--surface-decal-stroke-width) dashed var(--surface-decal-transfer, #ff7f00);
      background: var(--surface-decal-transfer-fill, rgba(255, 127, 0, 0.16));
      box-shadow: 0 0 0 calc(var(--surface-decal-stroke-width) * 1.5) var(--surface-decal-transfer-fill, rgba(255, 127, 0, 0.16));
    }

    .bx-surface-decal--destination {
      border: var(--surface-decal-stroke-width) solid var(--surface-decal-transfer, #ff7f00);
      background: var(--surface-decal-transfer-fill, rgba(255, 127, 0, 0.16));
      box-shadow: 0 0 0 var(--surface-decal-halo-width) var(--surface-decal-transfer-fill-soft, rgba(255, 127, 0, 0.08));
    }

    .bx-surface-decal--context,
    .bx-surface-decal--hover {
      border: var(--surface-decal-fine-stroke-width) solid color-mix(in srgb, var(--surface-decal-context, #919191) 22%, transparent);
      background: var(--surface-decal-context-fill, rgba(0, 0, 0, 0.04));
      opacity: 0.72;
    }

    .bx-surface-decal--hover {
      background: var(--surface-decal-hover-fill, rgba(0, 0, 0, 0.04));
    }

    .bx-surface-decal-path-svg {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      overflow: visible;
      pointer-events: none;
      contain: layout style;
    }

    .bx-surface-decal-path {
      fill: none;
      stroke: var(--surface-decal-highlight, #00ffba);
      stroke-width: var(--surface-decal-stroke-width);
      vector-effect: non-scaling-stroke;
      filter: drop-shadow(0 0 var(--surface-decal-halo-width) var(--surface-decal-highlight-fill, rgba(0, 255, 186, 0.18)));
    }

    .bx-surface-decal-path--inspect {
      stroke: var(--surface-decal-inspect, #a66dfa);
      filter: drop-shadow(0 0 var(--surface-decal-inspect-halo-width) var(--surface-decal-inspect-fill, rgba(166, 109, 250, 0.18)));
    }

    .bx-surface-decal-path--receiver,
    .bx-surface-decal-path--drop-target,
    .bx-surface-decal-path--source,
    .bx-surface-decal-path--origin,
    .bx-surface-decal-path--destination {
      stroke: var(--surface-decal-transfer, #ff7f00);
      stroke-dasharray: 6 4;
      filter: drop-shadow(0 0 var(--surface-decal-halo-width) var(--surface-decal-transfer-fill, rgba(255, 127, 0, 0.16)));
    }
  `;
	document.head.append(style);
}
function syncDecalThemeVariables(source, target) {
	const styles = source.ownerDocument.defaultView?.getComputedStyle(source);
	if (!styles) return;
	for (const name of DECAL_THEME_VARIABLES) {
		const value = styles.getPropertyValue(name).trim();
		if (value) target.style.setProperty(name, value);
	}
}
function syncDecalStrokeWidth(source, runtime, ...targets) {
	const styles = source.ownerDocument.defaultView?.getComputedStyle(source);
	if (!styles) return;
	const explicitStroke = parsePositiveNumber(styles.getPropertyValue(DECAL_STROKE_WIDTH_VARIABLE));
	const zoom = runtime?.viewport.zoom ?? parsePositiveNumber(styles.getPropertyValue(DECAL_ZOOM_VARIABLE)) ?? 1;
	const strokeWidth = explicitStroke ?? Math.max(DEFAULT_DECAL_STROKE_WIDTH / zoom, 1);
	const rounded = Math.round(strokeWidth * 1e3) / 1e3;
	for (const target of targets) target.style.setProperty(DECAL_STROKE_WIDTH_VARIABLE, `${rounded}px`);
}
function parsePositiveNumber(value) {
	const parsed = Number.parseFloat(value.trim());
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function clipRectFor(document, element, clip) {
	const view = document.defaultView ?? window;
	const viewport = new DOMRect(0, 0, view.innerWidth, view.innerHeight);
	if (clip === "none") return null;
	if (clip === "viewport") return viewport;
	return intersectDomRects(viewport, element.getBoundingClientRect()) ?? viewport;
}
function intersectDomRects(a, b) {
	const left = Math.max(a.left, b.left);
	const top = Math.max(a.top, b.top);
	const right = Math.min(a.right, b.right);
	const bottom = Math.min(a.bottom, b.bottom);
	if (right <= left || bottom <= top) return null;
	return new DOMRect(left, top, right - left, bottom - top);
}
function sourceRectForElement(element) {
	const elementRect = element.getBoundingClientRect();
	return elementRect.width > 0 && elementRect.height > 0 ? elementRect : descendantFallbackRectForElement(element);
}
function radiusSourceForElement(element) {
	const elementRect = element.getBoundingClientRect();
	if (elementRect.width > 0 && elementRect.height > 0) return element;
	if (!allowsDescendantRectFallback(element)) return element;
	let best = null;
	let bestArea = 0;
	for (const descendant of element.querySelectorAll("*")) {
		const rect = descendant.getBoundingClientRect();
		const area = rect.width * rect.height;
		if (rect.width <= 0 || rect.height <= 0 || area <= bestArea) continue;
		best = descendant;
		bestArea = area;
	}
	return best ?? element;
}
function cornerRadiiForElement(element, rect) {
	const styles = element.ownerDocument.defaultView?.getComputedStyle(element);
	if (!styles) return void 0;
	const width = rect.width;
	const height = rect.height;
	const max = Math.max(0, Math.min(width, height) / 2);
	return {
		topLeft: clampDecalRadius(parseRadius(styles.borderTopLeftRadius, width, height), max),
		topRight: clampDecalRadius(parseRadius(styles.borderTopRightRadius, width, height), max),
		bottomRight: clampDecalRadius(parseRadius(styles.borderBottomRightRadius, width, height), max),
		bottomLeft: clampDecalRadius(parseRadius(styles.borderBottomLeftRadius, width, height), max)
	};
}
function parseRadius(value, width, height) {
	const token = value.trim().split(/\s+/)[0] ?? "";
	if (token.endsWith("px")) {
		const parsed = Number.parseFloat(token);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	if (token.endsWith("%")) {
		const parsed = Number.parseFloat(token);
		return Number.isFinite(parsed) ? Math.min(width, height) * (parsed / 100) : 0;
	}
	const parsed = Number.parseFloat(token);
	return Number.isFinite(parsed) ? parsed : 0;
}
function clampDecalRadius(value, max) {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(value, max));
}
function cornerRadiiCss(radius) {
	if (!radius) return "";
	return [
		radius.topLeft,
		radius.topRight,
		radius.bottomRight,
		radius.bottomLeft
	].map((value) => `${Math.round(value * 100) / 100}px`).join(" ");
}
function hasMeaningfulVisibleArea(clipped, source) {
	const minWidth = Math.min(8, source.width);
	const minHeight = Math.min(8, source.height);
	return clipped.width >= minWidth && clipped.height >= minHeight;
}
function rectForElement(element) {
	const sourceRect = sourceRectForElement(element);
	if (!sourceRect) return null;
	const radiusElement = radiusSourceForElement(element);
	return {
		id: element.getAttribute("data-ladder-id") ?? element.dataset["bxGridTraversalId"] ?? element.id,
		left: sourceRect.left,
		top: sourceRect.top,
		width: sourceRect.width,
		height: sourceRect.height,
		radius: cornerRadiiForElement(radiusElement, sourceRect)
	};
}
function decalShapeForTarget(element) {
	const explicit = element.getAttribute("data-surface-decal-shape");
	if (explicit === "rect" || explicit === "path" || explicit === "none") return explicit;
	if (element.classList.contains("boxel-canvas__edge") || element.getAttribute("data-surface-component") === "edge" || element.hasAttribute("data-surface-canvas-edge")) return "path";
	return "rect";
}
function pathForElement(element) {
	if (element instanceof SVGPathElement) return element;
	return element.querySelector("[data-surface-decal-path], .boxel-canvas__edge-path, path:not(.boxel-canvas__edge-interaction)");
}
function hiddenReasonForElement(element, clip) {
	const sourceRect = sourceRectForElement(element);
	if (!sourceRect) return "missing-layout";
	return intersectDomRects(sourceRect, clip) ? null : "offscreen-or-clipped";
}
function descendantFallbackRectForElement(element) {
	if (!allowsDescendantRectFallback(element)) return null;
	return descendantUnionRect(element);
}
function allowsDescendantRectFallback(element) {
	const surface = element.getAttribute("data-surface") ?? element.getAttribute("data-surface-component");
	return surface === "cell" || surface === "run" || surface === "unit";
}
function descendantUnionRect(element) {
	let left = Number.POSITIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;
	let found = false;
	for (const descendant of element.querySelectorAll("*")) {
		const rect = descendant.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) continue;
		left = Math.min(left, rect.left);
		top = Math.min(top, rect.top);
		right = Math.max(right, rect.right);
		bottom = Math.max(bottom, rect.bottom);
		found = true;
	}
	return found ? new DOMRect(left, top, right - left, bottom - top) : null;
}
function parsePixelValue(value) {
	const trimmed = value.trim();
	if (!trimmed.endsWith("px")) return null;
	const parsed = Number.parseFloat(trimmed);
	return Number.isFinite(parsed) ? parsed : null;
}
function rectForFixedLiftElement(element, clip) {
	if (element.style.position !== "fixed") return null;
	const left = parsePixelValue(element.style.left);
	const top = parsePixelValue(element.style.top);
	if (left === null || top === null) return null;
	const measured = element.getBoundingClientRect();
	const width = measured.width || element.offsetWidth;
	const height = measured.height || element.offsetHeight;
	if (width <= 0 || height <= 0) return null;
	const rect = intersectDomRects(new DOMRect(left, top, width, height), clip);
	if (!rect) return null;
	return {
		id: element.getAttribute("data-ladder-id") ?? element.dataset["bxGridTraversalId"] ?? element.id,
		left: rect.left,
		top: rect.top,
		width: rect.width,
		height: rect.height
	};
}
function rectForLiftElement(element, clip) {
	return rectForFixedLiftElement(element, clip) ?? rectForElement(element);
}
function topmostKeyboardLift(document) {
	return Array.from(document.querySelectorAll("[data-bx-lift][data-bx-lift-keyboard-lock=\"true\"]")).filter((lift) => lift.isConnected).sort((a, b) => {
		const za = Number(a.dataset["surfaceLayerZ"] ?? 0);
		return Number(b.dataset["surfaceLayerZ"] ?? 0) - za;
	})[0] ?? null;
}
function liftAnchorElement(lift) {
	const selector = lift.getAttribute("data-bx-lift-anchor-selector");
	if (!selector) return null;
	try {
		return lift.ownerDocument.querySelector(selector);
	} catch {
		return null;
	}
}
function liftUsesShadowFocus(lift) {
	const kind = lift.getAttribute("data-bx-lift-kind");
	return kind === "edit" || kind === "tools";
}
function mutationInsideDecalLayer(target, root, liftRoot) {
	return target === root || target === liftRoot || target instanceof Node && (root.contains(target) || liftRoot.contains(target));
}
function nodeContainsLift(node) {
	return node instanceof HTMLElement && (node.matches("[data-bx-lift]") || node.querySelector("[data-bx-lift]") !== null);
}
function mutationAffectsLiftLayer(mutation, root, liftRoot) {
	if (mutationInsideDecalLayer(mutation.target, root, liftRoot)) return false;
	if (mutation.type === "attributes") return mutation.target instanceof HTMLElement && (mutation.target.matches("[data-bx-lift]") || mutation.target.closest("[data-bx-lift]") !== null);
	for (const node of [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)]) if (nodeContainsLift(node)) return true;
	return false;
}
function renderLiftFocusDecal(document, root) {
	root.replaceChildren();
	const lift = topmostKeyboardLift(document);
	if (!lift) {
		root.style.zIndex = "";
		return null;
	}
	if (liftUsesShadowFocus(lift)) {
		root.style.zIndex = "";
		return {
			lift,
			anchor: liftAnchorElement(lift),
			anchorDecal: true
		};
	}
	const rect = rectForLiftElement(lift, clipRectFor(document, lift, "viewport"));
	if (!rect) {
		root.style.zIndex = "";
		return {
			lift,
			anchor: liftAnchorElement(lift),
			anchorDecal: true
		};
	}
	const liftZ = Number(lift.dataset["surfaceLayerZ"] ?? 0);
	if (Number.isFinite(liftZ) && liftZ > 0) root.style.zIndex = String(liftZ + 1);
	const decal = document.createElement("div");
	decal.className = "bx-surface-decal bx-surface-decal--lift-focus";
	decal.dataset["surfaceDecalKind"] = "lift-focus";
	decal.dataset["surfaceDecalIds"] = lift.getAttribute("id") ?? lift.getAttribute("data-bx-lift-focus-token") ?? "active-lift";
	decal.style.left = `${rect.left}px`;
	decal.style.top = `${rect.top}px`;
	decal.style.width = `${rect.width}px`;
	decal.style.height = `${rect.height}px`;
	decal.style.borderRadius = cornerRadiiCss(cornerRadiiForElement(lift, rect)) || getComputedStyle(lift).borderRadius || "10px";
	root.append(decal);
	return {
		lift,
		anchor: liftAnchorElement(lift),
		anchorDecal: true
	};
}
function renderLiftAnchorDecal(document, root, state) {
	if (!state?.anchor || !state.anchorDecal) return;
	const rect = rectForElement(state.anchor);
	if (!rect) return;
	const decal = document.createElement("div");
	decal.className = "bx-surface-decal bx-surface-decal--edit-anchor";
	decal.dataset["surfaceDecalKind"] = "edit-anchor";
	decal.dataset["surfaceDecalLiftAnchor"] = "true";
	decal.dataset["surfaceDecalIds"] = state.anchor.getAttribute("data-ladder-id") ?? state.anchor.dataset["bxGridTraversalId"] ?? state.anchor.id ?? "lift-anchor";
	decal.style.left = `${rect.left}px`;
	decal.style.top = `${rect.top}px`;
	decal.style.width = `${rect.width}px`;
	decal.style.height = `${rect.height}px`;
	decal.style.borderRadius = cornerRadiiCss(rect.radius);
	root.append(decal);
}
function decalCompetesWithLiftAnchor(kind, targets, state) {
	if (!state?.anchor) return false;
	if (kind !== "focus" && kind !== "selection" && kind !== "source" && kind !== "range") return false;
	return targets.includes(state.anchor);
}
function modeFor(element, options) {
	if (options.mode) return options.mode;
	const raw = element.closest("[data-surface-mode]")?.dataset["surfaceMode"];
	if (raw === "use" || raw === "change" || raw === "inspect" || raw === "debug") return raw;
	return "use";
}
function decalsFor(element, options) {
	if (options.projection) return options.projection.visualDecals;
	return (options.runtime ?? surfaceRuntimeForElement(element))?.projection(projectionOptionsFor(element, options)).visualDecals ?? [];
}
function projectionOptionsFor(element, options) {
	const projectionOptions = { mode: modeFor(element, options) };
	if (options.rootId !== void 0) projectionOptions.rootId = options.rootId;
	return projectionOptions;
}
function classForKind(kind) {
	return KIND_CLASS[kind] ?? kind;
}
var surfaceDecalLayer = modifier((element, _positional, options) => {
	const document = element.ownerDocument;
	const view = document.defaultView ?? window;
	ensureStyles(document);
	const root = document.createElement("div");
	const liftRoot = document.createElement("div");
	const z = SURFACE_LAYERS.allocate("selection");
	root.className = "bx-surface-decal-layer";
	root.dataset["surfaceLayerTier"] = "selection";
	root.dataset["surfaceLayerZ"] = String(z);
	root.style.zIndex = String(z);
	options.scopeRelay?.stamp(root);
	document.body.append(root);
	liftRoot.className = "bx-surface-lift-decal-layer";
	liftRoot.dataset["surfaceLayerTier"] = "lift-focus";
	options.scopeRelay?.stamp(liftRoot);
	document.body.append(liftRoot);
	let frame = 0;
	let retryCount = 0;
	let subscribedRuntime = options.runtime ?? surfaceRuntimeForElement(element);
	let unsubscribeRuntimeSelection;
	let unsubscribeRuntimeViewport;
	const renderedDecals = /* @__PURE__ */ new Map();
	const removeLiftAnchorDecals = () => {
		for (const decal of root.querySelectorAll("[data-surface-decal-lift-anchor=\"true\"]")) decal.remove();
	};
	const clearRootDecals = () => {
		for (const decal of renderedDecals.values()) decal.remove();
		renderedDecals.clear();
		removeLiftAnchorDecals();
	};
	const upsertRectDecal = (key, decalModel, box) => {
		const existing = renderedDecals.get(key);
		if (existing && !(existing instanceof HTMLElement)) {
			existing.remove();
			renderedDecals.delete(key);
		}
		let decal = renderedDecals.get(key);
		if (!decal) {
			decal = document.createElement("div");
			renderedDecals.set(key, decal);
			root.append(decal);
		}
		const kindClass = classForKind(decalModel.kind);
		decal.className = [
			"bx-surface-decal",
			`bx-surface-decal--${decalModel.kind}`,
			kindClass !== decalModel.kind ? `bx-surface-decal--${kindClass}` : "",
			options.className ?? ""
		].filter(Boolean).join(" ");
		decal.dataset["surfaceDecalKey"] = key;
		decal.dataset["surfaceDecalKind"] = decalModel.kind;
		decal.dataset["surfaceDecalIds"] = box.ids.join(" ");
		decal.style.left = `${box.left}px`;
		decal.style.top = `${box.top}px`;
		decal.style.width = `${box.width}px`;
		decal.style.height = `${box.height}px`;
		decal.style.borderRadius = cornerRadiiCss(box.radius);
	};
	const upsertPathDecal = (key, decalModel, target) => {
		const sourcePath = pathForElement(target);
		const matrix = sourcePath?.getScreenCTM();
		const d = sourcePath?.getAttribute("d");
		if (!sourcePath || !matrix || !d) return false;
		const existing = renderedDecals.get(key);
		if (existing && !(existing instanceof SVGSVGElement)) {
			existing.remove();
			renderedDecals.delete(key);
		}
		let svg = renderedDecals.get(key);
		if (!svg) {
			svg = document.createElementNS(SVG_NS, "svg");
			renderedDecals.set(key, svg);
			root.append(svg);
		}
		const kindClass = classForKind(decalModel.kind);
		svg.setAttribute("class", ["bx-surface-decal-path-svg", options.className ?? ""].filter(Boolean).join(" "));
		svg.setAttribute("aria-hidden", "true");
		svg.dataset["surfaceDecalKey"] = key;
		svg.dataset["surfaceDecalKind"] = decalModel.kind;
		svg.dataset["surfaceDecalIds"] = decalModel.ids.join(" ");
		svg.replaceChildren();
		const path = document.createElementNS(SVG_NS, "path");
		path.setAttribute("class", [
			"bx-surface-decal-path",
			`bx-surface-decal-path--${decalModel.kind}`,
			kindClass !== decalModel.kind ? `bx-surface-decal-path--${kindClass}` : ""
		].filter(Boolean).join(" "));
		path.setAttribute("d", d);
		path.setAttribute("transform", `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`);
		svg.append(path);
		return true;
	};
	const removeStaleDecals = (nextKeys) => {
		for (const [key, decal] of renderedDecals) {
			if (nextKeys.has(key)) continue;
			decal.remove();
			renderedDecals.delete(key);
		}
	};
	const syncSubscriptions = () => {
		const nextRuntime = options.runtime ?? surfaceRuntimeForElement(element);
		if (nextRuntime !== subscribedRuntime) {
			unsubscribeRuntimeSelection?.();
			unsubscribeRuntimeViewport?.();
			unsubscribeRuntimeSelection = void 0;
			unsubscribeRuntimeViewport = void 0;
			subscribedRuntime = nextRuntime;
			unsubscribeRuntimeSelection = subscribedRuntime?.subscribeSelection(schedule);
			unsubscribeRuntimeViewport = subscribedRuntime?.subscribeViewport(schedule);
		}
		return subscribedRuntime;
	};
	const render = () => {
		frame = 0;
		options.scopeRelay?.stamp(root);
		options.scopeRelay?.stamp(liftRoot);
		syncDecalThemeVariables(element, root);
		syncDecalThemeVariables(element, liftRoot);
		root.dataset["surfaceDecalActive"] = String(options.active !== false);
		if (options.active === false) {
			clearRootDecals();
			liftRoot.replaceChildren();
			liftRoot.style.zIndex = "";
			return;
		}
		removeLiftAnchorDecals();
		const activeLift = renderLiftFocusDecal(document, liftRoot);
		renderLiftAnchorDecal(document, root, activeLift);
		const runtime = syncSubscriptions();
		syncDecalStrokeWidth(element, runtime, root, liftRoot);
		const clip = clipRectFor(document, element, options.clip ?? "none");
		const diagnosticClip = clip ?? clipRectFor(document, element, "viewport");
		const kindFilter = options.kinds ? new Set(options.kinds) : null;
		const decals = decalsFor(element, options);
		let targetCount = 0;
		let measuredTargetCount = 0;
		let hiddenTargetCount = 0;
		let boxCount = 0;
		root.dataset["surfaceDecalModelCount"] = String(decals.length);
		root.dataset["surfaceDecalRuntime"] = runtime ? "ready" : "missing";
		delete root.dataset["surfaceDecalFirstTargetRect"];
		delete root.dataset["surfaceDecalFirstHiddenReason"];
		if (!runtime && retryCount < 30) {
			retryCount += 1;
			schedule();
			return;
		}
		retryCount = 0;
		const nextDecalKeys = /* @__PURE__ */ new Set();
		const kindIndexes = /* @__PURE__ */ new Map();
		for (const decalModel of decals) {
			if (kindFilter && !kindFilter.has(decalModel.kind)) continue;
			const targets = surfaceElementsForIds(element, decalModel.ids, runtime);
			if (decalCompetesWithLiftAnchor(decalModel.kind, targets, activeLift)) continue;
			targetCount += targets.length;
			const firstTarget = targets[0];
			if (firstTarget && root.dataset["surfaceDecalFirstTargetRect"] === void 0) {
				const rect = firstTarget.getBoundingClientRect();
				root.dataset["surfaceDecalFirstTargetRect"] = [
					Math.round(rect.left),
					Math.round(rect.top),
					Math.round(rect.width),
					Math.round(rect.height)
				].join(" ");
			}
			const rects = [];
			let pathCount = 0;
			for (const target of targets) {
				const shape = decalShapeForTarget(target);
				if (shape === "none") continue;
				if (shape === "path") {
					const key = `${decalModel.kind}:path:${pathCount}`;
					if (upsertPathDecal(key, decalModel, target)) {
						nextDecalKeys.add(key);
						pathCount += 1;
						measuredTargetCount += 1;
						continue;
					}
				}
				const rect = rectForElement(target);
				if (rect) {
					measuredTargetCount += 1;
					const visibleRect = clip ? clipSurfaceLayerRect(rect, clip) : rect;
					if (visibleRect && hasMeaningfulVisibleArea(visibleRect, rect)) {
						rects.push(visibleRect);
						continue;
					}
					hiddenTargetCount += 1;
					root.dataset["surfaceDecalFirstHiddenReason"] ??= diagnosticClip ? hiddenReasonForElement(target, diagnosticClip) ?? "offscreen-or-clipped" : "offscreen-or-clipped";
					continue;
				}
				hiddenTargetCount += 1;
				root.dataset["surfaceDecalFirstHiddenReason"] ??= diagnosticClip ? hiddenReasonForElement(target, diagnosticClip) ?? "unknown" : "unknown";
			}
			const boxes = SURFACE_LAYERS.collapseSelectionBoxes(rects, { tolerance: options.tolerance });
			boxCount += boxes.length;
			for (const box of boxes) {
				const index = kindIndexes.get(decalModel.kind) ?? 0;
				kindIndexes.set(decalModel.kind, index + 1);
				const key = `${decalModel.kind}:${index}`;
				nextDecalKeys.add(key);
				upsertRectDecal(key, decalModel, box);
			}
		}
		removeStaleDecals(nextDecalKeys);
		root.dataset["surfaceDecalTargetCount"] = String(targetCount);
		root.dataset["surfaceDecalMeasuredTargetCount"] = String(measuredTargetCount);
		root.dataset["surfaceDecalHiddenTargetCount"] = String(hiddenTargetCount);
		root.dataset["surfaceDecalBoxCount"] = String(boxCount);
	};
	const schedule = () => {
		if (frame !== 0) return;
		frame = view.requestAnimationFrame(render);
	};
	unsubscribeRuntimeSelection = subscribedRuntime?.subscribeSelection(schedule);
	unsubscribeRuntimeViewport = subscribedRuntime?.subscribeViewport(schedule);
	schedule();
	element.addEventListener(SURFACE_GEOMETRY_CHANGE_EVENT, schedule);
	view.addEventListener("scroll", schedule, true);
	view.addEventListener("resize", schedule);
	const liftObserver = new MutationObserver((mutations) => {
		if (mutations.some((mutation) => mutationAffectsLiftLayer(mutation, root, liftRoot))) schedule();
	});
	liftObserver.observe(document.body, {
		attributes: true,
		attributeFilter: [
			"data-bx-lift",
			"data-bx-lift-keyboard-lock",
			"data-surface-layer-z",
			"data-bx-lift-anchor-selector"
		],
		childList: true,
		subtree: true
	});
	return () => {
		if (frame !== 0) view.cancelAnimationFrame(frame);
		unsubscribeRuntimeSelection?.();
		unsubscribeRuntimeViewport?.();
		liftObserver.disconnect();
		element.removeEventListener(SURFACE_GEOMETRY_CHANGE_EVENT, schedule);
		view.removeEventListener("scroll", schedule, true);
		view.removeEventListener("resize", schedule);
		clearRootDecals();
		root.remove();
		liftRoot.remove();
		SURFACE_LAYERS.release(z);
	};
});
var _class$8, _descriptor$7;
/** What the host needs to know about the open lift. Three fields:
*  WHICH unit (row, col coordinates), WHICH kind, and the implicit
*  "is anything open" derived from `target !== null`.
*
*  `row` / `col` are intentionally generic: a grid uses (rowIdx,
*  colIdx); a canvas uses (nodeRow, nodeField); a kanban could use
*  (laneIdx, cardIdx). The state doesn't care what they mean — only
*  that the pair uniquely identifies the unit so the
*  `anchorSelectorFor` callback can resolve a DOM element. */
/** The open-lift state machine. See module docstring. */
var LiftState = (_class$8 = class LiftState {
	constructor(opts = {}) {
		/** The currently-open lift's `(row, col, kind)`, or null when no
		*  lift is open. Tracked so templates re-render on transitions
		*  (open → close, kind change, target change). */
		_initializerDefineProperty$1(this, "target", _descriptor$7, this);
		_defineProperty$1(this, "hoverTimer", null);
		_defineProperty$1(this, "dismissTimer", null);
		/** Timestamp of the most-recent explicit close (commit / cancel /
		*  dismiss). `scheduleHoverDetails` checks this against `dismissCooldownMs`
		*  to suppress immediate re-opens. Without this, closing an EDIT lift
		*  (the cursor is still over the source cell because the lift was
		*  covering it) would trigger pointerenter on the cell underneath
		*  → schedule hover details → 500ms later a details lift pops open
		*  the user didn't ask for. */
		_defineProperty$1(this, "lastClosedAt", 0);
		_defineProperty$1(this, "opts", void 0);
		/** Open the details lift on (row, col). Cancels any pending
		*  hover-open or dismiss timers. Idempotent — calling on the
		*  already-open unit is a no-op. */
		_defineProperty$1(this, "openDetails", (row, col) => {
			this.cancelHoverTimer();
			this.cancelDismissTimer();
			this.target = {
				row,
				col,
				kind: "details"
			};
		});
		/** Open the edit lift on (row, col). Cancels any pending hover /
		*  dismiss timers. The host typically calls this from explicit
		*  edit gestures (chevron click, dblclick, Enter, F2). Idempotent. */
		_defineProperty$1(this, "openEdit", (row, col) => {
			this.openLift(row, col, "edit");
		});
		/** Open the tools lift on (row, col). Tools lifts host action
		*  menus / command palettes — see the `actions` widget. Same
		*  dispatch shape as openEdit; the host picks which to call based
		*  on the unit's negotiated `contract.lift` (tools-only widgets
		*  go through this path). */
		_defineProperty$1(this, "openTools", (row, col) => {
			this.openLift(row, col, "tools");
		});
		/** Generic open-by-kind. Hosts that want to dispatch dynamically
		*  from `contract.lift` (e.g. "open whichever kind the widget
		*  declared most-escalated") call this directly:
		*
		*    const kind = contract.lift[contract.lift.length - 1];
		*    if (kind) this.liftState.openLift(rowIdx, colIdx, kind);
		*
		*  Adding a new lift kind to the system becomes a one-line change
		*  on the widget side (declare the cap), the contract side (cap →
		*  lift kind in the negotiator), and the lift CSS side (a
		*  `.bx-lift--<kind>` rule). No new method to wire on LiftState,
		*  no new dispatch branch in the host. `openEdit` / `openTools` /
		*  `openDetails` stay as named conveniences for callers that
		*  always know the kind statically. */
		_defineProperty$1(this, "openLift", (row, col, kind) => {
			this.cancelHoverTimer();
			this.cancelDismissTimer();
			this.target = {
				row,
				col,
				kind
			};
		});
		/** Schedule details to open on (row, col) after the hover pause.
		*  Bails out if the unit's contract doesn't list `'details'` in
		*  `lift[]`, or if an edit lift is already open (the user is
		*  committed to editing — no peeks). The companion modifier
		*  calls this on `pointerenter`. */
		_defineProperty$1(this, "scheduleHoverDetails", (row, col, contract) => {
			if (!contract.lift.includes("details")) return;
			if (this.target?.kind === "edit") return;
			if (this.lastClosedAt > 0 && Date.now() - this.lastClosedAt < this.opts.dismissCooldownMs) return;
			this.cancelHoverTimer();
			this.cancelDismissTimer();
			this.hoverTimer = setTimeout(() => {
				this.hoverTimer = null;
				if (this.target?.kind === "edit") return;
				this.target = {
					row,
					col,
					kind: "details"
				};
			}, this.opts.hoverPauseMs);
		});
		/** Cancel a pending hover-to-details timer; if a details lift IS
		*  open, schedule a dismiss after the grace window. Used by both
		*  source-pointerleave and lift-pointerleave — the dismiss only
		*  fires if neither the source nor the lift cancels it via
		*  `cancelDismiss()` first. */
		_defineProperty$1(this, "scheduleDismissDetails", () => {
			this.cancelHoverTimer();
			if (this.target?.kind !== "details") return;
			this.cancelDismissTimer();
			this.dismissTimer = setTimeout(() => {
				this.dismissTimer = null;
				if (this.target?.kind === "details") this.target = null;
			}, this.opts.dismissGraceMs);
		});
		/** Cancel a pending dismiss — pointer entered the lift element
		*  before the grace expired, so the user is reading the details. */
		_defineProperty$1(this, "cancelDismiss", () => {
			this.cancelDismissTimer();
		});
		/** Switch the open lift's kind without closing it. Same anchor,
		*  different content — the `<Lift>` re-renders its body without
		*  unmounting. Used for details ↔ edit escalation from inside
		*  the lift body or its toolbar. No-op if no lift is open. */
		_defineProperty$1(this, "escalate", (kind) => {
			if (!this.target) return;
			this.target = {
				...this.target,
				kind
			};
		});
		/** Close the lift. Cancels all pending timers. Used for explicit
		*  dismissals (Esc, click-out, commit, cancel). Stamps `lastClosedAt`
		*  so `scheduleHoverDetails` can suppress immediate hover re-opens
		*  (the cursor is still over the source cell because the lift was
		*  covering it; the unmount triggers a synthetic pointerenter). */
		_defineProperty$1(this, "close", () => {
			this.cancelHoverTimer();
			this.cancelDismissTimer();
			this.target = null;
			this.lastClosedAt = Date.now();
		});
		this.opts = {
			anchorSelectorFor: opts.anchorSelectorFor ?? defaultAnchorSelectorFor,
			hoverPauseMs: opts.hoverPauseMs ?? 500,
			dismissGraceMs: opts.dismissGraceMs ?? 200,
			dismissCooldownMs: opts.dismissCooldownMs ?? 600
		};
	}
	/** True when any lift is open (any unit, any kind). */
	get isOpen() {
		return this.target !== null;
	}
	/** The open lift's kind, or null if nothing is open. Templates
	*  use this to switch between Details and Edit content. */
	get kind() {
		return this.target?.kind ?? null;
	}
	/** Velcro anchor selector for the open lift, or `''` if nothing
	*  is open. Pass directly to
	*  `<Lift @anchor={{state.anchorSelector}}>`. */
	get anchorSelector() {
		if (!this.target) return "";
		return this.opts.anchorSelectorFor(this.target.row, this.target.col);
	}
	/** True if the lift is open AND it points at this exact unit.
	*  Used by per-unit chrome (e.g., `<LiftChevron>`) that needs to
	*  know "is the lift open on ME, specifically." */
	isOpenFor(row, col) {
		return this.target !== null && this.target.row === row && this.target.col === col;
	}
	/** Cancel any pending timers. Hosts call this from `willDestroy()`
	*  to keep teardown tidy. Safe to call multiple times. */
	destroy() {
		this.cancelHoverTimer();
		this.cancelDismissTimer();
	}
	cancelHoverTimer() {
		if (this.hoverTimer != null) {
			clearTimeout(this.hoverTimer);
			this.hoverTimer = null;
		}
	}
	cancelDismissTimer() {
		if (this.dismissTimer != null) {
			clearTimeout(this.dismissTimer);
			this.dismissTimer = null;
		}
	}
}, _descriptor$7 = _applyDecoratedDescriptor$1(_class$8.prototype, "target", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return null;
	}
}), _class$8);
/** Default anchor selector — every host's body unit stamps
*  `data-row="N"` and `data-col="N"`. Override via
*  `LiftStateOptions.anchorSelectorFor` when the host scopes by id
*  (multiple grids on one page, multiple canvases stacked) or uses
*  a different attribute scheme. */
function defaultAnchorSelectorFor(row, col) {
	return `[data-row="${row}"][data-col="${col}"]`;
}
/** Factory — mirrors `createFocusLadder()`. Use as a class field
*  in your host component:
*
*    liftState = createLiftState({
*      anchorSelectorFor: (r, c) =>
*        `[data-bx-grid="t1"] [data-row="${r}"][data-col="${c}"]`,
*    });
*
*  The instance is reactive — templates that read `state.target /
*  kind / isOpen / anchorSelector` re-render on transitions. */
function createLiftState(opts = {}) {
	return new LiftState(opts);
}
//#endregion
//#region packages/boxel-grid/dist/index.js
function _applyDecoratedDescriptor(i, e, r, n, l) {
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
function _initializerDefineProperty(e, i, r, l) {
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
var _class$7, _descriptor$6;
/**
* Ember adapter for TanStack Table.
*
* Models the lit-table `TableController` shape — owns the underlying
* `@tanstack/table-core` instance and bridges its store subscriptions into
* Glimmer's tracked reactivity via a single `@tracked` notifier integer.
*
* Usage:
*
* ```gts
* export default class MyGrid extends Component {
*   controller = new TableController(this);
*
*   get table() {
*     return this.controller.table({
*       data,
*       columns,
*       _rowModels: { coreRowModel: createCoreRowModel() },
*     });
*   }
* }
* ```
*/
var TableController = (_class$7 = class TableController {
	constructor(owner) {
		_initializerDefineProperty(this, "notifier", _descriptor$6, this);
		_defineProperty(this, "_table", null);
		_defineProperty(this, "_storeUnsub", void 0);
		_defineProperty(this, "_optionsUnsub", void 0);
		_defineProperty(this, "_scheduled", false);
		_defineProperty(this, "_lastStateJson", "");
		_defineProperty(this, "_lastColumns", null);
		_defineProperty(this, "_lastData", null);
		_defineProperty(this, "_pendingOpts", null);
		registerDestructor(owner, () => this.destroy());
	}
	table(tableOptions) {
		this.notifier;
		if (!this._table) {
			const reactivityFeature = constructReactivityFeature({
				stateNotifier: () => this.notifier,
				optionsNotifier: () => this.notifier
			});
			const merged = {
				...tableOptions,
				_features: {
					...tableOptions._features,
					emberReactivityFeature: reactivityFeature
				},
				mergeOptions: (defaults, next) => ({
					...defaults,
					...next
				})
			};
			this._table = constructTable(merged);
			this._lastStateJson = stableStringify(tableOptions.state ?? {});
			this._lastColumns = tableOptions.columns;
			this._lastData = tableOptions.data;
			scheduleOnce("afterRender", this, this._setupSubscriptions);
		} else {
			const stateJson = stableStringify(tableOptions.state ?? {});
			const columnsChanged = tableOptions.columns !== this._lastColumns;
			const dataChanged = tableOptions.data !== this._lastData;
			if (stateJson !== this._lastStateJson || columnsChanged || dataChanged) {
				this._lastStateJson = stateJson;
				this._lastColumns = tableOptions.columns;
				this._lastData = tableOptions.data;
				this._pendingOpts = tableOptions;
				scheduleOnce("afterRender", this, this._applyPendingOpts);
			}
		}
		return this._table;
	}
	bump() {
		if (this._scheduled) return;
		this._scheduled = true;
		scheduleOnce("afterRender", this, this._applyBump);
	}
	_applyBump() {
		this._scheduled = false;
		this.notifier = this.notifier + 1;
	}
	_setupSubscriptions() {
		if (!this._table) return;
		this._storeUnsub = this._table.store.subscribe(() => this.bump());
		this._optionsUnsub = this._table.optionsStore.subscribe(() => this.bump());
	}
	_applyPendingOpts() {
		if (this._pendingOpts && this._table) {
			const opts = this._pendingOpts;
			this._pendingOpts = null;
			this._table.setOptions((prev) => ({
				...prev,
				...opts
			}));
		}
	}
	destroy() {
		this._storeUnsub?.unsubscribe();
		this._optionsUnsub?.unsubscribe();
		this._storeUnsub = void 0;
		this._optionsUnsub = void 0;
		this._table = null;
	}
}, _descriptor$6 = _applyDecoratedDescriptor(_class$7.prototype, "notifier", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return 0;
	}
}), _class$7);
function stableStringify(v) {
	if (v === null || typeof v !== "object") return JSON.stringify(v);
	if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
	return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}
/**
* Type-only shape for the methods the toolbar reads off the TanStack
* Table instance. The runtime always has these (the features are
* wired into every table getTable() builds), but the public `Table<F,D>`
* type in `@tanstack/table-core@9-alpha` only exposes them when the
* corresponding `F` includes the feature key (e.g. `globalFilteringFeature`
* for `setGlobalFilter`). The toolbar is feature-agnostic, so we cast
* inside `safe(...)` calls instead of demanding callers thread the
* full feature set into `<Toolbar>`'s generic.
*/
/**
* Public surface every Toolbar gets via `<Toolbar @api={{...}}>` — also
* yielded as `t.api` in the slot context so consumers can wire builtins
* directly without re-deriving from the table.
*
* Scope: ONLY values that come from `@tanstack/table-core` primitives.
* Consumer-specific actions (copyAsCsv, addRow, refresh) stay
* consumer-supplied via `<t.Action @onClick>`.
*
* Pattern mirrors AG Grid's `gridApi` access — single object exposed to
* every panel/header/cellRenderer so consumers don't reach into the grid
* internals.
*/
/** String-literal union of built-in component names. */
/**
* Custom toolbar item — any Glimmer component that takes the standard
* `params` arg. Lets consumers drop bespoke items into the items array
* without modifying the toolbar package.
*/
/**
* One toolbar item in the `@items` array. Borrows AG Grid's
* `StatusPanelDef` shape:
*   { key?, statusPanel, align?, statusPanelParams? }
* Adapted for our purposes:
*   { key?, component, params?, align?, hidden? }
*/
/**
* String shortcuts in the items array — `'search'` collapses to a default
* `{ component: 'search' }` so common cases don't need the full envelope.
* Mirrors AG Grid's `toolPanels: ['columns', ...]` shortcut.
*/
/**
* Build a ToolbarApi from a TableResource-like object. Accepts a callable
* options-mutator so consumers can wire it from outside the package
* (e.g. when they want to pre-process `setQuickFilter` to also reset
* extra state).
*/
function makeToolbarApi(source) {
	const safe = (fn, fallback) => {
		try {
			if (!source().table) return fallback;
			return fn();
		} catch {
			return fallback;
		}
	};
	const tx = () => source().table;
	return {
		getTable: () => source().table,
		get quickFilter() {
			return safe(() => String(tx().getState().globalFilter ?? ""), "");
		},
		setQuickFilter(text) {
			safe(() => {
				tx().setGlobalFilter(text);
			}, void 0);
		},
		get selectedRowCount() {
			return safe(() => {
				const sel = tx().getState().rowSelection ?? {};
				return Object.values(sel).filter(Boolean).length;
			}, 0);
		},
		get filteredRowCount() {
			return safe(() => tx().getFilteredRowModel().rows.length, 0);
		},
		get totalRowCount() {
			return safe(() => tx().getRowCount(), 0);
		}
	};
}
var _class$6, _descriptor$5;
/**
* Boxel-idiomatic public API for `@tanstack/ember-table`.
*
* Mirrors the pattern used throughout `boxel/packages/host/app/resources/`:
* a `Resource` class consumers never instantiate directly, exposed through a
* verb-named factory function (`getTable`) that takes `parent` (Ember owner)
* and a thunk returning the live options.
*
* The thunk re-runs whenever any tracked state read inside it changes;
* `modify(_pos, named)` then receives the fresh options and forwards them to
* the underlying `TableController`. Consumers don't manage subscriptions,
* destructors, or option-diffing — the Resource handles it.
*
* Usage:
*
* ```gts
* export default class MyGrid extends Component {
*   @tracked data: Person[] = [...];
*   @tracked sorting: SortingState = [];
*   columns = [...];
*
*   tableR = getTable(this, () => ({
*     data: this.data,
*     columns: this.columns,
*     state: { sorting: this.sorting },
*     onSortingChange: (u) => {
*       this.sorting = typeof u === 'function' ? u(this.sorting) : u;
*     },
*     _features: { ...coreFeatures, ...stockFeatures },
*     _rowModels: { Sorted: createSortedRowModel({ sortFns }) },
*   }));
*
*   get table() { return this.tableR.table; }
*
*   <template>
*     {{#each this.table.getHeaderGroups as |hg|}} ... {{/each}}
*   </template>
* }
* ```
*/
var TableResource = (_class$6 = class TableResource extends Resource {
	constructor(...args) {
		super(...args);
		_initializerDefineProperty(this, "_table", _descriptor$5, this);
		_defineProperty(this, "_controller", null);
		/**
		* Stable `ToolbarApi` reference for `<Toolbar @api={{this.tableR.toolbarApi}}>`.
		* Memoized so identity stays stable across renders — important because
		* the api object is read in component args (Glimmer would re-invoke
		* the component if the arg ref changed every render).
		*
		* The API getters internally read `this.table` so they re-tick through
		* the controller's notifier when state changes.
		*/
		_defineProperty(this, "_toolbarApi", null);
	}
	modify(_positional, named) {
		if (!this._controller) this._controller = new TableController(this);
		this._table = this._controller.table(named.options);
	}
	get table() {
		if (!this._table) throw new Error("[@tanstack/ember-table] TableResource read before modify() ran. Did you instantiate it outside getTable()?");
		return this._table;
	}
	get toolbarApi() {
		if (!this._toolbarApi) this._toolbarApi = makeToolbarApi(() => ({ table: this.table }));
		return this._toolbarApi;
	}
}, _descriptor$5 = _applyDecoratedDescriptor(_class$6.prototype, "_table", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return null;
	}
}), _class$6);
/**
* Public entry point. Verb-named factory; matches `getRoom`, `getSearch`,
* `getCardCollection` in the Boxel host resources.
*/
function getTable(parent, getOptions) {
	return TableResource.from(parent, () => ({ named: { options: getOptions() } }));
}
var _class$5, _descriptor$4, _descriptor2$3, _descriptor3$3, _descriptor4$2, _descriptor5$1, _descriptor6$1;
var SheetRuntimeContextName = "boxel-surface:sheet-runtime";
var SheetRowKeyContextName = "boxel-surface:sheet-row-key";
var SheetRuntime = (_class$5 = class SheetRuntime {
	constructor(options) {
		_initializerDefineProperty(this, "selectionCurrent", _descriptor$4, this);
		_initializerDefineProperty(this, "selectionAnchor", _descriptor2$3, this);
		_initializerDefineProperty(this, "selectionRange", _descriptor3$3, this);
		_initializerDefineProperty(this, "editActive", _descriptor4$2, this);
		_initializerDefineProperty(this, "editPending", _descriptor5$1, this);
		_initializerDefineProperty(this, "commitError", _descriptor6$1, this);
		_defineProperty(this, "selectionPosition", null);
		_defineProperty(this, "anchorPosition", null);
		_defineProperty(this, "editPosition", null);
		_defineProperty(this, "selectionHandlers", {
			change: /* @__PURE__ */ new Set(),
			clear: /* @__PURE__ */ new Set()
		});
		_defineProperty(this, "selectionChangeHandlers", /* @__PURE__ */ new Set());
		_defineProperty(this, "editHandlers", {
			open: /* @__PURE__ */ new Set(),
			commit: /* @__PURE__ */ new Set(),
			cancel: /* @__PURE__ */ new Set()
		});
		_defineProperty(this, "editOpenHandlers", /* @__PURE__ */ new Set());
		_defineProperty(this, "editCommitHandlers", /* @__PURE__ */ new Set());
		_defineProperty(this, "editCancelHandlers", /* @__PURE__ */ new Set());
		_defineProperty(this, "keyBindings", /* @__PURE__ */ new Map());
		_defineProperty(this, "cellRegistrations", /* @__PURE__ */ new Map());
		_defineProperty(this, "selection", void 0);
		_defineProperty(this, "edit", void 0);
		_defineProperty(this, "keyboard", void 0);
		_defineProperty(this, "cells", void 0);
		this.options = options;
		const runtime = this;
		this.selection = {
			get current() {
				return runtime.selectionCurrent;
			},
			get anchor() {
				return runtime.selectionAnchor;
			},
			get range() {
				return runtime.selectionRange;
			},
			select(target, mode = "replace") {
				runtime.select(target, mode);
			},
			clear() {
				runtime.clearSelection();
			},
			on(event, handler) {
				return runtime.onSelection(event, handler);
			},
			onChange(handler) {
				return runtime.onSelectionChange(handler);
			}
		};
		this.edit = {
			get active() {
				return runtime.editActive;
			},
			get pending() {
				return runtime.editPending;
			},
			get lastError() {
				return runtime.commitError;
			},
			open(target, hint = {}) {
				return runtime.openEdit(target, hint);
			},
			commit(value, advance = "stay") {
				return runtime.commitEdit(value, advance);
			},
			cancel() {
				runtime.cancelEdit();
			},
			on(event, handler) {
				return runtime.onEdit(event, handler);
			},
			onOpen(handler) {
				return runtime.onEditOpen(handler);
			},
			onCommit(handler) {
				return runtime.onEditCommit(handler);
			},
			onCancel(handler) {
				return runtime.onEditCancel(handler);
			}
		};
		this.keyboard = {
			bind(pattern, handler) {
				return runtime.bindKeyboard(pattern, handler);
			},
			handle(event) {
				return runtime.handleKeyboard(event);
			}
		};
		this.cells = {
			register(target, registration) {
				return runtime.registerCell(target, registration);
			},
			resolve(target) {
				return runtime.cellRegistrations.get(cellKey(target));
			},
			handle(target) {
				return runtime.cellRegistrations.get(cellKey(target));
			}
		};
		this.installDefaultKeyboardBindings();
	}
	updateOptions(options) {
		this.options = options;
		this.reconcileTopology();
	}
	reconcileTopology() {
		if (this.selectionCurrent) {
			const remapped = this.remapTarget(this.selectionCurrent, this.selectionPosition);
			if (remapped) {
				this.selectionCurrent = remapped.target;
				this.selectionPosition = remapped.position;
				this.selectionAnchor = remapped.target;
				this.anchorPosition = remapped.position;
				this.selectionRange = [remapped.target];
				this.notifySelection("change");
			} else this.clearSelection();
		}
		if (this.editActive) {
			const remapped = this.remapCellTarget(this.editActive.target, this.editPosition);
			if (remapped && this.isEditable(remapped.target)) {
				this.editActive = {
					...this.editActive,
					target: remapped.target
				};
				this.editPosition = remapped.position;
			} else this.cancelEdit();
		}
	}
	isEditable(target) {
		const resolved = this.resolveCell(target);
		if (!resolved) return false;
		const { row, column } = resolved;
		if (row.editable === false || column.computed === true) return false;
		if (typeof column.editable === "boolean" && column.editable === false) return false;
		if (typeof column.editable === "function" && !column.editable(row)) return false;
		if (this.cellRegistrations.get(cellKey(target))?.isEditable?.() === false) return false;
		const editable = this.options.editable;
		if (typeof editable === "boolean") return editable;
		if (isEditablePolicy(editable)) {
			const columnRule = editable.forColumn?.(target.colKey, {
				column,
				rows: this.rows()
			});
			if (typeof columnRule === "boolean" && !columnRule) return false;
			if (typeof columnRule === "function" && !columnRule(row)) return false;
			if (editable.forRow?.(target.rowKey, { row }) === false) return false;
			if (editable.forCell?.(target, {
				row,
				column
			}) === false) return false;
			return true;
		}
		if (typeof editable === "function") return editable(target, {
			row,
			column
		});
		return true;
	}
	select(target, mode) {
		const resolved = this.resolveTarget(target);
		if (!resolved) return;
		if (mode === "replace" && this.selectionCurrent && sameTarget(this.selectionCurrent, resolved.target)) return;
		const anchor = mode === "extend" && this.selectionAnchor ? this.selectionAnchor : resolved.target;
		const anchorPosition = mode === "extend" && this.anchorPosition ? this.anchorPosition : resolved.position;
		this.selectionCurrent = resolved.target;
		this.selectionPosition = resolved.position;
		this.selectionAnchor = anchor;
		this.anchorPosition = anchorPosition;
		this.selectionRange = [resolved.target];
		this.notifySelection("change");
	}
	clearSelection() {
		const hadSelection = this.selectionCurrent !== null;
		this.selectionCurrent = null;
		this.selectionAnchor = null;
		this.selectionRange = [];
		this.selectionPosition = null;
		this.anchorPosition = null;
		if (hadSelection) this.notifySelection("clear");
	}
	openEdit(target, hint) {
		const resolved = this.resolveCell(target);
		if (!resolved || !this.isEditable(target)) return false;
		if (this.editActive && sameCellTarget(this.editActive.target, resolved.target)) return true;
		this.select(target, "replace");
		this.commitError = null;
		this.editActive = {
			target: resolved.target,
			initialValue: hint.initialValue,
			source: hint.source
		};
		this.editPosition = resolved.position;
		this.notifyEdit("open", this.editActive);
		return true;
	}
	async commitEdit(value, advance) {
		const active = this.editActive;
		if (!active) return false;
		this.editPending = true;
		try {
			if (await this.options.commit?.({
				target: active.target,
				value,
				advance
			}) === false) {
				this.commitError = false;
				return false;
			}
		} catch (error) {
			this.commitError = error;
			return false;
		} finally {
			this.editPending = false;
		}
		this.commitError = null;
		const currentSelection = this.selectionCurrent;
		const shouldAdvance = !!currentSelection && isCellTarget(currentSelection) && sameCellTarget(currentSelection, active.target);
		this.editActive = null;
		this.editPosition = null;
		this.notifyEdit("commit", active, value);
		if (shouldAdvance) this.advanceAfterCommit(active.target, advance);
		return true;
	}
	cancelEdit() {
		const active = this.editActive;
		if (!active) return false;
		this.editActive = null;
		this.editPosition = null;
		this.editPending = false;
		this.notifyEdit("cancel", active);
		return true;
	}
	onSelection(event, handler) {
		this.selectionHandlers[event].add(handler);
		return () => this.selectionHandlers[event].delete(handler);
	}
	onSelectionChange(handler) {
		this.selectionChangeHandlers.add(handler);
		return () => this.selectionChangeHandlers.delete(handler);
	}
	onEdit(event, handler) {
		this.editHandlers[event].add(handler);
		return () => this.editHandlers[event].delete(handler);
	}
	onEditOpen(handler) {
		this.editOpenHandlers.add(handler);
		return () => this.editOpenHandlers.delete(handler);
	}
	onEditCommit(handler) {
		this.editCommitHandlers.add(handler);
		return () => this.editCommitHandlers.delete(handler);
	}
	onEditCancel(handler) {
		this.editCancelHandlers.add(handler);
		return () => this.editCancelHandlers.delete(handler);
	}
	notifySelection(event) {
		for (const handler of [...this.selectionHandlers[event]]) handler(this);
		for (const handler of [...this.selectionChangeHandlers]) handler(this.selectionCurrent, this);
	}
	notifyEdit(event, state, value) {
		for (const handler of [...this.editHandlers[event]]) handler(this);
		if (event === "open") for (const handler of [...this.editOpenHandlers]) handler(state, this);
		else if (event === "commit") for (const handler of [...this.editCommitHandlers]) handler(state, value, this);
		else for (const handler of [...this.editCancelHandlers]) handler(state, this);
	}
	registerCell(target, registration) {
		const key = cellKey(target);
		this.cellRegistrations.set(key, registration);
		return () => {
			if (this.cellRegistrations.get(key) === registration) this.cellRegistrations.delete(key);
		};
	}
	bindKeyboard(pattern, handler) {
		const normalized = normalizeKeyPattern(pattern);
		const bindings = this.keyBindings.get(normalized) ?? [];
		bindings.push(handler);
		this.keyBindings.set(normalized, bindings);
		return () => {
			const next = (this.keyBindings.get(normalized) ?? []).filter((item) => item !== handler);
			if (next.length) this.keyBindings.set(normalized, next);
			else this.keyBindings.delete(normalized);
		};
	}
	handleKeyboard(event) {
		if (event.defaultPrevented) return false;
		const pattern = keyPatternForEvent(event);
		const bindings = this.keyBindings.get(pattern);
		const handler = bindings?.[bindings.length - 1];
		if (!handler) return false;
		const handled = handler(event, this) !== false;
		if (handled) {
			event.preventDefault?.();
			event.stopPropagation?.();
		}
		return handled;
	}
	installDefaultKeyboardBindings() {
		this.bindKeyboard("ArrowUp", () => this.moveSelection(-1, 0));
		this.bindKeyboard("ArrowDown", () => this.moveSelection(1, 0));
		this.bindKeyboard("ArrowLeft", () => this.moveSelection(0, -1));
		this.bindKeyboard("ArrowRight", () => this.moveSelection(0, 1));
		this.bindKeyboard("Tab", () => this.moveSelectionByTab(1));
		this.bindKeyboard("Shift+Tab", () => this.moveSelectionByTab(-1));
		this.bindKeyboard("Home", () => this.moveSelectionToRowEdge("start"));
		this.bindKeyboard("End", () => this.moveSelectionToRowEdge("end"));
		this.bindKeyboard("Enter", () => this.openSelectedFromKeyboard());
		this.bindKeyboard("F2", () => this.openSelectedFromKeyboard());
		this.bindKeyboard("Escape", () => {
			if (this.cancelEdit()) return true;
			if (this.selection.current) {
				this.clearSelection();
				return true;
			}
			return false;
		});
	}
	moveSelection(rowDelta, colDelta) {
		const rows = this.rows();
		const columns = this.columns();
		if (!rows.length || !columns.length) return false;
		const firstRow = rows[0];
		const firstColumn = columns[0];
		if (!firstRow || !firstColumn) return false;
		if (!this.selectionPosition && !this.selectionCurrent) {
			this.select({
				rowKey: firstRow.key,
				colKey: firstColumn.key
			}, "replace");
			return true;
		}
		const current = this.selectionPosition ?? this.resolveTarget(this.selectionCurrent ?? {
			rowKey: firstRow.key,
			colKey: firstColumn.key
		})?.position ?? {
			rowIndex: 0,
			colIndex: 0
		};
		const nextRow = clamp(current.rowIndex + rowDelta, 0, rows.length - 1);
		const nextCol = clamp((current.colIndex ?? 0) + colDelta, 0, columns.length - 1);
		const row = rows[nextRow];
		const column = columns[nextCol];
		if (!row || !column) return false;
		this.select({
			rowKey: row.key,
			colKey: column.key
		}, "replace");
		return true;
	}
	moveSelectionByTab(direction) {
		const rows = this.rows();
		const columns = this.columns();
		if (!rows.length || !columns.length) return false;
		if (!this.selectionPosition && !this.selectionCurrent) {
			const row = rows[0];
			const column = columns[0];
			if (!row || !column) return false;
			this.select({
				rowKey: row.key,
				colKey: column.key
			}, "replace");
			return true;
		}
		const current = this.currentCellPosition();
		let flatIndex = current.rowIndex * columns.length + current.colIndex;
		flatIndex = clamp(flatIndex + direction, 0, rows.length * columns.length - 1);
		const row = rows[Math.floor(flatIndex / columns.length)];
		const column = columns[flatIndex % columns.length];
		if (!row || !column) return false;
		this.select({
			rowKey: row.key,
			colKey: column.key
		}, "replace");
		return true;
	}
	moveSelectionToRowEdge(edge) {
		const rows = this.rows();
		const columns = this.columns();
		if (!rows.length || !columns.length) return false;
		if (!this.selectionPosition && !this.selectionCurrent) {
			const row = rows[0];
			const column = columns[edge === "start" ? 0 : columns.length - 1];
			if (!row || !column) return false;
			this.select({
				rowKey: row.key,
				colKey: column.key
			}, "replace");
			return true;
		}
		const row = rows[this.currentCellPosition().rowIndex];
		const column = columns[edge === "start" ? 0 : columns.length - 1];
		if (!row || !column) return false;
		this.select({
			rowKey: row.key,
			colKey: column.key
		}, "replace");
		return true;
	}
	currentCellPosition() {
		const rows = this.rows();
		const columns = this.columns();
		const fallback = {
			rowIndex: 0,
			colIndex: 0
		};
		if (!rows.length || !columns.length) return fallback;
		const position = this.selectionPosition ?? this.resolveTarget(this.selectionCurrent ?? {
			rowKey: rows[0]?.key ?? "",
			colKey: columns[0]?.key ?? ""
		})?.position ?? fallback;
		return {
			rowIndex: clamp(position.rowIndex, 0, rows.length - 1),
			colIndex: clamp(position.colIndex ?? 0, 0, columns.length - 1)
		};
	}
	openSelectedFromKeyboard() {
		const current = this.selectionCurrent;
		if (!current || !isCellTarget(current)) return false;
		return this.openEdit(current, { source: "keyboard" });
	}
	advanceAfterCommit(target, advance) {
		if (advance === "stay") {
			this.focusCell(target);
			return;
		}
		if (advance === "out") {
			this.clearSelection();
			return;
		}
		const resolved = this.resolveCell(target);
		if (!resolved) return;
		const delta = {
			up: [-1, 0],
			down: [1, 0],
			left: [0, -1],
			right: [0, 1]
		}[advance];
		const rows = this.rows();
		const columns = this.columns();
		if (!rows.length || !columns.length) return;
		const rowIndex = clamp(resolved.position.rowIndex + delta[0], 0, rows.length - 1);
		const colIndex = clamp((resolved.position.colIndex ?? 0) + delta[1], 0, columns.length - 1);
		const row = rows[rowIndex];
		const column = columns[colIndex];
		if (!row || !column) return;
		const nextTarget = {
			rowKey: row.key,
			colKey: column.key
		};
		this.select(nextTarget, "replace");
		this.focusCell(nextTarget);
	}
	focusCell(target) {
		const handle = this.cellRegistrations.get(cellKey(target));
		handle?.focus?.();
		handle?.scrollIntoView?.();
	}
	resolveTarget(target) {
		if (isCellTarget(target)) return this.resolveCell(target);
		const rowIndex = this.rows().findIndex((row) => row.key === target.rowKey);
		if (rowIndex < 0) return null;
		return {
			target: { rowKey: target.rowKey },
			position: {
				rowIndex,
				colIndex: null
			}
		};
	}
	resolveCell(target) {
		const rows = this.rows();
		const columns = this.columns();
		const rowIndex = rows.findIndex((row) => row.key === target.rowKey);
		const colIndex = columns.findIndex((column) => column.key === target.colKey);
		if (rowIndex < 0 || colIndex < 0) return null;
		const row = rows[rowIndex];
		const column = columns[colIndex];
		if (!row || !column) return null;
		return {
			target: {
				rowKey: target.rowKey,
				colKey: target.colKey
			},
			row,
			column,
			position: {
				rowIndex,
				colIndex
			}
		};
	}
	remapTarget(target, position) {
		if (isCellTarget(target)) return this.remapCellTarget(target, position);
		const row = this.remapRow(target.rowKey, position?.rowIndex ?? null);
		if (!row) return null;
		return {
			target: { rowKey: row.row.key },
			position: {
				rowIndex: row.rowIndex,
				colIndex: null
			}
		};
	}
	remapCellTarget(target, position) {
		const row = this.remapRow(target.rowKey, position?.rowIndex ?? null);
		const column = this.remapColumn(target.colKey, position?.colIndex ?? null);
		if (!row || !column) return null;
		return {
			target: {
				rowKey: row.row.key,
				colKey: column.column.key
			},
			position: {
				rowIndex: row.rowIndex,
				colIndex: column.colIndex
			}
		};
	}
	remapRow(rowKey, rowIndex) {
		const rows = this.rows();
		const byKey = rows.findIndex((row) => row.key === rowKey);
		const rowByKey = rows[byKey];
		if (byKey >= 0 && rowByKey) return {
			row: rowByKey,
			rowIndex: byKey
		};
		if (rowIndex !== null && rowIndex >= 0 && rowIndex < rows.length) {
			const row = rows[rowIndex];
			if (row) return {
				row,
				rowIndex
			};
		}
		return null;
	}
	remapColumn(colKey, colIndex) {
		const columns = this.columns();
		const byKey = columns.findIndex((column) => column.key === colKey);
		const columnByKey = columns[byKey];
		if (byKey >= 0 && columnByKey) return {
			column: columnByKey,
			colIndex: byKey
		};
		if (colIndex !== null && colIndex >= 0 && colIndex < columns.length) {
			const column = columns[colIndex];
			if (column) return {
				column,
				colIndex
			};
		}
		return null;
	}
	rows() {
		return this.options.rows();
	}
	columns() {
		return this.options.columns();
	}
}, _descriptor$4 = _applyDecoratedDescriptor(_class$5.prototype, "selectionCurrent", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return null;
	}
}), _descriptor2$3 = _applyDecoratedDescriptor(_class$5.prototype, "selectionAnchor", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return null;
	}
}), _descriptor3$3 = _applyDecoratedDescriptor(_class$5.prototype, "selectionRange", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return [];
	}
}), _descriptor4$2 = _applyDecoratedDescriptor(_class$5.prototype, "editActive", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return null;
	}
}), _descriptor5$1 = _applyDecoratedDescriptor(_class$5.prototype, "editPending", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return false;
	}
}), _descriptor6$1 = _applyDecoratedDescriptor(_class$5.prototype, "commitError", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return null;
	}
}), _class$5);
function createSheetRuntime(options) {
	return new SheetRuntime(options);
}
function isCellTarget(target) {
	return "colKey" in target;
}
function isEditablePolicy(value) {
	return typeof value === "object" && value !== null;
}
function cellKey(target) {
	return `${target.rowKey}\u0000${target.colKey}`;
}
function sameCellTarget(left, right) {
	return left.rowKey === right.rowKey && left.colKey === right.colKey;
}
function sameTarget(left, right) {
	if (isCellTarget(left) || isCellTarget(right)) return isCellTarget(left) && isCellTarget(right) && sameCellTarget(left, right);
	return left.rowKey === right.rowKey;
}
function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}
function normalizeKeyPattern(pattern) {
	const parts = pattern.split("+").map((part) => part.trim()).filter(Boolean);
	const key = normalizeKeyName(parts.pop() ?? "");
	return [...new Set(parts.map(normalizeModifierName))].sort(modifierSort).concat(key).join("+");
}
function keyPatternForEvent(event) {
	const modifiers = [];
	if (event.altKey) modifiers.push("Alt");
	if (event.ctrlKey) modifiers.push("Ctrl");
	if (event.metaKey) modifiers.push("Meta");
	if (event.shiftKey) modifiers.push("Shift");
	return modifiers.sort(modifierSort).concat(normalizeKeyName(event.key)).join("+");
}
function normalizeModifierName(modifier) {
	const lower = modifier.toLowerCase();
	if (lower === "control") return "Ctrl";
	if (lower === "cmd" || lower === "command") return "Meta";
	return `${modifier.slice(0, 1).toUpperCase()}${modifier.slice(1).toLowerCase()}`;
}
function normalizeKeyName(key) {
	if (key === "Esc") return "Escape";
	if (key === " ") return "Space";
	return key;
}
function modifierSort(a, b) {
	return modifierRank(a) - modifierRank(b);
}
function modifierRank(modifier) {
	const rank = [
		"Alt",
		"Ctrl",
		"Meta",
		"Shift"
	].indexOf(modifier);
	return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
}
/**
* Minimal structural shape for a FieldDef-like class. The grid's
* `<Cell @field>` plucks `static atom` (preview) and `static edit`
* (editor) off this class at render time and feeds them into
* `FieldAtomBridge` / `FieldEditBridge`, which forward them as
* boxel's standard `@model` argument.
*
* The same class doubles as a card-form field, no second slot pair
* required: boxel's host invokes the same `static atom` / `static
* edit` via its own field renderer.
*/
var KIND_MAP = {
	text: "text",
	date: "text",
	number: "number",
	boolean: "boolean"
};
function isoDate(v) {
	if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
	return "";
}
function parseIsoDate(input) {
	if (input instanceof Date) return input;
	const s = String(input ?? "").trim();
	if (!s) return null;
	const d = new Date(s);
	return Number.isNaN(d.getTime()) ? null : d;
}
function readPrimitive(row, col) {
	if (!row) return null;
	const v = row[col.key];
	switch (col.type) {
		case "date": return isoDate(v);
		case "number": return typeof v === "number" ? v : null;
		case "boolean": return v === true;
		default: return v == null ? "" : String(v);
	}
}
function writePrimitive(row, col, next) {
	switch (col.type) {
		case "number": {
			const n = next === "" || next == null ? null : Number(next);
			row[col.key] = Number.isFinite(n) ? n : null;
			return;
		}
		case "boolean":
			row[col.key] = next === true || next === "true";
			return;
		case "date":
			row[col.key] = parseIsoDate(next);
			return;
		default: row[col.key] = String(next ?? "");
	}
}
function getSheet(owner, options) {
	const tableR = getTable(owner, () => ({
		data: options.data() ?? [],
		columns: options.columns.map((c) => ({
			accessorKey: c.key,
			header: c.label
		})),
		_features: coreFeatures,
		_rowModels: { coreRowModel: createCoreRowModel() }
	}));
	const resolveEditable = (row, col) => {
		if (col.computed || col.editable === false) return false;
		if (typeof options.editable === "function") return options.editable(row, col);
		if (typeof options.editable === "object" && options.editable !== null) {
			const columnRule = options.editable.forColumn?.(col);
			if (typeof columnRule === "boolean" && !columnRule) return false;
			if (typeof columnRule === "function" && !columnRule(row)) return false;
			if (options.editable.forRow?.(row) === false) return false;
			if (options.editable.forCell?.(row, col) === false) return false;
			return true;
		}
		return options.editable ?? true;
	};
	let sheet;
	sheet = {
		get table() {
			return tableR.table;
		},
		runtime: createSheetRuntime({
			rows: () => sheet.rows.map((sheetRow) => {
				const row = sheetRow.source;
				return {
					key: sheetRow.key,
					data: row,
					editable: typeof options.editable === "object" && options.editable !== null ? options.editable.forRow?.(row) : void 0
				};
			}),
			columns: () => options.columns.map((column) => ({
				key: column.key,
				computed: column.computed,
				editable: column.editable
			})),
			editable: (target) => {
				return (sheet.rows.find((candidate) => candidate.key === target.rowKey)?.cells.find((candidate) => candidate.colKey === target.colKey))?.editable ?? false;
			},
			commit: ({ target, value, advance }) => {
				const cell = sheet.rows.find((candidate) => candidate.key === target.rowKey)?.cells.find((candidate) => candidate.colKey === target.colKey);
				if (!cell) throw new Error(`Cannot commit missing sheet cell ${target.rowKey}:${target.colKey}`);
				const cellAdvance = advance === "out" ? void 0 : advance;
				return cell.commit(value, cellAdvance);
			}
		}),
		get gridTemplateColumns() {
			return options.columns.map((c) => c.width ?? "1fr").join(" ");
		},
		get columns() {
			return options.columns;
		},
		get rows() {
			return tableR.table.getRowModel().rows.map((tanRow, i) => {
				const row = tanRow.original;
				return {
					key: row?.id ?? `r${i}`,
					source: row,
					cells: options.columns.map((col) => {
						const isField = !!col.field;
						return {
							colKey: col.key,
							kind: isField ? void 0 : KIND_MAP[col.type ?? "text"],
							field: isField ? col.field : void 0,
							value: isField ? row?.[col.key] : readPrimitive(row, col),
							editable: resolveEditable(row, col),
							commit: (next, advance) => {
								if (!row) return;
								if (col.commit) return col.commit(row, next, {
									column: col,
									advance
								});
								if (!isField) writePrimitive(row, col, next);
							}
						};
					})
				};
			});
		}
	};
	return sheet;
}
var _SheetRuntimeProvider;
var SheetRuntimeProvider = class extends Component {};
_SheetRuntimeProvider = SheetRuntimeProvider;
setComponentTemplate(precompileTemplate("<ContextProvider @key={{SheetRuntimeContextName}} @value={{@runtime}}>\n  {{yield}}\n</ContextProvider>", {
	strictMode: true,
	scope: () => ({
		ContextProvider,
		SheetRuntimeContextName
	})
}), _SheetRuntimeProvider);
function createSheetRuntimeProvider(runtime) {
	var _BoundSheetRuntimeProviderComponent;
	class BoundSheetRuntimeProviderComponent extends Component {}
	_BoundSheetRuntimeProviderComponent = BoundSheetRuntimeProviderComponent;
	setComponentTemplate(precompileTemplate("<SheetRuntimeProvider @runtime={{runtime}}>\n  {{yield}}\n</SheetRuntimeProvider>", {
		strictMode: true,
		scope: () => ({
			SheetRuntimeProvider,
			runtime
		})
	}), _BoundSheetRuntimeProviderComponent);
	return BoundSheetRuntimeProviderComponent;
}
function safeGridIdPart(value) {
	return value.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}
function gridRuntimePolicy(config) {
	if (config.preset === "headless") return { traversal: "skip" };
	return { preset: config.preset };
}
function gridRuntimeTarget(config) {
	return config.preset === "headless" ? void 0 : "structure";
}
function gridRuntimeRowTarget(config) {
	if (config.preset === "collection" || config.selection === "row" || config.keyboard === "row") return "range-item";
	if (config.preset === "headless") return;
	return "structure";
}
function gridRuntimeCellTarget(config) {
	if (config.preset === "sheet" || config.selection === "cell" || config.selection === "cell-range" || config.keyboard === "cell") return "field";
	if (config.preset === "collection") return "value";
	if (config.preset === "table") return "value";
}
function gridRuntimeCellPolicy(config, target, cell) {
	if (target !== "field") return void 0;
	return {
		edit: cell.editPolicy ?? (cell.editable ?? config.editable ? "inline" : "none"),
		keyboard: config.keyboard === "cell" ? "grid-cell" : "tree"
	};
}
function gridRuntimeCoordinate(target, cell) {
	if (target !== "field") return void 0;
	return {
		row: cell.rowIndex,
		col: cell.columnIndex
	};
}
function gridRuntimeRegistrationPlan(config, model, ids = { gridId: config.gridId }) {
	const gridId = ids.gridId;
	const grid = {
		id: gridId,
		focusKey: config.gridId,
		surface: "grid",
		target: gridRuntimeTarget(config),
		policy: gridRuntimePolicy(config),
		parentId: config.parentId
	};
	const headerActions = (model.headerActions ?? []).map((action, index) => {
		return {
			id: ids.headerActionIds?.get(action.key) ?? action.id ?? `${gridId}-header-action-${safeGridIdPart(action.key || String(index))}`,
			focusKey: action.focusKey ?? action.key,
			surface: "unit",
			target: "action",
			parentId: gridId
		};
	});
	const rowTarget = gridRuntimeRowTarget(config);
	const cellTarget = gridRuntimeCellTarget(config);
	const rows = [];
	const cells = [];
	const rowIdsByKey = /* @__PURE__ */ new Map();
	const cellIdsByKey = /* @__PURE__ */ new Map();
	const rootChildIds = headerActions.map((action) => action.id);
	const siblingOrders = [];
	for (const row of model.rows) {
		const rowId = ids.rowIds?.get(row.key) ?? row.id ?? `${gridId}-row-${safeGridIdPart(row.key)}`;
		rows.push({
			id: rowId,
			focusKey: row.focusKey ?? row.key,
			surface: "row",
			target: rowTarget,
			parentId: gridId
		});
		rowIdsByKey.set(row.key, rowId);
		rootChildIds.push(rowId);
		const rowCellIds = [];
		for (const cell of row.cells) {
			const cellId = ids.cellIds?.get(cell.key) ?? cell.id ?? `${gridId}-cell-${safeGridIdPart(cell.key)}`;
			cells.push({
				id: cellId,
				focusKey: cell.focusKey ?? cell.key,
				surface: "cell",
				target: cellTarget,
				grid: gridRuntimeCoordinate(cellTarget, cell),
				policy: gridRuntimeCellPolicy(config, cellTarget, cell),
				parentId: rowId
			});
			cellIdsByKey.set(cell.key, cellId);
			rowCellIds.push(cellId);
		}
		siblingOrders.push({
			parentId: rowId,
			ids: rowCellIds
		});
	}
	siblingOrders.unshift({
		parentId: gridId,
		ids: rootChildIds
	});
	return {
		grid,
		headerActions,
		rows,
		cells,
		rowIdsByKey,
		cellIdsByKey,
		siblingOrders
	};
}
function gridRuntimeSelectionSteps(plan, state) {
	if (!state.headKey) return [];
	const idsByKey = state.axis === "row" ? plan.rowIdsByKey : plan.cellIdsByKey;
	const headId = idsByKey.get(state.headKey);
	if (!headId) return [];
	const anchorId = state.anchorKey ? idsByKey.get(state.anchorKey) : void 0;
	if (anchorId && anchorId !== headId) return [{ id: anchorId }, {
		id: headId,
		options: { range: true }
	}];
	return [{ id: headId }];
}
function applyGridRuntimeSelection(runtime, plan, state) {
	for (const step of gridRuntimeSelectionSteps(plan, state)) runtime.select(step.id, step.options);
}
var runtimeRoots = /* @__PURE__ */ new WeakMap();
function registerSheetRuntimeRoot(element, runtime) {
	runtimeRoots.set(element, runtime);
	element.dataset["bxSheetRuntimeRoot"] = "";
	return () => {
		runtimeRoots.delete(element);
		element.removeAttribute("data-bx-sheet-runtime-root");
	};
}
function sheetRuntimeForElement(element) {
	let current = element;
	while (current) {
		const runtime = runtimeRoots.get(current);
		if (runtime) return runtime;
		current = current.parentElement;
	}
}
function sheetCellTargetForElement(element) {
	const rowElement = element.closest("[data-bx-grid-row-key], [data-row-key]");
	const rowKey = element.dataset["bxGridRowKey"] ?? rowElement?.dataset["bxGridRowKey"] ?? rowElement?.dataset["rowKey"];
	const colKey = element.dataset["colKey"] ?? element.dataset["bxGridColumnId"] ?? element.dataset["bxGridCellKey"];
	return rowKey && colKey ? {
		rowKey,
		colKey
	} : void 0;
}
function registerSheetCellElement(runtime, element, target, options = {}) {
	element.dataset["bxGridCell"] = "";
	element.dataset["bxGridRowKey"] = target.rowKey;
	element.dataset["bxGridColumnId"] = target.colKey;
	element.dataset["colKey"] = target.colKey;
	if (!element.id) element.id = `${element.closest("[data-bx-grid-id]")?.dataset["bxGridId"] ?? "boxel-grid"}-cell-${safeGridIdPart(`${target.rowKey}-${target.colKey}`)}`;
	const unregisterCell = runtime.cells.register(target, {
		focus: () => focusElement(element),
		scrollIntoView: () => {
			if (typeof element.scrollIntoView === "function") element.scrollIntoView({
				block: "nearest",
				inline: "nearest"
			});
		},
		isEditable: () => {
			if (typeof options.editable === "function") return options.editable();
			return options.editable ?? true;
		}
	});
	const paint = () => paintSheetCellElement(runtime, element, target);
	paint();
	const unsubscribers = [
		runtime.selection.onChange(paint),
		runtime.edit.onOpen(paint),
		runtime.edit.onCommit(paint),
		runtime.edit.onCancel(paint)
	];
	return () => {
		for (const unsubscribe of unsubscribers) unsubscribe();
		unregisterCell();
		clearSheetCellPaint(element);
	};
}
function focusElement(element) {
	try {
		element.focus({ preventScroll: true });
	} catch {
		element.focus();
	}
}
function paintSheetCellElement(runtime, element, target) {
	const current = runtime.selection.current;
	const active = isSameCellTarget(current, target);
	const selected = runtime.selection.range.some((item) => isSameCellTarget(item, target));
	const editing = isSameCellTarget(runtime.edit.active?.target ?? null, target);
	const cellState = editing ? "editing-inline" : active || selected ? "active" : "idle";
	element.tabIndex = active ? 0 : -1;
	element.dataset["bxCellState"] = cellState;
	element.toggleAttribute("data-bx-grid-active", active);
	element.toggleAttribute("data-bx-grid-selected", active || selected);
	element.toggleAttribute("data-bx-grid-in-range", selected && !active);
	element.toggleAttribute("data-bx-grid-editing", editing);
	element.setAttribute("aria-selected", active || selected ? "true" : "false");
}
function clearSheetCellPaint(element) {
	element.tabIndex = -1;
	element.removeAttribute("data-bx-grid-active");
	element.removeAttribute("data-bx-grid-selected");
	element.removeAttribute("data-bx-grid-in-range");
	element.removeAttribute("data-bx-grid-editing");
	element.removeAttribute("data-bx-cell-state");
	element.setAttribute("aria-selected", "false");
}
function isSameCellTarget(left, right) {
	return !!left && "colKey" in left && left.rowKey === right.rowKey && left.colKey === right.colKey;
}
var MAX_REGISTRATION_RETRIES = 10;
var sheetCellRegistration = modifier((element, _positional, named) => {
	let disposed = false;
	let cleanup;
	let retry;
	let retryCount = 0;
	const cancelRetry = () => {
		if (retry === void 0) return;
		if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(retry);
		else clearTimeout(retry);
		retry = void 0;
	};
	const scheduleRetry = () => {
		cancelRetry();
		if (retryCount >= MAX_REGISTRATION_RETRIES) {
			element.dataset["bxSheetCellRegistrationFailed"] = "";
			if (typeof console !== "undefined") console.warn("[boxel-grid] sheetCellRegistration: gave up waiting for a SheetRuntime and cell target.", {
				element,
				hasRuntime: Boolean(named.runtime ?? sheetRuntimeForElement(element)),
				hasTarget: Boolean(named.target ?? (named.requireTarget ? requiredCellTargetForElement(element, named.rowKey, named.colKey) : sheetCellTargetForElement(element)))
			});
			return;
		}
		retryCount += 1;
		if (typeof requestAnimationFrame === "function") retry = requestAnimationFrame(register);
		else retry = setTimeout(register, 0);
	};
	const register = () => {
		retry = void 0;
		if (disposed || cleanup) return;
		const runtime = named.runtime ?? sheetRuntimeForElement(element);
		const target = named.target ?? (named.requireTarget ? requiredCellTargetForElement(element, named.rowKey, named.colKey) : sheetCellTargetForElement(element));
		if (!runtime || !target) {
			scheduleRetry();
			return;
		}
		element.removeAttribute("data-bx-sheet-cell-registration-failed");
		cleanup = registerSheetCellElement(runtime, element, target, { editable: () => named.editable ?? true });
		named.onRuntime?.(runtime);
		named.onTarget?.(target);
	};
	register();
	return () => {
		disposed = true;
		cancelRetry();
		cleanup?.();
		named.onRuntime?.(void 0);
		named.onTarget?.(void 0);
	};
});
function requiredCellTargetForElement(element, rowKey, colKey) {
	const resolvedRowKey = rowKey === void 0 || rowKey === null ? rowKeyForElement(element) : String(rowKey);
	const resolvedColKey = colKey === void 0 || colKey === null ? columnKeyForElement(element) : String(colKey);
	return resolvedRowKey && resolvedColKey ? {
		rowKey: resolvedRowKey,
		colKey: resolvedColKey
	} : void 0;
}
function rowKeyForElement(element) {
	const rowElement = element.closest("[data-bx-grid-row-key], [data-row-key]");
	return element.dataset["bxGridRowKey"] ?? rowElement?.dataset["bxGridRowKey"] ?? rowElement?.dataset["rowKey"];
}
function columnKeyForElement(element) {
	return element.dataset["colKey"] ?? element.dataset["bxGridColumnId"];
}
var _FieldAtomBridge, _class$4, _FieldEditBridge;
var FieldAtomBridge = class extends Component {
	get AtomView() {
		return this.args.fieldClass?.atom;
	}
};
_FieldAtomBridge = FieldAtomBridge;
setComponentTemplate(precompileTemplate("{{#if this.AtomView}}\n  <this.AtomView @model={{@value}} />\n{{/if}}", { strictMode: true }), _FieldAtomBridge);
var FieldEditBridge = (_class$4 = (_FieldEditBridge = class FieldEditBridge extends Component {
	constructor(...args) {
		super(...args);
		_defineProperty(this, "done", false);
		_defineProperty(this, "committing", false);
	}
	get EditView() {
		return this.args.fieldClass?.edit;
	}
	onKeydown(event) {
		if (surfaceTargetOwnsKeyboardEvent(event)) return;
		if (event.key !== "Enter" && event.key !== "Tab" && event.key !== "Escape") return;
		event.stopPropagation();
		switch (event.key) {
			case "Enter":
				event.preventDefault();
				this.commit("down");
				break;
			case "Tab":
				event.preventDefault();
				this.commit(event.shiftKey ? "left" : "right");
				break;
			case "Escape":
				event.preventDefault();
				this.args.onCancel();
				break;
		}
	}
	onFocusout(event) {
		const next = event.relatedTarget;
		const root = event.currentTarget;
		if (root && next && root.contains(next)) return;
		this.commit("stay");
	}
	async commit(advance) {
		if (this.done || this.committing) return;
		this.committing = true;
		try {
			if (await this.args.onCommit(this.args.value, advance) !== false) this.done = true;
		} catch {} finally {
			this.committing = false;
		}
	}
}, setComponentTemplate(precompileTemplate("{{#if this.EditView}}\n  <span class=\"bx-field-edit-bridge\" style=\"display:contents\" {{on \"keydown\" this.onKeydown}} {{on \"focusout\" this.onFocusout}}>\n    <this.EditView @model={{@value}} />\n  </span>\n{{/if}}", {
	strictMode: true,
	scope: () => ({ on })
}), _FieldEditBridge), _FieldEditBridge), _applyDecoratedDescriptor(_class$4.prototype, "onKeydown", [action], Object.getOwnPropertyDescriptor(_class$4.prototype, "onKeydown"), _class$4.prototype), _applyDecoratedDescriptor(_class$4.prototype, "onFocusout", [action], Object.getOwnPropertyDescriptor(_class$4.prototype, "onFocusout"), _class$4.prototype), _class$4);
var _SlotRender;
/**
* Bridges a TanStack Table cell / header / footer SLOT into a
* Glimmer-renderable node.
*
* Naming note: this used to be `FlexRender`, mirroring TanStack's
* upstream React `flexRender` helper. Renamed to `SlotRender` because
* the concept here is a *composition slot* (the column def declares
* "render this thing here"), not a *flexible cell type*. We reserve
* "Flex" for the schema-level concept of a cell that can hold
* string / number / date / etc. (Excel-style).
*
* Conventions:
* - `@context` may be the resolved context object **or** the
*   `cell.getContext` / `header.getContext` function. SlotRender invokes
*   it once if it is a function.
* - `@content` may be a string, number, a `(context) => result` producer
*   (the most common form in TanStack column defs), or a Glimmer component
*   class. Producers are invoked with the resolved context.
* - The final resolved value renders as text if string / number; as a
*   component if a class; as `String(value)` otherwise.
*/
var SlotRender = class extends Component {
	get resolvedContext() {
		const ctx = this.args.context;
		return typeof ctx === "function" ? ctx() : ctx;
	}
	get resolvedContent() {
		const c = this.args.content;
		if (typeof c === "function") return c(this.resolvedContext);
		return c;
	}
	get isComponent() {
		const r = this.resolvedContent;
		return typeof r === "function" && r !== null && "prototype" in r;
	}
	get asComponent() {
		return this.resolvedContent;
	}
	get asPrimitive() {
		const r = this.resolvedContent;
		if (r == null) return null;
		if (typeof r === "string" || typeof r === "number") return r;
		return String(r);
	}
};
_SlotRender = SlotRender;
setComponentTemplate(precompileTemplate("{{#if this.isComponent}}\n  {{#let this.asComponent as |C|}}\n    <C @context={{this.resolvedContext}} />\n  {{/let}}\n{{else}}\n  {{this.asPrimitive}}\n{{/if}}", { strictMode: true }), _SlotRender);
/**
* `<VirtualSpacer>` — invisible-ish placeholder div that occupies the
* height of the unrendered rows above (or below) the virtual window.
*
* Phase 2B.4 of EMBED-READINESS-PLAN.md. Lets the scroll container
* report the correct scrollHeight for the full dataset even when only
* a window of rows is in the DOM.
*
* Pure visual: a solid pale tint so fast scrolling doesn't show stark
* white. The consumer renders one above the visible window and one
* below, both using this component.
*
* Width is set by the parent's grid-row sizing (matches a normal row);
* height comes from `@style`.
*/
var VirtualSpacer = setComponentTemplate(precompileTemplate("<div class=\"boxel-virtual-spacer virtual-spacer\" style={{@style}} aria-hidden=\"true\" ...attributes></div>\n\n<style scoped>\n  /* Pale tint — visible enough to read as \"more content here\" during\n   * a fast scroll, quiet enough to disappear at rest. No stripe\n   * pattern (read as busy at large heights). */\n  .boxel-virtual-spacer {\n    background: rgba(0, 0, 0, 0.015);\n  }\n</style>", { strictMode: true }), templateOnly());
var _RowIterator;
/**
* `<RowIterator>` — pure body-iteration composable.
*
* Phase 3b of EMBED-READINESS-PLAN.md: extracts the body-iteration
* core that previously lived inside `<Grid>`'s `<:bodyRow>` slot
* handling. The iterator renders NO wrapper of its own — only the
* top/bottom virtual spacers (when configured) and the per-row
* yield. Consumers compose any layout around it: a CSS Grid body,
* a flex column, a virtualized list, even a non-table layout that
* happens to walk TanStack rows.
*
* Usage — bare:
*
* ```gts
* <RowIterator @table={{this.tableR.table}} as |row rowIdx|>
*   <div class="my-row" data-row={{rowIdx}}>
*     {{!-- cells --}}
*   </div>
* </RowIterator>
* ```
*
* Usage — with virtualization:
*
* ```gts
* <RowIterator
*   @table={{this.tableR.table}}
*   @virtual={{hash
*     rows=this.virtualRows
*     start=this.virtualStart
*     topSpacerStyle=this.topSpacerStyle
*     bottomSpacerStyle=this.bottomSpacerStyle
*   }}
*   as |row rowIdx|
* >
*   {{!-- per-row content --}}
* </RowIterator>
* ```
*
* Why standalone: `<Grid>` bakes in a body wrapper (role=rowgroup,
* class=boxel-grid-body) and a prescribed shape. Hosts that need
* a different body shape — or no body wrapper at all — can drop
* `<Grid>` entirely and compose `<RowIterator>` with whatever
* layout they want. The mechanics (key=id iteration, rowIdx offset
* math, spacer placement) are the same in both cases, so the
* iterator owns them.
*
* `<Grid>`'s `<:bodyRow>` slot uses this internally — same code
* path, same behavior. Consumers picking either shape get the
* same iteration semantics.
*/
var RowIterator = class extends Component {
	constructor(...args) {
		super(...args);
		_defineProperty(this, "globalRowIdx", (localIdx) => {
			return this.start + localIdx;
		});
	}
	get rows() {
		return this.args.virtual?.rows ?? this.args.table.getRowModel().rows;
	}
	get start() {
		return this.args.virtual?.start ?? 0;
	}
};
_RowIterator = RowIterator;
setComponentTemplate(precompileTemplate("{{#if @virtual.topSpacerStyle}}\n  <VirtualSpacer @style={{@virtual.topSpacerStyle}} />\n{{/if}}\n{{#each this.rows key=\"id\" as |row localIdx|}}\n  {{yield row (this.globalRowIdx localIdx)}}\n{{/each}}\n{{#if @virtual.bottomSpacerStyle}}\n  <VirtualSpacer @style={{@virtual.bottomSpacerStyle}} />\n{{/if}}", {
	strictMode: true,
	scope: () => ({ VirtualSpacer })
}), _RowIterator);
var PROJECTION_CLASSES = [
	"is-navigable-target",
	"is-editable-target",
	"is-editable",
	"is-drop-target",
	"is-focused",
	"is-selected",
	"is-focus-path",
	"is-surface-focused",
	"is-surface-selected",
	"is-surface-focus-path",
	"is-surface-edit-anchor"
];
var ACTIVITY_ROLE_PREFIX = "is-layer-";
function applyGridProjectionToDom(root, projection, gridId) {
	const rootNode = projection.nodeMap.get(gridId);
	if (rootNode) applyGridProjectionNode(root, rootNode);
	let focusCandidate = null;
	for (const element of root.querySelectorAll("[data-bx-grid-traversal-id]")) {
		const id = element.dataset["bxGridTraversalId"];
		if (!id) continue;
		const projected = projection.nodeMap.get(id);
		if (projected) {
			applyGridProjectionNode(element, projected);
			if (!focusCandidate && projected.selected && isGridCell(element)) focusCandidate = element;
		}
	}
	if (focusCandidate && shouldRestoreGridFocus(root)) focusCandidate.focus({ preventScroll: true });
}
function applyGridProjectionNode(element, projected) {
	clearProjectionClasses(element);
	const surfaceAdornments = new Set(projected.surfaceAdornments);
	const surfaceFocused = surfaceAdornments.has("focus");
	const surfaceSelected = surfaceAdornments.has("selection");
	const surfaceFocusPath = projected.focusPath && !projected.focused && !surfaceFocused;
	element.classList.toggle("is-navigable-target", projected.traversalStop);
	element.classList.toggle("is-editable-target", projected.traversalStop && projected.editable);
	element.classList.toggle("is-editable", projected.editable);
	element.classList.toggle("is-drop-target", projected.receiver);
	element.classList.toggle("is-focused", projected.focused);
	element.classList.toggle("is-selected", projected.selected);
	element.classList.toggle("is-focus-path", projected.focusPath);
	element.classList.toggle("is-surface-focused", surfaceFocused);
	element.classList.toggle("is-surface-selected", surfaceSelected);
	element.classList.toggle("is-surface-focus-path", surfaceFocusPath);
	element.classList.toggle("is-surface-edit-anchor", surfaceAdornments.has("edit-anchor"));
	for (const role of projected.layerRoles) element.classList.add(`${ACTIVITY_ROLE_PREFIX}${role}`);
	if (projected.tabIndex === null) element.removeAttribute("tabindex");
	else element.tabIndex = projected.tabIndex;
	if (isGridCell(element)) {
		element.toggleAttribute("data-bx-grid-active", projected.selected);
		element.toggleAttribute("data-bx-grid-selected", projected.selected);
		element.setAttribute("aria-selected", projected.selected ? "true" : "false");
	} else if (isGridRow(element)) {
		element.toggleAttribute("data-bx-grid-active-row", projected.selected);
		element.toggleAttribute("data-bx-grid-selected-row", projected.selected);
		element.setAttribute("aria-selected", projected.selected ? "true" : "false");
	}
	if (projected.traversalReason) element.dataset["stopReason"] = projected.traversalReason;
	else delete element.dataset["stopReason"];
	element.dataset["surfaceVisualAdornments"] = projected.visualAdornments.join(" ");
	element.dataset["surfaceAdornments"] = projected.surfaceAdornments.join(" ");
	element.dataset["surfaceDecalAdornments"] = projected.decalAdornments.join(" ");
	element.dataset["surfaceSuppressedAdornments"] = projected.suppressedAdornments.join(" ");
}
function isGridCell(element) {
	return element.hasAttribute("data-bx-grid-cell") || element.getAttribute("role") === "gridcell";
}
function isGridRow(element) {
	return element.hasAttribute("data-bx-grid-row") || element.getAttribute("role") === "row";
}
function shouldRestoreGridFocus(root) {
	const active = root.ownerDocument.activeElement;
	if (!(active instanceof HTMLElement)) return true;
	if (active === root.ownerDocument.body || active === root) return true;
	if (!root.contains(active)) return false;
	return !active.matches("input, textarea, select, [contenteditable=\"\"], [contenteditable=\"true\"], [data-surface-key-scope], [data-surface-key-scope] *");
}
function clearProjectionClasses(element) {
	for (const className of [...element.classList]) if (PROJECTION_CLASSES.includes(className) || className.startsWith(ACTIVITY_ROLE_PREFIX)) element.classList.remove(className);
}
var ACTION_SELECTOR = [
	"button",
	"a[href]",
	"input",
	"textarea",
	"select",
	"[contenteditable=\"\"]",
	"[contenteditable=\"true\"]",
	"[role=\"button\"]",
	"[role=\"link\"]",
	"[role=\"menuitem\"]",
	"[role=\"option\"]",
	"[role=\"switch\"]",
	"[role=\"tab\"]"
].join(", ");
function directChildByClass(root, className) {
	for (const child of Array.from(root.children)) if (child instanceof HTMLElement && child.classList.contains(className)) return child;
	return null;
}
function visible(element) {
	if (element.offsetParent !== null || element.getClientRects().length > 0) return true;
	if (element.ownerDocument.defaultView?.getComputedStyle(element).display !== "contents") return false;
	return Array.from(element.children).some((child) => child instanceof HTMLElement && visible(child));
}
function stableDomKey(element, fallback) {
	return element.dataset["bxGridKey"] ?? element.dataset["cellId"] ?? element.dataset["rowKey"] ?? element.dataset["colKey"] ?? element.dataset["bxGridRowKey"] ?? element.dataset["bxGridCellKey"] ?? element.dataset["cardId"] ?? element.dataset["cardName"] ?? element.getAttribute("aria-label") ?? fallback;
}
function safeIdPart(value) {
	return safeGridIdPart(value);
}
function ensureNodeId(element, fallback, registered) {
	if (!element.id) element.id = fallback;
	if (registered) element.dataset["ladderId"] = element.id;
	else delete element.dataset["ladderId"];
	element.dataset["bxGridTraversalId"] = element.id;
	return element.id;
}
function stampSurface(element, surface, target) {
	element.dataset["surface"] = surface;
	element.dataset["surfaceComponent"] = surface;
	if (target) element.dataset["surfaceTarget"] = target;
	else delete element.dataset["surfaceTarget"];
}
function registerNode(ladder, runtime, unregisters, element, registration) {
	stampSurface(element, registration.surface, registration.target);
	element.dataset["surfaceFocusKey"] = registration.focusKey ?? registration.id;
	if (ladder) unregisters.push(ladder.register(registration));
	if (runtime) {
		unregisters.push(runtime.register(registration));
		unregisters.push(registerSurfaceDomNode(runtime, registration.id, element));
	}
}
function paint(root, ladder, runtime, gridId) {
	const runtimeProjection = runtime?.projection({ mode: surfaceModeForGrid(root) });
	if (runtimeProjection) {
		applyGridProjectionToDom(root, runtimeProjection, gridId);
		return;
	}
	const rootFocused = ladder?.isFocused(gridId) ?? false;
	const rootSelected = rootFocused;
	const rootFocusPath = ladder?.isOnFocusPath(gridId) ?? false;
	root.classList.toggle("is-surface-focused", rootFocused);
	root.classList.toggle("is-surface-selected", rootSelected);
	root.classList.toggle("is-surface-focus-path", rootFocusPath && !rootFocused);
	for (const element of root.querySelectorAll("[data-bx-grid-traversal-id]")) {
		const id = element.dataset["bxGridTraversalId"];
		if (!id) continue;
		const focused = ladder?.isFocused(id) ?? false;
		const selected = ladder?.isSelected(id) ?? false;
		const focusPath = ladder?.isOnFocusPath(id) ?? false;
		element.classList.toggle("is-surface-focused", focused);
		element.classList.toggle("is-surface-selected", selected);
		element.classList.toggle("is-surface-focus-path", focusPath && !focused);
	}
}
function surfaceModeForGrid(root) {
	const mode = root.closest("[data-surface-mode]")?.dataset["surfaceMode"];
	return mode === "use" || mode === "change" || mode === "inspect" || mode === "debug" ? mode : void 0;
}
function runtimeConfig(options, parentId, gridId) {
	return {
		gridId,
		parentId,
		preset: options.preset,
		selection: options.selection,
		keyboard: options.keyboard,
		editable: options.editable,
		sortable: options.sortable
	};
}
function headerActionElements(root, options) {
	if (!options.sortable) return [];
	const header = directChildByClass(root, "boxel-grid-header");
	if (!header) return [];
	return Array.from(header.querySelectorAll(ACTION_SELECTOR)).filter((action) => action.closest(".boxel-grid") === root && visible(action));
}
function bodyRows(root) {
	const body = directChildByClass(root, "boxel-grid-body");
	if (!body) return [];
	return Array.from(body.querySelectorAll("[data-bx-grid-row], [role=\"row\"]")).filter((row) => row.closest(".boxel-grid") === root && visible(row));
}
function rowCells(root, row) {
	return Array.from(row.querySelectorAll("[data-bx-grid-cell], [role=\"gridcell\"], [role=\"cell\"]")).filter((cell) => cell.closest(".boxel-grid") === root && visible(cell));
}
function matchingElement(elements, used, keys, fallbackIndex) {
	const normalizedKeys = new Set(keys.filter((key) => Boolean(key)));
	for (const element of elements) {
		if (used.has(element)) continue;
		const domKey = stableDomKey(element, "");
		if (normalizedKeys.has(domKey) || normalizedKeys.has(element.id)) {
			used.add(element);
			return element;
		}
	}
	const fallback = elements[fallbackIndex];
	if (fallback && !used.has(fallback)) {
		used.add(fallback);
		return fallback;
	}
	for (const element of elements) {
		if (used.has(element)) continue;
		used.add(element);
		return element;
	}
}
function bindHeaderModel(root, options, gridId, registered, model) {
	const actions = headerActionElements(root, options);
	const used = /* @__PURE__ */ new Set();
	const ids = /* @__PURE__ */ new Map();
	const elements = /* @__PURE__ */ new Map();
	const bound = [];
	model.forEach((action, index) => {
		const element = matchingElement(actions, used, [
			action.key,
			action.id,
			action.focusKey
		], index);
		if (!element) return;
		element.dataset["bxGridKey"] = action.key;
		const id = ensureNodeId(element, action.id ?? `${gridId}-header-action-${safeIdPart(action.key || String(index))}`, registered);
		ids.set(action.key, id);
		elements.set(id, element);
		bound.push(action);
	});
	return {
		actions: bound,
		ids,
		elements
	};
}
function bindBodyModel(root, gridId, registered, model) {
	const rowElements = bodyRows(root);
	const usedRows = /* @__PURE__ */ new Set();
	const rowIds = /* @__PURE__ */ new Map();
	const cellIds = /* @__PURE__ */ new Map();
	const elements = /* @__PURE__ */ new Map();
	const rows = [];
	model.forEach((row, rowOrdinal) => {
		const rowElement = matchingElement(rowElements, usedRows, [
			row.key,
			row.id,
			row.focusKey
		], rowOrdinal);
		if (!rowElement) return;
		rowElement.dataset["bxGridRow"] = "";
		rowElement.dataset["bxGridRowKey"] = row.key;
		rowElement.dataset["bxGridRowIndex"] = String(row.index);
		const rowId = ensureNodeId(rowElement, row.id ?? `${gridId}-row-${safeIdPart(row.key)}`, registered);
		rowIds.set(row.key, rowId);
		elements.set(rowId, rowElement);
		const cellElements = rowCells(root, rowElement);
		const usedCells = /* @__PURE__ */ new Set();
		const cells = [];
		row.cells.forEach((cell, columnOrdinal) => {
			const cellElement = matchingElement(cellElements, usedCells, [
				cell.key,
				cell.id,
				cell.focusKey,
				cell.columnId
			], columnOrdinal);
			if (!cellElement) return;
			cellElement.dataset["bxGridCell"] = "";
			cellElement.dataset["bxGridCellKey"] = cell.key;
			cellElement.dataset["bxGridRowIndex"] = String(cell.rowIndex);
			cellElement.dataset["bxGridColumnIndex"] = String(cell.columnIndex);
			const cellId = ensureNodeId(cellElement, cell.id ?? `${gridId}-cell-${safeIdPart(cell.key)}`, registered);
			cellIds.set(cell.key, cellId);
			elements.set(cellId, cellElement);
			cells.push(cell);
		});
		rows.push({
			...row,
			cells
		});
	});
	return {
		rows,
		rowIds,
		cellIds,
		elements
	};
}
function registerPlannedTraversal(root, ladder, runtime, unregisters, plan, elementById, gridId) {
	const gridElement = elementById.get(plan.grid.id) ?? root;
	stampSurface(gridElement, plan.grid.surface, plan.grid.target);
	if (ladder) unregisters.push(ladder.register(plan.grid));
	if (runtime) {
		unregisters.push(runtime.register(plan.grid));
		unregisters.push(registerSurfaceDomNode(runtime, plan.grid.id, gridElement));
	}
	for (const registration of [
		...plan.headerActions,
		...plan.rows,
		...plan.cells
	]) {
		const element = elementById.get(registration.id);
		if (!element) continue;
		registerNode(ladder, runtime, unregisters, element, registration);
	}
	if (ladder) for (const order of plan.siblingOrders) ladder.setSiblings(order.parentId, order.ids);
	if (runtime) for (const order of plan.siblingOrders) runtime.setSiblings(order.parentId, order.ids);
	paint(root, ladder, runtime, gridId);
}
function registerModelTraversal(root, ladder, runtime, options, parentId, gridId) {
	if (!options.modelOwned || !options.model) return null;
	const unregisters = [];
	const registered = Boolean(ladder || runtime);
	const config = runtimeConfig(options, parentId, gridId);
	const header = bindHeaderModel(root, options, gridId, registered, options.model.headerActions ?? []);
	const body = bindBodyModel(root, gridId, registered, options.model.rows);
	const elementById = new Map([
		[gridId, root],
		...header.elements,
		...body.elements
	]);
	registerPlannedTraversal(root, ladder, runtime, unregisters, gridRuntimeRegistrationPlan(config, {
		...options.model,
		headerActions: header.actions,
		rows: body.rows
	}, {
		gridId,
		headerActionIds: header.ids,
		rowIds: body.rowIds,
		cellIds: body.cellIds
	}), elementById, gridId);
	return unregisters;
}
function buildDomTraversalModel(root, options, gridId, registered) {
	const elementById = new Map([[gridId, root]]);
	const headerActions = headerActionElements(root, options).map((action, index) => {
		const key = stableDomKey(action, String(index));
		const id = ensureNodeId(action, `${gridId}-header-action-${safeIdPart(key)}`, registered);
		action.dataset["bxGridKey"] = key;
		elementById.set(id, action);
		return {
			id,
			key,
			focusKey: id
		};
	});
	const rows = bodyRows(root).map((row, rowIndex) => {
		row.dataset["bxGridRow"] = "";
		row.dataset["bxGridRowIndex"] = String(rowIndex);
		const rowKey = row.dataset["rowKey"] ?? stableDomKey(row, String(rowIndex));
		const rowId = ensureNodeId(row, `${gridId}-row-${safeIdPart(rowKey)}`, registered);
		row.dataset["bxGridRowKey"] = rowKey;
		elementById.set(rowId, row);
		return {
			id: rowId,
			key: rowKey,
			focusKey: rowId,
			index: rowIndex,
			cells: rowCells(root, row).map((cell, columnIndex) => {
				cell.dataset["bxGridCell"] = "";
				cell.dataset["bxGridRowIndex"] = String(rowIndex);
				cell.dataset["bxGridColumnIndex"] = String(columnIndex);
				const columnId = cell.dataset["colKey"] ?? cell.dataset["bxGridColumnId"] ?? String(columnIndex);
				const cellKey = cell.dataset["bxGridCellKey"] ?? cell.dataset["cellId"] ?? `${rowKey}-${columnId}`;
				const cellId = ensureNodeId(cell, `${gridId}-cell-${safeIdPart(cellKey)}`, registered);
				cell.dataset["bxGridCellKey"] = cellKey;
				elementById.set(cellId, cell);
				return {
					id: cellId,
					key: cellKey,
					focusKey: cellId,
					rowKey,
					rowIndex,
					columnIndex,
					columnId,
					editable: options.editable
				};
			})
		};
	});
	return {
		model: {
			headerActions,
			rows,
			rowCount: rows.length,
			columnCount: Math.max(0, ...rows.map((row) => row.cells.length))
		},
		elementById
	};
}
function registerTraversal(root, ladder, runtime, options) {
	const unregisters = [];
	const registered = Boolean(ladder || runtime);
	const parentId = options.parentId ?? parentSurfaceIdForElement(root);
	const gridId = ensureNodeId(root, options.gridId, registered);
	const modelUnregisters = registerModelTraversal(root, ladder, runtime, options, parentId, gridId);
	if (modelUnregisters) return modelUnregisters;
	const { model, elementById } = buildDomTraversalModel(root, options, gridId, registered);
	registerPlannedTraversal(root, ladder, runtime, unregisters, gridRuntimeRegistrationPlan(runtimeConfig(options, parentId, gridId), model), elementById, gridId);
	return unregisters;
}
var gridTraversal = modifier((element, [ladder], options) => {
	if (options.enabled === false) return;
	let destroyed = false;
	let unregisters = [];
	let frame;
	let activeLadder;
	let activeRuntime;
	let unsubscribe;
	let unsubscribeRuntime;
	let ladderRetryCount = 0;
	const clear = () => {
		for (const unregister of unregisters) unregister();
		unregisters = [];
	};
	const setActiveSources = (nextLadder, nextRuntime) => {
		if (nextLadder === activeLadder && nextRuntime === activeRuntime) return;
		unsubscribe?.();
		unsubscribeRuntime?.();
		unsubscribe = void 0;
		unsubscribeRuntime = void 0;
		activeLadder = nextLadder;
		activeRuntime = nextRuntime;
		const repaint = () => {
			const gridId = element.dataset["bxGridTraversalId"] ?? element.id ?? options.gridId;
			paint(element, activeLadder, activeRuntime, gridId);
		};
		unsubscribe = activeLadder?.subscribe(repaint);
		unsubscribeRuntime = activeRuntime?.subscribe(repaint);
	};
	const sync = () => {
		if (destroyed) return;
		const owningLadder = ladder ?? ladderForSurfaceElement(element);
		const owningRuntime = options.runtime ?? surfaceRuntimeForElement(element);
		setActiveSources(owningLadder, owningRuntime);
		const endRuntimeBatch = owningRuntime?.beginBatch();
		try {
			clear();
			unregisters = registerTraversal(element, owningLadder, owningRuntime, options);
		} finally {
			endRuntimeBatch?.();
		}
		if ((!owningLadder || !owningRuntime) && ladderRetryCount < 10) {
			ladderRetryCount++;
			schedule();
		} else if (owningLadder && owningRuntime) ladderRetryCount = 0;
	};
	const schedule = () => {
		if (frame !== void 0) return;
		frame = requestAnimationFrame(() => {
			frame = void 0;
			sync();
		});
	};
	const observer = new MutationObserver(schedule);
	observer.observe(element, {
		childList: true,
		subtree: true
	});
	schedule();
	return () => {
		destroyed = true;
		if (frame !== void 0) cancelAnimationFrame(frame);
		observer.disconnect();
		unsubscribe?.();
		unsubscribeRuntime?.();
		clear();
	};
});
var sheetRuntimeRoot = modifier((element, _positional, named) => {
	if (!named.runtime) return;
	return registerSheetRuntimeRoot(element, named.runtime);
});
var _dec$1, _dec2$1, _dec3, _dec4, _dec5, _class$3, _descriptor$3, _descriptor2$2, _descriptor3$2, _descriptor4$1, _descriptor5, _descriptor6, _descriptor7, _Grid;
var GRID_PRESETS = {
	sheet: {
		stickyHeader: true,
		contained: true,
		selection: "cell-range",
		keyboard: "cell",
		editable: true,
		sortable: true,
		chrome: "standard"
	},
	table: {
		stickyHeader: true,
		contained: true,
		selection: "none",
		keyboard: "none",
		editable: false,
		sortable: true,
		chrome: "plain"
	},
	collection: {
		stickyHeader: true,
		contained: true,
		selection: "row",
		keyboard: "row",
		editable: false,
		sortable: true,
		chrome: "list"
	},
	headless: {
		stickyHeader: false,
		contained: false,
		selection: "none",
		keyboard: "none",
		editable: false,
		sortable: false,
		chrome: "none"
	}
};
var nextGridInstance = 0;
var GRID_NAVIGATION_KEYS = new Set([
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"Home",
	"End",
	"PageUp",
	"PageDown",
	"Tab",
	"Enter",
	"F2"
]);
/**
* `<Grid>` — wrapper component for grids built on `@tanstack/ember-table`.
*
* Phase 2.2 of EMBED-READINESS-PLAN.md: this component now owns the
* SCROLL CONTAINER that wraps the header + body. Pass any wrapper-level
* attrs / event handlers / CSS variables through the splattribute sink:
*
* ```gts
* <Grid
*   @table={{this.tableR.table}}
*   class="my-variant"
*   style={{this.gridChromeStyle}}
*   tabindex="0"
*   {{on "keydown" this.handleKeydown}}
*   {{on "scroll" this.trackScroll}}
* >
*   {{!-- header / body / overlays --}}
* </Grid>
* ```
*
* The wrapper class is `boxel-grid` (new) AND `grid-wrapper` (legacy alias
* — kept so existing `document.querySelector('.grid-wrapper')` calls keep
* working). New consumers should target `.boxel-grid`.
*
* Layout / sticky chrome OWNED here:
*  - `position: relative` (containing block for absolutely-positioned overlays)
*  - `overflow-x: auto`, `overflow-y: visible` (default scroll behaviour)
*  - background, border, focus ring
*  - `--row-h`, `--col-num-w`, `--col-select-w` CSS variable defaults
*    (consumers can override via inline style on the splat)
*  - body iteration + virtual spacers when `<:bodyRow>` is used
*
* Default-block yield (table back to consumer) stays as the escape hatch
* for full-control rendering.
*/
var Grid = (_dec$1 = consume(LadderContextName), _dec2$1 = consume(SurfaceRuntimeContextName), _dec3 = consume(ParentIdContextName), _dec4 = consume(SurfaceScopeContextName), _dec5 = consume(SheetRuntimeContextName), _class$3 = (_Grid = class Grid extends Component {
	constructor(...args) {
		super(...args);
		_defineProperty(this, "instanceId", `boxel-grid-${++nextGridInstance}`);
		_defineProperty(this, "gridTraversal", gridTraversal);
		_defineProperty(this, "sheetRuntimeRoot", sheetRuntimeRoot);
		_initializerDefineProperty(this, "inheritedLadder", _descriptor$3, this);
		_initializerDefineProperty(this, "inheritedRuntime", _descriptor2$2, this);
		_initializerDefineProperty(this, "inheritedParentId", _descriptor3$2, this);
		_initializerDefineProperty(this, "inheritedScopeRelay", _descriptor4$1, this);
		_initializerDefineProperty(this, "inheritedSheetRuntime", _descriptor5, this);
		_initializerDefineProperty(this, "activeRowId", _descriptor6, this);
		_initializerDefineProperty(this, "activeRowState", _descriptor7, this);
		_defineProperty(this, "rowAnchorIndex", null);
		_defineProperty(this, "localScopeRelay", void 0);
		_defineProperty(this, "gridActions", {
			selectCell: (rowKey, colKey) => this.selectCellByKey(rowKey, colKey),
			selectColumn: (colKey) => this.selectColumnByKey(colKey),
			selectRow: (rowKey) => this.selectRowByKey(rowKey),
			clearSelection: () => this.clearSelection(),
			focusGrid: () => this.focusGrid()
		});
		_defineProperty(this, "handleMouseDown", (event) => {
			if (event.button !== 0 || this.selectionMode === "none") return;
			if (isSurfaceTextEntryTarget(event.target)) return;
			const root = event.currentTarget;
			if (!(root instanceof HTMLElement)) return;
			if (this.selectionMode === "row") {
				const row = this.rowForEvent(root, event);
				if (row) {
					event.preventDefault();
					this.activateRow(root, row, event.shiftKey, event);
					event.stopPropagation();
				}
				return;
			}
			const cell = this.cellForEvent(root, event);
			if (cell && this.activateRuntimeCell(root, cell, event.shiftKey)) {
				if (event.detail >= 2) this.openRuntimeCellEdit(root, cell, "dblclick");
				event.preventDefault();
				event.stopPropagation();
			}
		});
		_defineProperty(this, "handleKeydown", (event) => {
			const root = event.currentTarget;
			if (!(root instanceof HTMLElement)) return;
			if (event.defaultPrevented) return;
			if (this.eventHasSurfaceKeyScope(event)) {
				if (event.key === "Escape" || GRID_NAVIGATION_KEYS.has(event.key)) event.stopPropagation();
				return;
			}
			if (event.key === "Escape") {
				if (isSurfaceTextEntryTarget(event.target)) {
					event.stopPropagation();
					return;
				}
				if (this.clearInteractionState(root, event)) {
					event.preventDefault();
					event.stopPropagation();
					return;
				}
			}
			if (this.keyboard === "none") return;
			if (surfaceTargetOwnsKeyboardEvent(event)) return;
			if (this.keyboard === "row") {
				if (this.handleRowKeydown(root, event)) event.stopPropagation();
				return;
			}
			if (this.usesSheetRuntime) {
				if (this.handleRuntimeCellKeydown(event)) event.stopPropagation();
				return;
			}
		});
		_defineProperty(this, "handleClearRequest", (event) => {
			const root = event.currentTarget;
			if (!(root instanceof HTMLElement)) return;
			this.clearInteractionState(root, event);
		});
		_defineProperty(this, "sheetRuntimeBridge", modifier((root, _positional, named) => {
			const runtime = named.runtime;
			if (!runtime || !this.usesSheetRuntime) return;
			const unsubscribers = [runtime.selection.onChange((target) => {
				if (!this.isSheetCellTarget(target)) {
					this.runtime?.clearInteractionState();
					return;
				}
				const selection = this.syncSurfaceSelectionFromRuntimeTarget(root, target);
				if (selection) this.notifySelect(selection);
			}), runtime.edit.onOpen((state) => {
				const cell = this.cellElementForSheetTarget(root, state.target);
				const selection = this.selectionFromRuntimeTarget(state.target, cell ?? void 0);
				if (selection) this.notifyActivate(selection);
			})];
			return () => {
				for (const unsubscribe of unsubscribers) unsubscribe();
			};
		}));
		_defineProperty(this, "runtimeDocumentKeydown", modifier((root) => {
			const document = root.ownerDocument;
			const handleKeydown = (event) => {
				if (event.defaultPrevented || !this.usesSheetRuntime) return;
				if (this.keyboard !== "cell") return;
				if (root.contains(event.target)) return;
				if (!this.effectiveSheetRuntime?.selection.current) return;
				const activeElement = document.activeElement;
				if (activeElement !== document.body && activeElement !== document.documentElement) return;
				if (surfaceTargetOwnsKeyboardEvent(event)) return;
				if (this.handleRuntimeCellKeydown(event)) event.stopPropagation();
			};
			document.addEventListener("keydown", handleKeydown);
			return () => document.removeEventListener("keydown", handleKeydown);
		}));
	}
	get scopeRelay() {
		let relay = this.localScopeRelay;
		if (!relay || relay.parent !== this.inheritedScopeRelay) {
			relay = createSurfaceScopeRelay(this.inheritedScopeRelay);
			this.localScopeRelay = relay;
		}
		return relay;
	}
	get preset() {
		return this.args.preset ?? "sheet";
	}
	get presetConfig() {
		return GRID_PRESETS[this.preset];
	}
	get stickyHeader() {
		return this.args.stickyHeader ?? this.presetConfig.stickyHeader;
	}
	get contained() {
		return this.args.contained ?? this.presetConfig.contained;
	}
	get selectionMode() {
		return this.args.selection ?? this.presetConfig.selection;
	}
	get keyboard() {
		return this.args.keyboard ?? this.presetConfig.keyboard;
	}
	get editable() {
		return this.args.editable ?? this.presetConfig.editable;
	}
	get sortable() {
		return this.args.sortable ?? this.presetConfig.sortable;
	}
	get chrome() {
		return this.args.chrome ?? this.presetConfig.chrome;
	}
	get isInteractive() {
		return this.keyboard !== "none" || this.selectionMode !== "none";
	}
	get preservesSurfaceFocus() {
		return this.args.preserveSurfaceFocus ?? (this.isInteractive || this.editable || this.sortable);
	}
	get surfacePreserveFocusAttribute() {
		return this.preservesSurfaceFocus ? "" : null;
	}
	get rootClass() {
		return [
			"boxel-grid",
			"grid-wrapper",
			`boxel-grid--preset-${this.preset}`,
			`boxel-grid--chrome-${this.chrome}`,
			this.stickyHeader ? "has-sticky-header" : "has-static-header",
			this.contained ? "is-contained" : "is-uncontained",
			this.isInteractive ? "is-interactive" : "is-static"
		].join(" ");
	}
	get surfaceId() {
		return this.instanceId;
	}
	get parentSurfaceId() {
		return this.inheritedParentId ?? null;
	}
	get ladder() {
		return this.inheritedLadder;
	}
	get runtime() {
		return this.inheritedRuntime;
	}
	get effectiveSheetRuntime() {
		return this.args.sheet?.runtime ?? this.inheritedSheetRuntime;
	}
	get usesSheetRuntime() {
		return !!this.effectiveSheetRuntime && this.selectionMode !== "none" && this.selectionMode !== "row";
	}
	get table() {
		const table = this.args.table ?? this.args.sheet?.table;
		if (!table) throw new Error("<Grid> requires either @sheet or @table");
		return table;
	}
	get effectiveGridTemplateColumns() {
		return this.args.gridTemplateColumns ?? this.args.sheet?.gridTemplateColumns;
	}
	get traversalEnabled() {
		return this.preset !== "headless" || this.isInteractive || this.sortable;
	}
	get tabIndex() {
		return this.isInteractive ? "0" : null;
	}
	get activeDescendant() {
		return this.runtimeActiveCellState()?.id ?? this.activeRowId;
	}
	get ariaMultiselectable() {
		return this.selectionMode === "cell-range" ? "true" : null;
	}
	get selectionState() {
		const runtimeSelection = this.runtimeSelectionState();
		if (runtimeSelection) return runtimeSelection;
		return {
			activeCell: null,
			activeRow: this.activeRowState,
			activeColumn: this.activeColumnState,
			range: null
		};
	}
	get activeColumnState() {
		return this.runtimeActiveColumnState();
	}
	get actions() {
		return this.gridActions;
	}
	get headers() {
		const activeColumn = this.activeColumnState;
		return this.headerActionModel.map((action, index) => {
			const colKey = action.key;
			return {
				key: colKey,
				id: action.id ?? `${this.surfaceId}-header-action-${safeGridIdPart(colKey || String(index))}`,
				colKey,
				colIndex: index,
				active: activeColumn?.colKey === colKey
			};
		});
	}
	get yieldedGrid() {
		return {
			table: this.table,
			selection: this.selectionState,
			actions: this.actions,
			headers: this.headers
		};
	}
	get visibleColumnCount() {
		let table = this.table;
		return table.getVisibleLeafColumns?.().length ?? table.getAllLeafColumns?.().length ?? 1;
	}
	get headerStyle() {
		const cols = this.effectiveGridTemplateColumns;
		const rows = this.args.gridTemplateRows;
		if (!cols && !rows) return htmlSafe("");
		const parts = [];
		if (cols) parts.push(`grid-template-columns: ${cols}`);
		if (rows) parts.push(`grid-template-rows: ${rows}`);
		return htmlSafe(parts.join("; ") + ";");
	}
	/** Inline style for the body wrapper — same `grid-template-columns`
	*  the header uses, applied to the body wrapper too. The body wrapper
	*  becomes a CSS grid; each row gets `grid-column: 1 / -1` +
	*  `grid-template-columns: subgrid` so column widths are owned by
	*  ONE grid, not N. Without this every row's per-row grid could
	*  drift independently (different content widths reflowing in
	*  isolation), producing the jagged-column look. */
	get bodyStyle() {
		const cols = this.effectiveGridTemplateColumns;
		if (!cols) return htmlSafe("");
		return htmlSafe(`display: grid; grid-template-columns: ${cols};`);
	}
	get rowOffset() {
		return this.args.virtual?.start ?? 0;
	}
	get renderedRows() {
		return this.args.virtual?.rows ?? this.table.getRowModel().rows;
	}
	get traversalModel() {
		const rows = this.renderedRows.map((row, ordinal) => {
			const rowKey = String(row.id ?? ordinal);
			const rowIndex = this.rowOffset + ordinal;
			return {
				id: `${this.surfaceId}-row-${safeGridIdPart(rowKey)}`,
				key: rowKey,
				focusKey: `row:${rowKey}`,
				index: rowIndex,
				cells: this.cellsForRow(row).map((cell, columnIndex) => {
					const columnId = String(cell.column?.id ?? cell.id ?? columnIndex);
					const key = `${rowKey}-${columnId}`;
					return {
						id: `${this.surfaceId}-cell-${safeGridIdPart(key)}`,
						key,
						focusKey: `cell:${key}`,
						rowKey,
						rowIndex,
						columnIndex,
						columnId,
						editable: this.editable
					};
				})
			};
		});
		return {
			headerActions: this.headerActionModel,
			rows,
			rowCount: this.table.getRowModel().rows.length,
			columnCount: this.visibleColumnCount
		};
	}
	get headerActionModel() {
		if (!this.sortable) return [];
		const table = this.table;
		const actions = [];
		for (const group of table.getHeaderGroups?.() ?? []) for (const [index, header] of (group.headers ?? []).entries()) {
			if (header.isPlaceholder) continue;
			const columnId = String(header.column?.id ?? header.id ?? index);
			actions.push({
				id: `${this.surfaceId}-header-action-${safeGridIdPart(columnId)}`,
				key: columnId,
				focusKey: `header:${columnId}`
			});
		}
		return actions;
	}
	cellsForRow(row) {
		const rowLike = row;
		return rowLike.getVisibleCells?.() ?? rowLike.getAllCells?.() ?? [];
	}
	runtimeSelectionState() {
		const activeCell = this.runtimeActiveCellState();
		if (!activeCell) return null;
		return {
			activeCell,
			activeRow: null,
			activeColumn: {
				colKey: activeCell.colKey,
				colIndex: activeCell.colIndex
			},
			range: {
				startRow: activeCell.rowIndex,
				endRow: activeCell.rowIndex,
				startCol: activeCell.colIndex,
				endCol: activeCell.colIndex
			}
		};
	}
	runtimeActiveColumnState() {
		const activeCell = this.runtimeActiveCellState();
		if (!activeCell) return null;
		return {
			colKey: activeCell.colKey,
			colIndex: activeCell.colIndex
		};
	}
	runtimeActiveCellState() {
		if (!this.usesSheetRuntime) return null;
		const target = this.effectiveSheetRuntime?.selection.current ?? null;
		if (!this.isSheetCellTarget(target)) return null;
		const sheet = this.args.sheet;
		if (!sheet) return null;
		const rowIndex = sheet.rows.findIndex((row) => row.key === target.rowKey);
		const colIndex = sheet.columns.findIndex((column) => column.key === target.colKey);
		if (rowIndex < 0 || colIndex < 0) return null;
		return {
			id: this.activeCellIdForTarget(target),
			rowKey: target.rowKey,
			colKey: target.colKey,
			rowIndex,
			colIndex
		};
	}
	handleRuntimeCellKeydown(event) {
		const runtime = this.effectiveSheetRuntime;
		if (!runtime) return false;
		const hadSelection = runtime.selection.current !== null;
		const hadEdit = runtime.edit.active !== null;
		if (!runtime.keyboard.handle(event)) return false;
		const current = runtime.selection.current;
		if (this.isSheetCellTarget(current)) {
			this.syncGridStateFromRuntimeTarget(current);
			this.focusRuntimeCell(current);
		}
		if (event.key === "Escape" && hadSelection && !hadEdit && runtime.selection.current === null) this.args.onClear?.(event);
		return true;
	}
	handleRowKeydown(root, event) {
		const rows = this.rows(root);
		if (rows.length === 0) return false;
		const rawIndex = this.currentRowIndex(rows);
		if (rawIndex < 0) {
			if (!this.isRowEntryKey(event.key)) return false;
			event.preventDefault();
			const firstRow = rows[0];
			if (firstRow) this.activateRow(root, firstRow, false, event);
			return true;
		}
		const currentIndex = rawIndex;
		let nextIndex = currentIndex;
		switch (event.key) {
			case "ArrowUp":
				nextIndex = Math.max(0, currentIndex - 1);
				break;
			case "ArrowDown":
				nextIndex = Math.min(rows.length - 1, currentIndex + 1);
				break;
			case "Home":
				nextIndex = 0;
				break;
			case "End":
				nextIndex = rows.length - 1;
				break;
			case "PageUp":
				nextIndex = Math.max(0, currentIndex - 10);
				break;
			case "PageDown":
				nextIndex = Math.min(rows.length - 1, currentIndex + 10);
				break;
			case "Enter":
				event.preventDefault();
				{
					const currentRow = rows[currentIndex];
					if (currentRow) this.notifyActivate(this.rowSelection(root, currentRow), event);
				}
				return true;
			default: return false;
		}
		event.preventDefault();
		const nextRow = rows[nextIndex];
		if (!nextRow) return true;
		this.activateRow(root, nextRow, event.shiftKey, event);
		return true;
	}
	isRowEntryKey(key) {
		return [
			"ArrowUp",
			"ArrowDown",
			"Home",
			"End",
			"PageUp",
			"PageDown",
			"Enter"
		].includes(key);
	}
	closestCell(root, target) {
		const cell = target.closest("[data-bx-grid-cell], [role=\"gridcell\"], [role=\"cell\"]");
		if (!cell || !root.contains(cell) || cell.closest(".boxel-grid") !== root) return null;
		return cell.closest(".boxel-grid-body") ? cell : null;
	}
	closestRow(root, target) {
		const row = target.closest("[data-bx-grid-row], [role=\"row\"]");
		if (!row || !root.contains(row) || row.closest(".boxel-grid") !== root) return null;
		return row.closest(".boxel-grid-body") ? row : null;
	}
	cellForEvent(root, event) {
		const target = event.target;
		if (target instanceof Element) {
			const cell = this.closestCell(root, target);
			if (cell) return cell;
		}
		const hit = root.ownerDocument.elementFromPoint(event.clientX, event.clientY);
		if (hit instanceof Element) {
			const cell = this.closestCell(root, hit);
			if (cell) return cell;
		}
		return this.cellAtPoint(root, event.clientX, event.clientY);
	}
	rowForEvent(root, event) {
		const target = event.target;
		if (target instanceof Element) {
			const row = this.closestRow(root, target);
			if (row) return row;
		}
		const hit = root.ownerDocument.elementFromPoint(event.clientX, event.clientY);
		if (hit instanceof Element) {
			const row = this.closestRow(root, hit);
			if (row) return row;
		}
		return this.rowAtPoint(root, event.clientX, event.clientY);
	}
	cellAtPoint(root, x, y) {
		return this.cells(root).find((cell) => this.rectContains(cell, x, y)) ?? null;
	}
	rowAtPoint(root, x, y) {
		return this.rows(root).find((row) => this.rectContains(row, x, y)) ?? null;
	}
	rectContains(element, x, y) {
		const rect = element.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
	}
	cells(root) {
		const body = root.querySelector(".boxel-grid-body") ?? root;
		return Array.from(body.querySelectorAll("[data-bx-grid-cell], [role=\"gridcell\"], [role=\"cell\"]")).filter((cell) => cell.closest(".boxel-grid") === root && this.isVisible(cell));
	}
	rows(root) {
		const body = root.querySelector(".boxel-grid-body") ?? root;
		return Array.from(body.querySelectorAll("[data-bx-grid-row], [role=\"row\"]")).filter((row) => row.closest(".boxel-grid") === root && this.isVisible(row));
	}
	currentRootElement() {
		return globalThis.document?.querySelector(`[data-bx-grid-id="${this.surfaceId}"]`) ?? null;
	}
	selectCellByKey(rowKey, colKey) {
		if (this.usesSheetRuntime) {
			const target = {
				rowKey,
				colKey
			};
			this.effectiveSheetRuntime?.selection.select(target);
			this.syncGridStateFromRuntimeTarget(target);
			this.focusRuntimeCell(target);
		}
	}
	selectColumnByKey(colKey) {
		if (!this.usesSheetRuntime) return;
		const row = this.args.sheet?.rows[0];
		if (!row) return;
		this.selectCellByKey(row.key, colKey);
	}
	selectRowByKey(rowKey) {
		const root = this.currentRootElement();
		if (!root) return;
		const row = this.findRowByKey(root, rowKey);
		if (row) this.activateRow(root, row, false);
	}
	clearSelection() {
		if (this.effectiveSheetRuntime) {
			this.effectiveSheetRuntime.edit.cancel();
			this.effectiveSheetRuntime.selection.clear();
		}
		const root = this.currentRootElement();
		if (root) {
			this.clearInteractionState(root);
			return;
		}
		this.clearTrackedSelection();
		this.args.onClear?.();
	}
	focusGrid() {
		const root = this.currentRootElement();
		if (root) this.focusElement(root);
	}
	findRowByKey(root, rowKey) {
		return this.rows(root).find((row) => this.rowKeyForRow(row) === rowKey) ?? null;
	}
	rowKeyForRow(row) {
		return row.dataset["rowKey"] ?? row.dataset["bxGridRowKey"] ?? row.id;
	}
	colKeyForCell(cell) {
		return cell.dataset["colKey"] ?? cell.dataset["bxGridColumnId"] ?? cell.dataset["bxGridCellKey"] ?? this.colKeyFromCellId(this.selectionId(cell)) ?? cell.id;
	}
	currentRowIndex(rows) {
		return rows.findIndex((row) => row.id === this.activeRowId);
	}
	activateRuntimeCell(root, cell, extend) {
		if (!this.usesSheetRuntime) return false;
		const target = this.sheetTargetForCell(root, cell);
		const runtime = this.effectiveSheetRuntime;
		if (!target || !runtime) return false;
		runtime.selection.select(target, extend ? "extend" : "replace");
		const selection = this.syncGridStateFromRuntimeTarget(target, cell);
		this.focusRuntimeCell(target);
		this.focusLadderCell(selection?.id ?? cell.id, extend, root);
		return true;
	}
	focusRuntimeCell(target) {
		const handle = this.effectiveSheetRuntime?.cells.handle(target);
		if (handle) {
			handle.focus?.();
			handle.scrollIntoView?.();
		}
	}
	openRuntimeCellEdit(root, cell, source) {
		const runtime = this.effectiveSheetRuntime;
		const target = this.sheetTargetForCell(root, cell);
		if (!runtime || !target) return false;
		if (runtime.edit.open(target, { source })) {
			this.syncGridStateFromRuntimeTarget(target, cell);
			return true;
		}
		return false;
	}
	syncGridStateFromRuntimeTarget(target, knownCell) {
		const selection = this.selectionFromRuntimeTarget(target, knownCell);
		if (!selection) return null;
		this.activeRowId = null;
		this.activeRowState = null;
		if (knownCell) {
			if (!knownCell.id) knownCell.id = selection.id;
			knownCell.dataset["bxGridTraversalId"] = selection.id;
			knownCell.dataset["ladderId"] = selection.id;
		}
		return selection;
	}
	syncSurfaceSelectionFromRuntimeTarget(root, target, extend = false) {
		const cell = this.cellElementForSheetTarget(root, target);
		const selection = this.syncGridStateFromRuntimeTarget(target, cell ?? void 0);
		if (!selection) return null;
		this.focusLadderCell(selection.id, extend, root);
		return selection;
	}
	cellElementForSheetTarget(root, target) {
		return this.cells(root).find((cell) => {
			const candidate = this.sheetTargetForCell(root, cell);
			return candidate?.rowKey === target.rowKey && candidate.colKey === target.colKey;
		}) ?? null;
	}
	selectionFromRuntimeTarget(target, knownCell) {
		const sheet = this.args.sheet;
		if (!sheet) return null;
		const rowIndex = sheet.rows.findIndex((row) => row.key === target.rowKey);
		const colIndex = sheet.columns.findIndex((column) => column.key === target.colKey);
		if (rowIndex < 0 || colIndex < 0) return null;
		const id = knownCell?.dataset["bxGridTraversalId"] ?? knownCell?.id ?? this.activeCellIdForTarget(target);
		return {
			kind: "cell",
			id,
			focusKey: `cell:${`${target.rowKey}-${target.colKey}`}`,
			cellId: id,
			rowKey: target.rowKey,
			colKey: target.colKey,
			rowIndex,
			colIndex
		};
	}
	activeCellIdForTarget(target) {
		return `${this.surfaceId}-cell-${safeGridIdPart(`${target.rowKey}-${target.colKey}`)}`;
	}
	sheetTargetForCell(root, cell) {
		const row = this.closestRow(root, cell);
		const rowKey = cell.dataset["bxGridRowKey"] ?? (row ? this.rowKeyForRow(row) : void 0);
		const colKey = this.colKeyForCell(cell);
		if (!rowKey || !colKey) return null;
		return {
			rowKey,
			colKey
		};
	}
	isSheetCellTarget(target) {
		return !!target && "colKey" in target;
	}
	activateRow(root, row, extend, event) {
		const rows = this.rows(root);
		const index = rows.indexOf(row);
		if (index < 0) return;
		if (!extend || this.rowAnchorIndex === null) this.rowAnchorIndex = index;
		const start = Math.min(this.rowAnchorIndex ?? index, index);
		const end = Math.max(this.rowAnchorIndex ?? index, index);
		for (const [i, item] of rows.entries()) {
			const active = i === index;
			const selected = i >= start && i <= end;
			this.ensureElementId(item, "row", i);
			item.tabIndex = active ? 0 : -1;
			item.toggleAttribute("data-bx-grid-active-row", active);
			item.toggleAttribute("data-bx-grid-selected-row", selected);
			item.setAttribute("aria-selected", selected ? "true" : "false");
		}
		this.activeRowId = row.id;
		this.activeRowState = this.activeRowFromSelection(this.rowSelection(root, row));
		this.focusLadderRow(row.id, extend, root);
		this.focusElement(row);
		this.notifySelect(this.rowSelection(root, row), event);
	}
	focusLadderCell(id, extend, root) {
		const range = extend && this.selectionMode === "cell-range";
		if (this.ladder?.getNode(id)) this.ladder.select(id, { range });
		this.surfaceRuntimeFor(root)?.select(id, {
			range,
			restoreSource: true
		});
	}
	focusLadderRow(id, extend, root) {
		if (this.ladder?.getNode(id)) this.ladder.select(id, { range: extend });
		this.surfaceRuntimeFor(root)?.select(id, {
			range: extend,
			restoreSource: true
		});
	}
	surfaceRuntimeFor(root) {
		const currentRoot = root ?? this.currentRootElement();
		return this.runtime ?? (currentRoot ? surfaceRuntimeForElement(currentRoot) : void 0);
	}
	clearInteractionState(root, event) {
		const runtime = this.effectiveSheetRuntime;
		const hadRuntimeState = !!runtime && (runtime.selection.current !== null || runtime.edit.active !== null);
		runtime?.edit.cancel();
		runtime?.selection.clear();
		const hadLocalState = this.activeRowId !== null || this.rowAnchorIndex !== null || root.querySelector([
			"[data-bx-grid-active]",
			"[data-bx-grid-selected]",
			"[data-bx-grid-in-range]",
			"[data-bx-grid-active-row]",
			"[data-bx-grid-selected-row]"
		].join(", ")) !== null;
		for (const cell of this.cells(root)) {
			cell.tabIndex = -1;
			cell.removeAttribute("data-bx-grid-active");
			cell.removeAttribute("data-bx-grid-selected");
			cell.removeAttribute("data-bx-grid-in-range");
			cell.setAttribute("aria-selected", "false");
		}
		for (const row of this.rows(root)) {
			row.tabIndex = -1;
			row.removeAttribute("data-bx-grid-active-row");
			row.removeAttribute("data-bx-grid-selected-row");
			row.setAttribute("aria-selected", "false");
		}
		this.clearTrackedSelection();
		const hadLadderState = this.ladder?.clearSubtree(this.surfaceId) ?? false;
		if (hadLocalState || hadLadderState || hadRuntimeState) {
			this.focusElement(root);
			this.args.onClear?.(event);
			return true;
		}
		return false;
	}
	clearTrackedSelection() {
		this.activeRowId = null;
		this.activeRowState = null;
		this.rowAnchorIndex = null;
	}
	notifySelect(selection, event) {
		this.args.onSelect?.(selection, event);
	}
	notifyActivate(selection, event) {
		this.args.onActivate?.(selection, event);
	}
	rowSelection(root, row) {
		const allRows = this.rows(root);
		const rowIndex = this.indexFromDataset(row.dataset["bxGridRowIndex"], allRows.indexOf(row));
		return {
			kind: "row",
			id: this.selectionId(row),
			focusKey: row.dataset["surfaceFocusKey"],
			rowId: row.id,
			rowKey: this.rowKeyForRow(row),
			rowIndex
		};
	}
	selectionId(element) {
		return element.dataset["cellId"] ?? element.dataset["ladderId"] ?? element.dataset["bxGridCellKey"] ?? element.dataset["bxGridRowKey"] ?? element.id;
	}
	indexFromDataset(value, fallback) {
		if (value === void 0) return Math.max(0, fallback);
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : Math.max(0, fallback);
	}
	colKeyFromCellId(id) {
		const separator = id.lastIndexOf(":");
		return separator >= 0 ? id.slice(separator + 1) : void 0;
	}
	activeRowFromSelection(selection) {
		if (selection.kind !== "row") return null;
		return {
			id: selection.id,
			rowKey: selection.rowKey ?? String(selection.rowIndex),
			rowIndex: selection.rowIndex
		};
	}
	ensureElementId(element, kind, index) {
		if (!element.id) element.id = `${this.instanceId}-${kind}-${index}`;
	}
	focusElement(element) {
		try {
			element.focus({ preventScroll: true });
		} catch {
			element.focus();
		}
		element.scrollIntoView({
			block: "nearest",
			inline: "nearest"
		});
	}
	eventHasSurfaceKeyScope(event) {
		return event.composedPath().some((entry) => entry instanceof Element && (entry.hasAttribute("data-surface-key-scope") || entry.closest("[data-surface-key-scope]") !== null));
	}
	isVisible(element) {
		if (element.offsetParent !== null || element.getClientRects().length > 0) return true;
		if (element.ownerDocument.defaultView?.getComputedStyle(element).display !== "contents") return false;
		return Array.from(element.children).some((child) => child instanceof HTMLElement && this.isVisible(child));
	}
}, setComponentTemplate(precompileTemplate("<ContextProvider @key={{SurfaceScopeContextName}} @value={{this.scopeRelay}}>\n  <ContextProvider @key={{SheetRuntimeContextName}} @value={{this.effectiveSheetRuntime}}>\n    <div class={{this.rootClass}} role=\"grid\" aria-label={{if @aria-label @aria-label \"data grid\"}} aria-activedescendant={{this.activeDescendant}} aria-multiselectable={{this.ariaMultiselectable}} tabindex={{this.tabIndex}} data-bx-grid-preset={{this.preset}} data-bx-grid data-bx-grid-id={{this.surfaceId}} data-bx-grid-selection={{this.selectionMode}} data-bx-grid-keyboard={{this.keyboard}} data-bx-grid-editable={{this.editable}} data-bx-grid-sortable={{this.sortable}} data-surface-preserve-focus={{this.surfacePreserveFocusAttribute}} {{this.gridTraversal this.ladder gridId=this.surfaceId parentId=this.parentSurfaceId preset=this.preset selection=this.selectionMode keyboard=this.keyboard editable=this.editable sortable=this.sortable model=this.traversalModel modelOwned=(has-block \"bodyRow\") runtime=this.runtime enabled=this.traversalEnabled}} {{on \"mousedown\" this.handleMouseDown capture=true}} {{on \"keydown\" this.handleKeydown}} {{on \"boxel-grid-clear-selection\" this.handleClearRequest}} {{surfaceDecalLayer runtime=this.runtime scopeRelay=this.scopeRelay}} {{surfaceScopeRelay this.scopeRelay}} {{this.sheetRuntimeRoot runtime=this.effectiveSheetRuntime}} {{this.sheetRuntimeBridge runtime=this.effectiveSheetRuntime}} {{this.runtimeDocumentKeydown}} ...attributes>\n      {{#if (has-block \"header\")}}\n        {{!-- Grid-owned header WRAPPER (sticky-top, display:grid).\n              Per-cell content comes from the consumer via <:header>;\n              grid-template-columns / -rows come from @gridTemplateColumns /\n              @gridTemplateRows so the consumer keeps owning column-sizing\n              logic. The legacy `grid-header` class lives alongside\n              `boxel-grid-header` so existing host JS selectors work. --}}\n        <div class=\"boxel-grid-header grid-header\" role=\"rowgroup\" style={{this.headerStyle}}>\n          {{yield this.yieldedGrid to=\"header\"}}\n        </div>\n      {{/if}}\n\n      {{#if (has-block \"bodyRow\")}}\n        {{!-- Grid renders the body wrapper (role=rowgroup); the\n              <RowIterator> composable handles iteration + virtual\n              spacers; consumer fills per-row content via <:bodyRow>.\n              <:bodyAfter> piggybacks for totals / overlays inside\n              the same wrapper.\n\n              The body wrapper is now a CSS grid (`display: grid` +\n              `grid-template-columns: <consumer's template>`). Rows\n              opt into `grid-column: 1 / -1; grid-template-columns:\n              subgrid;` so column widths come from THIS one grid, not\n              from each row recomputing in isolation. Stops the\n              \"jagged columns\" failure mode where row N's columns\n              landed at slightly different widths than row N+1's. --}}\n        <div class=\"boxel-grid-body grid-body\" role=\"rowgroup\" style={{this.bodyStyle}}>\n          <RowIterator @table={{this.table}} @virtual={{@virtual}} as |row rowIdx|>\n            {{yield row rowIdx this.yieldedGrid to=\"bodyRow\"}}\n          </RowIterator>\n          {{#if (has-block \"bodyAfter\")}}\n            {{yield this.yieldedGrid to=\"bodyAfter\"}}\n          {{/if}}\n        </div>\n      {{else if (has-block \"body\")}}\n        {{!-- Escape hatch: Grid yields the body wrapper bare. Per-row\n              iteration, virtual spacers, totals, overlays — all the\n              consumer's responsibility. --}}\n        <div class=\"boxel-grid-body grid-body\" role=\"rowgroup\" style={{this.bodyStyle}}>\n          {{yield this.yieldedGrid to=\"body\"}}\n        </div>\n      {{/if}}\n\n      {{yield this.yieldedGrid}}\n    </div>\n  </ContextProvider>\n</ContextProvider>\n\n<style scoped>\n  /* ─── design tokens — defaults, overridable via inline style ────\n   * Consumers can pass `style=\"--bg: #fff8e7\"` etc via splat to\n   * override per-instance, or set tokens on a parent selector to\n   * theme multiple grids at once.\n   *\n   * Three groups:\n   *   • dimensional   (row / header / filter / column widths)\n   *   • palette       (background / border / foreground / accent)\n   *   • typography    (mono font)\n   *   • z-index tier  (see comment further down)\n   *\n   * Phase 2.8b moved the palette + typography from the host's\n   * :where(.page) here so a consumer dropping <Grid> alone gets a\n   * sensible default look. */\n  :where(.boxel-grid) {\n    /* dimensional */\n    --row-h: 36px;\n    --header-h: 32px;\n    --filter-h: 32px;\n    --col-num-w: 36px;\n    --col-select-w: 32px;\n    --col-prelude-w: 68px;            /* num + select */\n\n    /* palette */\n    --bg: #fff;\n    --bg-zebra: #fafafa;\n    --bg-hover: #f5f7ff;\n    --bg-focus: #eef2ff;\n    --bg-pinned: #fef3c7;\n    --bg-toolbar: #f9fafb;\n    --border: #e5e7eb;\n    --border-soft: #f3f4f6;\n    --fg: #111827;\n    --fg-muted: #6b7280;\n    --fg-faded: #9ca3af;\n    --accent: #6366f1;\n    --accent-soft: #c7d2fe;\n    --accent-bg: #ede9fe;\n\n    /* typography */\n    --mono: 'SF Mono', Menlo, monospace;\n\n    /* ─── z-index tier (single source of truth) ────────────────────\n     * Layer-by-purpose, not by magic number. Anything position:sticky\n     * must beat anything that scrolls past it — that's why sticky\n     * tiers (sticky-body, sticky-header) sit above the range overlay\n     * and focused cell.\n     *\n     * **Lift-tier organization** — each lift level (see\n     * WIDGET-TRAITS.md \"lift ladder\") gets a numeric range. Within\n     * a tier, items can stack (e.g., two popovers from a multi-step\n     * flow take +1 each). Higher tiers always beat lower tiers, so\n     * a popover always covers a cell-lift, which always covers the\n     * focus ring.\n     *\n     *   selection tier      (1–9)      cells, focus ring, range overlay\n     *   sticky tier         (5–10)     pinned cells, sticky header\n     *   cell-lift tier      (100–199)  .cell-lift-shell (in-place expand)\n     *   popover-lift tier   (1000+)    floating-ui popovers, dropdowns\n     *   modal-lift tier     (10000+)   future modal-expand surface\n     *   toast / system tier (90000+)   toasts, drag ghosts, system overlays\n     *\n     *   --z-cell           default body cell (no positioning)\n     *   --z-focused        focused cell (slight elevation for ring)\n     *   --z-range-tint     in-range cell tint\n     *   --z-range          range overlay border (single rect / range)\n     *   --z-sticky-body    sticky body cells (prelude, pinned-left/right)\n     *   --z-sticky-header  sticky header cells (above sticky body)\n     *   --z-pin-shadow     pin-boundary drop shadow (continuous gradient)\n     *   --z-overlay        loading / empty overlays\n     *   --z-cell-lift      .cell-lift-shell (in-place editor expand)\n     *   --z-popover        cell popover (floating-ui anchored)\n     *   --z-modal          modal-expand surface (full viewport)\n     *   --z-toast          toasts, fill-handle, drag ghosts (always top)\n     *\n     * Defined here so consumers can override per-instance via splat:\n     * `style=\"--z-toast: 99999\"`. Aliased into the host's old token\n     * names (--z-cell-pinned, --z-row-pinned, --z-header, --z-overlay)\n     * for backward-compat with pre-Phase-2.8 callers. */\n    --z-cell: 1;\n    --z-focused: 2;\n    --z-range-tint: 3;\n    --z-range: 4;\n    --z-sticky-body: 5;\n    --z-sticky-header: 6;\n    --z-pin-shadow: 10;\n    --z-overlay: 5;\n    --z-cell-lift: 200;\n    --z-popover: 1000;\n    --z-modal: 10000;\n    --z-toast: 90000;\n  }\n\n  /* ─── scroll container ──────────────────────────────────────────\n   * `position: relative` makes this the containing block for any\n   * absolutely-positioned overlays (range borders, fill handle,\n   * drop indicators) yielded inside.\n   *\n   * Presets decide whether the grid is a contained scroller. The\n   * default `sheet` preset is contained so sticky headers and\n   * keyboard scrolling work immediately. `headless` stays uncontained\n   * and visually plain. */\n  .boxel-grid {\n    position: relative;\n    /* Resolves via cascade against consumer-provided tokens; falls\n     * back to neutral defaults when none are defined. */\n    background: var(--bg, #fff);\n    border: 1px solid var(--border, #e5e7eb);\n    outline: none;\n    width: 100%;\n    overflow-x: auto;\n    overflow-y: visible;\n    color: var(--fg, #111827);\n  }\n  .boxel-grid:focus-visible {\n    box-shadow: inset 0 0 0 2px var(--accent-soft, #c7d2fe);\n  }\n\n  .boxel-grid.is-contained,\n  .boxel-grid.mode-large {\n    max-block-size: var(--boxel-grid-max-block-size, min(70vh, 560px));\n    overflow: auto;\n  }\n\n  .boxel-grid.is-uncontained {\n    max-block-size: none;\n    overflow-y: visible;\n  }\n\n  .boxel-grid--chrome-plain {\n    border-radius: 0;\n    box-shadow: none;\n  }\n\n  .boxel-grid--chrome-list {\n    border-color: var(--border-soft, #f3f4f6);\n    background: transparent;\n  }\n\n  .boxel-grid--chrome-none {\n    border: 0;\n    background: transparent;\n    box-shadow: none;\n    overflow: visible;\n  }\n\n  /* ─── header wrapper ────────────────────────────────────────────\n   * Sticky-top container for header cells. Display: grid so the\n   * consumer's per-cell grid-area placement works. Drop shadow on\n   * the bottom gives the body scrolling underneath a visible\n   * boundary.\n   *\n   * grid-template-columns / -rows come from `@gridTemplateColumns`\n   * / `@gridTemplateRows` props (see headerStyle getter). Default\n   * (no props) is a single auto-row, auto-column grid that works\n   * for a flat single-row header. */\n  .boxel-grid-header {\n    display: grid;\n    z-index: var(--z-sticky-header);\n    background: var(--bg-toolbar, #f9fafb);\n    border-bottom: 1px solid var(--border, #e5e7eb);\n    box-shadow: 0 4px 6px -4px rgba(0, 0, 0, 0.12);\n    width: max-content;\n    min-width: 100%;\n  }\n\n  .boxel-grid-body {\n    width: max-content;\n    min-width: 100%;\n  }\n\n  .boxel-grid.has-sticky-header .boxel-grid-header {\n    position: sticky;\n    top: var(--boxel-grid-sticky-top, 0);\n  }\n\n  .boxel-grid.has-static-header .boxel-grid-header {\n    position: relative;\n    top: auto;\n    box-shadow: none;\n  }\n\n  .boxel-grid--chrome-none .boxel-grid-header {\n    background: transparent;\n    border-bottom: 0;\n    box-shadow: none;\n  }\n\n  /* Public <Row> defaults. This keeps row markup lightweight for the\n   * common case: a row spans the Grid-owned body grid and inherits the\n   * shared column template via subgrid. Hosts can still override layout\n   * on the row for headless/custom rendering. */\n  .boxel-grid-body > :where(.boxel-grid-row, [data-bx-grid-row], [role=\"row\"]) {\n    grid-column: 1 / -1;\n    display: grid;\n    grid-template-columns: subgrid;\n    min-width: 100%;\n  }\n\n  .boxel-grid-row.is-row-disabled {\n    color: var(--fg-faded, #9ca3af);\n  }\n\n  .boxel-grid-row.is-row-selected {\n    background: var(--accent-bg, #ede9fe);\n  }\n\n  .boxel-grid [data-bx-grid-active],\n  .boxel-grid [data-bx-grid-active-row] {\n    outline: none;\n    background: var(--bg-focus, #eef2ff);\n    position: relative;\n    z-index: var(--z-focused);\n  }\n\n  /* Foci protocol: when browser focus is inside an inline editor, the\n   * editor owns the primary focus ring. The cell keeps only semantic\n   * soft tint; hard borders and halos come from SurfaceDecalLayer. */\n  .boxel-grid [data-bx-grid-active]:has(\n    :where(\n      .boxel-cell-editor-wrap,\n      .bx-cell-editor-wrap,\n      [data-surface-key-scope=\"editor\"]\n    ):focus-within\n  ) {\n    background: var(--bg, #fff);\n  }\n\n  .boxel-grid [data-bx-grid-in-range],\n  .boxel-grid [data-bx-grid-selected-row] {\n    background: var(--accent-bg, #ede9fe);\n  }\n\n  .boxel-grid [data-bx-grid-active][data-bx-grid-in-range],\n  .boxel-grid [data-bx-grid-active-row][data-bx-grid-selected-row] {\n    background: var(--bg-focus, #eef2ff);\n  }\n\n  .boxel-grid--preset-table [data-bx-grid-active],\n  .boxel-grid--preset-table [data-bx-grid-in-range],\n  .boxel-grid--preset-headless [data-bx-grid-active],\n  .boxel-grid--preset-headless [data-bx-grid-in-range] {\n    outline: none;\n    background: inherit;\n  }\n</style>", {
	strictMode: true,
	scope: () => ({
		ContextProvider,
		SurfaceScopeContextName,
		SheetRuntimeContextName,
		on,
		surfaceDecalLayer,
		surfaceScopeRelay,
		RowIterator
	})
}), _Grid), _Grid), _descriptor$3 = _applyDecoratedDescriptor(_class$3.prototype, "inheritedLadder", [_dec$1], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor2$2 = _applyDecoratedDescriptor(_class$3.prototype, "inheritedRuntime", [_dec2$1], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor3$2 = _applyDecoratedDescriptor(_class$3.prototype, "inheritedParentId", [_dec3], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor4$1 = _applyDecoratedDescriptor(_class$3.prototype, "inheritedScopeRelay", [_dec4], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class$3.prototype, "inheritedSheetRuntime", [_dec5], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor6 = _applyDecoratedDescriptor(_class$3.prototype, "activeRowId", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return null;
	}
}), _descriptor7 = _applyDecoratedDescriptor(_class$3.prototype, "activeRowState", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return null;
	}
}), _class$3);
var _Row;
/**
* Public grid row primitive.
*
* `Row` is intentionally semantic, not behavioral. It gives Grid a stable
* row boundary and identity, while the owning Grid preset decides whether
* rows are traversal stops (`collection`, `properties`) or just structural
* context around cells (`sheet`, `table`).
*/
var Row = class extends Component {
	constructor(...args) {
		super(...args);
		_defineProperty(this, "SheetRowKeyContextName", SheetRowKeyContextName);
	}
	get rowKey() {
		const key = this.args.rowKey;
		return key === void 0 || key === null ? null : String(key);
	}
	get ariaSelected() {
		return this.args.selected ? "true" : null;
	}
	get ariaDisabled() {
		return this.args.disabled ? "true" : null;
	}
};
_Row = Row;
setComponentTemplate(precompileTemplate("{{!--\n  The selection-binding helper `selectionForCell` reads\n  `row.dataset.rowKey` (i.e. `data-row-key`) to populate the\n  `selection.rowKey` field exposed to Grid `@onSelect` consumers.\n  We emit it here so `<Row @rowKey={{key}}>` is sufficient and\n  consumers don't have to splat `data-row-key={{key}}` separately.\n  The engine-internal `data-bx-grid-row-key` is still emitted for\n  the traversal modifier's own bookkeeping.\n--}}\n<ContextProvider @key={{this.SheetRowKeyContextName}} @value={{this.rowKey}}>\n  <div class=\"boxel-grid-row grid-row\n      {{if @selected \"is-row-selected\"}}\n      {{if @disabled \"is-row-disabled\"}}\" role=\"row\" data-bx-grid-row data-bx-grid-row-key={{this.rowKey}} data-bx-grid-key={{this.rowKey}} data-row-key={{this.rowKey}} aria-selected={{this.ariaSelected}} aria-disabled={{this.ariaDisabled}} ...attributes>\n    {{yield}}\n  </div>\n</ContextProvider>", {
	strictMode: true,
	scope: () => ({ ContextProvider })
}), _Row);
var _TextCellPreview, _class$2, _descriptor$2, _TextCellEditor, _NumberCellPreview, _class2, _descriptor2$1, _NumberCellEditor, _DateCellPreview, _class3, _descriptor3$1, _DateCellEditor, _class4, _BooleanCellPreview;
function displayValue(value) {
	if (value == null) return "";
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	return String(value);
}
function inputValue(event) {
	return event.target.value;
}
var TextCellPreview = class extends Component {
	get text() {
		return displayValue(this.args.value);
	}
};
_TextCellPreview = TextCellPreview;
setComponentTemplate(precompileTemplate("<span>{{this.text}}</span>", { strictMode: true }), _TextCellPreview);
var TextCellEditor = (_class$2 = (_TextCellEditor = class TextCellEditor extends Component {
	constructor(owner, args) {
		super(owner, args);
		_initializerDefineProperty(this, "draft", _descriptor$2, this);
		_defineProperty(this, "done", false);
		_defineProperty(this, "committing", false);
		this.draft = args.initialValue ?? displayValue(args.value);
	}
	update(event) {
		this.draft = inputValue(event);
	}
	keydown(event) {
		if (event.key !== "Enter" && event.key !== "Tab" && event.key !== "Escape") return;
		event.stopPropagation();
		switch (event.key) {
			case "Enter":
				event.preventDefault();
				this.commit("down");
				break;
			case "Tab":
				event.preventDefault();
				this.commit(event.shiftKey ? "left" : "right");
				break;
			case "Escape":
				event.preventDefault();
				this.cancel();
				break;
		}
	}
	blur() {
		this.commit("stay");
	}
	async commit(advance) {
		if (this.done || this.committing) return;
		this.committing = true;
		try {
			if (await this.args.onCommit(this.draft, advance) !== false) this.done = true;
		} catch {} finally {
			this.committing = false;
		}
	}
	cancel() {
		if (this.done) return;
		this.done = true;
		this.args.onCancel();
	}
}, setComponentTemplate(precompileTemplate("<input class=\"bx-basic-cell-editor bx-basic-cell-editor--text\" type=\"text\" value={{this.draft}} {{on \"input\" this.update}} {{on \"keydown\" this.keydown}} {{on \"blur\" this.blur}} />", {
	strictMode: true,
	scope: () => ({ on })
}), _TextCellEditor), _TextCellEditor), _descriptor$2 = _applyDecoratedDescriptor(_class$2.prototype, "draft", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _applyDecoratedDescriptor(_class$2.prototype, "update", [action], Object.getOwnPropertyDescriptor(_class$2.prototype, "update"), _class$2.prototype), _applyDecoratedDescriptor(_class$2.prototype, "keydown", [action], Object.getOwnPropertyDescriptor(_class$2.prototype, "keydown"), _class$2.prototype), _applyDecoratedDescriptor(_class$2.prototype, "blur", [action], Object.getOwnPropertyDescriptor(_class$2.prototype, "blur"), _class$2.prototype), _class$2);
var NumberCellPreview = class extends Component {
	get text() {
		return displayValue(this.args.value);
	}
};
_NumberCellPreview = NumberCellPreview;
setComponentTemplate(precompileTemplate("<span>{{this.text}}</span>", { strictMode: true }), _NumberCellPreview);
var NumberCellEditor = (_class2 = (_NumberCellEditor = class NumberCellEditor extends Component {
	constructor(owner, args) {
		super(owner, args);
		_initializerDefineProperty(this, "draft", _descriptor2$1, this);
		_defineProperty(this, "done", false);
		_defineProperty(this, "committing", false);
		this.draft = args.initialValue ?? displayValue(args.value);
	}
	update(event) {
		this.draft = inputValue(event);
	}
	keydown(event) {
		if (event.key !== "Enter" && event.key !== "Tab" && event.key !== "Escape") return;
		event.stopPropagation();
		switch (event.key) {
			case "Enter":
				event.preventDefault();
				this.commit("down");
				break;
			case "Tab":
				event.preventDefault();
				this.commit(event.shiftKey ? "left" : "right");
				break;
			case "Escape":
				event.preventDefault();
				this.cancel();
				break;
		}
	}
	blur() {
		this.commit("stay");
	}
	async commit(advance) {
		if (this.done || this.committing) return;
		this.committing = true;
		const text = this.draft.trim();
		try {
			if (await this.args.onCommit(text === "" ? null : Number(text), advance) !== false) this.done = true;
		} catch {} finally {
			this.committing = false;
		}
	}
	cancel() {
		if (this.done) return;
		this.done = true;
		this.args.onCancel();
	}
}, setComponentTemplate(precompileTemplate("<input class=\"bx-basic-cell-editor bx-basic-cell-editor--number\" type=\"text\" inputmode=\"decimal\" value={{this.draft}} {{on \"input\" this.update}} {{on \"keydown\" this.keydown}} {{on \"blur\" this.blur}} />", {
	strictMode: true,
	scope: () => ({ on })
}), _NumberCellEditor), _NumberCellEditor), _descriptor2$1 = _applyDecoratedDescriptor(_class2.prototype, "draft", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _applyDecoratedDescriptor(_class2.prototype, "update", [action], Object.getOwnPropertyDescriptor(_class2.prototype, "update"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "keydown", [action], Object.getOwnPropertyDescriptor(_class2.prototype, "keydown"), _class2.prototype), _applyDecoratedDescriptor(_class2.prototype, "blur", [action], Object.getOwnPropertyDescriptor(_class2.prototype, "blur"), _class2.prototype), _class2);
var DateCellPreview = class extends Component {
	get text() {
		return displayValue(this.args.value);
	}
};
_DateCellPreview = DateCellPreview;
setComponentTemplate(precompileTemplate("<span>{{this.text}}</span>", { strictMode: true }), _DateCellPreview);
var DateCellEditor = (_class3 = (_DateCellEditor = class DateCellEditor extends Component {
	constructor(owner, args) {
		super(owner, args);
		_initializerDefineProperty(this, "draft", _descriptor3$1, this);
		_defineProperty(this, "done", false);
		_defineProperty(this, "committing", false);
		this.draft = args.initialValue ?? displayValue(args.value);
	}
	update(event) {
		this.draft = inputValue(event);
	}
	keydown(event) {
		if (event.key !== "Enter" && event.key !== "Tab" && event.key !== "Escape") return;
		event.stopPropagation();
		switch (event.key) {
			case "Enter":
				event.preventDefault();
				this.commit("down");
				break;
			case "Tab":
				event.preventDefault();
				this.commit(event.shiftKey ? "left" : "right");
				break;
			case "Escape":
				event.preventDefault();
				this.cancel();
				break;
		}
	}
	blur() {
		this.commit("stay");
	}
	async commit(advance) {
		if (this.done || this.committing) return;
		this.committing = true;
		try {
			if (await this.args.onCommit(this.draft, advance) !== false) this.done = true;
		} catch {} finally {
			this.committing = false;
		}
	}
	cancel() {
		if (this.done) return;
		this.done = true;
		this.args.onCancel();
	}
}, setComponentTemplate(precompileTemplate("<input class=\"bx-basic-cell-editor bx-basic-cell-editor--date\" type=\"date\" value={{this.draft}} {{on \"input\" this.update}} {{on \"keydown\" this.keydown}} {{on \"blur\" this.blur}} />", {
	strictMode: true,
	scope: () => ({ on })
}), _DateCellEditor), _DateCellEditor), _descriptor3$1 = _applyDecoratedDescriptor(_class3.prototype, "draft", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _applyDecoratedDescriptor(_class3.prototype, "update", [action], Object.getOwnPropertyDescriptor(_class3.prototype, "update"), _class3.prototype), _applyDecoratedDescriptor(_class3.prototype, "keydown", [action], Object.getOwnPropertyDescriptor(_class3.prototype, "keydown"), _class3.prototype), _applyDecoratedDescriptor(_class3.prototype, "blur", [action], Object.getOwnPropertyDescriptor(_class3.prototype, "blur"), _class3.prototype), _class3);
var BooleanCellPreview = (_class4 = (_BooleanCellPreview = class BooleanCellPreview extends Component {
	get checked() {
		return Boolean(this.args.value);
	}
	get disabled() {
		return !this.args.onCommit;
	}
	change(event) {
		event.stopPropagation();
		this.args.onCommit?.(event.target.checked);
	}
}, setComponentTemplate(precompileTemplate("<input class=\"bx-basic-cell-checkbox\" type=\"checkbox\" checked={{this.checked}} disabled={{this.disabled}} {{on \"change\" this.change}} />", {
	strictMode: true,
	scope: () => ({ on })
}), _BooleanCellPreview), _BooleanCellPreview), _applyDecoratedDescriptor(_class4.prototype, "change", [action], Object.getOwnPropertyDescriptor(_class4.prototype, "change"), _class4.prototype), _class4);
var READONLY_WIDGET = {
	unit: { preview: TextCellPreview },
	capabilities: []
};
var TEXT_WIDGET = {
	unit: {
		preview: TextCellPreview,
		editor: TextCellEditor
	},
	capabilities: [
		"text-input",
		"draft-commit",
		"commit-on-close"
	]
};
var NUMBER_WIDGET = {
	unit: {
		preview: NumberCellPreview,
		editor: NumberCellEditor
	},
	capabilities: [
		"text-input",
		"arrow-nudge",
		"draft-commit"
	]
};
var DATE_WIDGET = {
	unit: {
		preview: DateCellPreview,
		editor: DateCellEditor
	},
	capabilities: [
		"text-input",
		"draft-commit",
		"commit-on-close"
	]
};
var BOOLEAN_WIDGET = {
	unit: { preview: BooleanCellPreview },
	capabilities: ["live-write"]
};
function inferBasicCellKind(value) {
	if (typeof value === "boolean") return "boolean";
	if (typeof value === "number") return "number";
	return "text";
}
function basicCellWidget(kind) {
	switch (kind) {
		case "number": return NUMBER_WIDGET;
		case "date": return DATE_WIDGET;
		case "boolean": return BOOLEAN_WIDGET;
		case "readonly": return READONLY_WIDGET;
		default: return TEXT_WIDGET;
	}
}
var cellWidgets = {
	text: TEXT_WIDGET,
	number: NUMBER_WIDGET,
	date: DATE_WIDGET,
	boolean: BOOLEAN_WIDGET,
	readonly: READONLY_WIDGET
};
var LIFT_DEFAULTS = {
	liftFocus: "auto",
	liftSize: "comfortable",
	liftBackdrop: "tint",
	liftElevation: "raised",
	liftKeyboardModel: "compose"
};
var GRID_CONTRACTS = {
	"grid>cell": {
		focus: "delegated",
		selection: "range",
		pointer: "gesture-split",
		keyboard: "grid-navigation",
		commit: "on-blur",
		sizing: "fill",
		overflow: "clip",
		lift: ["details", "edit"],
		liftPlacement: "attached",
		...LIFT_DEFAULTS,
		rangeable: true,
		advanceOnCommit: "down",
		layer: "cell-lift",
		adornment: "active"
	},
	"grid>unit": {
		focus: "delegated",
		selection: "range",
		pointer: "gesture-split",
		keyboard: "grid-navigation",
		commit: "on-blur",
		sizing: "fill",
		overflow: "clip",
		lift: ["details", "edit"],
		liftPlacement: "attached",
		...LIFT_DEFAULTS,
		rangeable: true,
		advanceOnCommit: "down",
		layer: "cell-lift",
		adornment: "active"
	},
	"cell>pane": {
		focus: "contained",
		selection: "shared",
		pointer: "child-interaction",
		keyboard: "child-text",
		commit: "on-close",
		sizing: "clamped",
		overflow: "portal",
		lift: ["edit"],
		liftPlacement: "attached",
		...LIFT_DEFAULTS,
		rangeable: false,
		advanceOnCommit: "stay",
		layer: "popover",
		adornment: "none"
	},
	"cell>plane": {
		focus: "trapped",
		selection: "child",
		pointer: "blocked",
		keyboard: "modal",
		commit: "explicit",
		sizing: "clamped",
		overflow: "portal",
		lift: ["edit"],
		liftPlacement: "plane",
		...LIFT_DEFAULTS,
		liftBackdrop: "scrim",
		liftElevation: "modal",
		rangeable: false,
		advanceOnCommit: "stay",
		layer: "modal",
		adornment: "none"
	},
	"layout>grid": {
		focus: "delegated",
		selection: "shared",
		pointer: "gesture-split",
		keyboard: "grid-navigation",
		commit: "draft",
		sizing: "measured",
		overflow: "clip",
		lift: ["edit"],
		liftPlacement: "attached",
		...LIFT_DEFAULTS,
		rangeable: false,
		advanceOnCommit: "down",
		layer: "base",
		adornment: "active"
	},
	"canvas>grid": {
		focus: "delegated",
		selection: "object",
		pointer: "parent-gesture",
		keyboard: "canvas-tool",
		commit: "draft",
		sizing: "measured",
		overflow: "clip",
		lift: ["edit"],
		liftPlacement: "attached",
		...LIFT_DEFAULTS,
		rangeable: false,
		advanceOnCommit: "stay",
		layer: "base",
		adornment: "selected"
	}
};
registerContractTable("boxel-grid", GRID_CONTRACTS);
var GRID_CELL_POLICY = {
	permits: [
		"text-input",
		"lift-details",
		"lift-preview",
		"lift-edit",
		"lift-tools",
		"plane-default",
		"live-write",
		"draft-commit",
		"commit-on-close",
		"escape-to-raw",
		"hover-reveal",
		"arrow-nudge",
		"multi-unit"
	],
	forbids: [],
	overrides: {
		adornment: "active",
		selection: "range"
	}
};
/**
* Per-instance overrides for column-level customization.
* Carries optional contract refinements PLUS the grid-specific
* extras that aren't part of the contract proper.
*/
var _CellInner;
var autoFocusEditor = modifier((element, [seed]) => {
	let focused = false;
	const focusEditor = () => {
		if (focused) return;
		const focusable = element.querySelector("input, textarea, select, [contenteditable=\"\"], [contenteditable=\"true\"]");
		if (!focusable) return;
		focused = true;
		focusable.focus();
		if (focusable instanceof HTMLInputElement || focusable instanceof HTMLTextAreaElement) if (seed === void 0 || seed === "") focusable.select();
		else {
			const len = focusable.value.length;
			focusable.setSelectionRange(len, len);
		}
	};
	const frame = requestAnimationFrame(focusEditor);
	const timer = setTimeout(focusEditor, 0);
	return () => {
		cancelAnimationFrame(frame);
		clearTimeout(timer);
	};
});
var EDITOR_NAVIGATION_KEYS = new Set([
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"Home",
	"End",
	"PageUp",
	"PageDown"
]);
/**
* Engine-owned keyboard scope for inline editors.
*
* Widgets should not have to remember to protect their editor DOM
* from parent grid / surface keyboard handlers. The wrapper declares
* `data-surface-key-scope="editor"` for generic ancestors, and this
* modifier supplies the default local behavior for widgets that do
* not implement their own Escape/nav-key policy:
*
*   - Escape cancels the inline edit and never reaches the card root.
*   - Arrow/Home/End/Page keys stay inside the editor subtree.
*
* Editors that need richer behavior can preventDefault/stopPropagation
* themselves before the event bubbles here.
*/
var editorKeyScope = modifier((element, [onCancel]) => {
	const onKeydown = (event) => {
		if (event.defaultPrevented) return;
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			onCancel?.();
			return;
		}
		if (EDITOR_NAVIGATION_KEYS.has(event.key)) event.stopPropagation();
	};
	element.addEventListener("keydown", onKeydown);
	return () => element.removeEventListener("keydown", onKeydown);
});
/**
* `<CellInner>` — surface-contract-aware cell dispatcher.
*
* Internal content dispatcher for cell-backed surfaces. `<CellInner>`
* consumes a `Widget` bundle PLUS a pre-computed `SurfaceContract`
* and decides:
*
*   1. SKELETON wins (loading rows can't be edited).
*   2. EDITOR (intent inferred from `@edit` presence) — when
*      `contract.popup === 'none'`, render the inline editor:
*      `widget.cell.editor` at escalation 0, `widget.cell.rawEditor`
*      at escalation 1. When `contract.popup !== 'none'`, the host
*      owns the popup chrome — we render the PREVIEW under it
*      (so the cell shows what the user is editing).
*   3. PREVIEW — `widget.cell.preview` (cell-specific) → fall back
*      to `widget.layout.preview`.
*   4. LEGACY RENDERER — when widget has no preview component
*      (rare, but supported for one-off ad-hoc renderers).
*   5. PLAIN — last-resort `<span class="boxel-cell-plain">`.
*
* The shape mirrors the old dispatcher contract for compatibility:
*   - `@cell` carries `{ value, renderer }` PLUS optional `widget`
*     and `contract` — when both are present, the contract drives;
*     when widget is missing, falls back to the legacy renderer branch.
*   - `@edit` is the edit envelope (editor + initialValue + onCommit
*     + onCancel + onEscalate), extended with optional
*     `onPreviewChange` + `escalation`.
*   - `@skeleton` + `@onCommit` are the same.
*
* What CellInner does NOT do:
*   - mount popovers / panes (host job — cell-popover chrome,
*     popover-host velcro anchor, layer allocation)
*   - manage focus across surfaces (host job — focus resource)
*   - validate or persist commits (host job — commitEdit pipeline)
*   - handle range selection or fill (host job — range overlay)
*/
/**
* Edit envelope. The contract path uses:
*   - `onPreviewChange` for the pre-commit preview channel
*   - `escalation` for the escape-to-raw rung selector
*/
/** The cell view-model the dispatcher reads. Carries the fallback
*  renderer plus the widget + contract pair. Both pairs may be
*  undefined; the dispatcher picks the available branch. */
var CellInner = class extends Component {
	/** Skeleton trumps everything (loading state). */ get hasSkeleton() {
		return this.args.skeleton != null;
	}
	/** Edit mode is active. The contract decides whether we render
	*  the inline editor here or defer to the host's popup. */
	get hasEdit() {
		return this.args.edit != null;
	}
	/** True when contract permits inline cell editing AND widget
	*  has a cell editor. Otherwise the host owns the lift.
	*
	*  K.5: reads `contract.lift` instead of legacy `popup`. A cell
	*  with `lift: []` (Pattern A/B widgets — text, numberInput,
	*  slider) renders inline; a cell with `lift: ['details', 'edit']`
	*  defers to the host-owned <Lift> shell. */
	get shouldRenderInlineEditor() {
		if (!this.hasEdit) return false;
		const widget = this.args.cell.widget;
		const contract = this.args.cell.contract;
		if (!widget || !contract) return true;
		if (contract.lift.length > 0) return false;
		return this.activeEditorComponent != null;
	}
	/** Pick the right editor component for the current escalation
	*  rung. At rung 1 + widget has a rawEditor → use that.
	*  Otherwise the strict editor. */
	get activeEditorComponent() {
		const widget = this.args.cell.widget;
		if (!widget) return this.args.edit?.editor;
		const escalation = this.args.edit?.escalation ?? 0;
		const unit = widget.unit ?? widget.cell;
		if (escalation === 1 && unit?.rawEditor) return unit.rawEditor;
		return unit?.editor;
	}
	/** Stringified cell value for the plain-fallback branch. The
	*  generic `TValue=unknown` doesn't satisfy Glint's `ContentValue`
	*  type for inline `{{...}}` rendering, so we coerce explicitly.
	*  null / undefined render as the empty string (no "null" /
	*  "undefined" leaking into the UI). */
	get plainContent() {
		const v = this.args.cell.value;
		return v == null ? "" : String(v);
	}
	/** Preview component selection: cell.preview → layout.preview.
	*  Returns undefined if neither is defined; caller falls through
	*  to the legacy renderer / plain text branches. */
	get previewComponent() {
		const widget = this.args.cell.widget;
		if (!widget) return void 0;
		return (widget.unit ?? widget.cell)?.preview ?? widget.layout?.preview;
	}
};
_CellInner = CellInner;
setComponentTemplate(precompileTemplate("{{#if this.hasSkeleton}}\n  {{#let @skeleton as |Skel|}}\n    {{#if Skel}}<Skel />{{/if}}\n  {{/let}}\n{{else if this.shouldRenderInlineEditor}}\n  {{#let this.activeEditorComponent as |Editor|}}\n    {{#if Editor}}\n      {{!-- Wrapper owns the default editor box and gives the\n            autoFocusEditor modifier a subtree to walk for the\n            first focusable. --}}\n      <span class=\"bx-cell-editor-wrap\" data-surface-key-scope=\"editor\" data-surface-preserve-focus {{autoFocusEditor @edit.initialValue}} {{editorKeyScope @edit.onCancel}}>\n        <Editor @value={{@cell.value}} @editing={{true}} @initialValue={{@edit.initialValue}} @onCommit={{@edit.onCommit}} @onCancel={{@edit.onCancel}} @onEscalate={{@edit.onEscalate}} @onPreviewChange={{@edit.onPreviewChange}} @fieldClass={{@cell.fieldClass}} />\n      </span>\n    {{/if}}\n  {{/let}}\n{{else if this.previewComponent}}\n  {{#let this.previewComponent as |Preview|}}\n    <span class=\"bx-cell-preview-wrap\">\n      <Preview @value={{@cell.value}} @onCommit={{@onCommit}} @fieldClass={{@cell.fieldClass}} />\n    </span>\n  {{/let}}\n{{else if @cell.renderer}}\n  {{#let @cell.renderer as |LegacyRenderer|}}\n    <span class=\"bx-cell-renderer-wrap\">\n      <LegacyRenderer @value={{@cell.value}} @onCommit={{@onCommit}} />\n    </span>\n  {{/let}}\n{{else}}\n  <span class=\"boxel-cell-plain plain\">{{this.plainContent}}</span>\n{{/if}}\n\n<style scoped>\n  .boxel-cell-plain {\n    box-sizing: border-box;\n    display: block;\n    width: 100%;\n    min-width: 0;\n    min-height: var(--boxel-grid-cell-content-min-block-size, var(--row-h, 36px));\n    padding: var(--boxel-grid-cell-padding, 9px 12px);\n    font: inherit;\n    color: inherit;\n  }\n  .bx-cell-preview-wrap,\n  .bx-cell-renderer-wrap,\n  .bx-cell-editor-wrap {\n    box-sizing: border-box;\n    display: grid;\n    width: 100%;\n    min-width: 0;\n    min-height: var(--boxel-grid-cell-content-min-block-size, var(--row-h, 36px));\n    color: inherit;\n    font: inherit;\n  }\n  .bx-cell-preview-wrap,\n  .bx-cell-renderer-wrap {\n    align-items: center;\n    padding: var(--boxel-grid-cell-padding, 9px 12px);\n  }\n  .bx-cell-editor-wrap {\n    align-items: stretch;\n    overflow: hidden;\n  }\n  .bx-cell-editor-wrap:focus-within {\n    outline: var(--boxel-grid-editor-outline, 2px solid var(--accent, #6366f1));\n    outline-offset: var(--boxel-grid-editor-outline-offset, -2px);\n  }\n  :global(.bx-cell-editor-wrap :where(input, textarea, select, [contenteditable=\"\"], [contenteditable=\"true\"], [role=\"textbox\"])) {\n    box-sizing: border-box;\n    display: block;\n    width: 100%;\n    min-width: 0;\n    min-height: 100%;\n    padding: var(--boxel-grid-cell-padding, 9px 12px);\n    border: 0;\n    outline: 0;\n    background: var(--boxel-grid-editor-bg, transparent);\n    color: inherit;\n    font: inherit;\n  }\n</style>", {
	strictMode: true,
	scope: () => ({
		autoFocusEditor,
		editorKeyScope
	})
}), _CellInner);
var _dec, _dec2, _class$1, _descriptor$1, _descriptor2, _descriptor3, _descriptor4, _Cell;
var FIELD_BRIDGE_WIDGET = {
	unit: {
		preview: FieldAtomBridge,
		editor: FieldEditBridge
	},
	capabilities: [
		"text-input",
		"draft-commit",
		"commit-on-close"
	]
};
/**
* `<Cell>` — stock grid cell and cell-runtime participant.
*
* It accepts either a normalized `@cell` payload or ordinary
* `@value` + `@type` / `@field` args, then owns the cell chrome,
* SheetRuntime registration, edit lifecycle routing, and optional
* lift behavior.
*
* Internally this composes the distilled primitives:
*
*   - one `LiftState` per cell instance (each cell owns its own lift)
*   - `surfaceLiftBinding` modifier on the cell div (pointer + dblclick)
*   - `<LiftChevron>` for the explicit edit affordance
*   - `<Lift>` for the floating editor / details surface
*   - `<CellInner>` for the cell content + inline edit envelope
*
* EXAMPLE
* =======
*
* ```gts
* import { Cell } from '@cardstack/boxel-grid';
* import { negotiateForWidget, GRID_CELL_POLICY } from '@cardstack/surfaces';
*
* // The host pre-negotiates a contract per widget...
* const cell = {
*   value: row.status,
*   widget: statusPill,
*   contract: negotiateForWidget({
*     parentSurface: 'grid', childSurface: 'unit',
*     childIntent: 'preview',
*     widgetCapabilities: statusPill.capabilities,
*     parentPolicy: GRID_CELL_POLICY,
*   }),
* };
*
* // ...and drops the cell wherever:
* <td>
*   <Cell @cell={{cell}} @onCommit={{this.handleCommit}} />
* </td>
* ```
*
* GESTURES
* ========
*
*   click       → ladder.select (when ladder args provided)
*   dblclick    → opens the edit lift (Pattern C with `lift-edit`)
*                 OR seeds the inline editor (Pattern A/B with an
*                 `unit.editor` / `cell.editor`)
*   hover       → opens the details lift after the pause (when the
*                 contract supports `'details'`)
*   chevron ▾   → opens the edit lift directly
*
* The widget-lab demo uses `<Grid>` + `<TablePaneRender>` instead when
* many cells intentionally share one `LiftState` across the grid.
*/
function eq$1(a, b) {
	return a === b;
}
function escapeAttributeValue(value) {
	return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}
var Cell = (_dec = consume(SheetRuntimeContextName), _dec2 = consume(SheetRowKeyContextName), _class$1 = (_Cell = class Cell extends Component {
	constructor(owner, args) {
		super(owner, args);
		_initializerDefineProperty(this, "inheritedSheetRuntime", _descriptor$1, this);
		_initializerDefineProperty(this, "inheritedSheetRowKey", _descriptor2, this);
		/** Stable id per Cell instance. Anchors the lift to THIS
		*  cell via `[data-bx-widget-cell="${cellId}"]`. */
		_defineProperty(this, "cellId", guidFor(this));
		/** This cell's own lift state. Each `<Cell>` is single-cell
		*  by definition, so coords are always (0, 0) — the LiftState
		*  resolves to this cell's data attribute regardless. */
		_defineProperty(this, "liftState", createLiftState({ anchorSelectorFor: () => `[data-bx-widget-cell="${this.cellId}"]` }));
		_initializerDefineProperty(this, "elementSheetRuntime", _descriptor3, this);
		_initializerDefineProperty(this, "elementSheetTarget", _descriptor4, this);
		/** Modifier refs reachable from the template. Glint strict mode
		*  wants modifiers on the component instance for stable lookup. */
		_defineProperty(this, "surfaceLiftBinding", surfaceLiftBinding);
		_defineProperty(this, "multiUnit", multiUnit);
		_defineProperty(this, "sheetCellRegistration", sheetCellRegistration);
		_defineProperty(this, "runtimeLiftSync", modifier((_element, _positional, named) => {
			const { runtime, target } = named;
			if (!runtime || !target) return;
			const targetMatches = (state) => state.target.rowKey === target.rowKey && state.target.colKey === target.colKey;
			const unsubscribers = [
				runtime.edit.onOpen((state) => {
					if (targetMatches(state) && this.supportsLift) this.liftState.openEdit(0, 0);
				}),
				runtime.edit.onCommit((state) => {
					if (targetMatches(state)) this.liftState.close();
				}),
				runtime.edit.onCancel((state) => {
					if (targetMatches(state)) this.liftState.close();
				})
			];
			return () => {
				for (const unsubscribe of unsubscribers) unsubscribe();
			};
		}));
		/** Cleanup function returned by `ladder.register`. */
		_defineProperty(this, "_ladderCleanup", void 0);
		_defineProperty(this, "bindSheetRuntime", (runtime) => {
			this.elementSheetRuntime = runtime;
		});
		_defineProperty(this, "bindSheetTarget", (target) => {
			this.elementSheetTarget = target;
		});
		/** Click selects the cell in the ladder. Shift / Cmd modifiers go
		*  to ladder.select for additive / range. Uses `click` (not
		*  `pointerdown`) so the selection update doesn't disrupt inner
		*  Pattern B widgets' own click handlers. */
		_defineProperty(this, "selectInLadder", (event) => {
			const { ladder, ladderId } = this.args;
			if (!ladder || !ladderId) return;
			ladder.select(ladderId, {
				additive: event.metaKey || event.ctrlKey,
				range: event.shiftKey
			});
		});
		_defineProperty(this, "handleActivate", (sourceEvent) => {
			this.activate(sourceEvent);
		});
		_defineProperty(this, "handleLiftActivate", () => {
			this.handleActivate();
		});
		_defineProperty(this, "handleKeydown", (event) => {
			if (surfaceTargetOwnsKeyboardEvent(event)) return;
			if (event.key !== "Enter" && event.key !== "F2") return;
			if (this.rootElement()?.closest(".boxel-grid")) return;
			event.preventDefault();
			event.stopPropagation();
			this.handleActivate(event);
		});
		/** Commit handler the editor inside the Lift wires to. */
		_defineProperty(this, "liftCommit", (next) => {
			if (this.runtimeEditState) {
				this.sheetRuntime?.edit.commit(next).then((committed) => {
					if (committed) this.liftState.close();
				});
				return;
			}
			this.args.onCommit?.(next);
			this.liftState.close();
		});
		_defineProperty(this, "liftCancel", () => {
			if (this.runtimeEditState) this.sheetRuntime?.edit.cancel();
			this.liftState.close();
		});
		const { ladder: _ladder, ladderId: _ladderId, ladderParentId } = args;
		if (_ladder && _ladderId && ladderParentId !== void 0) this._ladderCleanup = _ladder.register({
			id: _ladderId,
			surface: this.isMultiUnit ? "cell" : "unit",
			parentId: ladderParentId
		});
	}
	willDestroy() {
		super.willDestroy();
		this._ladderCleanup?.();
		this.liftState.destroy();
	}
	get baseCell() {
		return this.args.cell;
	}
	get value() {
		return this.baseCell ? this.baseCell.value : this.args.value;
	}
	get isEditable() {
		return this.args.editable ?? this.baseCell?.editable ?? Boolean(this.args.onCommit);
	}
	get rowKey() {
		const key = this.args.rowKey ?? this.inheritedSheetRowKey;
		return key === void 0 || key === null ? void 0 : String(key);
	}
	get colKey() {
		const key = this.args.colKey ?? this.baseCell?.colKey;
		return key === void 0 || key === null ? void 0 : String(key);
	}
	get explicitSheetTarget() {
		const { rowKey, colKey } = this;
		return rowKey && colKey ? {
			rowKey,
			colKey
		} : void 0;
	}
	get kind() {
		if (!this.isEditable && !this.args.widget && !this.baseCell?.widget) return "readonly";
		return this.args.type ?? this.baseCell?.kind ?? inferBasicCellKind(this.value);
	}
	get widget() {
		if (this.args.field || this.baseCell?.field) return FIELD_BRIDGE_WIDGET;
		return this.args.widget ?? this.baseCell?.widget ?? basicCellWidget(this.kind);
	}
	get cellPayload() {
		return {
			value: this.value,
			widget: this.widget,
			contract: this.args.contract ?? this.baseCell?.contract,
			renderer: this.baseCell?.renderer,
			fieldClass: this.args.field ?? this.baseCell?.field ?? this.baseCell?.fieldClass
		};
	}
	/** Resolve the contract from the cell payload. If the host didn't
	*  pre-negotiate, fall back to `grid > unit` × `GRID_CELL_POLICY`
	*  using the widget's capabilities — drop-in even when the host
	*  hasn't done the negotiation up front. Always returns a usable
	*  contract (FALLBACK_CONTRACT when there's no widget at all) so
	*  template consumers don't need null guards. */
	get contract() {
		if (this.cellPayload.contract) return this.cellPayload.contract;
		if (!this.widget) return FALLBACK_CONTRACT;
		return negotiateForWidget({
			parentSurface: "grid",
			childSurface: "unit",
			childIntent: "preview",
			widgetCapabilities: this.widget.capabilities,
			parentPolicy: GRID_CELL_POLICY
		});
	}
	get isMultiUnit() {
		return !!this.widget?.capabilities?.includes("multi-unit");
	}
	get supportsLift() {
		return !!this.contract?.lift?.length;
	}
	get isLadderFocused() {
		const { ladder, ladderId } = this.args;
		return !!(ladder && ladderId && ladder.isFocused(ladderId));
	}
	get isLadderSelected() {
		const { ladder, ladderId } = this.args;
		return !!(ladder && ladderId && ladder.isSelected(ladderId));
	}
	get sheetRowKey() {
		return this.sheetTarget?.rowKey;
	}
	get sheetColKey() {
		return this.sheetTarget?.colKey;
	}
	get sheetTarget() {
		return this.args.sheetTarget ?? this.explicitSheetTarget ?? this.elementSheetTarget;
	}
	get sheetRuntime() {
		return this.args.sheetRuntime ?? this.inheritedSheetRuntime ?? this.elementSheetRuntime;
	}
	get sheetEditable() {
		return this.args.sheetEditable ?? this.isEditable;
	}
	/** Universal dblclick handler — `surfaceLiftBinding` calls this regardless
	*  of whether the contract supports a lift. In a Grid, the Grid's
	*  capture-phase dblclick owns edit activation; this remains the
	*  non-grid fallback and the safety path for direct Cell usage. */
	activate(sourceEvent) {
		const hasRuntimeTarget = !!(this.sheetRuntime && this.sheetTarget);
		const runtimeOpened = this.openRuntimeEdit(sourceEvent);
		if (hasRuntimeTarget && !runtimeOpened) return false;
		if (this.supportsLift) {
			this.liftState.openEdit(0, 0);
			return true;
		}
		if (!(this.widget?.unit?.editor ?? this.widget?.cell?.editor)) return false;
		return true;
	}
	get runtimeEditState() {
		const active = this.sheetRuntime?.edit.active;
		const target = this.sheetTarget;
		if (!active || !target) return null;
		return active.target.rowKey === target.rowKey && active.target.colKey === target.colKey ? active : null;
	}
	get editState() {
		const runtimeEdit = this.runtimeEditState;
		if (!runtimeEdit) return null;
		const editor = this.widget?.unit?.editor ?? this.widget?.cell?.editor;
		if (!editor) return null;
		return {
			editor,
			initialValue: runtimeEdit.initialValue,
			onCommit: (next, advance) => {
				return this.sheetRuntime?.edit.commit(next, advance ?? "stay");
			},
			onCancel: () => {
				this.sheetRuntime?.edit.cancel();
			},
			escalation: 0
		};
	}
	openRuntimeEdit(sourceEvent) {
		const runtime = this.sheetRuntime;
		const target = this.sheetTarget;
		if (!runtime || !target) return false;
		if (runtime.edit.active?.target.rowKey === target.rowKey && runtime.edit.active.target.colKey === target.colKey) return true;
		return runtime.edit.open(target, { source: sourceEvent instanceof MouseEvent && sourceEvent.type === "dblclick" ? "dblclick" : "host" });
	}
	rootElement() {
		return document.querySelector(`[data-bx-widget-cell="${escapeAttributeValue(this.cellId)}"]`);
	}
	get liftKind() {
		return this.liftState.kind ?? "details";
	}
	/** Show the escalation toolbar only in EDIT mode — Details renders
	*  an inline ✎ button to escalate instead of a top-row toolbar. */
	get liftEscalationKinds() {
		return this.liftState.kind === "edit" ? ["details", "edit"] : [];
	}
	get liftPreviewComponent() {
		return this.widget?.unit?.preview ?? this.widget?.cell?.preview ?? this.widget?.layout?.preview;
	}
	get liftEditorComponent() {
		return this.widget?.pane?.editor ?? this.widget?.unit?.editor ?? this.widget?.cell?.editor;
	}
}, setComponentTemplate(precompileTemplate("<div class=\"bx-cell\n    {{if this.supportsLift \"has-lift\"}}\n    {{if this.isLadderFocused \"is-focused\"}}\n    {{if this.isLadderSelected \"is-selected\"}}\" data-bx-widget-cell={{this.cellId}} data-ladder-id={{@ladderId}} role=\"gridcell\" data-bx-grid-row-key={{this.rowKey}} data-col-key={{this.colKey}} data-bx-grid-column-id={{this.colKey}} ...attributes {{on \"click\" this.selectInLadder}} {{on \"keydown\" this.handleKeydown}} {{this.runtimeLiftSync runtime=this.sheetRuntime target=this.sheetTarget}} {{this.sheetCellRegistration runtime=this.sheetRuntime target=this.sheetTarget rowKey=this.rowKey colKey=this.colKey editable=this.sheetEditable requireTarget=true onRuntime=this.bindSheetRuntime onTarget=this.bindSheetTarget}} {{this.surfaceLiftBinding state=this.liftState contract=this.contract row=0 col=0 onActivate=this.handleLiftActivate}}>\n  <div class=\"bx-cell-content\">\n    <CellInner @cell={{this.cellPayload}} @edit={{this.editState}} @onCommit={{@onCommit}} />\n  </div>\n  <LiftChevron @state={{this.liftState}} @contract={{this.contract}} @row={{0}} @col={{0}} title=\"Open editor (dblclick also works)\" />\n</div>\n\n{{!-- Per-cell Lift mount. Velcro-anchored to this cell's\n      [data-bx-widget-cell]. Renders nothing until the lift\n      opens; portaled to body so it escapes table / overflow\n      ancestors. --}}\n{{#if this.liftState.isOpen}}\n  <Lift @anchor={{this.liftState.anchorSelector}} @open={{this.liftState.isOpen}} @kind={{this.liftKind}} @canEscalateTo={{this.liftEscalationKinds}} @onEscalate={{this.liftState.escalate}} @onDismiss={{this.liftCancel}} {{on \"pointerenter\" this.liftState.cancelDismiss}} {{on \"pointerleave\" this.liftState.scheduleDismissDetails}} as |kind|>\n    {{#if (eq kind \"details\")}}\n      {{#let this.liftPreviewComponent as |Preview|}}\n        {{#if Preview}}\n          <div class=\"bx-widget-cell-details\">\n            <span class=\"bx-widget-cell-details-value\">\n              <Preview @value={{this.cellPayload.value}} />\n            </span>\n            <button type=\"button\" class=\"bx-widget-cell-details-edit\" aria-label=\"Edit\" title=\"Edit\" {{on \"click\" (fn this.liftState.escalate \"edit\")}}>✎</button>\n          </div>\n        {{/if}}\n      {{/let}}\n    {{else if (eq kind \"edit\")}}\n      {{#let this.liftEditorComponent as |Editor|}}\n        {{#if Editor}}\n          <Editor @value={{this.cellPayload.value}} @onCommit={{this.liftCommit}} @onCancel={{this.liftCancel}} />\n        {{/if}}\n      {{/let}}\n    {{/if}}\n  </Lift>\n{{/if}}\n\n<style scoped>\n  /* Self-contained Details body chrome. Mirrors widget-lab's\n   * .widget-lab__lift-details idiom but lives here so the\n   * convenience wrapper renders correctly without host CSS. */\n  .bx-widget-cell-details {\n    display: inline-flex;\n    align-items: center;\n    gap: 6px;\n    padding: 6px 10px;\n  }\n  .bx-widget-cell-details-value {\n    display: inline-flex;\n    align-items: center;\n  }\n  .bx-widget-cell-details-edit {\n    background: transparent;\n    border: none;\n    cursor: pointer;\n    font-size: 12px;\n    color: #6b7280;\n    padding: 2px 4px;\n    border-radius: 3px;\n  }\n  .bx-widget-cell-details-edit:hover {\n    background: rgba(99, 102, 241, 0.12);\n    color: #4f46e5;\n  }\n</style>", {
	strictMode: true,
	scope: () => ({
		on,
		CellInner,
		LiftChevron,
		Lift,
		eq: eq$1,
		fn
	})
}), _Cell), _Cell), _descriptor$1 = _applyDecoratedDescriptor(_class$1.prototype, "inheritedSheetRuntime", [_dec], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class$1.prototype, "inheritedSheetRowKey", [_dec2], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class$1.prototype, "elementSheetRuntime", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class$1.prototype, "elementSheetTarget", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: null
}), _class$1);
/**
* `<RangeOverlay>` — single absolutely-positioned bordered div that
* traces the boundary of a selected cell range.
*
* Phase 2B.3 of EMBED-READINESS-PLAN.md. Replaces the host's inline
* `<div class="range-overlay">` markup. Pure visual — the consumer
* computes the rectangle (typically from `getBoundingClientRect()` of
* the corner cells), this component renders + styles the div.
*
* Why a separate component vs a CSS class: encapsulates the styling
* + naming with the rest of the package, lets the consumer drop a
* range overlay into any grid (not just one with our specific cell
* data-attrs) by passing the right style string.
*
* Pairs with `<FillHandle>` — together they form the AG-Grid-style
* range affordance (border + drag handle at bottom-right corner).
*
* Border colors resolve via `var(--accent, ...)` cascade so theming
* works the same way it does for the rest of the package chrome.
*/
var RangeOverlay = setComponentTemplate(precompileTemplate("<div class=\"boxel-range-overlay range-overlay {{if @variant @variant \"\"}}\" style={{@style}} ...attributes></div>\n\n<style scoped>\n  /* Pointer-events: none so the overlay doesn't intercept clicks\n   * meant for the cells underneath. z-index lives on the named\n   * tier from <Grid> — sits above focused-cell tint, below sticky\n   * body cells (so a wide focused cell extending behind a pinned\n   * column gets clipped, not the overlay). */\n  .boxel-range-overlay {\n    position: fixed;\n    pointer-events: none;\n    z-index: var(--z-range, 4);\n    border: 2px solid color-mix(in srgb, var(--accent, #6366f1) 60%, transparent);\n    border-radius: 1px;\n  }\n  .boxel-range-overlay.active {\n    border-color: var(--accent, #6366f1);\n  }\n</style>", { strictMode: true }), templateOnly());
/**
* `<DragGhost>` — floating overlay that follows the cursor during a
* drag-reorder operation. Two visual variants:
*
*   • column → solid accent-bg chip with uppercase label,
*     mimics the column header being lifted out
*   • row    → translucent strip mirroring the dragged row,
*     full-width feel, accent border
*
* Phase 2B.5 of EMBED-READINESS-PLAN.md. Consumer owns the drag state
* (start position, current pointer, axis-locking) and computes the
* style; this component just renders the visual.
*
* Pairs with `<DropIndicator>` — together they form the full drag
* affordance (ghost + drop target line).
*/
var DragGhost = setComponentTemplate(precompileTemplate("<div class=\"boxel-drag-ghost boxel-drag-ghost--{{@kind}}\" style={{@style}} aria-hidden=\"true\" ...attributes>{{@label}}</div>\n\n<style scoped>\n  .boxel-drag-ghost {\n    position: fixed;\n    z-index: var(--z-toast, 10000);\n    pointer-events: none;\n    white-space: nowrap;\n    box-shadow: 0 8px 24px rgba(99, 102, 241, 0.25);\n    border-radius: 4px;\n    font: 600 12px Inter, system-ui, sans-serif;\n  }\n\n  /* Column ghost — solid chip with uppercase label, matches the\n   * AG-Grid-style column-drag affordance. */\n  .boxel-drag-ghost--column {\n    background: var(--accent-bg, #ede9fe);\n    color: #6d28d9;\n    border: 1px solid var(--accent, #6366f1);\n    padding: 6px 10px;\n    text-transform: uppercase;\n    letter-spacing: 0.04em;\n  }\n\n  /* Row ghost — translucent strip, normal-case label, sits at the\n   * dragged row's height. */\n  .boxel-drag-ghost--row {\n    background: rgba(99, 102, 241, 0.18);\n    border: 2px solid var(--accent, #6366f1);\n    color: var(--accent, #6366f1);\n    padding: 0 12px;\n    display: flex;\n    align-items: center;\n  }\n</style>", { strictMode: true }), templateOnly());
/**
* `<DropIndicator>` — thin accent line that signals the drop target
* during a drag-reorder operation.
*
*   • column → vertical 2px line at the gap between two columns
*   • row    → horizontal 2px line at the gap between two rows
*
* Phase 2B.5 of EMBED-READINESS-PLAN.md. Pairs with `<DragGhost>` —
* the consumer renders both during a drag.
*/
var DropIndicator = setComponentTemplate(precompileTemplate("<div class=\"boxel-drop-indicator boxel-drop-indicator--{{@kind}}\" style={{@style}} aria-hidden=\"true\" ...attributes></div>\n\n<style scoped>\n  .boxel-drop-indicator {\n    position: fixed;\n    pointer-events: none;\n    background: var(--accent, #6366f1);\n    box-shadow: 0 0 6px var(--accent, #6366f1);\n    /* One tier below the drag ghost so the ghost sits on top if\n     * the line ever overlaps the cursor area. */\n    z-index: calc(var(--z-toast, 10000) - 1);\n  }\n\n  /* Column-drop = vertical line (top:0; bottom:0; width:2px) */\n  .boxel-drop-indicator--column {\n    top: 0;\n    bottom: 0;\n    width: 2px;\n  }\n\n  /* Row-drop = horizontal line (height:2px; width set by consumer) */\n  .boxel-drop-indicator--row {\n    height: 2px;\n  }\n</style>", { strictMode: true }), templateOnly());
var _GridOverlay;
/**
* `<GridOverlay>` — body-level surface for state messages
* (loading, empty, error).
*
* Phase 2B.7 of EMBED-READINESS-PLAN.md created the overlay variant.
* Phase 4 (honesty pass) added the `block` variant after the empty
* state was found to overlap the totals row when there were no
* data rows: an absolute overlay needs a parent with height, and
* an empty body has none.
*
* Pick the variant by intent, not by appearance:
*
* ```gts
* {{#if this.isLoading}}
*   <GridOverlay aria-live="polite">     {{!-- default: overlay --}}
*     <Spinner /> Loading…
*   </GridOverlay>
* {{else if this.isEmpty}}
*   <GridOverlay @variant="block">       {{!-- empty: block --}}
*     <strong>No matching rows</strong>
*     <span>Try clearing filters or the search above.</span>
*   </GridOverlay>
* {{/if}}
* ```
*
* `overlay` mode positions absolute against the nearest non-static
* ancestor — typically `.boxel-grid-body` (when used inside
* `<:bodyAfter>`) or `.boxel-grid` itself. `block` mode is normal
* flow with `min-height: 160px` so the message has room.
*
* z-index uses `--z-overlay` from the named tier in <Grid>.
*/
var GridOverlay = class extends Component {
	get variantClass() {
		return this.args.variant === "block" ? "boxel-grid-overlay--block" : "boxel-grid-overlay--overlay";
	}
};
_GridOverlay = GridOverlay;
setComponentTemplate(precompileTemplate("<div class=\"boxel-grid-overlay grid-overlay {{this.variantClass}}\" role={{if @role @role \"status\"}} ...attributes>\n  {{yield}}\n</div>\n\n<style scoped>\n  .boxel-grid-overlay {\n    display: flex;\n    flex-direction: column;\n    align-items: center;\n    justify-content: center;\n    gap: 8px;\n  }\n  .boxel-grid-overlay--overlay {\n    position: absolute;\n    inset: 0;\n    background: rgba(255, 255, 255, 0.85);\n    backdrop-filter: blur(2px);\n    z-index: var(--z-overlay, 5);\n  }\n  .boxel-grid-overlay--block {\n    /* Normal flow — the overlay sits in the document and pushes\n     * the parent to grow. min-height keeps the message from\n     * collapsing to single-line height when the host's content\n     * (typically a <strong> + <span> stack) is short. */\n    min-height: 160px;\n    width: 100%;\n    padding: 24px 16px;\n  }\n</style>", { strictMode: true }), _GridOverlay);
/**
* `<Spinner>` — small animated loading indicator. 24px circle with
* an accent-colored arc that rotates 360° per 800ms.
*
* Phase 2B.7 of EMBED-READINESS-PLAN.md. Pure visual, no args.
* Inherits accent + border colors via CSS variables (cascades from
* <Grid> or any parent that defines --accent / --border).
*
* Typically used inside `<GridOverlay>` for the loading state, but
* it's a standalone component — drop it anywhere a small loading
* indicator is needed.
*/
var Spinner = setComponentTemplate(precompileTemplate("<span class=\"boxel-spinner spinner\" role=\"presentation\" ...attributes></span>\n\n<style scoped>\n  .boxel-spinner {\n    display: inline-block;\n    width: 24px;\n    height: 24px;\n    border: 3px solid var(--border, #e5e7eb);\n    border-top-color: var(--accent, #6366f1);\n    border-radius: 50%;\n    animation: boxel-spinner-spin 800ms linear infinite;\n  }\n  @keyframes boxel-spinner-spin {\n    to { transform: rotate(360deg); }\n  }\n  /* Respect motion preferences — users who opt out of animation get\n   * a static ring with the accent arc still visible (so the spinner\n   * still reads as an indicator), just not rotating. */\n  @media (prefers-reduced-motion: reduce) {\n    .boxel-spinner { animation: none; }\n  }\n</style>", { strictMode: true }), templateOnly());
var _Toast;
/**
* `<Toast>` — short-lived notification chip. Dark background, white
* text, soft shadow, fades in over 160ms.
*
* Phase 2B.7b of EMBED-READINESS-PLAN.md. Wrapper-only — consumer
* fills the default block with the message.
*
* Two positioning modes:
*   • normal flow (default) — pair with a positioning modifier on
*     the invocation if you want the toast anchored to a specific
*     element (the host POC uses ember-velcro for this; the package
*     stays neutral about which positioning lib you use)
*   • floating (`@floating={{true}}`) — fixed to bottom-center
*     of the viewport, useful as a global notification surface
*
* `pointer-events: none` so the toast doesn't intercept clicks
* while it's fading. z-index uses --z-toast (top of the named tier).
*/
var Toast = class extends Component {};
_Toast = Toast;
setComponentTemplate(precompileTemplate("<div class=\"boxel-toast copy-toast {{if @floating \"boxel-toast--floating copy-toast-floating\"}}\" role=\"status\" aria-live=\"polite\" ...attributes>{{yield}}</div>\n\n<style scoped>\n  .boxel-toast {\n    background: var(--fg, #111827);\n    color: #fff;\n    padding: 6px 12px;\n    border-radius: 6px;\n    font: 500 12px Inter, system-ui, sans-serif;\n    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.2);\n    z-index: var(--z-toast, 10000);\n    pointer-events: none;\n    white-space: nowrap;\n    animation: boxel-toast-fade-in 160ms ease-out;\n  }\n\n  .boxel-toast--floating {\n    position: fixed;\n    bottom: 24px;\n    left: 50%;\n    transform: translateX(-50%);\n  }\n\n  @keyframes boxel-toast-fade-in {\n    from { opacity: 0; transform: translateY(-4px); }\n    to   { opacity: 1; transform: translateY(0); }\n  }\n  /* Skip the fade-in for users with reduced-motion preference. */\n  @media (prefers-reduced-motion: reduce) {\n    .boxel-toast { animation: none; }\n  }\n</style>", { strictMode: true }), _Toast);
/**
* `<ResizeHandle>` — vertical drag affordance at the right edge of a
* column header. 6×18px transparent strip, becomes accent-colored on
* hover.
*
* Phase 2B.7c of EMBED-READINESS-PLAN.md. Pure visual — the consumer
* attaches drag handlers via splattributes:
*
* ```gts
* <ResizeHandle
*   {{on "mousedown" col.getResizeHandler}}
*   {{on "touchstart" col.getResizeHandler}}
*   {{on "dblclick" (fn this.autoFit col.id)}}
* />
* ```
*
* `position: absolute; right: 0` — the parent header cell must
* establish a positioning context (typical for header cells which
* use `position: sticky` or have an explicit position).
*
* `role="separator"` + `aria-orientation="vertical"` mark this as
* a resize affordance for assistive tech. `cursor: col-resize`
* signals the action to sighted users.
*/
var ResizeHandle = setComponentTemplate(precompileTemplate("<span class=\"boxel-resize-handle resize-handle\" role=\"separator\" aria-orientation=\"vertical\" aria-label=\"Resize column (double-click to auto-fit)\" ...attributes></span>\n\n<style scoped>\n  .boxel-resize-handle {\n    position: absolute;\n    right: 0;\n    top: 50%;\n    transform: translateY(-50%);\n    height: 18px;\n    width: 6px;\n    cursor: col-resize;\n    user-select: none;\n    touch-action: none;\n    background: transparent;\n    border-radius: 2px;\n    transition: background 80ms;\n  }\n  .boxel-resize-handle:hover {\n    background: var(--accent, #6366f1);\n  }\n</style>", { strictMode: true }), templateOnly());
/**
* Pin-style helper — composes the inline `style` string for a sticky-pinned
* header / body / filter cell into one place.
*
* Phase 2B.6 of EMBED-READINESS-PLAN.md: collapses the three
* `pinned*Style` getters previously living in the host
* (`pinnedCellStyle`, `pinnedHeaderGridStyle`, `pinnedFilterStyle`).
* They all produced essentially the same `position: sticky; left|right:
* Npx; z-index: var(--z-sticky-*);` shape; only the z-tier and whether
* to prepend `grid-area:` differed.
*
* Caller supplies the OFFSETS already resolved (in px from the
* scroll-container edge — including any host-specific prelude widths
* like row-num + select-cell). The helper does not look up column
* widths or pin order; that's column-state logic the host already
* owns.
*
* Returns a `SafeString` ready to drop into `style={{...}}`. Returns
* the empty SafeString when the cell is not pinned and no `gridArea`
* is provided — same shape the old helpers produced.
*
* Usage:
*
* ```ts
* import { pinStyle } from '@tanstack/ember-table';
*
* pinStyle({
*   isPinnedLeft: true,
*   leftOffset: 168,        // px from scroll-container left edge
*   zTier: 'body',          // body cells use --z-sticky-body
* });
* // → 'position: sticky; left: 168px; z-index: var(--z-sticky-body);'
*
* pinStyle({
*   isPinnedRight: true,
*   rightOffset: 0,
*   zTier: 'header',        // header cells sit above body sticky tier
*   gridArea: '1 / 7 / 3 / 8',
* });
* // → 'grid-area: 1 / 7 / 3 / 8; position: sticky; right: 0px;
* //    z-index: var(--z-sticky-header);'
* ```
*
* `--z-sticky-body` / `--z-sticky-header` are defined on `<Grid>` (see
* grid.gts z-tier comment) and resolve via the CSS cascade.
*/
function pinStyle(opts) {
	const parts = [];
	if (opts.gridArea) parts.push(`grid-area: ${opts.gridArea}`);
	if (opts.isPinnedLeft) {
		parts.push("position: sticky");
		parts.push(`left: ${opts.leftOffset ?? 0}px`);
		parts.push(`z-index: var(--z-sticky-${opts.zTier})`);
	} else if (opts.isPinnedRight) {
		parts.push("position: sticky");
		parts.push(`right: ${opts.rightOffset ?? 0}px`);
		parts.push(`z-index: var(--z-sticky-${opts.zTier})`);
	}
	if (parts.length === 0) return htmlSafe("");
	return htmlSafe(parts.join("; ") + ";");
}
var ToolbarAction = setComponentTemplate(precompileTemplate("<button type=\"button\" class=\"t-action variant-{{if @variant @variant \"default\"}}\" title=\"{{if @title @title @label}}{{if @shortcut (concat \" (\" @shortcut \")\")}}\" disabled={{@disabled}} {{on \"click\" @onClick}} ...attributes>\n  {{#if @icon}}<span class=\"t-action-icon\">{{@icon}}</span>{{/if}}\n  {{#if @label}}<span class=\"t-action-label\">{{@label}}</span>{{/if}}\n</button>\n\n<style scoped>\n  /* Three variants: ghost (default), primary (accent-tinted), danger\n   * (red-tinted). Flat at rest, gain border on hover — matches the\n   * Round-5 toolbar visual baseline. */\n  .t-action {\n    display: inline-flex;\n    align-items: center;\n    gap: 6px;\n    background: transparent;\n    border: 1px solid transparent;\n    border-radius: 6px;\n    padding: 5px 10px;\n    font: inherit;\n    font-weight: 500;\n    color: #374151;\n    cursor: pointer;\n    line-height: 1.3;\n    white-space: nowrap;\n    flex: 0 0 auto;\n    transition: background 80ms ease-out, border-color 80ms, color 80ms;\n  }\n  .t-action-label { white-space: nowrap; }\n  .t-action:hover:not(:disabled) {\n    background: var(--t-bg-hover, #f3f4f6);\n    border-color: var(--t-border, #e5e7eb);\n    color: #111827;\n  }\n  .t-action:focus-visible {\n    outline: 2px solid var(--t-accent, #6366f1);\n    outline-offset: -1px;\n  }\n  .t-action:disabled {\n    opacity: 0.5;\n    cursor: not-allowed;\n  }\n\n  /* Primary — additive actions (\"+ Row\", \"+ Column\"). Accent tint at\n   * rest so they read as the call to action. */\n  .t-action.variant-primary {\n    background: color-mix(in srgb, var(--t-accent, #6366f1) 7%, transparent);\n    color: var(--t-accent, #6366f1);\n    border-color: color-mix(in srgb, var(--t-accent, #6366f1) 18%, transparent);\n  }\n  .t-action.variant-primary:hover:not(:disabled) {\n    background: color-mix(in srgb, var(--t-accent, #6366f1) 14%, transparent);\n    border-color: color-mix(in srgb, var(--t-accent, #6366f1) 30%, transparent);\n  }\n\n  /* Danger — destructive actions. Subtle until hovered. */\n  .t-action.variant-danger {\n    color: #b91c1c;\n  }\n  .t-action.variant-danger:hover:not(:disabled) {\n    background: color-mix(in srgb, #ef4444 10%, transparent);\n    border-color: color-mix(in srgb, #ef4444 30%, transparent);\n  }\n\n  .t-action-icon {\n    font-size: 11px;\n    opacity: 0.7;\n    display: inline-flex;\n    align-items: center;\n  }\n</style>", {
	strictMode: true,
	scope: () => ({
		concat,
		on
	})
}), templateOnly());
var _ToolbarSearch;
var ToolbarSearch = class extends Component {
	constructor(...args) {
		super(...args);
		_defineProperty(this, "setValue", (event) => {
			const v = event.target.value;
			this.args.onChange(v);
		});
		_defineProperty(this, "clear", () => {
			if (this.args.onClear) this.args.onClear();
			else this.args.onChange("");
		});
	}
	get widthStyle() {
		return `flex: 0 0 ${this.args.width ?? 240}px;`;
	}
};
_ToolbarSearch = ToolbarSearch;
setComponentTemplate(precompileTemplate("<div class=\"t-search-wrap\" style={{this.widthStyle}}>\n  <input type=\"text\" class=\"t-search\" value={{@value}} placeholder={{if @placeholder @placeholder \"Filter…\"}} {{on \"input\" this.setValue}} ...attributes />\n  {{#if @value}}\n    <button type=\"button\" class=\"t-search-clear\" aria-label=\"Clear search\" {{on \"click\" this.clear}}>×</button>\n  {{/if}}\n</div>\n\n<style scoped>\n  .t-search-wrap {\n    position: relative;\n    display: inline-flex;\n    align-items: center;\n  }\n  .t-search {\n    width: 100%;\n    padding: 6px 28px 6px 10px;\n    border: 1px solid var(--t-border, #e5e7eb);\n    border-radius: 6px;\n    font: inherit;\n    background: var(--t-bg-soft, #fafbfc);\n    color: var(--t-text, #111827);\n    transition: border-color 80ms, background 80ms, box-shadow 80ms;\n  }\n  .t-search:focus {\n    outline: none;\n    border-color: var(--t-accent, #6366f1);\n    background: var(--t-bg, #fff);\n    box-shadow: 0 0 0 3px color-mix(in srgb, var(--t-accent, #6366f1) 14%, transparent);\n  }\n  .t-search::placeholder { color: #9ca3af; }\n  .t-search-clear {\n    position: absolute;\n    right: 4px;\n    top: 50%;\n    transform: translateY(-50%);\n    background: transparent;\n    border: 0;\n    padding: 0;\n    width: 20px;\n    height: 20px;\n    border-radius: 4px;\n    color: #9ca3af;\n    font-size: 14px;\n    cursor: pointer;\n    line-height: 1;\n    transition: background 80ms, color 80ms;\n  }\n  .t-search-clear:hover { background: var(--t-bg-hover, #f3f4f6); color: #374151; }\n</style>", {
	strictMode: true,
	scope: () => ({ on })
}), _ToolbarSearch);
var _ToolbarSelect;
var ToolbarSelect = class extends Component {
	constructor(...args) {
		super(...args);
		_defineProperty(this, "setValue", (event) => {
			const v = event.target.value;
			this.args.onChange(v);
		});
	}
};
_ToolbarSelect = ToolbarSelect;
setComponentTemplate(precompileTemplate("<label class=\"t-select\" ...attributes>\n  {{#if @label}}\n    <span class=\"t-select-label\">{{@label}}</span>\n  {{/if}}\n  <select class=\"t-select-input\" {{on \"change\" this.setValue}}>\n    {{#each @options key=\"value\" as |opt|}}\n      <option value={{opt.value}} disabled={{opt.disabled}} selected={{eq @value opt.value}}>{{opt.label}}</option>\n    {{/each}}\n  </select>\n</label>\n\n<style scoped>\n  /* Label sits inside the same pill as the select, separated by no\n   * divider — the label IS the prefix. Mirrors the `Data: <select>`\n   * pattern from the Round-5 toolbar, but as a single integrated\n   * widget so the eye lands once. */\n  .t-select {\n    display: inline-flex;\n    align-items: center;\n    gap: 4px;\n    padding: 4px 4px 4px 10px;\n    font-size: 12px;\n    color: #6b7280;\n    background: var(--t-bg-soft, #fafbfc);\n    border: 1px solid var(--t-border, #e5e7eb);\n    border-radius: 6px;\n    line-height: 1.3;\n    transition: border-color 80ms, background 80ms;\n  }\n  .t-select:hover {\n    border-color: color-mix(in srgb, var(--t-accent, #6366f1) 30%, var(--t-border, #e5e7eb));\n  }\n  .t-select-label {\n    font-weight: 500;\n    color: #6b7280;\n  }\n  .t-select-input {\n    background: transparent;\n    border: 0;\n    padding: 2px 4px;\n    font: inherit;\n    font-weight: 500;\n    color: var(--t-text, #111827);\n    cursor: pointer;\n    outline: none;\n  }\n  .t-select-input:focus { color: var(--t-accent, #6366f1); }\n</style>", {
	strictMode: true,
	scope: () => ({
		on,
		eq: eq$2
	})
}), _ToolbarSelect);
function eq$2(a, b) {
	return a === b;
}
var _ToolbarToggle;
var ToolbarToggle = class extends Component {
	constructor(...args) {
		super(...args);
		_defineProperty(this, "pick", (option) => {
			if (option !== this.args.value) this.args.onChange(option);
		});
		_defineProperty(this, "isActive", (option) => option === this.args.value);
	}
};
_ToolbarToggle = ToolbarToggle;
setComponentTemplate(precompileTemplate("<div class=\"t-toggle\" role=\"radiogroup\" aria-label={{@label}} ...attributes>\n  {{#if @label}}\n    <span class=\"t-toggle-label\">{{@label}}</span>\n  {{/if}}\n  <div class=\"t-toggle-track\">\n    {{#each @options key=\"@identity\" as |opt|}}\n      <button type=\"button\" role=\"radio\" aria-checked={{this.isActive opt}} class=\"t-toggle-opt {{if (this.isActive opt) \"on\"}}\" {{on \"click\" (fn this.pick opt)}}>{{opt}}</button>\n    {{/each}}\n  </div>\n</div>\n\n<style scoped>\n  .t-toggle {\n    display: inline-flex;\n    align-items: center;\n    gap: 6px;\n    padding: 3px 4px 3px 10px;\n    background: var(--t-bg-soft, #fafbfc);\n    border: 1px solid var(--t-border, #e5e7eb);\n    border-radius: 6px;\n    font-size: 12px;\n    line-height: 1.3;\n  }\n  .t-toggle-label {\n    color: #6b7280;\n    font-weight: 500;\n  }\n  .t-toggle-track {\n    display: inline-flex;\n    gap: 2px;\n    background: transparent;\n  }\n  .t-toggle-opt {\n    background: transparent;\n    border: 0;\n    padding: 3px 8px;\n    font: inherit;\n    font-weight: 500;\n    color: #6b7280;\n    cursor: pointer;\n    border-radius: 4px;\n    text-transform: capitalize;\n    transition: background 80ms, color 80ms;\n  }\n  .t-toggle-opt:hover:not(.on) {\n    background: var(--t-bg-hover, #f3f4f6);\n    color: #111827;\n  }\n  .t-toggle-opt.on {\n    background: var(--t-bg, #fff);\n    color: var(--t-accent, #6366f1);\n    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06), inset 0 0 0 1px var(--t-border, #e5e7eb);\n  }\n</style>", {
	strictMode: true,
	scope: () => ({
		on,
		fn
	})
}), _ToolbarToggle);
var ToolbarDivider = setComponentTemplate(precompileTemplate("<span class=\"t-divider\" aria-hidden=\"true\" ...attributes></span>\n<style scoped>\n  .t-divider {\n    width: 1px;\n    height: 22px;\n    background: var(--t-border, #e5e7eb);\n    margin: 0 4px;\n    flex: 0 0 auto;\n  }\n</style>", { strictMode: true }), templateOnly());
var _class, _descriptor, _ToolbarMenu;
var MENU_OPENED_EVENT = "tanstack-toolbar-menu-opened";
var ToolbarMenu = (_class = (_ToolbarMenu = class ToolbarMenu extends Component {
	constructor(owner, args) {
		super(owner, args);
		_initializerDefineProperty(this, "open", _descriptor, this);
		_defineProperty(this, "_instanceId", Math.random());
		_defineProperty(this, "toggle", () => {
			if (this.open) this.open = false;
			else {
				this.open = true;
				document.dispatchEvent(new CustomEvent(MENU_OPENED_EVENT, { detail: { id: this._instanceId } }));
			}
		});
		_defineProperty(this, "close", () => {
			this.open = false;
		});
		_defineProperty(this, "handleSiblingOpen", (event) => {
			if (event.detail?.id !== this._instanceId) this.open = false;
		});
		_defineProperty(this, "outsideClick", (event) => {
			if (!this.open) return;
			if (!event.target?.closest(".t-menu")) this.open = false;
		});
		_defineProperty(this, "escape", (event) => {
			if (event.key === "Escape" && this.open) this.open = false;
		});
		_defineProperty(this, "pickInside", (event) => {
			if (event.target?.closest(".t-action, [role=\"menuitem\"]")) this.open = false;
		});
		document.addEventListener("mousedown", this.outsideClick, true);
		document.addEventListener("keydown", this.escape, true);
		document.addEventListener(MENU_OPENED_EVENT, this.handleSiblingOpen);
		registerDestructor(this, () => {
			document.removeEventListener("mousedown", this.outsideClick, true);
			document.removeEventListener("keydown", this.escape, true);
			document.removeEventListener(MENU_OPENED_EVENT, this.handleSiblingOpen);
		});
	}
}, setComponentTemplate(precompileTemplate("<div class=\"t-menu {{if this.open \"open\"}}\" ...attributes>\n  <button type=\"button\" class=\"t-menu-trigger\" aria-haspopup=\"menu\" aria-expanded={{this.open}} {{on \"click\" this.toggle}}>\n    {{#if @icon}}<span class=\"t-menu-icon\">{{@icon}}</span>{{/if}}\n    <span class=\"t-menu-label\">{{@label}}</span>\n    <span class=\"t-menu-chevron\">▾</span>\n  </button>\n  {{#if this.open}}\n    <div class=\"t-menu-popover align-{{if @align @align \"left\"}}\" role=\"menu\" {{on \"click\" this.pickInside}}>\n      {{yield (hash Action=ToolbarAction Divider=ToolbarDivider Select=ToolbarSelect Toggle=ToolbarToggle)}}\n    </div>\n  {{/if}}\n</div>\n\n<style scoped>\n  .t-menu { position: relative; display: inline-flex; }\n  .t-menu-trigger {\n    display: inline-flex;\n    align-items: center;\n    gap: 4px;\n    background: transparent;\n    border: 1px solid transparent;\n    border-radius: 6px;\n    padding: 5px 8px 5px 10px;\n    font: inherit;\n    font-weight: 500;\n    color: #374151;\n    cursor: pointer;\n    transition: background 80ms, border-color 80ms;\n  }\n  .t-menu-trigger:hover,\n  .t-menu.open .t-menu-trigger {\n    background: var(--t-bg-hover, #f3f4f6);\n    border-color: var(--t-border, #e5e7eb);\n    color: #111827;\n  }\n  .t-menu-icon { font-size: 11px; opacity: 0.7; }\n  .t-menu-chevron {\n    font-size: 9px;\n    opacity: 0.6;\n    margin-left: 2px;\n  }\n\n  .t-menu-popover {\n    position: absolute;\n    top: calc(100% + 4px);\n    z-index: 100;\n    min-width: 180px;\n    background: var(--t-bg, #fff);\n    border: 1px solid var(--t-border, #e5e7eb);\n    border-radius: 8px;\n    box-shadow:\n      0 12px 24px -8px rgba(0, 0, 0, 0.12),\n      0 4px 8px -4px rgba(0, 0, 0, 0.08);\n    padding: 4px;\n    display: flex;\n    flex-direction: column;\n    gap: 1px;\n  }\n  .t-menu-popover.align-left  { left: 0; }\n  .t-menu-popover.align-right { right: 0; }\n  /* Inside the popover, action buttons fill width and align left\n   * — they're menu items, not toolbar buttons. Plain selectors\n   * (no scoping in Glimmer) so the cascade picks them up. */\n  .t-menu-popover .t-action {\n    justify-content: flex-start;\n    width: 100%;\n  }\n</style>", {
	strictMode: true,
	scope: () => ({
		on,
		hash,
		ToolbarAction,
		ToolbarDivider,
		ToolbarSelect,
		ToolbarToggle
	})
}), _ToolbarMenu), _ToolbarMenu), _descriptor = _applyDecoratedDescriptor(_class.prototype, "open", [tracked], {
	configurable: true,
	enumerable: true,
	writable: true,
	initializer: function() {
		return false;
	}
}), _class);
var ToolbarBadge = setComponentTemplate(precompileTemplate("{{#unless @hidden}}\n  <span class=\"t-badge variant-{{if @variant @variant \"default\"}}\" ...attributes>\n    <span class=\"t-badge-value\">{{@value}}</span>\n    {{#if @label}}\n      <span class=\"t-badge-label\">{{@label}}</span>\n    {{/if}}\n  </span>\n{{/unless}}\n\n<style scoped>\n  .t-badge {\n    display: inline-flex;\n    align-items: baseline;\n    gap: 4px;\n    padding: 3px 8px;\n    border-radius: 999px;\n    font-size: 11px;\n    font-weight: 600;\n    line-height: 1.3;\n    letter-spacing: 0.01em;\n  }\n  .t-badge-value { font-variant-numeric: tabular-nums; }\n  .t-badge-label { font-weight: 500; opacity: 0.85; }\n\n  .t-badge.variant-default {\n    background: #f3f4f6;\n    color: #4b5563;\n  }\n  .t-badge.variant-accent {\n    background: color-mix(in srgb, var(--t-accent, #6366f1) 12%, transparent);\n    color: var(--t-accent, #6366f1);\n  }\n  .t-badge.variant-warning {\n    background: #fffbeb;\n    color: #b45309;\n  }\n  .t-badge.variant-danger {\n    background: #fee2e2;\n    color: #b91c1c;\n  }\n</style>", { strictMode: true }), templateOnly());
var ToolbarSpacer = setComponentTemplate(precompileTemplate("<span class=\"t-spacer\" aria-hidden=\"true\" ...attributes></span>\n<style scoped>\n  .t-spacer { flex: 1 1 auto; min-width: 0; }\n</style>", { strictMode: true }), templateOnly());
/**
* Module-scope registry mapping built-in name → component class.
* Used by the Layer-2 `@items` renderer to dispatch string shortcuts
* (`'search'` / `'action'` / etc.) to the right component.
*
* Mirrors AG Grid's name-to-class dispatch (`'agGroupCellRenderer'` →
* `AgGroupCellRenderer`) but as a flat module-scope map rather than a
* runtime `Registry` class — Glimmer resolves components at compile
* time, no need for an instance lookup.
*/
var BUILTIN_TOOLBAR_COMPONENTS = {
	action: ToolbarAction,
	search: ToolbarSearch,
	select: ToolbarSelect,
	toggle: ToolbarToggle,
	menu: ToolbarMenu,
	badge: ToolbarBadge,
	spacer: ToolbarSpacer,
	divider: ToolbarDivider
};
function isBuiltinName(x) {
	return typeof x === "string" && Object.prototype.hasOwnProperty.call(BUILTIN_TOOLBAR_COMPONENTS, x);
}
var _RenderItem;
/**
* Internal helper used by the Layer-2 `@items` renderer. Resolves a
* single `ToolbarItemEntry` (string shortcut, full def, or custom
* component) into the matching component class, then invokes it with
* the entry's params + the toolbar api.
*
* Built-in items receive their params SPREAD as args (so
* `params: { value, onChange }` becomes `@value` + `@onChange`).
*
* Custom items receive `@params` AS A WHOLE OBJECT plus `@api`. The
* custom component is responsible for reading the keys it cares about.
* This shape mirrors AG Grid's `cellRendererParams` envelope.
*/
var RenderItem = class extends Component {
	get def() {
		const e = this.args.item;
		if (typeof e === "string") {
			if (!isBuiltinName(e)) return null;
			return { component: e };
		}
		return e;
	}
	get isHidden() {
		return Boolean(this.def?.hidden);
	}
	get componentClass() {
		const d = this.def;
		if (!d) return null;
		const c = d.component;
		if (typeof c === "string") return isBuiltinName(c) ? BUILTIN_TOOLBAR_COMPONENTS[c] : null;
		return c;
	}
	get isCustom() {
		const d = this.def;
		return Boolean(d && typeof d.component !== "string");
	}
	get params() {
		return this.def?.params ?? {};
	}
	get pAny() {
		return this.params;
	}
};
_RenderItem = RenderItem;
setComponentTemplate(precompileTemplate("{{#if this.isHidden}}\n  {{!-- explicit hide --}}\n{{else if this.componentClass}}\n  {{#let this.componentClass as |C|}}\n    {{#if this.isCustom}}\n      {{!-- Custom items get the whole envelope. --}}\n      <C @params={{this.params}} @api={{@api}} />\n    {{else}}\n      {{!-- Built-ins: forward common props by name. Each component\n            only reads the ones it knows; extras are harmless. --}}\n      <C @value={{this.pAny.value}} @label={{this.pAny.label}} @icon={{this.pAny.icon}} @placeholder={{this.pAny.placeholder}} @width={{this.pAny.width}} @options={{this.pAny.options}} @variant={{this.pAny.variant}} @disabled={{this.pAny.disabled}} @shortcut={{this.pAny.shortcut}} @title={{this.pAny.title}} @hidden={{this.pAny.hidden}} @align={{this.pAny.align}} @onChange={{this.pAny.onChange}} @onClick={{this.pAny.onClick}} @onClear={{this.pAny.onClear}} />\n    {{/if}}\n  {{/let}}\n{{/if}}", { strictMode: true }), _RenderItem);
var _Toolbar;
var Toolbar = class extends Component {
	get normalizedItems() {
		return (this.args.items ?? []).map((e) => typeof e === "string" ? isBuiltinName(e) ? { component: e } : null : e).filter((x) => Boolean(x));
	}
	get hasItems() {
		return (this.args.items?.length ?? 0) > 0;
	}
	get itemsStart() {
		return this.normalizedItems.filter((i) => (i.align ?? "start") === "start");
	}
	get itemsCenter() {
		return this.normalizedItems.filter((i) => i.align === "center");
	}
	get itemsEnd() {
		return this.normalizedItems.filter((i) => i.align === "end");
	}
};
_Toolbar = Toolbar;
setComponentTemplate(precompileTemplate("<div class=\"t-toolbar density-{{if @density @density \"standard\"}} {{if @sticky \"t-sticky\"}} {{if this.hasItems \"t-config-driven\"}}\" role=\"toolbar\" aria-label={{@aria-label}} ...attributes>\n  {{#if this.hasItems}}\n    {{!-- Layer 2 — three-container align dispatch. AG Grid's status\n          bar uses left/center/right divs with parent flex; we mirror\n          that. Empty groups have no visible chrome. --}}\n    <div class=\"t-align t-align-start\">\n      {{#each this.itemsStart key=\"@index\" as |item|}}\n        <RenderItem @item={{item}} @api={{@api}} />\n      {{/each}}\n    </div>\n    <div class=\"t-align t-align-center\">\n      {{#each this.itemsCenter key=\"@index\" as |item|}}\n        <RenderItem @item={{item}} @api={{@api}} />\n      {{/each}}\n    </div>\n    <div class=\"t-align t-align-end\">\n      {{#each this.itemsEnd key=\"@index\" as |item|}}\n        <RenderItem @item={{item}} @api={{@api}} />\n      {{/each}}\n    </div>\n  {{else}}\n    {{!-- Layer 1 — slot composition. Yields the sub-component\n          namespace + the api so consumers compose by hand. --}}\n    {{yield (hash Action=ToolbarAction Search=ToolbarSearch Select=ToolbarSelect Toggle=ToolbarToggle Menu=ToolbarMenu Badge=ToolbarBadge Spacer=ToolbarSpacer Divider=ToolbarDivider api=@api)}}\n  {{/if}}\n</div>\n\n<style scoped>\n  .t-toolbar {\n    display: flex;\n    align-items: center;\n    flex-wrap: wrap;            /* overflow → wrap to next row, never clip */\n    row-gap: 6px;\n    column-gap: 6px;\n    padding: 8px 10px;\n    background: var(--t-bg, #fff);\n    border: 1px solid var(--t-border, #e5e7eb);\n    font-family: Inter, system-ui, -apple-system, sans-serif;\n    font-size: 13px;\n    color: var(--t-text, #111827);\n  }\n  .t-toolbar > * { flex-shrink: 0; }\n\n  /* Config-driven (@items) layout — three align containers laid out\n   * with space-between so each cluster gravitates to its edge.\n   * Slot composition keeps the simple flat flex layout. */\n  .t-toolbar.t-config-driven {\n    justify-content: space-between;\n  }\n  .t-align {\n    display: flex;\n    align-items: center;\n    gap: 6px;\n    flex-wrap: wrap;\n  }\n  .t-align:empty {\n    flex: 0 0 0;\n  }\n  /* Start cluster gets `flex: 1` only when it's the only one with\n   * items, so a single-cluster toolbar still pushes content left.\n   * Center stays auto-sized; end stays auto-sized at the right. */\n  .t-align-start  { flex: 1 1 auto; min-width: 0; justify-content: flex-start; }\n  .t-align-center { flex: 0 1 auto; justify-content: center; }\n  .t-align-end    { flex: 0 1 auto; justify-content: flex-end; }\n\n  .t-toolbar.t-sticky {\n    position: sticky;\n    top: 0;\n    z-index: 5;\n  }\n  .t-toolbar.density-compact {\n    padding: 4px 8px;\n    gap: 4px;\n    font-size: 12px;\n  }\n</style>", {
	strictMode: true,
	scope: () => ({
		RenderItem,
		hash,
		ToolbarAction,
		ToolbarSearch,
		ToolbarSelect,
		ToolbarToggle,
		ToolbarMenu,
		ToolbarBadge,
		ToolbarSpacer,
		ToolbarDivider
	})
}), _Toolbar);
//#endregion
export { $internalMemoFnMeta, Cell, CellInner, DragGhost, DropIndicator, FieldAtomBridge, FieldEditBridge, GRID_CELL_POLICY, GRID_CONTRACTS, Grid, GridOverlay, LAYERS, SurfaceLayerManager as LayerManager, Lift, LiftChevron, LiftState, RangeOverlay, ResizeHandle, Row, RowIterator, SheetRowKeyContextName, SheetRuntime, SheetRuntimeContextName, SheetRuntimeProvider, SlotRender, Spinner, TableController, TableResource, Toast, Toolbar, ToolbarAction, ToolbarBadge, ToolbarDivider, ToolbarMenu, ToolbarSearch, ToolbarSelect, ToolbarSpacer, ToolbarToggle, VirtualSpacer, aggregationFn_count, aggregationFn_extent, aggregationFn_max, aggregationFn_mean, aggregationFn_median, aggregationFn_min, aggregationFn_sum, aggregationFn_unique, aggregationFn_uniqueCount, aggregationFns, applyGridRuntimeSelection, assignPrototypeAPIs, assignTableAPIs, basicCellWidget, buildHeaderGroups, callMemoOrStaticFn, cellWidgets, cloneState, columnFacetingFeature, columnFilteringFeature, columnGroupingFeature, columnOrderingFeature, columnPinningFeature, columnResizingFeature, columnSizingFeature, columnVisibilityFeature, constructCell, constructColumn, constructColumnFacetingFeature, constructColumnFilteringFeature, constructColumnGroupingFeature, constructColumnOrderingFeature, constructColumnPinningFeature, constructColumnResizingFeature, constructColumnSizingFeature, constructColumnVisibilityFeature, constructCoreCellsFeature, constructCoreColumnsFeature, constructCoreHeadersFeature, constructCoreRowModelsFeature, constructCoreRowsFeature, constructCoreTablesFeature, constructGlobalFilteringFeature, constructHeader, constructReactivityFeature, constructRow, constructRowExpandingFeature, constructRowPaginationFeature, constructRowPinningFeature, constructRowSelectionFeature, constructRowSortingFeature, constructTable, coreCellsFeature, coreColumnsFeature, coreFeatures, coreHeadersFeature, coreRowModelsFeature, coreRowsFeature, coreTablesFeature, createColumnHelper, createCoreRowModel, createExpandedRowModel, createFacetedMinMaxValues, createFacetedRowModel, createFacetedUniqueValues, createFilteredRowModel, createGroupedRowModel, createLiftState, createPaginatedRowModel, createSheetRuntime, createSheetRuntimeProvider, createSortedRowModel, expandRows, filterFn_arrHas, filterFn_arrIncludes, filterFn_arrIncludesAll, filterFn_arrIncludesSome, filterFn_equals, filterFn_equalsString, filterFn_equalsStringSensitive, filterFn_greaterThan, filterFn_greaterThanOrEqualTo, filterFn_inNumberRange, filterFn_includesString, filterFn_includesStringSensitive, filterFn_lessThan, filterFn_lessThanOrEqualTo, filterFn_weakEquals, filterFns, flattenBy, functionalUpdate, getFunctionNameInfo, getInitialTableState, getMemoFnMeta, getSheet, getTable, globalFilteringFeature, gridRuntimeRegistrationPlan, gridRuntimeSelectionSteps, inferBasicCellKind, isFunction, isNumberArray, makeStateUpdater, memo, noop, pinStyle, reSplitAlphaNumeric, registerSheetCellElement, rowExpandingFeature, rowPaginationFeature, rowPinningFeature, rowSelectionFeature, rowSortingFeature, safeGridIdPart, sheetCellRegistration, sortFn_alphanumeric, sortFn_alphanumericCaseSensitive, sortFn_basic, sortFn_datetime, sortFn_text, sortFn_textCaseSensitive, sortFns, stockFeatures, surfaceLiftBinding, tableFeatures, tableMemo, tableOptions };
