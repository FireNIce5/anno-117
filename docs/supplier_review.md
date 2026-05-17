# Supplier Mechanic Review

Review of the `Supplier` interface and the demand-resolution pipeline that connects `Product`, `Factory`, `TradeRoute`, `ExtraGoodSupplier`, and `PassiveTradeSupplier`.

## Architecture summary

The supplier system is implemented across:

- `src/suppliers.ts` — `Supplier` interface + `PassiveTradeSupplier`, `ExtraGoodSupplier`
- `src/production.ts:155-296` — `Product.initSuppliers` orchestrates demand resolution
- `src/factories.ts:493-784` — `Factory` implements `Supplier`
- `src/trade.ts:26-191` — `TradeRoute` implements `Supplier`

The orchestrator is `Product.demandCalculationSubscription` (`src/production.ts:277-294`):

```text
total       = totalDemand                                  (consumers + export trade routes)
defaultProd = Σ availableSuppliers.defaultProduction()     (auto sources)

if defaultProd >= total:
    excessProduction = defaultProd - total
    defaultSupplier.setDemand(0)
else:
    excessProduction = 0
    defaultSupplier.setDemand(total - defaultProd + defaultSupplier.defaultProduction())
```

The role split for the `Supplier` interface:

- `defaultProduction()` — what this supplier produces automatically without being asked
- `currentProduction()` — what it actually produces right now
- `setDemand(x)` — produce at least x

This matches the design described in the task.

---

## Issues

### 1. ExtraGoodSupplier as default: excess production not tracked when factory is driven by primary demand

**Location:** `src/suppliers.ts:169-173`

```ts
defaultProduction(): number {
    return this.isDefaultSupplier() ? 0 : this.currentProduction();
}
```

**Demand meeting is correct as-is.** The factory's `throughput = max(byPrimary, supplier.throughput, byExisting)` always satisfies the largest constraint, so total obsidian demand is met regardless of what `defaultProduction` returns when this supplier is the default. The current `return 0` is a deliberate, safe choice that avoids any feedback edge.

**The flaw is in `excessProduction` reporting.** When the underlying factory is already running because **its primary product** has independent demand, the factory generates extra goods as a byproduct. Today that "automatic" production never reaches `totalDefaultProduction`, so the calculator misses the over-production.

**Concrete scenario** (from `tests/computed/fertility-extra-goods.spec.ts:162-230`):

1. Limestone Quarry is the default supplier for Obsidian via the extra-good supplier.
2. 1000 Patricians demand 8.33 obsidian/min, so `setDemand(8.33)` sets `supplier.throughput = 8.33 / totalRatio`.
3. 20 concrete factories are added — these demand limestone, pushing `factory.throughput()` above what the obsidian supplier requested.
4. `entry.amount() = scaling × defaultAmount × factory.throughput() / cycle` follows factory throughput, so `currentProduction()` for obsidian exceeds 8.33.

In `demandCalculationSubscription`:

- `defaultProd` = 0 (this supplier reports 0; no other obsidian supplier is producing)
- branch `defaultProd >= total` is never taken → `excessProduction(0)`
- The actual obsidian over-production is silent. `excessProduction` feeds the export-route default value (`src/presenters.ts:304-306`), so the user can't see the surplus or pre-fill an export route for it.

This matches the user's stated requirement:

> if the default supplier is an extra good, we do not know whether the current production of the original good is due to the extra good or the default one. Still we must update the default supplier demand when the demand for extra good or the default good changes.

**Why a naive fix breaks demand meeting.** Commit `8394aad` reverted a `defaultProduction()` that depended on `this.factory.throughput()`:

```ts
if (this.throughput() + EPSILON < this.factory.throughput())
    return this.currentProduction();
const otherThroughput = max(factory.throughputByExistingBuildings(), factory.throughputByOutput());
return otherThroughput < EPSILON ? 0 : factory.throughput()/otherThroughput * currentProduction();
```

`currentProduction()` and `factory.throughput()` both depend on `supplier.throughput()` (via `setDemand`), so reading them inside `defaultProduction()` closes a feedback loop: `defaultProd` rises → `if (defaultProd >= total)` fires → `setDemand(0)` → throughput collapses → `defaultProd` falls → `else` branch fires → `setDemand(total)` → throughput jumps → oscillation.

**Fix direction (excess-only, no feedback):** compute the production that would happen *if this supplier asked for 0*, using only inputs that do not depend on `supplier.throughput()`. Sketch:

```ts
defaultProduction(): number {
    if (!this.isDefaultSupplier()) return this.currentProduction();
    const ratio = this.getTotalRatio();
    // primary-demand-driven throughput, NOT including this supplier's own request
    const otherDriven = Math.max(
        this.factory.throughputByExistingBuildings(),
        this.factory.demandFromProduct() / this.factory.extraGoodFactor()
    );
    return otherDriven * ratio;
}
```

Because `defaultProd` and `defaultSupp.defaultProduction()` enter the formula symmetrically (`remaining = total - defaultProd + defaultSupp.defaultProduction()`), shifting both by the same `X` leaves the `setDemand` value unchanged — demand meeting is preserved. The only behavioral change is which branch fires and what `excessProduction` reports.

**Caveat:** the sketch ignores the contribution of *other* `ExtraGoodSupplier`s on the same factory (their `throughput()` is part of `throughputByOutput`). Either include them carefully or skip — the practical impact depends on how often two extra-good suppliers target the same factory.

### 2. `setDemand` on ExtraGoodSupplier can't reduce throughput when primary demand dominates

**Location:** `src/factories.ts:619-632`

`Factory.throughputByOutputSubscriptions` takes `max(demandFromProduct/extraGoodFactor, throughputByExtraGoodSupplier)`. If primary demand alone exceeds the supplier's requested throughput, the supplier's `setDemand` is a no-op.

This is consistent — factories must satisfy primary demand — but the calculator must then surface the resulting overproduction as `excessProduction`. See Issue 1.

### 3. `extraGoodFactor` applies only to the primary product

**Location:** `src/factories.ts:635-638`, `src/buffs.ts:207`

`Factory.outputAmount` for the primary output is `throughput * extraGoodFactor`. Extra-good entries use `factory.throughput()` directly, without `extraGoodFactor`. Since `extraGoodFactor` only changes for self-effecting extra goods (factory boosting its own primary product), this is correct.

`ExtraGoodSupplier.setDemand` also divides by `totalRatio` without `extraGoodFactor`, which is consistent.

**Action:** confirm self-effecting extras never write into the `productionList` of an `ExtraGoodSupplier` of a *different* product.

### 4. TradeRoute as default supplier — persistence write skips `'trade_route'`

**Location:** `src/world.ts:1063-1080`

The `defaultSupplier.subscribe` handler in `world.ts` only writes `null` / `factory` / `extra_good` / `passive_trade`. There's no branch for `trade_route`.

Flow:

1. During `Island` construction, `defaultSupplierSubscription` (`src/production.ts:227`) immediately calls `resetDefaultSupplier()`, which writes some non-null value.
2. Later, `TradeManager` constructs and calls `route.setAsDefaultSupplier()` — this writes nothing for `trade_route` from `Product`'s subscribe.

Trade-route-as-default isn't persisted via `Product`'s subscribe and relies entirely on `TradeManager`'s `isDefaultSupplier` flag in its own JSON (`src/trade.ts:322`).

**Risk:** a `defaultSupplier(null)` reset path would silently desync the two stores. -> no, this triggers the ko.observable chains to update trade route. Referencing a trade route in product would be even more prone to desync and invalid configurations

### 5. `TradeRoute.unsetAsDefaultSupplier` deletes the route — intended effect because it was created that way

**Location:** `src/trade.ts:167-172`

`unsetAsDefaultSupplier` deletes the route if `userSetAmount == 0`. That's the auto-cleanup contract documented in `src/AGENTS.md`.

But `Product.updateDefaultSupplier` (`src/production.ts:332`) calls `prevSupplier?.unsetAsDefaultSupplier()` whenever any supplier is swapped in. If the user creates a trade route via the default-supplier dropdown (with `userSetAmount=0`), then switches to a different supplier, the route silently disappears.

**Action:** confirm this matches intended UX. -> yes

### 6. `passiveTradeSupplier` is omitted from `availableSuppliers`

**Location:** `src/production.ts:198-225`, `src/production.ts:253-274`

`availableSuppliers` is built from factories, extra-good suppliers, and import trade routes. `passiveTradeSupplier` is added to `totalCurrentProduction` separately (line 271) but excluded from `totalDefaultProduction`.

**Result:**

- `passiveTradeSupplier.userSetAmount = 5` → `currentProduction = 5`, `totalCurrentProduction += 5` ✓
- `totalDefaultProduction` doesn't include passive trade → with a default supplier, the gap calc treats passive trade as not-auto, so the default supplier is asked to produce too much.

Worked example: `total=10, defaultProd=0, passive=5` → default supplier asked to produce 10 → `totalCurrentProduction = 10 + 5 = 15`. Double-counting.

**Suggested fix:** either include `passiveTradeSupplier` in `availableSuppliers` (so it counts in `totalDefaultProduction`) or add `passiveTradeSupplier.defaultProduction()` directly to `totalDefaultProduction`.

### 7. Minor: `getTotalRatio` not memoized

**Location:** `src/suppliers.ts:158-167`

`ExtraGoodSupplier.canSupply` and `setDemand` both call `getTotalRatio()`, which loops `productionList` and reads the observable `scaling`. Fine for correctness; `setDemand` is called from a `computed` so this re-establishes subscriptions on every change. Inexpensive in practice but a `pureComputed` would be cleaner.

### 8. Minor: `demandCalculationSubscription` uses `ko.computed`, not `pureComputed`

**Location:** `src/production.ts:277`

Side-effects (`excessProduction`, `setDemand`) are correctly outside pure semantics, so `ko.computed` is right. But this means it can't be disposed cleanly when products are torn down.

**Action:** confirm products are never recreated mid-session, otherwise a leak.

---

## Recommendation

Issue **#1** is the design-blocking bug and matches the user's described requirement directly. The previous fix attempt (commit `8394aad`) was on the right track but had a feedback loop. A correct fix decouples `ExtraGoodSupplier.defaultProduction` from `factory.throughput()` and computes it from non-`this.throughput()` inputs only.

Issue **#6** (passive trade supplier excluded from `availableSuppliers`) should be verified with a quick correctness test: set passive trade `userSetAmount=5` on a product with a factory default supplier and see if factory throughput drops by 5.
