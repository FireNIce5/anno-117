import { test, expect } from '@playwright/test';
import { ConfigLoader } from '../helpers';

/**
 * Tests for item effects on workforce requirements
 *
 * Validates that items correctly reduce workforce maintenance costs via workforceMaintenanceFactorUpgrade.
 *
 * Test case: Spinner factory (guid 3187) with Measurer item (guid 51339)
 * - Measurer item provides workforceMaintenanceFactorUpgrade: -25.0 (25% workforce reduction)
 * - When item is equipped, workforce should be 75% of original (25% reduction)
 * - When item is unequipped, workforce should return to 100% (base)
 */

test.describe('Item Workforce Reduction', () => {
    test('measurer item reduces spinner workforce by 25%', async ({ page }) => {
        const configLoader = new ConfigLoader();

        // Create config with spinner factory having 3 constructed buildings
        const config = configLoader.createIslandConfig("Latium", 3245, {
            "3187.buildings.constructed": "3",
            "3187.buildings.fullyUtilizeConstructed": "1"
        });

        await configLoader.loadConfigObject(page, config);
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        const spinnerGuid = 3187;
        const measurerItemGuid = 51339;

        await page.waitForTimeout(500);

        // Get initial state (no item equipped)
        const initialState = await page.evaluate((args) => {
            const island = window.view.island();
            const factory = island.assetsMap.get(args.factoryGuid);

            if (!factory) {
                return { found: false, error: 'Factory not found' };
            }

            // Find the measurer item buff
            const measurerBuff = factory.buffs().find((b: any) =>
                b.buff?.guid === args.itemGuid
            );

            return {
                found: true,
                factoryGuid: factory.guid,
                factoryName: factory.name(),
                buildingsConstructed: factory.buildings.constructed(),
                workforceAmount: factory.workforceDemand?.amount() ?? null,
                workforceBoost: factory.workforceDemand?.boost() ?? null,
                workforceName: factory.workforceDemand?.workforce()?.name() ?? null,
                itemExists: !!measurerBuff,
                itemScaling: measurerBuff?.scaling?.() ?? null,
                itemWorkforceUpgrade: measurerBuff?.workforceMaintenanceFactorUpgrade?.() ?? null,
                availableItemsCount: factory.availableItems()?.length ?? 0
            };
        }, { factoryGuid: spinnerGuid, itemGuid: measurerItemGuid });

        console.log('Initial state (no item equipped):', initialState);

        // Verify factory exists
        expect(initialState.found).toBe(true);
        expect(initialState.factoryGuid).toBe(spinnerGuid);
        expect(initialState.buildingsConstructed).toBe(3);

        // Verify workforce exists
        expect(initialState.workforceAmount).not.toBeNull();
        expect(initialState.workforceBoost).toBe(1.0); // No boost yet

        // Store initial workforce for comparison
        const initialWorkforce = initialState.workforceAmount!;
        console.log('Initial workforce requirement:', initialWorkforce);

        // Equip the Measurer item
        await page.evaluate((args) => {
            const island = window.view.island();
            const factory = island.assetsMap.get(args.factoryGuid);

            if (!factory) {
                console.error('Factory not found');
                return;
            }

            // Find the measurer item buff and activate it
            const measurerBuff = factory.buffs().find((b: any) =>
                b.buff?.guid === args.itemGuid
            );

            if (measurerBuff) {
                measurerBuff.scaling(1); // Activate the item
                console.log('Measurer item equipped');
            } else {
                console.error('Measurer buff not found in factory.buffs()');
            }
        }, { factoryGuid: spinnerGuid, itemGuid: measurerItemGuid });

        await page.waitForTimeout(200);

        // Get state after equipping item
        const equippedState = await page.evaluate((args) => {
            const island = window.view.island();
            const factory = island.assetsMap.get(args.factoryGuid);

            if (!factory) {
                return { found: false };
            }

            const measurerBuff = factory.buffs().find((b: any) =>
                b.buff?.guid === args.itemGuid
            );

            return {
                found: true,
                workforceAmount: factory.workforceDemand?.amount() ?? null,
                workforceBoost: factory.workforceDemand?.boost() ?? null,
                itemScaling: measurerBuff?.scaling?.() ?? null,
                itemWorkforceUpgrade: measurerBuff?.workforceMaintenanceFactorUpgrade?.() ?? null,
                buffsCount: factory.buffs().length
            };
        }, { factoryGuid: spinnerGuid, itemGuid: measurerItemGuid });

        console.log('Equipped state:', equippedState);

        // Verify item is equipped
        expect(equippedState.found).toBe(true);
        expect(equippedState.itemScaling).toBe(1); // Item should be active

        // Verify workforce reduction
        // workforceMaintenanceFactorUpgrade = -25
        // factor = -25/100 + 1 = 0.75 (25% reduction)
        expect(equippedState.workforceBoost).toBeCloseTo(0.75, 2);

        // Verify actual workforce amount is reduced by 25%
        const expectedWorkforce = 6;
        expect(equippedState.workforceAmount).toBe(expectedWorkforce);

        console.log(`Workforce reduced from ${initialWorkforce} to ${equippedState.workforceAmount} (${Math.round((1 - equippedState.workforceAmount! / initialWorkforce) * 100)}% reduction)`);

        // Unequip the item
        await page.evaluate((args) => {
            const island = window.view.island();
            const factory = island.assetsMap.get(args.factoryGuid);

            if (factory) {
                const measurerBuff = factory.buffs().find((b: any) =>
                    b.buff?.guid === args.itemGuid
                );

                if (measurerBuff) {
                    measurerBuff.scaling(0); // Deactivate the item
                }
            }
        }, { factoryGuid: spinnerGuid, itemGuid: measurerItemGuid });

        await page.waitForTimeout(200);

        // Get state after unequipping
        const unequippedState = await page.evaluate((args) => {
            const island = window.view.island();
            const factory = island.assetsMap.get(args.factoryGuid);

            return {
                workforceAmount: factory?.workforceDemand?.amount() ?? null,
                workforceBoost: factory?.workforceDemand?.boost() ?? null
            };
        }, { factoryGuid: spinnerGuid, itemGuid: measurerItemGuid });

        console.log('Unequipped state:', unequippedState);

        // Verify workforce returns to original
        expect(unequippedState.workforceBoost).toBe(1.0);
        expect(unequippedState.workforceAmount).toBe(initialWorkforce);
    });
});
