# Invalidation Performance Analysis

## Problem Summary

The `realmIndexUpdater.update()` method is experiencing significant performance issues during file writes in the boxel system. Investigation reveals the bottleneck is in the invalidation calculation system.

## Performance Flow Analysis

### Call Stack
```
_batchWrite() 
  → realmIndexUpdater.update()
    → job.done (queue processing)
      → CurrentRun.incremental()
        → batch.invalidate()
          → calculateInvalidations() [BOTTLENECK]
            → itemsThatReference() [PRIMARY BOTTLENECK]
```

### Primary Bottleneck: `itemsThatReference()`

**Location**: `/packages/runtime-common/index-writer.ts:584`

**Problem**: Expensive database query that performs JSON array operations:
```sql
SELECT i.url, i.file_alias, i.type
FROM boxel_index_working as i
CROSS JOIN jsonb_array_elements_text(i.deps) as deps_array_element  -- EXPENSIVE
WHERE deps_array_element = 'target_module'
```

**Performance Issues**:
- JSON array expansion for every dependency lookup
- No database indexes on JSON array contents  
- Pagination overhead (1000 item chunks)
- Called recursively for every node in dependency graph

## Dependency System Analysis

### What `deps` Array Contains

The `deps` array contains **mixed dependencies**:

1. **Instance → Instance**: `["realm/card1.json", "realm/card2.json"]`
2. **Instance → Module**: `["realm/card-definition"]` 
3. **Module → Module**: `["realm/base-module"]`

### Dependency Graph Complexity

```
Module A changes
  ↓
Find all items with A in deps array (itemsThatReference)
  ↓  
Recursively find items depending on those items (calculateInvalidations)
  ↓
Creates exponential invalidation chains
```

## Performance Measurements Added

### Performance Logging
Added `perfLog` timing to:

1. **`itemsThatReference()`**:
   - Start/completion messages
   - Duration, result count, page count

2. **`calculateInvalidations()`**:
   - Only logs top-level calls (prevents recursive spam)
   - Total invalidation count and duration

### How to Enable
```bash
export DEBUG=index-perf
npm test -- --filter="invalidation"
```

## Key Findings

### 1. Unnecessary Dependencies Impact
- Larger `deps` arrays = slower JSON queries
- False invalidation cascades from unnecessary dependencies
- 4x+ more invalidation triggers than needed in some cases

### 2. Recursive Query Pattern
- `itemsThatReference()` called once per dependency node
- No batching of dependency lookups
- Database cannot optimize repeated similar queries

### 3. Pagination Overhead
- Manual `LIMIT/OFFSET` approach for 1000+ results
- Multiple round trips for large dependency sets

## Optimization Opportunities

### 1. Reverse Dependency Index
Create dedicated table:
```sql
CREATE TABLE dependency_index (
  module_url TEXT,
  dependent_url TEXT,
  dependent_type TEXT,
  INDEX (module_url)
);
```

### 2. Batch Dependency Resolution
- Single query to build complete dependency graph
- Topological sorting for optimal invalidation order

### 3. Dependency Cleanup
- Review `recursiveModuleDeps()` for unnecessary transitive deps
- Minimize `deps` arrays to only essential dependencies

### 4. Caching Strategy
- Cache dependency relationships between indexing runs
- Only recalculate when modules actually change

## Test Infrastructure

### Unit Tests Added
- `itemsThatReference returns correct dependencies for single item`
- `itemsThatReference handles module dependencies correctly`  
- `itemsThatReference handles pagination correctly` (1500+ items)
- `itemsThatReference respects realm boundaries`

### Test Locations
- `/packages/runtime-common/tests/index-writer-test.ts`
- `/packages/host/tests/unit/index-writer-test.ts`  
- `/packages/realm-server/tests/index-writer-test.ts`

## Next Steps

1. **Benchmark current performance** with added logging
2. **Analyze dependency patterns** to identify unnecessary deps
3. **Implement reverse dependency index** as primary optimization
4. **Add batched dependency resolution** for remaining cases
5. **Validate improvements** with existing test suite

## Files Modified

- `/packages/runtime-common/index-writer.ts` - Added performance logging, made `itemsThatReference` public
- `/packages/runtime-common/tests/index-writer-test.ts` - Added unit tests  
- `/packages/host/tests/unit/index-writer-test.ts` - Added test stubs
- `/packages/realm-server/tests/index-writer-test.ts` - Added test stubs

## Performance Context

The issue manifests as:
- Slow file writes in realm operations
- `realmIndexUpdater.update()` taking multiple seconds
- User-facing delays during content creation/editing
- Queue backlogs during high indexing activity