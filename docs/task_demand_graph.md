# Plan: Demand Graph Analysis + LP Test Framework

## Context

The Anno 117 Calculator's demand system is a directed graph connecting products and factories via supply/consumption edges, with extra good edges added conditionally by effects. Two tools are needed:

1. **Graph analysis script** — loads `js/params.js` directly in Node.js, constructs the graph, finds interesting structural patterns (cycles, diamonds, hubs)
2. **LP test framework** — given product demands and active effects, constructs a linear minimization problem from params data, solves it, then verifies the calculator's reactive computation matches

The LP is the correctness oracle: it independently computes what minimum production is needed, and the test checks the calculator agrees.

---

## params.js Data Structure (key sections)

Loaded by mocking `window` in Node.js:
```typescript
(global as any).window = { params: null };
require('../../js/params.js');                 // sets window.params = {...}
const params = (global as any).window.params;
```

| Section | Relevant fields |
|---------|----------------|
| `params.factories[]` | `guid`, `cycleTime`, `inputs[]{product,amount}`, `outputs[]{product,amount}`, `associatedRegions[]` |
| `params.buildingBuffs[]` | `guid`, `additionalOutputs[]{product, amount, additionalOutputCycle, forceProductSameAsFactoryOutput}`, `baseProductivityUpgrade`, `productivityUpgrade` |
| `params.effects[]` | `guid`, `buffs[]` (buff GUIDs), `targets[]` (factory GUIDs — may be absent), `targetsIsAllProduction` |
| `params.products[]` | `guid`, `locaText.english` |
| `params.sessions[]` | `guid`, `region` |

**Extra goods:** effect → buffs (buildingBuffs) → `additionalOutputs`. When `forceProductSameAsFactoryOutput: true`, product = factory's primary output (self-effecting — boosts output coefficient, not a separate graph edge). When false, product is a distinct extra good.

**Important:** `Effect.applyBuffs()` in the calculator returns early when `config.targets` is absent (`targetGuids == null`, production.ts:871). Effects with `targetsIsAllProduction: true` but no `targets` array are UI-display-only and apply no buffs. Only build graph edges for effects that have a non-empty `targets` array.

**`outputs[0].amount`:** All factories in the current dataset have exactly one output entry. The amount is not always 1 — always read `outputs[0].amount` explicitly.

**Boost formula:** `boost = ((100 + Σ baseProductivityUpgrade) × (100 + Σ productivityUpgrade)) / 10000` (factories.ts:125). Active-effect buffs can raise this above 1.

---

## Part 1: Graph Analysis Script

### File: `scripts/analyze-demand-graph.ts`

Pure Node.js — no Playwright, no running server needed. Run with:
```bash
npx ts-node scripts/analyze-demand-graph.ts
```

**Step 1 — Load params.js:**
```typescript
(global as any).window = { params: null };
require('../js/params.js');
const params = (global as any).window.params;
```

**Step 2 — Build lookup maps:**
- `buffMap: Map<number, BuffConfig>` from `params.buildingBuffs`
- `factoryMap: Map<number, FactoryConfig>` from `params.factories`
- `productMap: Map<number, ProductConfig>` from `params.products`

**Step 3 — Build graph nodes & edges:**

Nodes: one `Product` node per product GUID, one `Factory` node per factory GUID.

| Edge type | From | To | Source | Notes |
|-----------|------|----|--------|-------|
| `PRODUCT_TO_PRODUCER` | Product | Factory | factory.outputs[0].product → factory | Tag with `associatedRegions`, `outputAmount`, and `extraGoodFactor` metadata (see below) |
| `PRODUCER_TO_INPUT` | Factory | Product | factory → factory.inputs[].product | |
| `EXTRA_GOOD` | Factory | Product | effect.targets[factory] → buff.additionalOutputs[product] | **Only** when `forceProductSameAsFactoryOutput: false` AND effect has non-empty `targets` array |
| `PRODUCT_SOURCED_FROM` | Product A | Product B | A is extra good of factory whose primary output is B | **Only** for non-self-effecting extras (same condition as above) |

**Self-effecting extra goods (`forceProductSameAsFactoryOutput: true`):** Do NOT add `EXTRA_GOOD` or `PRODUCT_SOURCED_FROM` edges — they would create self-loops or duplicate `PRODUCT_TO_PRODUCER`. Instead, annotate the factory's `PRODUCT_TO_PRODUCER` edge with:
```
extraGoodFactor = 1 + Σ (scaling × buff.additionalOutputs[i].amount / additionalOutputCycle)
```
This factor multiplies the effective output per unit of throughput.

**Known limitation:** `replaceInputs` buffs in `buildingBuffs` can swap one input for another at runtime. The graph uses the static `factory.inputs[]` and does not model input substitutions.

**Step 4 — Algorithms (in Node.js):**

1. **Cycle detection** — DFS with white/grey/black coloring on all node types combined; collect back edges and trace cycle paths
2. **SCCs** — Tarjan's algorithm; SCCs with >1 node are cycles; report sizes
3. **Diamond detection** — For each product P with ≥2 `PRODUCT_TO_PRODUCER` edges or ≥2 `PRODUCT_SOURCED_FROM` edges arriving: check if ancestor sets from those paths intersect (shared common ancestor)
4. **Hub nodes** — sort by in-degree + out-degree; top-10

**Step 5 — Output:**

Write `dist/demand-graph.json`:
```json
{
  "stats": { "productCount": N, "factoryCount": M, "edgeCount": K },
  "cycles": [{ "nodes": [guid...], "edgeTypes": [...] }],
  "sccs": [{ "nodes": [guid...], "size": N }],
  "diamonds": [{ "productGuid": N, "supplierPaths": [...] }],
  "hubs": [{ "guid": N, "type": "product|factory", "inDegree": N, "outDegree": N }]
}
```

Also print summary to stdout. Note in output that the graph spans all regions/sessions.

**Expected findings (validate these are present in output):**

| Pattern | Type | Description |
|---------|------|-------------|
| Coal → Resin → Wood → Coal | Cycle / SCC | Coal, resin, and wood are linked in a cycle through a shared extra-goods effect; the SCC containing all three must appear with size ≥ 3 |
| Obsidian diamond + conditional cycle | Diamond / Cycle | Concrete takes lime and sand as inputs. Both the lime quarry and the sand pit produce obsidian as an extra good, so two `PRODUCT_SOURCED_FROM` paths (obsidian→lime, obsidian→sand) converge — shared ancestor is the concrete factory. Additionally, if lime quarry is set as obsidian's default supplier the graph closes a cycle: obsidian → lime → lime\_quarry → obsidian (via `PRODUCT_SOURCED_FROM` + `PRODUCT_TO_PRODUCER` + `EXTRA_GOOD`). The diamond must be detected unconditionally; the cycle only closes when the lime-quarry default-supplier link is active. |

If either pattern is absent, the edge-construction logic has a bug.

---

## Part 2: LP Test Framework

### New dependency

```bash
npm install --save-dev javascript-lp-solver
```

(Pure JS, no native deps, works in Node.js test process.)

### File: `tests/minimization/lp-framework.ts`

Pure Node.js module. Exports `buildAndSolve(input: LpInput): LpSolution`.

**LP formulation:**

Decision variables: `t_f ≥ 0` = throughput of factory f (units/min)

Objective: `minimize Σ t_f`

Constraints — for each product p:
```
[Σ_{f: outputs p} outputRate(f,p) * t_f]   ← primary production (includes boost and extraGoodFactor)
+ [Σ_{f,effect: extra good for p, effect active} egRatio(f,p,effect) * scaling * t_f]
- [Σ_{f: inputs p} inputRate(f,p) * t_f]
≥ external_demand_p
```

Where:
- `outputRate(f,p)` = `factory.outputs[0].amount * boost_f * extraGoodFactor_f`
  - For non-self-effecting case: `extraGoodFactor_f = 1`
  - For self-effecting case: `extraGoodFactor_f = 1 + Σ(scaling × buff.amount / additionalOutputCycle)`
- `boost_f` = `((100 + Σ baseProductivityUpgrade) × (100 + Σ productivityUpgrade)) / 10000` summed over all active effects targeting factory f (default 1.0 when no boosts are active)
- `egRatio(f,p,effect)` = `buff.additionalOutputs[].amount / additionalOutputCycle` for non-self-effecting extra goods only
- `inputRate(f,p)` = `factory.inputs[].amount`
- `external_demand_p` = 0 for intermediate products, given amount for demanded products

**Factory region filtering:** Include only factories whose `associatedRegions` contains the target session's region GUID. Obtain the region GUID from `params.sessions.find(s => s.guid === sessionGuid).region`.

**Relevant subgraph:** Forward BFS (supply-chain direction) from demanded product GUIDs:
- Start from each demanded product node
- Follow `PRODUCT_TO_PRODUCER` edges forward (Product → Factory) to find producing factories
- Follow `PRODUCER_TO_INPUT` edges forward (Factory → InputProduct) to find required inputs
- Follow `PRODUCT_SOURCED_FROM` edges (ExtraGood → PrimaryProduct → Factory) for active-effect extra goods
- Recurse until no new nodes are added
- Include only factories reachable via active effects (filter `EXTRA_GOOD` / `PRODUCT_SOURCED_FROM` by `activeEffects`)

This restricts LP size to the relevant sub-graph.

**Interface:**
```typescript
interface LpInput {
  params: ParamsData;                              // loaded from js/params.js
  sessionGuid: number;                             // e.g. 3245 for Latium — used for region filtering
  demands: Array<{ productGuid: number; amount: number }>;
  activeEffects: Array<{ effectGuid: number; scaling: number }>;  // scaling in [0,1]
}

interface LpSolution {
  feasible: boolean;
  throughputs: Map<number, number>;   // factoryGuid → throughput (units/min)
  boosts: Map<number, number>;        // factoryGuid → boost multiplier (1.0 if no boosts)
  objective: number;
}
```

**Note on `ExtraGoodSupplier` capping:** In the live calculator, `ExtraGoodSupplier.currentProduction()` is capped at `product.totalDemand()` when it is the default supplier (suppliers.ts:200). The LP computes the raw uncapped rate. When LP production ≥ demand, the calculator reports exactly `totalDemand()`, so the assertion `production >= demand - epsilon` still holds. The LP may overapproximate extra-good supply when the underlying factory is driven by a second product's demand.

### File: `tests/minimization/minimization.spec.ts`

Playwright tests. Each test follows this pattern:

```
1. Load params.js in Node.js
2. Call buildAndSolve(lpInput) → { throughputs, boosts }
3. Load calculator via ConfigLoader + goto('/')
4. Wait for window.view.islands()
5. In page.evaluate: apply throughputs to factories
   - for each factory with t_f > 0:
       boost = boosts.get(factoryGuid) ?? 1.0
       buildings = ceil(t_f / (boost * 60 / cycleTime))
       factory.buildings.constructed(buildings)
       factory.buildings.fullyUtilizeConstructed(true)
   - set defaultSupplier for each demanded product
6. Wait 300ms for observables to settle
7. In page.evaluate: read product.totalCurrentProduction() for each demanded product
8. Assert: production >= LP_demand - epsilon for all demanded products
9. Assert: LP objective ≈ sum of applied throughputs (sanity check)
```

**Test scenarios:**

| Test name | Demanded products | Active effects | Notable structure |
|-----------|------------------|----------------|-------------------|
| `cheese-supply-chain` | Cheese (2153) | none | Multi-hop chain through dairy + feed |
| `obsidian-extra-good` | Obsidian (145102) | Obsidian Gathering (145095, scaling=1) | Extra good supplier |
| `multi-product-demand` | Cheese (2153) + Wine (2138) | none | Two independent chains |
| `self-effecting-extra-good` | Sheep Farm output | Silo buff (77960, scaling=1) | Self-effecting extra good factor |

Use Latium island (session 3245) for Roman products, `with-data.json` as base fixture.

---

## Critical files

| File | Action |
|------|--------|
| `scripts/analyze-demand-graph.ts` | **Create** — graph analysis, no Playwright |
| `tests/minimization/lp-framework.ts` | **Create** — LP builder + solver |
| `tests/minimization/minimization.spec.ts` | **Create** — 4 test scenarios |
| `js/params.js` | **Read-only** — data source for both tools |
| `tests/helpers/config-loader.ts` | **Reuse** — fixture loading |
| `tests/fixtures/with-data.json` | **Reuse** — base fixture |
| `package.json` | **Modify** — add `javascript-lp-solver` |

---

## Verification

```bash
npm run type-check
npx ts-node scripts/analyze-demand-graph.ts   # outputs dist/demand-graph.json
npm run build && npx playwright test tests/minimization/ --reporter=list
```

Check that:
- Graph script finds the coal/resin/wood cycle (SCC size ≥ 3) and the obsidian diamond (≥2 `PRODUCT_SOURCED_FROM` paths) as described in Step 5
- LP tests pass with production ≥ LP demand for all scenarios
- `self-effecting-extra-good` test shows extraGoodFactor > 1 in the LP solution
