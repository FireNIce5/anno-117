# Testing Framework Knowledge

## Quick Reference: Helpers
- **ConfigLoader**: 
    - `loadConfig(page, fixturePath)`: Loads a JSON file into localStorage.
    - `loadConfigObject(page, configObject)`: Directly loads an object into localStorage.
    - `createIslandConfig(name, session, data, settings)`: Creates a single-island config.
    - `createFullConfig(islands, settings, activeIsland)`: Creates a multi-island config (e.g., Latium + Albion).
- **BindingDetector**: `listenForErrors(page)`, `hasBindingError()`. Captures Knockout errors. *Note: `error.text()` is a function.*
- **ComputedAsserter**: `assertEquals(page, path, expected, tolerance)`. Safely evaluates observables in page context.
- **FixtureManager**: `loadFixture(name)`, `generateFixture(params)`. Manages test data in `tests/fixtures/`.
- **LP Framework**: `tests/minimization/lp-framework.ts`. Uses `javascript-lp-solver` to compute minimum throughputs given demands and active effects.

## Minimization Tests

**Location**: `tests/minimization/minimization.spec.ts`
**Purpose**: Verifies that the calculator's reactive throughput logic matches a linear programming oracle.

**Implementation Details**:
- Decision variables: `t_f` (throughput of factory `f`).
- Objective: `minimize sum(t_f)`.
- Constraints: Net production of product `p` >= external demand `p`.
- Supports: Base productivity, multiplicative percentage boosts, self-effecting extra goods, and non-self-effecting extra goods.

**Common Pitfalls**:
- **Region IDs vs GUIDs**: `Factory.associatedRegions` typically contains string IDs (e.g. `"Roman"`). `Session.region` is a numeric GUID. To filter factories by session, first resolve the Session's region GUID to its corresponding Region ID via `params.regions`.
- **Build Synchronization**: Playwright tests load `dist/calculator.bundle.js`. Always run `npm run build` after modifying `src`. If the bundle doesn't update, use `rm -r -Force dist ; npm run build` (PowerShell) to force emission.

## Critical Constraints
- **Robust Initialization**: `networkidle` is unstable. Always wait for the view and island to be ready:
  `await page.waitForFunction(() => (window as any).view && (window as any).view.island());`
- **Knockout in `page.evaluate()`**: The `ko` object is **NOT** available. Access observables by calling them: `window.view.island().factories[0].boost()`.
- **Observable Arrays**: Must unwrap before array methods: `factory.buffs().find(...)` or `island.availablePatrons().find(...)`.
- **DOM-Based Testing**: Prefer waiting for selectors (`.product-tile`) and clicking elements over direct `window.view` access to avoid timing issues.

## Common Mistakes to Avoid
- **Reference Errors**: Never use `ko.isObservable()` or `ko.unwrap()` in `page.evaluate()`. Use `typeof === 'function'` or direct calls.
- **Missing Parentheses**: Using `factory.boost` instead of `factory.boost()` returns the function, not the value.
- **Manual localStorage**: When setting objects in `evaluate` blocks, you MUST `JSON.stringify(value)` for objects, otherwise they are stored as `"[object Object]"`.
- **Patron Availability**: `availablePatrons()` is filtered by DLC. If a patron isn't appearing, ensure its associated DLC is checked.
- **`page.evaluate` Arguments**: Playwright's `page.evaluate` only accepts **ONE** argument for the function. Pass multiple values as an object: `page.evaluate(({a, b}) => a + b, {a: 1, b: 2})`.
- **Storage Booleans**: `localStorage` stores booleans as strings `"1"` or `"0"`. Use `Number()` coercion when comparing.
- **Collapsible Elements**: Tests will fail to "click" or "see" elements inside collapsed fieldsets. Expand them first via DOM manipulation.
- **Hardcoding Params**: Don't hardcode cycle times or consumption rates. Read them from `window.view.island().assetsMap.get(guid)` in the test.
- **Bootstrap Tabs**: Only ONE tab can have the `active` class at init. Don't add `active` via `foreach` loops in templates.
- **Nested Replacement Errors**: When using `replace`, ensure the `new_string` doesn't accidentally wrap or nest class definitions (e.g., `class X { class X ... }`).
- **Need vs Product GUIDs**: Needs have their own GUIDs distinct from the products they consume. Check `params.needs` for the correct GUID when testing consumption logic.
- **Asset Traversal**: Some objects like `PopulationLevelNeed` aren't in the global `assetsMap`. Access them via their parents: `island.populationLevels.flatMap(l => l.needs)`.

## Population Tiers
| Region | Tier 1 | Tier 2 | Tier 3 |
| :--- | :--- | :--- | :--- |
| **Roman** | Liberti | Plebeians | Equites |
| **Celtic** | Waders | Smiths | Aldermen |

## Common Test GUIDs
| Category | GUID | Name / Description |
| :--- | :--- | :--- |
| **Session** | 37135 | All Islands (Global/Meta) |
| **Session** | 3245 | Latium |
| **Session** | 6627 | Albion |
| **Population**| 1499 | Liberti Population Level |
| **Residence** | 3087 | Liberti Residence (Latium) |
| **Residence** | 6475 | Waders Residence (Albion) |
| **Factory**   | 3089 | Timber Factory (Latium) |
| **Factory**   | 2786 | Sheep Farm |
| **Factory**   | 3187 | Spinner |
| **Factory**   | 2694 | Latium Vineyard |
| **Factory**   | 23723 | Albion Vineyard |
| **Factory**   | 2916 | Limestone Quarry |
| **Product**   | 2153 | Cheese |
| **Product**   | 2138 | Wine |
| **Product**   | 2140 | Oysters with Caviar |
| **Product**   | 2151 | Fine Glass |
| **Product**   | 2179 | Marble |
| **Product**   | 8563 | Minerals |
| **Product**   | 2069 | Wheat |
| **Product**   | 145102| Obsidian |
| **Module**    | 77954 | Silo Module (Sheep Farm) |
| **Buff**      | 77960 | Silo Buff (+100% Prod) |
| **Item**      | 51339 | Measurer (-25% Workforce) |
| **Patron**    | 43594 | Ceres (Always available) |
| **DLC**       | 67902 | Prophecies of Ash (DLC01) |
| **Effect**    | 145095| Obsidian Gathering (Limestone) |
| **Effect**    | 148043| Obsidian Mining (Obsidian) |
| **Effect**    | 99014 | Epicure of Water (Radius) |
| **Effect**    | 43600 | CeresPopulationEffect |

## Formulas Reference
- **Productivity (Boost)**: `((100 + sum(baseProductivityUpgrades)) * (100 + sum(productivityUpgrades))) / 100` (Division at end to avoid rounding artifacts like 315.01%)
- **Factory Throughput**: `buildings.utilized * boost * 60 / cycleTime`
- **Residence Need**: `buildings.constructed * needConsumptionRate * consumptionFactor`
- **Residence Residents**: `buildings.constructed * need.residents` (summed for checked needs)
- **Extra Goods**: `requiredInputAmount * (scaling * defaultAmount / additionalOutputCycle)`

## Storage Architecture
- **Global Keys**: `calculatorSettings`, `sessionSettings`, `globalEffects` (JSON strings).
- **Island Storage**: Nested JSON under island name key (e.g., `"Latium"`).
- **SubStorage Pattern**: Data is stringified JSON nested inside stringified JSON. Use `ConfigLoader` to handle this complexity.

## Execution
- `npm run build` - **MANDATORY** before running tests to sync `src` and `dist`.
- `npm test` - Run all (non-interactive)
- `npm run test:computed` - Scoped run for logic tests.
- Set `CI=true` or `--reporter=list` to prevent HTML report from opening.
