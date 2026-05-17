import { test, expect } from '@playwright/test';
import { ConfigLoader } from '../helpers/config-loader';

test.describe('Default Suppliers in All Islands View', () => {
  test('All products with producers have a default supplier in All Islands view', async ({ page }) => {
    // Load 'basic' fixture
    const configLoader = new ConfigLoader();
    await configLoader.loadConfig(page, 'tests/fixtures/basic.json');

    // Navigate and wait for initialization
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Activate all DLCs
    await page.evaluate(() => {
        (window as any).view.dlcs.forEach((d: any) => d.checked(true));
    });

    // Select 'All Islands'
    await page.evaluate(() => {
        const allIslands = (window as any).view.islands().find((i: any) => i.name() === "All Islands");
        if (allIslands) {
            (window as any).view.island(allIslands);
        }
    });

    // Wait for computations to settle
    await page.waitForTimeout(500);

    // Get all products that have at least one producer (factory) and check if they have a default supplier
    const results = await page.evaluate(() => {
        const island = (window as any).view.island();
        if (!island) return [];

        return island.products.map((p: any) => {
            const hasProducer = p.factories.length > 0;
            const hasDefaultSupplier = p.defaultSupplier() != null;
            
            return {
                guid: p.guid,
                name: p.name(),
                hasProducer,
                hasDefaultSupplier
            };
        });
    });

    // Filter products that HAVE a producer but NO default supplier
    const missingSuppliers = results.filter((p: any) => p.hasProducer && !p.hasDefaultSupplier);

    // Assert that no product with producers is missing a default supplier
    expect(missingSuppliers.length, `Expected all products with producers to have a default supplier, but found ${missingSuppliers.length} missing: ${missingSuppliers.map((p: any) => p.name).join(', ')}`).toBe(0);
  });
});
