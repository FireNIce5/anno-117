import { test, expect } from '@playwright/test';
import { ConfigLoader } from '../helpers/config-loader';

test.describe('New Requirements Tests', () => {
  let configLoader: ConfigLoader;

  const DLC01 = 67902;
  const EFFECT_OBSIDIAN_GATHERING = 145095;
  const EFFECT_OBSIDIAN_MINING = 148043;
  const PRODUCT_OBSIDIAN = 145102;
  const FACTORY_LIMESTONE_QUARRY = 2916;
  const FACTORY_CONCRETE_MIXER_ROMAN = 3129;
  const RESIDENCE_PATRICIAN = 3145;
  const PRODUCT_BOARDGAMES = 145225;
  
  const FERTILITY_GRAPES = 2205;
  const FACTORY_VINEYARD_ALBION = 23723;
  const FACTORY_VINEYARD_LATIUM = 2694;

  test.beforeEach(async ({ page }) => {
    configLoader = new ConfigLoader();
    await configLoader.loadConfig(page, 'tests/fixtures/with-data.json');
    await page.goto('/');
    // Wait for islands to be initialized instead of networkidle
    await page.waitForFunction(() => (window as any).view && (window as any).view.islands().length >= 3);
  });

  test('Vineyard in Albion: productivity not shown as it lacks fertility', async ({ page }) => {
    await page.evaluate(({ FACTORY_VINEYARD_ALBION }) => {
      const view = (window as any).view;
      const albion = view.islands().find((i: any) => i.name() === "Albion");
      view.island(albion);
      
      const factory = albion.assetsMap.get(FACTORY_VINEYARD_ALBION);
      const product = factory.product;
      const productPresenter = view.presenter.productByGuid.get(product.guid);
      
      view.selectedProduct(productPresenter);
      (window as any).$ && (window as any).$('#product-config-dialog').modal('show');
    }, { FACTORY_VINEYARD_ALBION });

    // Wait for the modal to be visible
    await page.waitForSelector('#product-config-dialog', { state: 'visible' });

    // Check if the productivity row is hidden
    // We look for the text "Productivity" (from i18n) and check if its parent row is visible
    const productivityText = await page.evaluate(() => (window as any).view.texts.productivity.name());
    const rowVisible = await page.evaluate((text) => {
      const rows = Array.from(document.querySelectorAll('#product-config-dialog tr'));
      const row = rows.find(r => r.textContent?.includes(text));
      if (!row) return false;
      const style = window.getComputedStyle(row);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }, productivityText);

    expect(rowVisible).toBe(false);
  });

  test('Vineyard in Latium: factory config has "Available on Island" button', async ({ page }) => {
    await page.evaluate(({ FACTORY_VINEYARD_LATIUM }) => {
      const view = (window as any).view;
      const latium = view.islands().find((i: any) => i.name() === "Latium");
      view.island(latium);
      
      const factory = latium.assetsMap.get(FACTORY_VINEYARD_LATIUM);
      const product = factory.product;
      const productPresenter = view.presenter.productByGuid.get(product.guid);
      
      view.selectedProduct(productPresenter);
      (window as any).$ && (window as any).$('#product-config-dialog').modal('show');
    }, { FACTORY_VINEYARD_LATIUM });

    await page.waitForSelector('#product-config-dialog', { state: 'visible' });

    // Look for the "Available on Island" label
    const labelText = await page.evaluate(() => (window as any).view.texts.availableOnIsland.name());
    const labelVisible = await page.locator(`label:has-text("${labelText}")`).isVisible();

    expect(labelVisible).toBe(true);
  });

  test('Vineyard in Albion: factory config has NO "Available on Island" button', async ({ page }) => {
    await page.evaluate(({ FACTORY_VINEYARD_ALBION }) => {
      const view = (window as any).view;
      const albion = view.islands().find((i: any) => i.name() === "Albion");
      view.island(albion);
      
      const factory = albion.assetsMap.get(FACTORY_VINEYARD_ALBION);
      const product = factory.product;
      const productPresenter = view.presenter.productByGuid.get(product.guid);
      
      view.selectedProduct(productPresenter);
      (window as any).$ && (window as any).$('#product-config-dialog').modal('show');
    }, { FACTORY_VINEYARD_ALBION });

    await page.waitForSelector('#product-config-dialog', { state: 'visible' });

    const labelText = await page.evaluate(() => (window as any).view.texts.availableOnIsland.name());
    const label = page.locator(`label:has-text("${labelText}")`);
    
    // It should either not exist or be hidden
    const count = await label.count();
    if (count > 0) {
        expect(await label.isVisible()).toBe(false);
    } else {
        expect(count).toBe(0);
    }
  });

  test('Latium: DLC01 Obsidian gathering - production matches demand', async ({ page }) => {
    const results = await page.evaluate(({ 
        DLC01, EFFECT_OBSIDIAN_GATHERING, EFFECT_OBSIDIAN_MINING, 
        RESIDENCE_PATRICIAN, PRODUCT_OBSIDIAN, FACTORY_LIMESTONE_QUARRY 
    }) => {
      const view = (window as any).view;
      const latium = view.islands().find((i: any) => i.name() === "Latium");
      view.island(latium);
      
      // Enable DLC01
      const dlc = view.dlcs.find((d: any) => d.guid === DLC01);
      if (dlc) dlc.checked(true);
      
      // Enable both forms of obsidian gathering
      const effect1 = latium.allEffects.find((e: any) => e.guid === EFFECT_OBSIDIAN_GATHERING);
      if (effect1) effect1.scaling(1);
      const effect2 = latium.allEffects.find((e: any) => e.guid === EFFECT_OBSIDIAN_MINING);
      if (effect2) effect2.scaling(1);
      
      // Enter 1000 patrician residences
      const patrician = latium.assetsMap.get(RESIDENCE_PATRICIAN);
      if (patrician) patrician.buildings.constructed(1000);
      
      // Set supplier of obsidian to limestone quarry AND obsidian mine
      const obsidian = latium.assetsMap.get(PRODUCT_OBSIDIAN);
      const limestoneQuarry = latium.assetsMap.get(FACTORY_LIMESTONE_QUARRY);
      
      const extraGoodSupplier = obsidian.extraGoodSuppliers.find((s: any) => s.factory.guid === FACTORY_LIMESTONE_QUARRY);
      if (extraGoodSupplier) {
          obsidian.updateDefaultSupplier(extraGoodSupplier);
      }
      
      const productPresenter = view.presenter.productByGuid.get(PRODUCT_OBSIDIAN);
      view.selectedProduct(productPresenter);
      (window as any).$ && (window as any).$('#product-config-dialog').modal('show');
      
      return {
          produced: obsidian.totalCurrentProduction(),
          consumed: obsidian.totalDemand(),
          netBalance: obsidian.totalCurrentProduction() - obsidian.totalDemand()
      };
    }, { 
        DLC01, EFFECT_OBSIDIAN_GATHERING, EFFECT_OBSIDIAN_MINING, 
        RESIDENCE_PATRICIAN, PRODUCT_OBSIDIAN, FACTORY_LIMESTONE_QUARRY 
    });

    await page.waitForSelector('#product-config-dialog', { state: 'visible' });

    expect(results.produced).toBeGreaterThan(0);
    expect(results.produced).toBeCloseTo(results.consumed, 5);
  });

  test('Latium: DLC01 Obsidian with 10 concrete factories - production does not exceed demand', async ({ page }) => {
    const results = await page.evaluate(({ 
        DLC01, EFFECT_OBSIDIAN_GATHERING, EFFECT_OBSIDIAN_MINING, 
        RESIDENCE_PATRICIAN, PRODUCT_OBSIDIAN, FACTORY_LIMESTONE_QUARRY,
        FACTORY_CONCRETE_MIXER_ROMAN
    }) => {
      const view = (window as any).view;
      const latium = view.islands().find((i: any) => i.name() === "Latium");
      view.island(latium);
      
      // Enable DLC01
      const dlc = view.dlcs.find((d: any) => d.guid === DLC01);
      if (dlc) dlc.checked(true);
      
      // Enable both forms of obsidian gathering
      const effect1 = latium.allEffects.find((e: any) => e.guid === EFFECT_OBSIDIAN_GATHERING);
      if (effect1) effect1.scaling(1);
      const effect2 = latium.allEffects.find((e: any) => e.guid === EFFECT_OBSIDIAN_MINING);
      if (effect2) effect2.scaling(1);
      
      // Enter 1000 patrician residences
      const patrician = latium.assetsMap.get(RESIDENCE_PATRICIAN);
      if (patrician) patrician.buildings.constructed(1000);
      
      // Set supplier of obsidian to limestone quarry
      const obsidian = latium.assetsMap.get(PRODUCT_OBSIDIAN);
      const limestoneQuarry = latium.assetsMap.get(FACTORY_LIMESTONE_QUARRY);
      
      const extraGoodSupplier = obsidian.extraGoodSuppliers.find((s: any) => s.factory.guid === FACTORY_LIMESTONE_QUARRY);
      if (extraGoodSupplier) {
          obsidian.updateDefaultSupplier(extraGoodSupplier);
      }
      
      const productPresenter = view.presenter.productByGuid.get(PRODUCT_OBSIDIAN);
      view.selectedProduct(productPresenter);
      (window as any).$ && (window as any).$('#product-config-dialog').modal('show');

      // Add 20 concrete factories AFTER setting the default supplier
      const concreteMixer = latium.assetsMap.get(FACTORY_CONCRETE_MIXER_ROMAN);
      if (concreteMixer) concreteMixer.buildings.constructed(20);

      var result =  {
          produced: productPresenter.extraGoodProduction(),
          consumed: productPresenter.totalDemandNoRoutes(),
          obsidianOverproduction: obsidian.excessProduction(),
          limestoneQuarryThroughput: limestoneQuarry.throughput(),
          limestoneQuarryOutput: limestoneQuarry.outputAmount()
      };

      // Check that reset is also correct
      if (concreteMixer) concreteMixer.buildings.constructed(0);
      result["producedReset"] = productPresenter.extraGoodProduction();
      result["consumedReset"] = productPresenter.totalDemandNoRoutes();

      return result;
    }, { 
        DLC01, EFFECT_OBSIDIAN_GATHERING, EFFECT_OBSIDIAN_MINING, 
        RESIDENCE_PATRICIAN, PRODUCT_OBSIDIAN, FACTORY_LIMESTONE_QUARRY,
        FACTORY_CONCRETE_MIXER_ROMAN
    });

    await page.waitForSelector('#product-config-dialog', { state: 'visible' });

    // Production of obsidian must not be higher than demand
    // (This implies that ExtraGoodSupplier logic should cap production at demand if it's the default supplier)
    expect(results.produced).toBeCloseTo(results.consumed, 5);
    expect(results.produced).not.toBeGreaterThan(results.consumed + 0.001);
    expect(results.producedReset).toBeCloseTo(results.consumedReset, 5);
  });
});
