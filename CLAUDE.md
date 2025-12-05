# CLAUDE.md

Technical guidance for working with the Anno 117 Calculator codebase.

## Quick Reference

### Commands
- `npm run build` - Production build
- `npm run dev` - Development with watch
- `npm run type-check` - TypeScript validation
- `npm test` - Run Playwright tests
- `/translate <key>` - Translate i18n key to all 12 languages

### Core Files
- **main.ts** - Entry point, initialization (see @main.ts:292)
- **factories.ts** - Production logic, buff system
- **world.ts** - Island/session management, initialization order
- **production.ts** - Products, demands, buffs
- **buffs.ts** - AppliedBuff (separated to avoid circular imports)
- **views.ts** - Presenters (ResidencePresenter pattern)
- **i18n.ts** - UI translations (12 languages required)
## Testing

**Key Commands:**
- `npm test` - Run all Playwright tests
- `npm run test:computed` - Calculation tests
- `npm run test:binding` - Template binding tests
Always run type checking after making changes:
```bash
npm run type-check
```

For build validation:
```bash
npm run build
```
**Test Docs:** See `tests/CLAUDE.md` for formulas and constraints

## Critical Architecture
- Items create AppliedBuff for each target. This tracks whether the effect is applied to the specific factory in AppliedBuff.scaling (knockout observable storing a float).
- Initialization order in island constructor is important. Buffs register in factories. Factories register in products. Therefore, initDemands and applyBuffs exist to establish the links after objects are created. Only after that values are loaded from localStorage (as part of calling the persist* method)
- Most assets are created for each island. Only some (regions, seesions, buffs, need categories) only exist once globally.
- Avoid to use `as any` casts when generating code. Do not use them to fix typescript errors.
### Initialization Order (world.ts:518)
**MUST follow this sequence:**
1. Create objects (factories, products, consumers)
2. `f.initDemands(assetsMap)` - Factories register in products
3. `e.applyBuffs(assetsMap)` - Effects create AppliedBuff for targets
4. `persistBuildings()` - Load saved configurations

### Key Constraints
- `types.config.ts` is auto-generated - never edit
- Circular imports resolved: production.ts → buffs.ts ← factories.ts
- Most assets per-island; regions/sessions/buffs are global
- Observable arrays: Call `.buffs()` not `.buffs` for array access

**Storage Class** (src/world.ts:34-152):
- Each Storage instance manages one top-level localStorage key
- Data stored as JSON string, parsed into `this.json` object
- Internal Map for quick lookups
- Debounced saving (0ms timeout) to prevent excessive writes

**Three SubStorage Instances**:
1. `calculatorSettings = new SubStorage("calculatorSettings")` (main.ts:350)
   - Stores settings like `settings.showAllProducts`, `settings.decimalsForBuildings`
   - Keys accessed via `settingsStorage.getItem("settings.propertyName")`

2. `sessionSettings = new SubStorage("sessionSettings")` (main.ts:351)
   - Stores session-level configuration
   - Used for session effects persistence

3. `globalEffects = new SubStorage("globalEffects")` (main.ts:416)
   - Stores global effect scaling values
   - Keys: `{effectGuid}.scaling`

**Island Storage** (per-island JSON):
- Each island has its own Storage instance: `new Storage(islandName)`
- Island name used as localStorage key (e.g., "Latium", "All Islands")
- Contains nested JSON with session, building counts, etc.
- See tests/CLAUDE.md for complete structure

### ALL_ISLANDS Constant
- Defined in src/util.ts:51 as `"All Islands"`
- Used as storage key for the special all-islands view
- Session GUID: 37135 (Global/Meta session)
- Must be included in all test fixtures

## Debugging

**Enable Debug Mode:**
```javascript
localStorage.setItem('debug.enabled', 'true'); // Persists across reloads
window.view.debug.enabled(true); // Runtime toggle
```

**Debug Utilities:**
- `window.debugKO.inspect('#selector')` - Inspect element binding
- `window.debugKO.log(object, 'label')` - Log asset info
- Template debug binding: `data-bind="debug: 'Label'"`

**Common Issues:**
- Template errors: Check `ko.templates` object exists
- Effects missing: Wrong init order (applyBuffs before initDemands)
- Observable arrays: Use `this.buffs()` not `this.buffs`

### Debug Binding Handler
- **Purpose**: Log binding context and asset information for troubleshooting template issues
- **Location**: src/components.ts (registered alongside other binding handlers)
- **Usage Patterns**:
  - Basic debugging: `<div data-bind="debug: true">...</div>`
  - Labeled debugging: `<div data-bind="debug: 'Factory Tile'">...</div>`
- **Behavior**:
  - **init callback**: Logs initial binding information when element is first bound
  - **update callback**: Logs changes when bound observables update (requires verbose mode)
  - Only active when `window.view.debug.enabled()` is true

### Debug Utilities (Global Access)
Available via `window.debugKO` object for ad-hoc debugging from browser console:

```javascript
// Inspect specific element by selector
debugKO.inspect('#factory-config-dialog');
debugKO.inspect('.factory-tile');

// Get asset type information
const type = debugKO.type(window.view.selectedFactory());
console.log('Type:', type); // "Factory" or "Template(Factory)"

// Log detailed asset information
debugKO.log(window.view.island(), 'Current Island');

// Get full binding context
const context = debugKO.context(document.querySelector('.factory-tile'));
console.log(context.assetInfo); // { guid, name, type, region }
```

## Bootstrap Tabs (v4.5.2)

**Critical Rules:**
- Only ONE tab with `active` class at init
- Buttons use `data-target="#id"`, links use `href="#id"`
- Don't add `active` via Knockout foreach loops

## Storage Architecture

**SubStorage Pattern** (world.ts:34-152):
- `calculatorSettings` - Settings JSON (e.g., `settings.showAllProducts`)
- `sessionSettings` - Session config
- `globalEffects` - Global effect scaling
- Per-island: `new Storage(islandName)` - Island-specific JSON

**Constants:**
- `ALL_ISLANDS = "All Islands"` (util.ts:51) - Session GUID: 37135

## Translations

**Two Sources:**
- `i18n.ts` - UI text (12 languages required)
- `params.js` - Game data (auto-generated from Anno 117 assets)

**Commands:**
- `npm run check-translations` - Verify completeness
- `/translate keyName` - Translate single key
- `./scripts/auto-translate.sh` - Batch translate

**Languages:** english, french, polish, spanish, italian, german, brazilian, russian, simplified_chinese, traditional_chinese, japanese, korean

See `src/CLAUDE.md` for detailed i18n guidance.

**Community:**
- Discord: https://discord.gg/jSBrJZvAEq (Server ID: 1439668406973497376)
- PayPal donations: Button ID 8P2Y93KGWJHXQ
- Badges in README.md and help-dialog.html template