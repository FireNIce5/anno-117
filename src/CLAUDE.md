# TypeScript Development Notes for Anno Calculator

## Class Architecture and Interface Patterns

### IslandManager Settings Pattern (IMPLEMENTED)

**Purpose**: Manages island creation settings (world.ts:254-273)

**Key Pattern**:
- Settings are Option instances with localization and persistence
- Initial values set by `isFirstRun` parameter (ViewMode dependent)
- Applied via Island methods (e.g., `island.activateAllNeeds(checked)`)
- Settings belong to IslandManager, NOT view.settings
- Template binding: `data-bind="checked: $root.islandManager.activateAllNeeds.checked"`

### Constructible Interface Pattern
- `Constructible` is an interface (not a class) that extends `NamedElement`
- Required properties: `buildings: BuildingsCalc`, `island: Island`, `addBuff(appliedBuff: AppliedBuff): void`
- **NEVER use `instanceof Constructible`** - interfaces cannot be checked with instanceof
- Use the `isConstructible(obj)` type guard function in `world.ts` instead
- Classes implementing Constructible: `ResidenceBuilding`, `Consumer` (and its subclasses: `Factory`, `Module`, `PublicConsumerBuilding`)

### Parameter Interface Integration
When creating classes that use configuration interfaces from `types.config.ts`:

1. **Always look up referenced objects**: Convert numeric IDs to actual object references using `_assetsMap.get()`
2. **Update property types**: Change from `number[]` to proper object arrays (e.g., `Buff[]`, `Effect[]`, `Product[]`)
3. **Add proper error handling**: Throw descriptive errors when referenced objects aren't found

Example pattern:
```typescript
// Instead of storing IDs
public buffs: number[];

// Store actual objects  
public buffs: Buff[];

// In constructor
this.buffs = config.buffs.map(buffId => {
    const buff = _assetsMap.get(buffId);
    if (!buff) {
        throw new Error(`Buff with GUID ${buffId} not found in assetsMap`);
    }
    return buff as Buff;
});
```

### Type Safety Improvements
- **Remove all `as any` type assertions** - they break type safety
- When properties exist but aren't typed, add them to the class definition rather than using type assertions
- Use proper type guards for interface checking instead of `instanceof` on interfaces
- For filtering that changes types, combine type guards with instanceof checks: 
  ```typescript
  .filter((f: any) => isConstructible(f) && f instanceof Consumer) as Consumer[]
  ```

### Missing Property Patterns  
When encountering "missing" properties that exist at runtime:
- Check if they're commented out in the class definition
- Add them as properly typed optional properties: `public property?: Type`
- Common example: `ResidenceBuilding` needs `upgradedBuildingGuid?: string` and `upgradedBuilding?: ResidenceBuilding`

## Module Integration Architecture (IMPLEMENTED)
- **Module Creation**: Modules are created in Factory constructor when `config.additionalModule` exists
- **AppliedBuff Creation**: Modules call `applyBuffs()` from Factory.initDemands() - creates AppliedBuff instances with `useParentScaling=false`
- **Buff Scaling**: Module `checked` observable controls buff scaling (0 = inactive, 1 = active)
- **Persistence**: Module state persisted using `persistBool` pattern in Island constructor
- **Circular Imports**: AppliedBuff moved to separate `buffs.ts` file to resolve Factory ↔ Production circular dependency

### Critical Module Implementation Details
**Input Demand Calculation** (factories.ts:388):
- Modules MUST have `buildings.fullyUtilizeConstructed(true)` in constructor
- This enables throughput calculation via `throughputByExistingBuildings`
- Without this, modules produce no input demands even when checked

**Boost Application via Observable Array** (factories.ts:41, 104):
- `buffs` MUST be `KnockoutObservableArray<AppliedBuff>`, not plain array
- Declared as: `public buffs: KnockoutObservableArray<AppliedBuff>;`
- Initialized as: `this.buffs = ko.observableArray([]);`
- Without observable array, `boostSubscription` doesn't react to module buff changes
- All code accessing buffs must unwrap: `this.buffs()` not `this.buffs`

**Module Buff Application Flow**:
1. Factory.initDemands() calls `module.applyBuffs(assetsMap)` (factories.ts:633)
2. Module creates AppliedBuff with `useParentScaling=false` (factories.ts:400-406)
3. Module sets initial scaling: `appliedBuff.scaling(this.checked() ? 1 : 0)` (factories.ts:408)
4. AppliedBuff constructor calls `this.target.addBuff(this)` (buffs.ts:139)
5. Consumer.addBuff() pushes to observable array: `this.buffs.push(appliedBuff)` (factories.ts:335)
6. Observable array change triggers `boostSubscription` recalculation (factories.ts:177-202)
7. Module buffs are multiplicative, other buffs additive (factories.ts:184-190)

**AppliedBuff Property Names** (buffs.ts:14-27):
- AppliedBuff has `buff` property, NOT `effect`
- Correct: `appliedBuff.buff.guid`
- Wrong: `appliedBuff.effect.guid`

### Object Lookup Best Practices
1. Always validate `_assetsMap.get(id)` results before using
2. Use descriptive error messages with GUID and context
3. Cast to appropriate types after validation: `buff as Buff`

## Syntax Fixes
Knockout computed: `read: () => { return value; }, write: (val: boolean) => { setValue(val); }`  
Avoid: `(() => {...})` or `((val as boolean) => {...})`

## Class Hierarchy
- **Consumer**: Base class (inputs only, final consumption)
- **Factory**: Extends Consumer (inputs + outputs, produces for other consumers)  
- **Module**: Extends Consumer (provides conditional buffs with multiplicative bonuses)
- **PublicConsumerBuilding**: Extends Consumer (services, no production)

## Productivity Bonus System (IMPLEMENTED)

### Two-Stage Productivity Calculation
The productivity boost calculation uses a two-stage approach with `baseProductivityUpgrade` and `productivityUpgrade`:

**Stage 1 - Base Productivity (Additive)**:
- `baseProductivityUpgrade` values are summed and added to the base value of 100
- Applied from all sources: buffs (items/effects/modules) and aqueduct buffs
- Example: If two buffs have baseProductivityUpgrade of 10 and 15:
  - Base = 100 + 10 + 15 = 125

**Stage 2 - Percentage Multiplier (Additive, then Multiplicative)**:
- `productivityUpgrade` percentages are summed together
- The sum is applied as a multiplier: `(1 + sum / 100)`
- Multiplied with the base productivity from Stage 1
- Example: If buffs have productivityUpgrade of 20 and 10:
  - Multiplier = 1 + (20 + 10) / 100 = 1.3

**Final Formula**:
```typescript
const baseValue = 100 + sum(baseProductivityUpgrade);
const multiplier = 100 + sum(productivityUpgrade);
const totalBoost = (baseValue * multiplier) / 10000;
```

**Example Calculation**:
- baseProductivityUpgrade = 20, productivityUpgrade = 30
- baseValue = 100 + 20 = 120
- multiplier = 100 + 30 = 130
- totalBoost = (120 × 130) / 10000 = 1.56 (156% productivity)

### Implementation Pattern
See the implementation in `src/factories.ts:177-202` in the `Consumer.initDemands()` boostSubscription.

**Critical Detail**: Division is performed at the end (`/ 10000`) to avoid floating-point rounding issues that can cause display problems (e.g., showing 315.01% instead of 315%).

### Buff Property Architecture
**Buff Class** (production.ts:478, 516):
- `baseProductivityUpgrade: number` - Added to base 100 before multiplication
- `productivityUpgrade: number` - Percentage multiplier applied to base

**AppliedBuff Class** (buffs.ts:21, 84-90):
- `baseProductivityUpgrade: KnockoutObservable<number>` - Scales buff value by `scaling()`
- `productivityUpgrade: KnockoutObservable<number>` - Scales buff value by `scaling()`

**AqueductBuff Class** (production.ts:828, 854-860):
- Same observable pattern as AppliedBuff
- Both properties scaled by aqueduct `scaling()` value

### BuildingDemand Pattern
- **BuildingDemand**: Subclass of Demand that accepts `KnockoutObservable<number>` as factor
- **Dynamic Scaling**: `updateAmount()` method multiplies base amount by observable factor
- **Usage**: Used for fuel consumption demands where factor changes based on buff calculations
- **Factor Removal**: Base Demand class no longer has static factor property - moved to BuildingDemand observable

## Effects Persistence Architecture (IMPLEMENTED)

### Three-Tier Effect Persistence System
**Global Effects** (main.ts:369-384):
- Storage key pattern: `global.effect.${effectGuid}.scaling`
- Persisted after creation during initialization
- Uses direct localStorage.getItem/setItem with observable subscriptions

**Session Effects** (world.ts:203-218):
- Storage key pattern: `session.${sessionGuid}.effect.${effectGuid}.scaling`
- Persisted in Session constructor after effect creation
- Uses TypeScript-safe localStorage existence checking

**Island Effects** (world.ts:786-789):
- Storage key pattern: `island.effect.${effectGuid}.scaling`
- Uses existing `persistFloat(effect, "scaling", ...)` helper pattern
- Integrated into Island constructor persistence flow

### Implementation Details
- **Effect Scaling**: All effects use `scaling: KnockoutObservable<number>` (0=inactive, 1=active)
- **Automatic Persistence**: Observable subscriptions save changes immediately to localStorage
- **Type Safety**: Proper null checking for localStorage.getItem() results
- **Backward Compatible**: No changes to existing Effect class interface
- **Consistent Pattern**: All three levels follow same observable subscription pattern

### Storage Key Structure
```
global.effect.${effectGuid}.scaling          // Global effects
session.${sessionGuid}.effect.${effectGuid}.scaling  // Session effects  
island.effect.${effectGuid}.scaling          // Island effects (via persistFloat)
```

### Core Architecture
- Factory/building persistence uses helper functions: persistBool, persistInt, persistFloat, persistString
- All persistence is scoped with localStorage keys: ${scope}.${obj.guid}.${attributeName}
- Global objects (regions, sessions, effects) now have persistence for their scaling states
- Island-level persistence happens in Island constructor using persistBuildings() flow

## Effect Source Types and Display (IMPLEMENTED)

### Effect Source Property
**Purpose**: Identifies the origin/type of an effect for UI display

**Source Enum Values** (production.ts:655):
- `'module'` - Effect from factory modules
- `'tech'` - Effect from technology/discoveries
- `'festival'` - Effect from festival events
- `'veneration-effect'` - Effect from patron veneration
- `'session-event'` - Session-wide event effect
- `'island-event'` - Island-specific event effect

**Property Declaration**:
```typescript
public source?: string; // Optional, set from config
public effectDuration?: number; // Duration in seconds (for events)
```

### Source Text Localization (production.ts:699-737)

**getSourceText() Method**: Returns localized source name with optional duration
- Maps source enum to params.js translation keys (NOT i18n.ts)
- Accesses translations via `window.view.texts`
- Appends duration in brackets if `effectDuration > 0`: `"Festival (2h)"`
- Uses global `formatNumber()` function for duration formatting

**Source to Translation Key Mapping**:
```typescript
'module' → 'silo'
'tech' → 'discovery'
'festival' → 'festival'
'veneration-effect' → 'venerationEffects'
'session-event' → 'sessionEvent'
'island-event' → 'islandEvent'
```

**Important**: Always use params.js translations (accessed via `window.view.texts`), not i18n.ts translations, for game-related text.

### Effect Filtering by Session (IMPLEMENTED)

**Location**: Island.availableEffects computed observable (world.ts:818-843)

**Filtering Logic**:
1. **Meta Session (All Islands)**: Shows all effects without filtering
   - Check: `this.isAllIslands()` returns true
   - No target validation needed

2. **Regular Islands**: Shows effects only if they meet one of:
   - `effect.targetsIsAllProduction === true` (global effects)
   - Effect has at least one target in the island's session/region

**Region Matching**:
```typescript
const hasTargetsInSession = e.targets.some(target => {
    return target.associatedRegions.some(region =>
        region.guid === this.island.session.region.guid
    );
});
```

**Key Behavior**:
- Session-specific effects (e.g., Latium-only) hidden on islands from other sessions
- All effects visible in "All Islands" view for comprehensive overview
- Uses Constructible interface: targets have `associatedRegions` property
- Patron effects always filtered out via `this.patronEffects.indexOf(e) != -1`

**Template Integration** (templates/effects-dialog.html:36):
- Duration column replaced with source display
- Binding: `data-bind="text: $data.getSourceText()"`
- Shows source type with duration in brackets when applicable

## Population-Level Need Management (IMPLEMENTED)

### Architecture Transformation
**Before**: Individual residence-level need activation (ResidenceNeed.checked observable per building)
**After**: Population-level need activation (PopulationLevelNeed.checked observable shared across all residences)

### Key Classes Created/Modified
**PopulationLevelNeed** (consumption.ts:74-139):
- Centralized need management for entire population tier
- Properties: checked, notes, available, hidden observables
- Methods: name(), isInactive(), banned(), prepareResidenceEffectView()
- Each PopulationLevel has needsMap: Map<number, PopulationLevelNeed>

**PopulationLevel** (population.ts:233-355):
- Added needsMap and needs array for population-level need management
- Methods: getNeed(), isNeedActivated(), getVisibleNeeds()
- Needs initialized when first residence is added via addResidence()

**ResidenceNeed** (consumption.ts:145-261):
- checked and notes properties now computed observables delegating to PopulationLevel
- Maintains all calculation logic (amount, residents, demands)
- Preserved UI compatibility through delegation pattern

### Persistence Changes
**Storage Pattern**: Changed from `${residenceGuid}[${needGuid}].checked` to `${populationLevelGuid}[${needGuid}].checked`
**Location**: Island constructor persistence (world.ts:961-967) now iterates PopulationLevel.needs instead of ResidenceBuilding.needsMap

### UI Architecture (IMPLEMENTED)
**ResidencePresenter** (views.ts:747-793):
- Added populationNeedCategories computed observable
- Creates need categories from population-level needs with aggregated totalResidents() and totalAmount()
- Preserves methods by adding properties directly to PopulationLevelNeed objects (avoids object spread)

**Template Structure** (templates/population-level-config-dialog.html):
- Population summary section with total residents across all residences
- Residence buildings table showing individual buildings with controls
- Population-level needs section with single checkbox per need type
- Proper binding context: $root.texts for localization, $data.need.product for asset icons

### Critical Implementation Patterns
**Object Method Preservation**: NEVER use object spread (`...obj`) with Knockout objects as it loses method references
**Template Binding Context**: Use $root.texts for localization, formatNumber/formatPercentage as global functions
**Delegation Pattern**: ResidenceNeed observables delegate to PopulationLevel for single source of truth
**Dynamic Property Addition**: Add computed properties directly to existing objects to preserve methods

## Need Categorization Architecture 

### Category Identification Issue
**Problem**: Need categories use `id` as unique identifier, NOT `guid`
**Root Cause**: `NeedCategory` extends `NamedElement` which has optional `guid?: number`, but categories are identified by their `id: string` property
**Critical Fix**: Always use `category.id` for Map keys when grouping needs by category


### Two-Way Observable Delegation Pattern
**Problem**: Population-level need changes not reflected in residence-level consumption
**Solution**: ResidenceNeed.checked must be writable computed observable with delegation

```typescript
// WRONG - read-only delegation breaks consumption
this.checked = ko.pureComputed(() => {
    const populationLevelNeed = this.residence.populationLevel.getNeed(this.need.guid);
    return populationLevelNeed ? populationLevelNeed.checked() : false;
});

// CORRECT - two-way binding enables proper consumption
this.checked = ko.pureComputed({
    read: () => {
        const populationLevelNeed = this.residence.populationLevel.getNeed(this.need.guid);
        return populationLevelNeed ? populationLevelNeed.checked() : true;
    },
    write: (value: boolean) => {
        const populationLevelNeed = this.residence.populationLevel.getNeed(this.need.guid);
        if (populationLevelNeed) {
            populationLevelNeed.checked(value);
        }
    }
});
```

### Key Implementation Details
- **Category Mapping**: Use `category.id` string identifiers, not `category.guid` numbers
- **Delegation Direction**: PopulationLevelNeed is the source of truth, ResidenceNeed delegates to it
- **Default Values**: When population-level need doesn't exist, default to `true` (activated) to maintain backward compatibility
- **Consumption Flow**: ResidenceNeed.amount() calculations depend on ResidenceNeed.checked() delegation working properly

### Object Method Preservation Pattern
**Critical Implementation Detail**: User's fix preserves Knockout observable methods by avoiding object spread

**Problem**: Object spread (`...obj`) loses method references from Knockout observables
**Solution**: Direct property addition to existing objects
```typescript
// WRONG - loses Knockout methods
const extended = { ...populationLevelNeed, totalResidents, totalAmount };

// CORRECT - preserves methods by direct assignment
populationLevelNeed.totalResidents = totalResidents;
populationLevelNeed.totalAmount = totalAmount;
populationLevelNeed.prepareResidenceEffectView = prepareResidenceEffectView;
```

### Template Integration Improvements
**UI Binding Context**: Fixed template binding to work with presenter pattern
- Proper use of `$root.texts` for localization
- Global function calls: `formatNumber()`, `formatPercentage()` without $root prefix
- Correct data context navigation: `$data.need.product` for asset properties

## Knockout Debug System (IMPLEMENTED)

**Debug Utilities** (src/util.ts:542-772):
- `window.debugKO.inspect(selector)`, `.type(obj)`, `.log(obj, label)`, `.context(element)`
- Template wrapper detection, safe observable unwrapping, asset type identification

**Debug Binding** (src/components.ts:75-134):
- Template usage: `<div data-bind="debug: 'Label'">`
- Logs `[DebugKO]` with asset type, GUID, name, binding context
- Requires `window.view.debug.enabled()` for init, `verboseMode()` for updates

**Persistence** (src/main.ts:79-110):
- localStorage restore on init: `debug.enabled`, `verboseMode`, `logBindings`
- Two-way sync via observable subscriptions
- Enable: `localStorage.setItem('debug.enabled', 'true')` OR `window.view.debug.enabled(true)`

## Internationalization (i18n.ts)

**Required Languages** (12 total): english, french, polish, spanish, italian, german, brazilian, russian, simplified_chinese, traditional_chinese, japanese, korean

**CRITICAL**: Use `simplified_chinese` and `traditional_chinese`, NEVER `chinese`

**Workflow**:
- Add key with English: `newKey: { english: "text" }`
- Complete: `/translate newKey` OR `npm run check-translations`
- Verify: `npm run check-translations`
- Template: `<span data-bind="text: $root.texts.newKey"></span>`

**Excluded**: `helpContent` (managed separately, doesn't require all 12 languages)

**Common Errors**: Using `chinese` instead of `simplified_chinese`/`traditional_chinese`, missing languages, special character escaping

## Presenter Pattern Architecture (IMPLEMENTED)

### CategoryPresenter Implementation

**Purpose**: Wraps ProductCategory and creates ProductPresenter instances for all products in the category

**Key Architectural Decision**: CategoryPresenter creates its own ProductPresenter instances rather than filtering from island.productPresenters
- **Reason**: Ensures each product has exactly one presenter per category, avoiding duplication
- **Pattern**: Similar to ResidencePresenter creating need presenters

**Critical Properties**:
```typescript
export class CategoryPresenter {
    public instance: KnockoutObservable<ProductCategory>;  // Resolves from island.assetsMap
    public category: ProductCategory;                       // Original category reference
    public island: KnockoutObservable<Island>;             // MUST be observable for reactivity
    public productPresenters: ProductPresenter[];           // Created in constructor, not computed
}
```

**Initialization Pattern** (main.ts:494-505):
```typescript
// For each category in allIslands.categories
const categoryPresenter = new CategoryPresenter(category, window.view.island);
presenter.categories.push(categoryPresenter);

// Build presenter lookup map
for (const productPresenter of categoryPresenter.productPresenters) {
    presenter.productByGuid.set(productPresenter.guid, productPresenter);
}
```

**Key Differences from ProductPresenter**:
- `productPresenters` is a plain array (not computed) - created once in constructor
- `instance` computed resolves category from island.assetsMap on island changes
- No filtering logic - creates presenters for ALL products in category.products

### ProductPresenter Architecture

**Critical Observable Pattern**:
```typescript
export class ProductPresenter {
    public product: Product;                              // Direct reference (NOT observable)
    public island: KnockoutObservable<Island>;           // MUST be observable
    public instance: KnockoutComputed<Product>;          // Resolves from island().assetsMap
    public factoryPresenters: FactoryPresenter[];        // Created once, not observable array
}
```

**Why instance is Computed**:
- Allows product data to update when user switches islands
- Resolves current island's version: `this.island().assetsMap.get(this.product.guid)`
- All delegated properties use `this.instance()` to get current data

**Factory Presenter Creation**:
- Created once in constructor from `product.factories`
- Each FactoryPresenter gets reference to parent ProductPresenter
- Not an observable array - static list per product

### FactoryPresenter Nested Pattern

**Parent Reference for Observable Island**:
```typescript
export class FactoryPresenter {
    public parentProduct: ProductPresenter;
    public island: KnockoutObservable<Island>;  // Inherited from parent

    constructor(factory: Factory, parent: ProductPresenter) {
        this.parentProduct = parent;
        this.island = parent.island;  // Share parent's observable island
        this.instance = ko.computed(() =>
            this.island().assetsMap.get(this.factory.guid)
        );
    }
}
```

**Critical Pattern**: Never create new observable - reuse parent's observable island
- Ensures all nested presenters react to same island changes
- Avoids subscription proliferation
- Maintains single source of truth

### Common Presenter Anti-Patterns

**❌ WRONG - Creating circular dependency**:
```typescript
this.product = ko.pureComputed(() => this.instance());
this.instance = ko.computed(() => this.island().assetsMap.get(this.product.guid));
// ERROR: product depends on instance, instance depends on product.guid
```

**✅ CORRECT - Direct reference + computed resolution**:
```typescript
this.product = product;  // Direct reference to original product
this.instance = ko.pureComputed(() => this.island().assetsMap.get(this.product.guid));
```

**❌ WRONG - Creating new observable for nested presenter**:
```typescript
this.island = ko.observable(parent.island());  // Creates duplicate observable
```

**✅ CORRECT - Share parent's observable**:
```typescript
this.island = parent.island;  // Reuse parent's observable reference
```

### Presenter Integration with Templates (REMOVED)

**Old Pattern (Removed)**: Templates with added computed properties
```typescript
// This pattern was replaced
categoryTemplate.productPresenters = ko.pureComputed(() => {
    // Filter island.productPresenters by category
});
```

**New Pattern (Implemented)**: Dedicated presenter hierarchy
```typescript
// CategoryPresenter creates its own ProductPresenters
window.view.presenter.categories = [];  // Array of CategoryPresenter
window.view.presenter.productByGuid = new Map();  // Quick lookup

// Templates removed - use presenters directly in bindings
```

**Benefits of Presenter-Only Approach**:
- Clear separation: Templates for display, Presenters for data/logic
- No mixing of Template pattern with Presenter pattern
- Single source of ProductPresenter instances (via CategoryPresenter)
- Faster lookups via productByGuid Map

### Observable vs Direct Reference Guidelines

**Use Observable When**:
- Value changes during application lifetime (e.g., selected island)
- Multiple components need to react to changes
- Value needs to persist across UI updates

**Use Direct Reference When**:
- Value is immutable after creation (e.g., original Product/Category reference)
- Only needed for identification (e.g., guid lookup)
- Used to resolve current data from observable source

**Computed Observable Pattern**:
- Delegate to observable source: `ko.pureComputed(() => this.island().assetsMap.get(guid))`
- Provides reactive access to current data
- Updates automatically when observable source changes

### Product-Based Presenter Pattern (PLANNED)

**ProductPresenter** - Wraps Product with UI-specific observables:
- `factoryPresenters: FactoryPresenter[]` - Nested presenters for factories
- `availableSuppliers: KnockoutComputed<SupplierOption[]>` - All supplier options for dropdown
- `totalProduction`, `totalDemand`, `netBalance` - Aggregate calculations

**UI Templates**:
- `product-tile.html` - Single tile per product showing aggregate production/demand
- `product-config-dialog.html` - Tabbed dialog (Factories | Extra Goods | Trade Routes | Production Chain)
- `factory-config-section.html` - Individual factory configuration within product dialog

**Critical Patterns**:
- Object method preservation: Add properties directly, never use spread operator
- Supplier dropdown: Integrates factories, islands (for trade routes), extra goods, passive trade
- Trade route auto-creation: Selecting island creates TradeRoute with minAmount=0
- Init order: Create presenters after initDemands/applyBuffs, before persistBuildings

## Supplier Interface Architecture (PLANNED)

**Problem**: Demands tightly coupled to Factory suppliers. No unified way to handle trade routes, passive trade, or extra goods as alternative sources.

**Supplier Interface**:
```typescript
interface Supplier {
    type: 'factory' | 'trade_route' | 'passive_trade' | 'extra_good';
    defaultProduction(): number;
    setDemand(amount: number): void;
}
```

**Implementations**:
- **FactorySupplier**: Wraps Factory, generates recursive input demands
- **TradeRouteSupplier**: Auto-creates trade routes with `userSetAmount` floor constraint
- **PassiveTradeSupplier**: Manual input, no demand propagation ("joker" supplier)
- **ExtraGoodSupplier**: Wraps items producing extra goods

**Product Changes**:
- Add `defaultSupplier: KnockoutObservable<Supplier>` (user-selected per island)
- Add `availableSuppliers: KnockoutComputed<Supplier[]>` (all options)
- Deprecate `fixedFactory` property

**Demand Simplification**:
- Remove `Demand.factory` property
- Demand resolution at Product level via `defaultSupplier.setDemand()`

**Init Order**:
1. Create objects (factories, products, consumers, suppliers)
2. `f.initDemands()` - Factories register in products
3. `p.initSuppliers()` - Create supplier instances
4. `e.applyBuffs()` - Effects apply buffs
5. `p.restoreDefaultSupplier()` - Load supplier selection
6. `persistBuildings()` - Load factory state

**Trade Route Changes**:
- Add `userSetAmount` observable - user-set minimum
- Auto-cleanup: Delete routes where `userSetAmount == 0 && !manuallySet`
- Storage: `island.product.${productGuid}.supplier.type|.id`

**TradeList modifications** (trade.ts:180-331):
- `userSetAmount: KnockoutObservable<number>` - user-set minimum
- `manuallySet: KnockoutObservable<boolean>` - distinguishes user vs auto-created routes
- `routes` includes `userSetAmount` property per route
- Auto-cleanup: Remove routes where `userSetAmount == 0 && !manuallySet`

**Patterns**: Strategy (Supplier interface), Presenter (UI separation), Delegation (Demand→Product→Supplier)

**Pitfalls**: Circular dependencies (use separate suppliers.ts file), Observable method preservation (never use spread operator), Init order (suppliers after factories register, selection before demands)