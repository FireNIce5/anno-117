# Plan: Fertility Management per Island

## Context

The game distinguishes which fertilities (e.g. "Mackerel", "Flax", "Grapes") are naturally present on each island. The calculator currently assumes every island has all fertilities. `params.js` has been updated with two new arrays:
- `fertilities` already existed but now has a `regions` field per entry
- `areaBuffs` is new: in-game structures that artificially add a fertility to an area, each with `addedFertility` (fertility GUID) and `fertilityPercent` (50 or 100)

The goal: let users uncheck missing fertilities per island, have the productivity factor reflect this, and prevent factories with missing fertility from being the default supplier.

---

## Implementation Steps

### 1. `src/types.config.ts` — Add `AreaBuffConfig`, update `FertilityConfig`, update `ParamsConfig`

Add `regions?: string[]` to `FertilityConfig`:
```typescript
export interface FertilityConfig {
  guid: number;
  name: string;
  iconPath: string;
  locaText: LocaTextConfig;
  dlcUnlocks?: number[];
  regions?: string[];  // NEW
}
```

Add new interface:
```typescript
export interface AreaBuffConfig {
  guid: number;
  name: string;
  iconPath: string;
  locaText: LocaTextConfig;
  dlcUnlocks?: number[];
  addedFertility: number;
  fertilityPercent: number;
}
```

Add `areaBuffs?: AreaBuffConfig[]` to `ParamsConfig`.

---

### 2. `src/production.ts` — Add `AreaBuff` and `IslandFertility` classes

Update `Fertility` constructor:
```typescript
this.regions = config.regions || [];
// (add `public regions: string[]` property)
```

Add `AreaBuff` class (after `Fertility`, before `Buff`). Does NOT extend `NamedElement` (it's a per-island instance, not a shared asset):
- `guid`, `locaText`, `icon?`, `fertilityPercent: number`
- `addedFertility: Fertility | null` (looked up from assetsMap)
- `scaling: KnockoutObservable<number>` (0=inactive, 1=active; `icon-checkbox` handles number↔bool)
- `name: KnockoutComputed<string>` using current language setting

Add `IslandFertility` class (after `AreaBuff`):
- `fertility: Fertility`
- `checked: KnockoutObservable<boolean>` (defaults `true`)
- `factor: KnockoutComputed<number>` (0.0–1.0):
  ```typescript
  factor = ko.pureComputed(() => {
      if (this.checked()) return 1.0;
      // pre-filter relevantBuffs once in constructor
      let total = 0;
      for (const buff of relevantBuffs) {
          if (buff.scaling() > 0) total += buff.fertilityPercent;
      }
      return Math.min(1.0, total / 100);
  });
  ```
  `relevantBuffs` is computed once in the constructor: `islandAreaBuffs.filter(b => b.addedFertility?.guid === fertility.guid)`.

Export both classes.

---

### 3. `src/world.ts` — Island class changes

**Property declarations** (add near line 550):
```typescript
public islandFertilities: Map<number, IslandFertility>;
public areaBuffs: AreaBuff[];
public allFertilitiesSet: KnockoutComputed<boolean>;
public fertilitiesExpanded: KnockoutObservable<boolean>;
```

**Import** `AreaBuff`, `IslandFertility` from `./production`.

**Initialization in Island constructor** — place immediately after the existing `fertilities` loop (currently ~line 801), before `buildingBuffs` loop. The fertile loop should now also collect into a local array:

```typescript
// Modified fertilities loop:
const islandFertilityConfigs: Fertility[] = [];
for (let f of (params.fertilities || [])) {
    let fertility = new Fertility(f);
    assetsMap.set(fertility.guid, fertility);
    islandFertilityConfigs.push(fertility);
}

// New: per-island AreaBuff instances
this.areaBuffs = [];
for (const abConfig of (params.areaBuffs || [])) {
    this.areaBuffs.push(new AreaBuff(abConfig, assetsMap));
}

// New: per-island IslandFertility instances, region-filtered
this.islandFertilities = new Map();
if (!this.isAllIslands()) {
    for (const fertility of islandFertilityConfigs) {
        if (fertility.regions.length > 0 && !fertility.regions.includes(this.region.id || ''))
            continue;
        this.islandFertilities.set(
            fertility.guid,
            new IslandFertility(fertility, this.areaBuffs)
        );
    }
}

this.allFertilitiesSet = ko.pureComputed(() => {
    for (const [, f] of this.islandFertilities) {
        if (!f.checked()) return false;
    }
    return true;
});
this.fertilitiesExpanded = ko.observable(false);
```

**Persistence** — inside `if (localStorage)` block, before `consumers.forEach(f => f.initDemands(assetsMap))` at line 948:
```typescript
for (const [guid, islandFertility] of this.islandFertilities) {
    persistBool(islandFertility, "checked", `island.fertility.${guid}.checked`);
}
for (const areaBuff of this.areaBuffs) {
    persistFloat(areaBuff, "scaling", `island.areaBuff.${areaBuff.guid}.scaling`);
}
```

**Helper method** (add to Island class):
```typescript
getIslandFertility(guid: number): IslandFertility | undefined {
    return this.islandFertilities?.get(guid);
}
```

---

### 4. `src/factories.ts` — Fertility factor in productivity + canSupply

**In `Consumer.initDemands()` boostSubscription** (lines 176-201), add fertility factor before `this.boost(...)`:
```typescript
let fertilityFactor = 1.0;
if (this instanceof Factory && (this as Factory).neededFertility) {
    const fertility = (this as Factory).neededFertility!;
    const islandFertility = this.island.islandFertilities?.get(fertility.guid);
    if (islandFertility) fertilityFactor = islandFertility.factor();
}
this.boost(Math.max(ACCURACY, totalBoost * fertilityFactor));
```
Knockout tracks `islandFertility.factor()` automatically, so the subscription re-fires when fertility changes.

**`Factory.canSupply()`** (line 716) — extend to block zero-fertility factories:
```typescript
canSupply(): boolean {
    if (!this.available()) return false;
    if (this.neededFertility) {
        const islandFertility = this.island.islandFertilities?.get(this.neededFertility.guid);
        if (islandFertility && islandFertility.factor() === 0) return false;
    }
    return true;
}
```

---

### 5. `src/i18n.ts` — Add translations

Add two keys (12 languages each):

**`missingFertility`**: "Missing Fertility" (from game UI strings):
- english: "Missing Fertility" | german: "Fehlende Fruchtbarkeit" | french: "Fertilité manquante"
- spanish: "Fertilidad faltante" | italian: "Fertilità mancante" | brazilian: "Fertilidade ausente"
- russian: "Нет плодородия" | simplified_chinese: "缺少肥力" | traditional_chinese: "缺少肥力"
- japanese: "肥沃度なし" | korean: "비옥도 없음" | polish: "Brak żyzności"

**`islandFertilities`**: "Island Fertilities":
- english: "Island Fertilities" | german: "Insel-Fruchtbarkeiten" | french: "Fertilités de l'île"
- spanish: "Fertilidades de la isla" | italian: "Fertilità dell'isola" | brazilian: "Fertilidades da ilha"
- russian: "Плодородие острова" | simplified_chinese: "岛屿肥力" | traditional_chinese: "島嶼肥力"
- japanese: "島の肥沃度" | korean: "섬 비옥도" | polish: "Żyzność wyspy"

---

### 6. `templates/factory-config-section.html` — Show fertility factor

Replace the existing fertility row (lines 64-78) with a version that shows the factor:

```html
<!-- ko if: $data.instance().neededFertility -->
<tr>
    <td><span data-bind="text: $root.texts.fertility.name"></span></td>
    <td>
        <!-- ko with: $root.island().getIslandFertility($data.instance().neededFertility.guid) -->
        <!-- ko if: $data.factor() === 0 -->
        <span class="text-danger" data-bind="text: $root.texts.missingFertility.name"></span>
        <!-- /ko -->
        <!-- ko if: $data.factor() > 0 && $data.factor() < 1 -->
        <span class="text-warning" data-bind="text: formatPercentage(100 * $data.factor(), false)"></span>
        <!-- /ko -->
        <!-- /ko -->
    </td>
    <td>
        <div class="inline-list-centered">
            <img class="icon-sm mr-1" data-bind="attr: { src: $data.instance().neededFertility.icon || null, alt: $data.instance().neededFertility.name }">
            <span data-bind="text: $data.instance().neededFertility.name"></span>
        </div>
    </td>
</tr>
<!-- /ko -->
```

`$root.island().getIslandFertility(guid)` returns `undefined` on the All Islands view (empty map) — `ko with:` suppresses the block cleanly.

---

### 7. `templates/island-management-dialog.html` — Fertility indicator + management

**In the world table** (line 82+), add a fertility column to the `<tr>` for each island:

After the patron column (`<td>` at line 92), insert:
```html
<td>
    <!-- ko if: !$data.isAllIslands() && !$data.allFertilitiesSet() -->
    <div class="inline-list" data-bind="attr: { title: $root.texts.missingFertility.name() }">
        <!-- ko foreach: Array.from($data.islandFertilities.values()).filter(f => !f.checked()) -->
        <img class="icon-sm" data-bind="attr: { src: $data.fertility.icon || null, title: $data.fertility.name, alt: $data.fertility.name }">
        <!-- /ko -->
    </div>
    <!-- /ko -->
</td>
```

**Fertility management expand button** — add to the last `<td>` (around line 133) alongside rename/delete:
```html
<!-- ko if: !$data.isAllIslands() -->
<button class="btn btn-secondary btn-sm"
    data-bind="click: () => $data.fertilitiesExpanded(!$data.fertilitiesExpanded()),
               css: { active: $data.fertilitiesExpanded() }">
    <span class="fa fa-leaf"></span>
</button>
<!-- /ko -->
```

**Expanded fertility management row** — add `<!-- ko -->` block after the island `<tr>` (inside `<tbody>`):
```html
<!-- ko if: !$data.isAllIslands() && $data.fertilitiesExpanded() -->
<tr>
    <td colspan="6">
        <div class="p-2">
            <strong data-bind="text: $root.texts.islandFertilities.name"></strong>
            <div class="inline-list flex-wrap mt-1">
                <!-- ko foreach: Array.from($data.islandFertilities.values()) -->
                <div class="mr-3 mb-1 inline-list-centered">
                    <div data-bind="component: { name: 'icon-checkbox', params: {
                        asset: $data.fertility,
                        checked: $data.checked,
                        id: 'fert-' + $parent.session.guid + '-' + $data.fertility.guid
                    }}"></div>
                </div>
                <!-- /ko -->
            </div>
            <!-- ko if: $data.areaBuffs.filter(b => b.addedFertility).length > 0 -->
            <div class="mt-2">
                <div class="inline-list flex-wrap">
                    <!-- ko foreach: $data.areaBuffs.filter(b => b.addedFertility) -->
                    <div class="mr-3 mb-1">
                        <div data-bind="component: { name: 'icon-checkbox', params: {
                            asset: $data,
                            checked: $data.scaling,
                            id: 'ab-' + $parent.session.guid + '-' + $data.guid
                        }}"></div>
                        <span class="ml-1" data-bind="text: $data.name()"></span>
                    </div>
                    <!-- /ko -->
                </div>
            </div>
            <!-- /ko -->
        </div>
    </td>
</tr>
<!-- /ko -->
```

Note: `icon-checkbox` already handles `KnockoutObservable<number>` for `checked` (converts 0/1 ↔ bool internally via `components.ts:401-406`). The `$data.session.guid` is used to make checkbox IDs unique across islands.

---

## Initialization Order (critical)

Inside Island constructor, this order must be preserved:
1. Fertilities loop (existing) → add `islandFertilityConfigs` collection
2. `this.areaBuffs` creation (new)
3. `this.islandFertilities` creation (new)
4. `this.allFertilitiesSet` computed (new)
5. `this.fertilitiesExpanded` observable (new)
6. Persistence for fertilities and areaBuffs (new, inside `if (localStorage)`)
7. Existing: buildingBuffs, factories, effects...
8. Existing: `consumers.forEach(f => f.initDemands(assetsMap))` — reads islandFertilities

---

## Critical Files

- `src/types.config.ts` — add AreaBuffConfig, update FertilityConfig, add areaBuffs to ParamsConfig
- `src/production.ts` — add AreaBuff + IslandFertility classes, update Fertility.regions
- `src/world.ts` — Island properties, initialization, persistence, getIslandFertility()
- `src/factories.ts` — fertility factor in boostSubscription, canSupply() update
- `src/i18n.ts` — missingFertility + islandFertilities keys (12 languages each)
- `templates/factory-config-section.html` — fertility row with factor display
- `templates/island-management-dialog.html` — missing-fertility indicator + expand/manage UI

---

## Verification

1. `npm run type-check` — no TypeScript errors
2. `npm run build` — successful build
3. Browser test:
   - Create an island, open island management, expand a fertility leaf icon → see fertility checkboxes
   - Uncheck a fertility → factory needing it shows "Missing Fertility" in red in product config
   - Factory with missing fertility cannot be set as default supplier
   - Re-check the fertility → factory works again at 100%
   - Enable an areaBuff for a missing fertility (50%) → factory shows "50%" in orange
   - Two areaBuffs (50% + 50%) → factory shows 100% again
   - Island with unchecked fertility shows its icon in the island management world table row
