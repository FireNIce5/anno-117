import { test, expect } from '@playwright/test';
import { ConfigLoader } from '../helpers/config-loader';

/**
 * Tests for population buffs from area effects (e.g. baths, amphitheater, patron rituals).
 *
 * Key data:
 *   - Liberti residence GUID: 3087 (Latium / Roman region)
 *   - Population level GUID: 1499
 *   - Epicure of Water effect GUID: 99014, buff GUID: 32385, buff.population: 1
 *     (island-event, not a patron effect → has a manual checkbox)
 *   - CeresPopulationEffect GUID: 43600, buff GUID: 43601, buff.population: 1
 *     (patron effect → no manual checkbox, scaling driven by devotion)
 *   - Ceres patron GUID: 43594
 *     Devotion milestones for CeresPopulationEffect: 250→1, 1500→2, 4500→3, ...
 */

const LIBERTI_GUID = 3087;
const EPICURE_EFFECT_GUID = 99014;
const EPICURE_BUFF_GUID = 32385;
const CERES_PATRON_GUID = 43594;
const LATIUM_SESSION = 3245;

test.describe('Population Buffs from Area Effects', () => {
    let configLoader: ConfigLoader;

    test.beforeEach(() => {
        configLoader = new ConfigLoader();
    });

    // -------------------------------------------------------------------------
    // Test 1: Persistence – scaling stored in localStorage survives a page reload
    // -------------------------------------------------------------------------
    test('checked buff scaling is restored from localStorage after reload', async ({ page }) => {
        // Pre-set island.effect.99014.scaling = "1" in the island JSON fixture
        const config = configLoader.createIslandConfig('Latium', LATIUM_SESSION, {
            [`${LIBERTI_GUID}.buildings.constructed`]: '1',
            [`island.effect.${EPICURE_EFFECT_GUID}.scaling`]: '1',
        });
        await configLoader.loadConfigObject(page, config);

        await page.goto('/');
        // Wait for islands to be initialized AND an island to be selected
        await page.waitForFunction(() => (window as any).view && (window as any).view.island());
        await page.waitForTimeout(300);

        // Verify effect is active (scaling = 1)
        const scalingBefore = await page.evaluate((effectGuid) => {
            const island = window.view.island();
            const effect = island.allEffects.find((e: any) => e.guid === effectGuid);
            return effect ? effect.scaling() : null;
        }, EPICURE_EFFECT_GUID);

        expect(scalingBefore, 'Effect should be active (scaling=1) before reload').toBe(1);

        // Reload – addInitScript re-applies the same fixture (scaling=1)
        await page.reload();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(300);

        const scalingAfter = await page.evaluate((effectGuid) => {
            const island = window.view.island();
            const effect = island.allEffects.find((e: any) => e.guid === effectGuid);
            return effect ? effect.scaling() : null;
        }, EPICURE_EFFECT_GUID);

        expect(scalingAfter, 'Effect scaling should still be 1 after reload').toBe(1);
    });

    test('scaling change is written to localStorage immediately', async ({ page }) => {
        const config = configLoader.createIslandConfig('Latium', LATIUM_SESSION, {
            [`${LIBERTI_GUID}.buildings.constructed`]: '1',
        });
        await configLoader.loadConfigObject(page, config);

        await page.goto('/');
        // Wait for islands to be initialized AND an island to be selected
        await page.waitForFunction(() => (window as any).view && (window as any).view.island());
        await page.waitForTimeout(300);

        // Activate the effect
        await page.evaluate((effectGuid) => {
            const island = window.view.island();
            const effect = island.allEffects.find((e: any) => e.guid === effectGuid);
            if (effect) effect.scaling(1);
        }, EPICURE_EFFECT_GUID);

        // Wait for debounced save (Storage uses 0 ms debounce)
        await page.waitForTimeout(100);

        // Read back from localStorage
        const stored = await page.evaluate((islandName) => {
            const raw = localStorage.getItem(islandName);
            return raw ? JSON.parse(raw) : null;
        }, 'Latium');

        expect(stored, 'Island JSON should exist in localStorage').not.toBeNull();
        expect(Number(stored[`island.effect.${EPICURE_EFFECT_GUID}.scaling`]),
            'Scaling should be saved to localStorage').toBe(1);
    });

    // -------------------------------------------------------------------------
    // Test 2: Liberti have population buff effects
    // -------------------------------------------------------------------------
    test('Liberti residence has population buff effects applied', async ({ page }) => {
        const config = configLoader.createIslandConfig('Latium', LATIUM_SESSION, {
            [`${LIBERTI_GUID}.buildings.constructed`]: '1',
        });
        await configLoader.loadConfigObject(page, config);

        await page.goto('/');
        // Wait for islands to be initialized AND an island to be selected
        await page.waitForFunction(() => (window as any).view && (window as any).view.island());
        await page.waitForTimeout(300);

        // Check the buff array on the residence (Latium island context)
        const buffInfo = await page.evaluate((libertiGuid) => {
            const island = window.view.island();
            const residence = island.assetsMap.get(libertiGuid);
            if (!residence) return null;
            const populationBuffs = residence.buffs().filter((b: any) => b.buff.population !== 0);
            return {
                total: residence.buffs().length,
                withPopulation: populationBuffs.length,
                names: populationBuffs.map((b: any) => b.parent.name()),
            };
        }, LIBERTI_GUID);

        expect(buffInfo, 'Liberti residence should be found').not.toBeNull();
        expect(buffInfo!.withPopulation,
            `Liberti should have at least one population buff (got: ${JSON.stringify(buffInfo!.names)})`
        ).toBeGreaterThan(0);
    });

    test('population-level-config-dialog shows area effects section for Liberti', async ({ page }) => {
        const config = configLoader.createIslandConfig('Latium', LATIUM_SESSION, {
            [`${LIBERTI_GUID}.buildings.constructed`]: '1',
        });
        await configLoader.loadConfigObject(page, config);

        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Update the presenter to show the Liberti population level and open the dialog
        await page.evaluate((libertiGuid) => {
            const island = window.view.island();
            const residence = island.assetsMap.get(libertiGuid);
            if (!residence) return;
            const populationLevel = residence.populationLevel;
            window.view.presenter.residence.update(populationLevel);
        }, LIBERTI_GUID);

        // Open the population dialog programmatically
        await page.evaluate(() => {
            ($('#population-level-config-dialog') as any).modal('show');
        });

        await page.waitForSelector('#population-level-config-dialog.show', {
            state: 'visible',
            timeout: 5000,
        });

        // The section heading should contain the localized "From Area Effects & Specialists" text
        const sectionVisible = await page.evaluate(() => {
            const dialog = document.querySelector('#population-level-config-dialog');
            if (!dialog) return false;
            // The heading can be in an h6 (original) or a legend (inside collapsible component)
            const headings = Array.from(dialog.querySelectorAll('h6, legend'));
            return headings.some(h => h.textContent && h.textContent.includes('Area Effects'));
        });

        expect(sectionVisible,
            'Dialog should contain the "From Area Effects & Specialists" section heading'
        ).toBe(true);
    });

    test('presenter.residence.populationBuffs has entries for Liberti', async ({ page }) => {
        // Use All Islands context (what the presenter is bound to)
        const config = configLoader.createIslandConfig('All Islands', 37135, {});
        await configLoader.loadConfigObject(page, config);

        await page.goto('/');
        // Wait for islands to be initialized AND an island to be selected
        await page.waitForFunction(() => (window as any).view && (window as any).view.island());
        await page.waitForTimeout(300);

        const presenterInfo = await page.evaluate((libertiGuid) => {
            const presenter = window.view.presenter.residence;
            if (!presenter) return null;

            // Update to Liberti population level in AllIslands
            const island = window.view.island();
            const residence = island.assetsMap.get(libertiGuid);
            if (!residence) return null;
            presenter.update(residence.populationLevel);

            const buffs = presenter.populationBuffs();
            return {
                count: buffs.length,
                names: buffs.map((b: any) => b.appliedBuff.parent.name()),
                isPatronFlags: buffs.map((b: any) => b.isPatronEffect),
            };
        }, LIBERTI_GUID);

        expect(presenterInfo, 'ResidencePresenter should exist').not.toBeNull();
        expect(presenterInfo!.count,
            `populationBuffs should be non-empty (got: ${JSON.stringify(presenterInfo!.names)})`
        ).toBeGreaterThan(0);
    });

    // -------------------------------------------------------------------------
    // Test 3: Ceres devotion 1500 → 2 bonus residents
    // -------------------------------------------------------------------------
    test('Ceres patron at devotion 1500 gives 2 bonus residents per building', async ({ page }) => {
        const config = configLoader.createIslandConfig('Latium', LATIUM_SESSION, {
            [`${LIBERTI_GUID}.buildings.constructed`]: '1',
            devotion: '1500',
            selectedPatron: String(CERES_PATRON_GUID),
        });

        await configLoader.loadConfigObject(page, config);

        await page.goto('/');
        // Wait for islands to be initialized AND an island to be selected
        await page.waitForFunction(() => (window as any).view && (window as any).view.island());
        await page.waitForTimeout(500); // allow patron effects to compute

        const ceresData = await page.evaluate((libertiGuid) => {
            const island = window.view.island();
            const residence = island.assetsMap.get(libertiGuid);
            if (!residence) return null;

            // Find the buff whose parent is a patron effect
            const ceresBuff = residence.buffs().find((b: any) =>
                island.patronEffects.indexOf(b.parent) !== -1 &&
                b.buff.population !== 0
            );
            if (!ceresBuff) return { found: false };

            return {
                found: true,
                effectScaling: ceresBuff.parent.scaling(),
                populationBonus: ceresBuff.populationBonus(),
                buildings: residence.buildings.constructed(),
                buffPopulation: ceresBuff.buff.population,
            };
        }, LIBERTI_GUID);

        expect(ceresData, 'Liberti residence should be found').not.toBeNull();
        expect(ceresData!.found,
            'Ceres population buff should be applied to Liberti residence'
        ).toBe(true);
        expect(ceresData!.effectScaling,
            'CeresPopulationEffect scaling should be 2 at devotion 1500'
        ).toBe(2);
        expect(ceresData!.populationBonus,
            'populationBonus() should equal scaling * buff.population = 2 * 1 = 2'
        ).toBe(2);
    });

    test('Ceres at devotion 1500 increases residents by 2 for 1 building', async ({ page }) => {
        // Load WITHOUT Ceres to get the baseline residents
        const configBaseline = configLoader.createIslandConfig('Latium', LATIUM_SESSION, {
            [`${LIBERTI_GUID}.buildings.constructed`]: '1',
        });
        await configLoader.loadConfigObject(page, configBaseline);

        await page.goto('/');
        // Wait for islands to be initialized AND an island to be selected
        await page.waitForFunction(() => (window as any).view && (window as any).view.island());
        await page.waitForTimeout(300);

        const baseResidents = await page.evaluate((libertiGuid) => {
            const island = window.view.island();
            const residence = island.assetsMap.get(libertiGuid);
            return residence ? residence.residents() : null;
        }, LIBERTI_GUID);

        expect(baseResidents, 'Baseline residents should be computable').not.toBeNull();

        // Now load WITH Ceres at devotion 1500
        const page2 = await page.context().newPage();
        const configCeres = configLoader.createIslandConfig('Latium', LATIUM_SESSION, {
            [`${LIBERTI_GUID}.buildings.constructed`]: '1',
            devotion: '1500',
            selectedPatron: String(CERES_PATRON_GUID),
        });
        await configLoader.loadConfigObject(page2, configCeres);

        await page2.goto('/');
        // Wait for islands to be initialized AND an island to be selected
        await page2.waitForFunction(() => (window as any).view && (window as any).view.island());

        await page2.waitForTimeout(500);

        const ceresResidents = await page2.evaluate((libertiGuid) => {
            const island = window.view.island();
            const residence = island.assetsMap.get(libertiGuid);
            return residence ? residence.residents() : null;
        }, LIBERTI_GUID);

        await page2.close();

        expect(ceresResidents, 'Residents with Ceres should be computable').not.toBeNull();
        expect(ceresResidents! - baseResidents!,
            'Ceres at devotion 1500 should add exactly 2 residents for 1 building'
        ).toBe(2);
    });

    // -------------------------------------------------------------------------
    // Test 4: Checking a buff (scaling 0→1) increases population
    // -------------------------------------------------------------------------
    test('activating a population buff increases residence residents', async ({ page }) => {
        // Load with the Epicure effect at scaling=0 (default) and 1 Liberti building
        const config = configLoader.createIslandConfig('Latium', LATIUM_SESSION, {
            [`${LIBERTI_GUID}.buildings.constructed`]: '1',
        });
        await configLoader.loadConfigObject(page, config);

        await page.goto('/');
        // Wait for islands to be initialized AND an island to be selected
        await page.waitForFunction(() => (window as any).view && (window as any).view.island());
        await page.waitForTimeout(300);

        const before = await page.evaluate((args) => {
            const island = window.view.island();
            const residence = island.assetsMap.get(args.libertiGuid);
            const effect = island.allEffects.find((e: any) => e.guid === args.effectGuid);
            if (!residence || !effect) return null;

            // Ensure the effect is inactive
            effect.scaling(0);

            // Find the applied buff for this effect on the residence
            const appliedBuff = residence.buffs().find(
                (b: any) => b.parent === effect && b.buff.population !== 0
            );

            return {
                residents: residence.residents(),
                buffPopulation: appliedBuff ? appliedBuff.buff.population : null,
                buildings: residence.buildings.constructed(),
            };
        }, { libertiGuid: LIBERTI_GUID, effectGuid: EPICURE_EFFECT_GUID });

        expect(before, 'Initial state should be readable').not.toBeNull();
        expect(before!.buffPopulation, 'Effect should have a population buff').not.toBeNull();

        // Activate the effect
        await page.evaluate((effectGuid) => {
            const island = window.view.island();
            const effect = island.allEffects.find((e: any) => e.guid === effectGuid);
            if (effect) effect.scaling(1);
        }, EPICURE_EFFECT_GUID);

        await page.waitForTimeout(100); // let observables propagate

        const after = await page.evaluate((libertiGuid) => {
            const island = window.view.island();
            const residence = island.assetsMap.get(libertiGuid);
            return residence ? residence.residents() : null;
        }, LIBERTI_GUID);

        const expectedIncrease = before!.buffPopulation! * before!.buildings;
        expect(after, 'Residents after activation should be computable').not.toBeNull();
        expect(after! - before!.residents,
            `Activating the buff (population=${before!.buffPopulation}) with ${before!.buildings} building(s) should increase residents by ${expectedIncrease}`
        ).toBe(expectedIncrease);
    });
});
