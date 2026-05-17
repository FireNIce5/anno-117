# Plan: Area Effect Attribute Buffs for Lower-Tier Residences

## Context

In Anno 117, population bonuses can arrive via two distinct area-effect mechanisms that the calculator does not yet model:

**Type A – Patron/veneration effects**: A patron ritual grants a `BuildingBuff` with `AdditionalAttributes.Population: +1` to **all residences** on the island. Example: *Ceres Confarreatio* (effect GUID 43600, buff GUID 43601). This is `PatronCeres.LocalEffects[1]` and is completely absent from params.js today.

**Type B – Public building area effects**: A service building (Baths, Amphitheater) that is a need for a higher tier also emits an area effect that grants population bonuses to **lower-tier** residences, even though those residences have no bath/amphitheater need. The bonus is proportional to how many lower-tier buildings are in range.

Both types share the same root gap: `ResidenceBuilding.residents` (population.ts:91–102) only sums from `needsMap` and ignores any applied buff or effect that provides a population bonus.

---

## Two Complementary Mechanisms

### Mechanism 1 — `AppliedBuff.populationBonus` (for Type A, patron effects)

Used when the population bonus is already expressed as a `BuildingBuff` + `Effect` in the game data, and activation is controlled by the existing patron scaling observable.

### Mechanism 2 — `ResidenceEffect.residents` (for Type B, public building area effects)

Used when the bonus is tied to coverage (% of buildings in range of a service building). This system is already fully coded but disabled.

Both mechanisms converge on `ResidenceBuilding.residents` – the only place that needs to sum from both sources.

---

## Part 1: Add the Second Ceres Buff (GUID 43600)

### 1.1 `js/params.js`

**Add to `buildingBuffs` array:**
```json
{
  "guid": 43601,
  "name": "CeresPopulationBuff",
  "baseProductivityUpgrade": 0,
  "productivityUpgrade": 0,
  "workforceModifierInPercent": 0,
  "fuelDurationPercent": 0,
  "workforceMaintenanceFactorUpgrade": 0,
  "populationBonus": 1,
  "isStackable": false,
  "locaText": { "english": "Boon of Ceres:\nConfarreatio", ... },
  "iconPath": "data/ui/fhd/base/icon_content/religion/icon_2d_deity_ceres.png"
}
```

**Add to `effects` array:**
```json
{
  "guid": 43600,
  "name": "CeresPopulationEffect",
  "buffs": [43601],
  "targets": [],
  "targetsIsAllProduction": false,
  "targetsIsAllResidences": true,
  "source": "veneration-effect",
  "iconPath": "data/ui/fhd/base/icon_content/religion/icon_2d_deity_ceres.png",
  "locaText": { "english": "Boon of Ceres:\nConfarreatio", ... }
}
```

**Extend `PatronCeres` (GUID 43594) with second local effect:**
```json
"localEffects": [
  { "effect": 43598, "milestones": [...] },   // already exists
  { "effect": 43600, "milestones": [...] }    // ADD – same milestone thresholds as 43598
]
```
(Milestone devotion thresholds and buffScaling values for 43600 need to be verified from the game asset for PatronCeres. Use same values as 43598 unless the game data differs.)

### 1.2 `src/types.config.ts` — extend auto-generated config types

```typescript
// In BuildingBuffConfig:
populationBonus?: number;

// In EffectConfig:
targetsIsAllResidences?: boolean;
```

*(types.config.ts is auto-generated but this change is valid here since population.ts/production.ts read from config.)*

### 1.3 `src/production.ts` — extend `Buff` and `Effect` classes

**Buff class (line ~522):** add field and constructor assignment:
```typescript
public populationBonus: number;
// in constructor:
this.populationBonus = config.populationBonus ?? 0;
```

**Effect class (line ~761):** add field and constructor assignment:
```typescript
public targetsIsAllResidences: boolean;
// in constructor:
this.targetsIsAllResidences = config.targetsIsAllResidences ?? false;
```

### 1.4 `src/buffs.ts` — extend `AppliedBuff` with `populationBonus`

Following the same pattern as `baseProductivityUpgrade`:
```typescript
public populationBonus: KnockoutComputed<number>;
// in constructor:
this.populationBonus = ko.pureComputed(() =>
    this.buff.populationBonus * this.scaling()
);
```

### 1.5 `src/population.ts` — implement `addBuff` and include bonuses

**Add `buffs` observable array to `ResidenceBuilding`:**
```typescript
public buffs: KnockoutObservableArray<AppliedBuff>;
// in constructor:
this.buffs = ko.observableArray([]);
```

**Implement `addBuff` (currently a TODO stub at ~line 224):**
```typescript
addBuff(appliedBuff: AppliedBuff): void {
    this.buffs.push(appliedBuff);
}
```

**Extend `residents` computed (population.ts:91–102) to include buff bonuses:**
```typescript
this.residents = ko.computed(() => {
    let sum = 0;
    for (const n of this.needsMap.values()) {
        sum += n.residents();
    }
    // Type A: patron/veneration population buffs
    for (const buff of this.buffs()) {
        if (buff.buff.populationBonus !== 0) {
            sum += buff.populationBonus() * this.buildings.constructed();
        }
    }
    // Type B: public building area effects (coverage-based)
    for (const coverage of this.effectCoverage()) {
        for (const entry of coverage.residenceEffect.entries) {
            if (entry.residents > 0) {
                sum += entry.residents * coverage.coverage() * this.buildings.constructed();
            }
        }
    }
    return sum;
});
```

### 1.6 `src/world.ts` — resolve `targetsIsAllResidences` when applying effects

In the island initialization where effects are applied to buildings (around line 843), after `e.applyBuffs(assetsMap)` is called, add residence handling. The cleanest place is **inside `Effect.applyBuffs()`** in production.ts: when `targetsIsAllResidences` is true, resolve all `ResidenceBuilding` instances from `assetsMap`.

In `Effect.applyBuffs()` (production.ts:~787):
```typescript
if (this.targetsIsAllResidences) {
    for (const asset of assetsMap.values()) {
        if (asset instanceof ResidenceBuilding) {
            new AppliedBuff(this, buff, asset, assetsMap);
        }
    }
}
```

This mirrors the existing `targetsIsAllProduction` pattern but for residences.

---

## Part 2: Public Building Area Effects (Baths → Liberti, etc.)

This uses the existing `ResidenceEffect` system.

### 2.1 `js/params.js` — add `residenceEffects` array

Add a new top-level key. Each entry describes one (source building, target tier) pair.

```json
"residenceEffects": [
  {
    "guid": 99001,
    "name": "Baths area effect on Liberti",
    "allowStacking": false,
    "residences": [<liberti_domus_guid_1>, ...],
    "effects": [
      {
        "guid": <baths_product_guid>,
        "residents": <bonus_residents_per_building>,
        "consumptionModifier": 0,
        "suppliedBy": []
      }
    ]
  }
  // ... one entry per (public building, lower tier) combination
]
```

GUIDs for synthetic entries (99001+) must not clash with real game GUIDs.
Population bonus values and residence GUIDs must be verified from game assets.

### 2.2 `src/world.ts:1081–1086` — uncomment ResidenceEffect instantiation

```typescript
for (let effect of (params.residenceEffects || [])) {
    let e = new ResidenceEffect(effect, assetsMap);
    assetsMap.set(e.guid, e);
}
```

Place this **after** `b.initDemands(assetsMap)` and **before** the `effectCoverage` persistence block at line 1088 (which is already wired).

### 2.3 `src/population.ts` — already covered by Part 1.5

The `effectCoverage` loop added to `residents` above handles the Type B bonus. No additional changes needed here.

---

## Files to Change — Summary

| File | Change |
|------|--------|
| `js/params.js` | Add buff 43601, effect 43600, 2nd PatronCeres localEffect, `residenceEffects` array |
| `src/types.config.ts` | Add `populationBonus?` to BuffConfig, `targetsIsAllResidences?` to EffectConfig |
| `src/production.ts` | Add `populationBonus` to Buff; `targetsIsAllResidences` to Effect; resolve residences in `applyBuffs()` |
| `src/buffs.ts` | Add `populationBonus: KnockoutComputed<number>` to AppliedBuff |
| `src/population.ts` | Add `buffs` observable array; implement `addBuff()`; extend `residents` computed for both sources |
| `src/world.ts:1081–1086` | Uncomment ResidenceEffect instantiation |

---

## Open Questions (require game data research)

1. **Milestone values for 43600** – same as 43598, or does the Confarreatio ritual have different devotion thresholds?
2. **Baths/Amphitheater area effect data** – which specific products, which tiers, what population bonus value, which residence GUIDs?
3. **More patron effects** – are there other patrons besides Ceres with population buffs on residences?

---

## Verification

1. `npm run type-check` — no errors
2. `npm test` — existing tests pass
3. Manual: Select Ceres patron, set devotion to a milestone → Liberti/Patricii/etc. population increases by `+1 × buildings.constructed()`
4. Manual: Remove Ceres patron → population drops back
5. Manual (Part 2): Add baths coverage for Liberti at 50% → population increases by `residents_bonus × 0.5 × constructed`
6. Manual: Save/reload page → coverage % and patron state persisted correctly
