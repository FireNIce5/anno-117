import { test, expect } from '@playwright/test';

test.describe('Persistence', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // Wait for initialization
        await page.waitForSelector('#residents-view');
    });

    test('Tech effects (Vino Veritas) and veneration effects (Vervactor\'s Plough) are stored as global effects', async ({ page }) => {
        const VINO_VERITAS_EFFECT = 38434;
        const VINO_VERITAS_AREA_BUFF = 30467;
        const VERVACTOR_PLOUGH_EFFECT = 43620;

        // Enable effects via UI or page.evaluate
        await page.evaluate(({ vv, vvab, vp }) => {
            const view = (window as any).view;
            const vvEffect = view.globalEffects.find((e: any) => e.guid === vv);
            const vvAreaBuff = view.areaBuffs.find((b: any) => b.guid === vvab);
            const vpEffect = view.globalEffects.find((e: any) => e.guid === vp);
            if (vvEffect) vvEffect.scaling(1);
            if (vvAreaBuff) vvAreaBuff.scaling(1);
            if (vpEffect) vpEffect.scaling(1);
        }, { vv: VINO_VERITAS_EFFECT, vvab: VINO_VERITAS_AREA_BUFF, vp: VERVACTOR_PLOUGH_EFFECT });

        // Give it a moment to save
        await page.waitForTimeout(100);

        // Check globalEffects storage
        const globalEffects = await page.evaluate(() => {
            return JSON.parse(localStorage.getItem('globalEffects') || '{}');
        });

        expect(Number(globalEffects[`${VINO_VERITAS_EFFECT}.scaling`])).toBe(1);
        expect(Number(globalEffects[`${VINO_VERITAS_AREA_BUFF}.scaling`])).toBe(1);
        expect(Number(globalEffects[`${VERVACTOR_PLOUGH_EFFECT}.scaling`])).toBe(1);
        
        // Also check they are NOT in island storage or session storage
        const islandName = await page.evaluate(() => (window as any).view.island().name);
        const islandStorage = await page.evaluate((name) => {
            return JSON.parse(localStorage.getItem(name) || '{}');
        }, islandName);
        
        expect(islandStorage[`island.effect.${VINO_VERITAS_EFFECT}.scaling`]).toBeUndefined();
        expect(islandStorage[`island.areaBuff.${VINO_VERITAS_AREA_BUFF}.scaling`]).toBeUndefined();

        const sessionSettings = await page.evaluate(() => {
            return JSON.parse(localStorage.getItem('sessionSettings') || '{}');
        });
        const sessionGuid = await page.evaluate(() => (window as any).view.island().session.guid);
        expect(sessionSettings[`session.${sessionGuid}.effect.${VINO_VERITAS_EFFECT}.scaling`]).toBeUndefined();

        // Verify it persists after reload/navigation (global)
        await page.reload();
        await page.waitForSelector('#residents-view');
        
        const results = await page.evaluate(({ vv, vvab }) => {
            const view = (window as any).view;
            const vvEffect = view.globalEffects.find((e: any) => e.guid === vv);
            const vvAreaBuff = view.areaBuffs.find((b: any) => b.guid === vvab);
            return {
                effect: vvEffect ? vvEffect.scaling() : null,
                areaBuff: vvAreaBuff ? vvAreaBuff.scaling() : null
            };
        }, { vv: VINO_VERITAS_EFFECT, vvab: VINO_VERITAS_AREA_BUFF });
        
        expect(Number(results.effect)).toBe(1);
        expect(Number(results.areaBuff)).toBe(1);
    });

    test('Session effects (Obsidian Gathering) are stored as session effects', async ({ page }) => {
        const OBSIDIAN_GATHERING_EFFECT = 145095;

        await page.evaluate((guid) => {
            const island = (window as any).view.island();
            const session = island.session;
            const effect = session.effects.find((e: any) => e.guid === guid);
            if (effect) effect.scaling(1);
        }, OBSIDIAN_GATHERING_EFFECT);

        await page.waitForTimeout(100);

        const sessionSettings = await page.evaluate(() => {
            return JSON.parse(localStorage.getItem('sessionSettings') || '{}');
        });

        const sessionGuid = await page.evaluate(() => (window as any).view.island().session.guid);
        const expectedKey = `session.${sessionGuid}.effect.${OBSIDIAN_GATHERING_EFFECT}.scaling`;

        expect(sessionSettings[expectedKey]).toBeDefined();
        expect(Number(sessionSettings[expectedKey])).toBe(1);
        
        // Check NOT in global storage
        const globalEffects = await page.evaluate(() => {
            return JSON.parse(localStorage.getItem('globalEffects') || '{}');
        });
        expect(globalEffects[`${OBSIDIAN_GATHERING_EFFECT}.scaling`]).toBeUndefined();

        // Check NOT in island storage
        const islandName = await page.evaluate(() => (window as any).view.island().name);
        const islandStorage = await page.evaluate((name) => {
            return JSON.parse(localStorage.getItem(name) || '{}');
        }, islandName);
        expect(islandStorage[`island.effect.${OBSIDIAN_GATHERING_EFFECT}.scaling`]).toBeUndefined();
    });
});
