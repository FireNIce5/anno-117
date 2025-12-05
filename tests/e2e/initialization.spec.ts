import { test, expect } from '@playwright/test';
import { ConfigLoader } from '../helpers/config-loader';
import { BindingErrorDetector } from '../helpers/binding-detector';
import { ComputedValueAsserter } from '../helpers/computed-asserter';

test.describe('Application Initialization E2E Tests', () => {
  let configLoader: ConfigLoader;
  let errorDetector: BindingErrorDetector;
  let asserter: ComputedValueAsserter;

  test.beforeEach(async () => {
    configLoader = new ConfigLoader();
    errorDetector = new BindingErrorDetector();
    asserter = new ComputedValueAsserter();
  });

  test('application initializes without errors', async ({ page }) => {
    // Set up error detection
    errorDetector.listenForErrors(page);

    // Load basic configuration
    await configLoader.loadConfig(page, 'tests/fixtures/basic.json');

    // Navigate to application
    await page.goto('/');

    // Wait for initialization to complete
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify no errors occurred
    const errorCounts = errorDetector.getErrorCounts();
    const relevantCount = errorCounts.binding + errorCounts.knockout;

    expect(
      relevantCount,
      `Application had ${relevantCount} errors during initialization: \n ${errorDetector.getFormattedBindingErrors().join('\n')} \n ${errorDetector.getFormattedKnockoutErrors().join('\n')}`
    ).toBe(0);
  });

  test('initialization order validates correctly', async ({ page }) => {
    // Load fixture with data to check initialization order
    await configLoader.loadConfig(page, 'tests/fixtures/with-data.json');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify critical initialization order
    const initOrder = await page.evaluate(() => {
      const view = (window as any).view;
      const island = view.island();

      // Check objects were created
      const objectsCreated = {
        factories: island.factories && island.factories.length > 0,
        products: island.products && island.products.length > 0,
        populationLevels: island.populationLevels && island.populationLevels.length > 0,
      };

      // Check relationships established
      const relationshipsEstablished = {
        factoriesHaveInputDemands: island.factories.some(
          (f: any) => f.inputDemands && f.inputDemands().length > 0
        ),
        factoriesHaveBuffs: island.factories.some(
          (f: any) => f.buffs && f.buffs.length > 0
        ),
      };

      // Check bindings applied
      const bindingsApplied = {
        koApplied: document.body.getAttribute('data-bind') !== null ||
                    document.querySelectorAll('[data-bind]').length > 0,
        componentsRendered: document.querySelectorAll('.product-tile, .ui-tier-unit').length > 0,
      };

      return {
        objectsCreated,
        relationshipsEstablished,
        bindingsApplied,
      };
    });

    // Verify objects were created
    expect(initOrder.objectsCreated.factories, 'Factories should be created').toBe(true);
    expect(initOrder.objectsCreated.products, 'Products should be created').toBe(true);
    expect(initOrder.objectsCreated.populationLevels, 'Population levels should be created').toBe(true);

    // Verify relationships established
    expect(
      initOrder.relationshipsEstablished.factoriesHaveInputDemands,
      'Factories should have input demands after initDemands()'
    ).toBe(true);

    // Verify bindings applied
    expect(initOrder.bindingsApplied.koApplied, 'Knockout bindings should be applied').toBe(true);
    expect(
      initOrder.bindingsApplied.componentsRendered,
      'Components should be rendered'
    ).toBe(true);
  });

  test('params.js loaded correctly', async ({ page }) => {
    // Load basic configuration
    await configLoader.loadConfig(page, 'tests/fixtures/basic.json');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify params object exists and has expected structure
    const paramsValid = await page.evaluate(() => {
      const params = (window as any).params;

      if (!params) {
        return { valid: false, reason: 'params object not found' };
      }

      // Check for expected params properties
      const hasConstants = params.constants !== undefined;
      const hasRegions = Array.isArray(params.regions);
      const hasSessions = Array.isArray(params.sessions);

      return {
        valid: hasConstants && hasRegions && hasSessions,
        hasConstants,
        hasRegions,
        hasSessions,
        regionsCount: params.regions ? params.regions.length : 0,
        sessionsCount: params.sessions ? params.sessions.length : 0,
      };
    });

    expect(paramsValid.valid, `params.js validation failed: ${JSON.stringify(paramsValid)}`).toBe(
      true
    );
    expect(paramsValid.regionsCount, 'Should have at least one region').toBeGreaterThan(0);
    expect(paramsValid.sessionsCount, 'Should have at least one session').toBeGreaterThan(0);
  });

  test('window.view global state initialized', async ({ page }) => {
    // Load basic configuration
    await configLoader.loadConfig(page, 'tests/fixtures/basic.json');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check window.view structure
    const viewState = await page.evaluate(() => {
      const view = (window as any).view;

      return {
        exists: view !== undefined,
        hasSettings: view.settings !== undefined,
        hasTexts: view.texts !== undefined,
        hasDlcs: Array.isArray(view.dlcs),
        hasIsland: view.island && view.island() !== null,
        hasRegions: Array.isArray(view.regions),
        hasSessions: Array.isArray(view.sessions),
      };
    });

    expect(viewState.exists, 'window.view should exist').toBe(true);
    expect(viewState.hasSettings, 'window.view.settings should exist').toBe(true);
    expect(viewState.hasTexts, 'window.view.texts should exist').toBe(true);
    expect(viewState.hasDlcs, 'window.view.dlcs should be an array').toBe(true);
    expect(viewState.hasIsland, 'window.view.island should be initialized').toBe(true);
    expect(viewState.hasRegions, 'window.view.regions should be an array').toBe(true);
    expect(viewState.hasSessions, 'window.view.sessions should be an array').toBe(true);
  });

  test('localStorage persistence works', async ({ page }) => {
    // Navigate to page first (without init script that would run on every reload)
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Set localStorage AFTER page load using evaluate (not init script)
    // This way it won't be overwritten on reload
    const config = configLoader.createIslandConfig("All Islands", 37135, {}, {});
    await page.evaluate((configData) => {
      localStorage.clear();
      for (const [key, value] of Object.entries(configData)) {
        localStorage.setItem(key, String(value));
      }
    }, config);

    // Reload to apply the config
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Set a factory building count
    await page.evaluate(() => {
      const factory = (window as any).view.island().assetsMap.get(3089);
      if (factory) {
        factory.buildings.constructed(42);
      } else {
        console.error("No factory found.")
      }
    });

    // Wait for persistence (debounced save is 0ms but still async)
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      console.log(localStorage.getItem("All Islands"));
    });


    // Reload page - localStorage should persist now (no init script overwriting it)
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      console.log(localStorage.getItem("All Islands"));
    });

    // Verify value persisted
    const reloadedValue = await page.evaluate(() => {
      const factory = (window as any).view.island().assetsMap.get(3089);
      return factory ? factory.buildings.constructed() : null;
    });

    expect(reloadedValue).toBe(42);
  });

  test('UI components render correctly', async ({ page }) => {
    await configLoader.loadConfig(page, 'tests/fixtures/basic.json');

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Check navbar rendered
    const navbar = await page.locator('nav.navbar').count();
    expect(navbar, 'Navbar should be rendered').toBe(1);

    // Check population section rendered
    const populationSection = await page.locator('#residents-view').count();
    expect(populationSection, 'Population section should be rendered').toBe(1);

    // Check at least some UI elements are visible
    const visibleElements = await page.locator('[data-bind]:visible').count();
    expect(visibleElements, 'Should have visible bound elements').toBeGreaterThan(0);
  });

  test('debug utilities available when enabled', async ({ page }) => {
    // Load basic configuration
    await configLoader.loadConfig(page, 'tests/fixtures/basic.json');
    await configLoader.setDebugMode(page, true);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check debug utilities are available
    const debugAvailable = await page.evaluate(() => {
      const debugKO = (window as any).debugKO;
      const debugEnabled = (window as any).view?.debug?.enabled?.();

      return {
        debugKOExists: debugKO !== undefined,
        hasInspect: typeof debugKO?.inspect === 'function',
        hasLog: typeof debugKO?.log === 'function',
        hasType: typeof debugKO?.type === 'function',
        debugEnabled,
      };
    });

    expect(debugAvailable.debugKOExists, 'window.debugKO should exist').toBe(true);
    expect(debugAvailable.hasInspect, 'debugKO.inspect should be a function').toBe(true);
    expect(debugAvailable.hasLog, 'debugKO.log should be a function').toBe(true);
    expect(debugAvailable.hasType, 'debugKO.type should be a function').toBe(true);
    expect(debugAvailable.debugEnabled, 'Debug mode should be enabled').toBe(true);
  });
});
