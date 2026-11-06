# Plan: Update DLC code to use new params.js fields + DLC-aware need persistence

## Context

`params.js` now has a new top-level `params.dlcs` array (DLC definitions with `guid`, `name`, `iconPath`, `id`) and a `dlcUnlocks: number[]` field on each asset in `needs`, `products`, `fertilities`, `factories`, `buildingBuffs`, `effects`, `techs`, and `items`.

The existing DLC infrastructure (DLC class, settings dialog, dependency tracking) was built for an old string-based ID scheme (`"dlc0"`, `"dlc1"`, …). It needs to be updated to:
1. Build a GUID-keyed map from the new `params.dlcs` data.
2. Resolve each asset's `dlcUnlocks: number[]` (GUID array) into actual `DLC` objects.
3. Make `NamedElement.available` reactive to the resolved DLC's `checked` state.
4. Clean up the stale `"dlc" + index` references in `views.ts`.

Additionally, **need persistence must be DLC-aware**:
- DLC-locked needs (`available() === false`) must **not** be written to localStorage.
- When a need becomes unlocked (DLC toggled on), restore its persisted state from localStorage if one exists; otherwise apply the `activateAllNeeds` setting.

---

## Files to change

### 1. `src/types.config.ts`  
*(auto-generated but must be updated to reflect schema reality)*

- Add `dlcUnlocks?: number[]` to: `NeedConfig`, `ProductConfig`, `FertilityConfig`, `FactoryConfig`, `BuildingBuffConfig`, `EffectConfig`, `TechConfig`, `ItemConfig`.
- Add new interface before `ParamsConfig`:
  ```ts
  export interface DLCParamConfig {
    guid: number;
    name: string;
    iconPath: string;
    id: string;
  }
  ```
- Add `dlcs?: DLCParamConfig[]` to `ParamsConfig`.

### 2. `src/types.ts`

- `NamedElementConfig` (line 30): rename `dlcs?: string[]` → `dlcUnlocks?: number[]`.
- `DLCConfig` (line 39-42): add `guid?: number`.
- `ViewConfig` (line 155-168): add `dlcsGuidMap: Map<number, any>`.

### 3. `src/main.ts`

- Line 348-349: add `window.view.dlcsGuidMap = new Map();` next to existing `dlcsMap` init.
- Line 354-365 (DLC loop): after `window.view.dlcsMap.set(d.id, d)` also add
  `if (d.guid) window.view.dlcsGuidMap.set(d.guid, d);`
  (`d.guid` comes from the DLC config object passed to the DLC constructor; the `DLC` class already stores it via `NamedElement` (`this.guid`)).

### 4. `src/util.ts` — `NamedElement` constructor (around line 324)

Replace the two-liner that sets up DLC management:
```ts
this.available = ko.pureComputed(() => true);
this.dlcLockingObservables = [];
```
with:
```ts
this.dlcLockingObservables = [];

if (config.dlcUnlocks && config.dlcUnlocks.length > 0) {
    const dlcsGuidMap: Map<number, DLC> | undefined = (window as any).view?.dlcsGuidMap;
    if (dlcsGuidMap) {
        this.dlcs = config.dlcUnlocks
            .map(guid => dlcsGuidMap.get(guid))
            .filter((d): d is DLC => d != null);
    }
}

if (this.dlcs && this.dlcs.length > 0) {
    const dlcs = this.dlcs;
    this.available = ko.pureComputed(() => dlcs.some(d => d.checked()));
} else {
    this.available = ko.pureComputed(() => true);
}
```

### 5. `src/views.ts` — `plan()` method (lines 114-118)

Remove the block that disables specific DLCs by index — those were Anno 1800 IDs and do not apply to Anno 117:
```ts
// DELETE these 4 lines:
for (var dlcIndex of [0, 2, 8, 11]) {
    var d = view.dlcsMap.get("dlc" + dlcIndex);
    if (d) d.checked(false);
}
```
Plan mode will now simply enable all DLCs (which the preceding `for (var dlc of view.dlcs.values())` loop already does).

### 6. `src/production.ts` — MetaProduct config objects (lines 389, 476)

Change `dlcs: []` → `dlcUnlocks: []` in the two `parentConfig` literals inside `MetaProduct` constructor calls to match the renamed `NamedElementConfig` field.

---

### 7. `src/world.ts` — DLC-aware need persistence

**Current code** (lines 1080–1086):
```typescript
for (let populationLevel of this.populationLevels) {
    for (let need of populationLevel.needs) {
        persistBool(need, "checked", `${populationLevel.guid}[${need.need.guid}].checked`);
        persistString(need, "notes", `${populationLevel.guid}[${need.need.guid}].notes`);
    }
}
```

**Step A** — add a `persistNeedChecked` helper variable declaration alongside `persistBool` etc. (~line 620):
```typescript
var persistNeedChecked: (need: any, storageKey: string) => void;
```

**Step B** — inside the `if (localStorage)` block (after `persistBuildings` definition, ~line 691), define:
```typescript
persistNeedChecked = (need: any, storageKey: string) => {
    // Initial load: skip restoring when need is DLC-locked
    if (need.available()) {
        if (localStorage.getItem(storageKey) != null)
            need.checked(parseInt(localStorage.getItem(storageKey)));
    }

    // Write only when available
    need.checked.subscribe((val: boolean) => {
        if (need.available())
            localStorage.setItem(storageKey, val ? "1" : "0");
    });

    // React to DLC toggle
    need.available.subscribe((isAvailable: boolean) => {
        if (isAvailable) {
            if (localStorage.getItem(storageKey) != null)
                need.checked(parseInt(localStorage.getItem(storageKey)));
            else
                need.checked(view.islandManager.activateAllNeeds.checked());
        }
    });
};
```

**Step C** — inside the `else` block (~line 693):
```typescript
persistNeedChecked = () => {};
```

**Step D** — replace the `persistBool` call in the needs loop:
```typescript
// Replace:
persistBool(need, "checked", `${populationLevel.guid}[${need.need.guid}].checked`);
// With:
persistNeedChecked(need, `${populationLevel.guid}[${need.need.guid}].checked`);
```

`persistString` for `notes` is unchanged.

**Key behaviours:**
- `need.available()` is `false` while its DLC is unchecked → initial load is skipped, subscribe writes are suppressed.
- DLC toggled ON at runtime → `available.subscribe` fires → restores persisted value OR applies `activateAllNeeds.checked()`.
- `view.islandManager` is guaranteed to be set by the time any DLC is toggled interactively (it is set at `main.ts:459`, before any user interaction).

---

## Verification

1. `npm run type-check` — should pass with no errors on the changed files.
2. `npm run build` — bundle must build cleanly.
3. In browser: open Settings dialog → DLC section should list entries from `params.dlcs` with icons and checkboxes.
4. Check an asset whose `dlcUnlocks` is non-empty: unchecking its DLC should cause `available()` to return false (verify via `window.debugKO.inspect`).
5. Toggle a DLC off → confirm its needs are no longer written to localStorage; toggle it on → confirm needs restore their prior state or default to the `activateAllNeeds` setting.
6. `npm test` — all Playwright tests should remain green.
