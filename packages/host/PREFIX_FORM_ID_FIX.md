# Prefix-Form Card ID 解析修复

相关 Linear issue：[CS-10654](https://linear.app/cardstack/issue/CS-10654/invalid-url-issue-present-in-multiple-places)

---

## 问题背景

服务器返回的卡片 ID 有时是 **prefix 简写形式**，例如：

```
@cardstack/catalog/piano/Piano/20dfd090-15bd-45e3-bd0d-b2fe8c3dcc8d
```

而不是绝对 URL：

```
http://localhost:4201/catalog/piano/Piano/20dfd090-15bd-45e3-bd0d-b2fe8c3dcc8d
```

整个代码库中大量地方直接使用 `new URL(id)`，一旦 `id` 是 prefix 形式就会抛出：

```
TypeError: Failed to construct 'URL': Invalid URL
```

这个错误出现在命令、组件、服务的多个地方（见 CS-10654）。

---

## 修复思路

> **核心原则：在最高层解决，下层代码无需改动。**

### 第一步：顶层拦截 — `virtual-network.ts` + `code-ref.ts`

#### `packages/runtime-common/virtual-network.ts`

VirtualNetwork 是应用的自定义 HTTP 层，**所有 `fetch` 调用都经过这里**。在这里拦截 prefix 形式的 URL 字符串并解析成绝对 URL，就能覆盖所有 HTTP 请求，不需要修改任何命令或组件。

```typescript
if (typeof urlOrRequest === 'string' && isRegisteredPrefix(urlOrRequest)) {
  urlOrRequest = resolveCardReference(urlOrRequest, undefined);
}
```

#### `packages/runtime-common/code-ref.ts` — `identifyCard`

Loader 内部出于可移植性，用 `unresolveCardReference` 把模块路径存成 prefix 形式。`identifyCard` 直接返回这个 prefix 形式的 module 字符串，导致调用方（如 `show-card` 命令）执行 `new URL(cardDefRef.module + '.gts')` 时崩溃。在 `identifyCard` 里解析，所有调用方都不需要改。

```typescript
let resolvedRef = { ...ref, module: resolveCardReference(ref.module, undefined) };
return maybeRelativeURL
  ? { ...resolvedRef, module: maybeRelativeURL(resolvedRef.module) }
  : resolvedRef;
```

---

### 第二步：Spec Preview 仍然崩溃 — 需要修复 `store.ts` + `gc-card-store.ts`

顶层拦截解决了 HTTP 请求和模块识别的问题，但 **spec-preview 仍然报 `Invalid URL`**，原因是卡片实例本身的 `id` 属性被设置成了 prefix 形式。`spec-preview` 直接读取 `spec.id` 并调用 `new URL(spec.id)`，没经过 VirtualNetwork，所以顶层拦截救不到它。

这里需要从数据层（store + 缓存）确保卡片实例的 `id` 始终是绝对 URL。

#### `packages/host/app/services/store.ts`

**`createFromSerialized` / `createFileMetaFromSerialized`**

服务器返回的 resource 带 prefix 形式 `id`，卡片 API 水化时会把 `card.id` 设成这个 prefix 形式。在水化前先正规化，确保实例的 `id` 始终是绝对 URL。

**`persistAndUpdate` — 保存后服务器响应正规化**

保存卡片后，服务器响应的 `json.data.id` 也可能是 prefix 形式。`needsServerStateMerge` 用字符串比较 `instance.id`（绝对 URL）和 `json.data.id`（prefix 形式）——两者不同 → 错误触发 `updateFromSerialized` → 试图把已保存卡片的 ID 改成 prefix 形式 → 报错：

```
Error: cannot change the id for saved instance http://...
```

修复：拿到服务器响应后立即正规化 `json.data.id`。

**`persistAndUpdate` — 新卡片 ID 赋值**

新卡片第一次保存，`api.setId(instance, json.data.id!)` 会把 prefix 形式 ID 直接设到实例上。修复：用 `cardIdToURL(json.data.id!).href` 确保设的是绝对 URL。

**`search()` / `resolveDocUrl()`**

这两个方法接收 realm URL（可能是 prefix 形式）后直接 `new URL(realm)`。修复：改用 `cardIdToURL(realm)`。

#### `packages/host/app/lib/gc-card-store.ts`

内存缓存用 Map 存卡片，key 是卡片 ID。**写入时**（`setCardItem`）已正规化为绝对 URL，但**读取时**（`getCardItem`）没有正规化——用 prefix 形式查找时找不到已存入的绝对 URL key，导致缓存 miss，创建出重复实例，最终报：

```
Error: the instance with [remote id: http://...] has conflicting instance id in store
```

修复：在 `getCardItem` 和 `getFileMetaItem` 读取前也加正规化，使读写 key 格式完全一致。

---

## 修复总览

| 层级 | 文件 | 修复内容 |
|------|------|----------|
| HTTP 层 | `virtual-network.ts` | 所有 `fetch()` 调用的 prefix URL 拦截解析 |
| 模块识别层 | `code-ref.ts` | `identifyCard` 返回 prefix 形式 module 路径 |
| 卡片水化层 | `store.ts` | `createFromSerialized` 水化前正规化 `resource.id` |
| 保存响应层 | `store.ts` | `persistAndUpdate` 服务器响应 ID 正规化 |
| 新卡片 ID | `store.ts` | `api.setId` 使用绝对 URL |
| Realm URL | `store.ts` | `search()` / `resolveDocUrl()` 接受 prefix realm |
| 缓存读取 | `gc-card-store.ts` | `getCardItem` / `getFileMetaItem` 查找前正规化 |
| 缓存写入 | `gc-card-store.ts` | `setCardItem` / `setFileMetaItem` 存入前正规化 |
