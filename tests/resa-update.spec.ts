import { expect, test } from '@playwright/test';

// In-app updater: the About dialog must offer a direct install (not just a
// link), and the recheck button must ask GitHub again.
test('about dialog installs the update in place', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('nowly:onboarding-seen', 'true'); } catch { /* storage disabled */ }
    const settings = {
      wallpaperEnabled: false, launchAtLogin: false, targetMonitorId: null, density: 'balanced',
      weekStart: 'monday', dateFormat: 'localized', showWeekends: true,
      calendarEnabled: true, matrixEnabled: true, notesEnabled: true
    };
    const calls: string[] = [];
    Reflect.set(window, '__calls', calls);
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string) => {
          calls.push(command);
          if (command === 'get_app_settings') return settings;
          if (command === 'get_task_workspace_snapshot') return { tasks: [], lanes: [], tags: [], defaultLaneId: null, viewPreferences: {} };
          if (command === 'list_events_in_range' || command === 'list_tasks' || command === 'list_notes') return [];
          if (command === 'check_for_update') return {
            currentVersion: '0.2.0', latestVersion: 'v0.2.23', updateAvailable: true,
            releaseNotes: 'notes', releaseUrl: 'https://github.com/RESA100x/RESA/releases', publishedAt: '2026-11-22T00:00:00Z'
          };
          if (command === 'install_update') return new Promise(() => undefined);
          throw new Error(`Unexpected command: ${command}`);
        },
        transformCallback: (callback: (payload: unknown) => void) => {
          const id = Math.floor(Math.random() * 2 ** 32);
          Reflect.set(window, `_${id}`, callback);
          return id;
        }
      }
    });
  });
  await page.goto('/');
  await page.locator('.about-button').click();
  const dialog = page.locator('.about-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.about-version__download')).toBeVisible();
  await expect(dialog.locator('.about-version__link')).toBeVisible();
  const countChecks = async () => (await page.evaluate(() => Reflect.get(window, '__calls') as string[])).filter((command) => command === 'check_for_update').length;
  const before = await countChecks();
  await dialog.locator('.about-version__recheck').click();
  await expect.poll(countChecks).toBe(before + 1);
  await dialog.locator('.about-version__download').click();
  await expect(dialog.getByRole('progressbar')).toBeVisible();
  await expect(dialog.locator('.about-version__download')).toBeDisabled();
  const calls = await page.evaluate(() => Reflect.get(window, '__calls') as string[]);
  expect(calls).toContain('install_update');
});
