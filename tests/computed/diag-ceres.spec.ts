import { test, expect } from '@playwright/test';
import { ConfigLoader } from '../helpers/config-loader';

const LIBERTI_GUID = 3087;
const CERES_PATRON_GUID = 43594;
const LATIUM_SESSION = 3245;

test('diagnose - stack traces', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', msg => {
        if (msg.text().includes('[DIAG]') || msg.text().includes('43600')) {
            logs.push(msg.text());
        }
    });

    const configLoader = new ConfigLoader();
    const config = configLoader.createIslandConfig('Latium', LATIUM_SESSION, {
        [`${LIBERTI_GUID}.buildings.constructed`]: '1',
        devotion: '1500',
        selectedPatron: String(CERES_PATRON_GUID),
    });
    await configLoader.loadConfigObject(page, config);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    for (const log of logs) {
        console.log(log);
    }
    console.log(`Total [DIAG] logs: ${logs.length}`);
    expect(true).toBe(true);
});
