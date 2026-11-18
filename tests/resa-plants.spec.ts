import { expect, test } from '@playwright/test';

// The watering reminder module. The spec stubs the Tauri bridge with one
// overdue monstera and asserts the three promises of the module: the card shows
// the plant by name, the illustration reports how wilted it is, and pressing
// the watering button both records the watering and lets the plant recover.

const MONSTERA = '龟背竹';
const NEEDS_WATER = '需要浇水';
const HEALTHY = '健康';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('nowly:onboarding-seen', 'true'); } catch { /* storage disabled */ }
    const DAY = 86_400_000;
    const now = new Date();
    const plants = [
      {
        id: 'plant-monstera',
        name: 'Dry one',
        species: 'monstera',
        wateringIntervalDays: 5,
        lastWateredAt: new Date(now.getTime() - 20 * DAY).toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      }
    ];
    const settings = {
      wallpaperEnabled: false, launchAtLogin: false, targetMonitorId: null,
      density: 'balanced', weekStart: 'monday', dateFormat: 'localized',
      showWeekends: true, calendarEnabled: true, matrixEnabled: true, notesEnabled: true
    };
    Reflect.set(window, '__moduleLayout__', [{ id: 'plants', x: 0, y: 0, w: 5, h: 5 }]);
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          if (command === 'get_app_settings') return settings;
          if (command === 'list_events_in_range') return [];
          if (command === 'list_notes') return [];
          if (command === 'list_tasks') return [];
          if (command === 'list_custom_templates') return [];
          if (command === 'list_extensions') return [];
          if (command === 'list_module_layout') return Reflect.get(window, '__moduleLayout__');
          if (command === 'save_module_layout') {
            Reflect.set(window, '__moduleLayout__', args.layout);
            return args.layout;
          }
          if (command === 'list_plants') return plants;
          if (command === 'water_plant') {
            const target = plants.find((item) => item.id === args.id);
            if (!target) throw { code: 'not_found', message: 'nope' };
            target.lastWateredAt = new Date().toISOString();
            return target;
          }
          if (command === 'get_time_settings') return { clocks: [], focus: {}, alarms: [] };
          if (command === 'list_alarms') return [];
          return 'ok';
        },
        transformCallback: (callback: (payload: unknown) => void) => {
          const id = 1;
          Reflect.set(window, `_${id}`, callback);
          return id;
        }
      }
    });
  });
  await page.goto('/');
});

test('an overdue plant is drawn wilted and named on its card', async ({ page }) => {
  await expect(page.getByText('Dry one')).toBeVisible();
  await expect(page.getByText(MONSTERA).first()).toBeVisible();
  await expect(page.getByText(NEEDS_WATER)).toBeVisible();
  await expect(page.getByText('1 盆植物需要浇水')).toBeVisible();

  const svg = page.locator('.plants-card__illustration');
  await expect(svg).toHaveAttribute('data-plant-species', 'monstera');
  const wilt = Number(await svg.getAttribute('data-wilt'));
  expect(wilt).toBeGreaterThan(0.8);
});

test('watering the plant records it and the plant recovers', async ({ page }) => {
  const svg = page.locator('.plants-card__illustration');
  await expect(svg).toBeVisible();

  await page.evaluate(() => {
    const bridge = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: (command: string, args?: unknown) => Promise<unknown> };
    const original = bridge.invoke.bind(bridge);
    Reflect.set(window, '__watered__', []);
    bridge.invoke = async (command: string, args?: unknown) => {
      if (command === 'water_plant') {
        (Reflect.get(window, '__watered__') as string[]).push(String((args as { id?: string })?.id));
      }
      return original(command, args);
    };
  });

  await page.getByRole('button', { name: '把 Dry one 标记为已浇水' }).click();

  await expect(page.getByText(HEALTHY)).toBeVisible();
  await expect.poll(async () => Number(await svg.getAttribute('data-wilt'))).toBeLessThan(0.05);
  expect(await page.evaluate(() => Reflect.get(window, '__watered__'))).toEqual(['plant-monstera']);
});
