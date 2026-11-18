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
    // `addInitScript` replays on every reload, so anything a test creates has to
    // survive in storage to behave like the real database.
    try {
      plants.push(...JSON.parse(localStorage.getItem('__resa_extra_plants__') ?? '[]'));
    } catch { /* ignore a corrupt fixture */ }
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
          if (command === 'create_plant') {
            const draft = args.draft as Record<string, unknown>;
            const created = { ...draft, id: `plant-${plants.length + 1}`, createdAt: now.toISOString(), updatedAt: now.toISOString() };
            plants.push(created as (typeof plants)[number]);
            return created;
          }
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

test('the slide view walks the plants one at a time', async ({ page }) => {
  // The stubbed bridge is rebuilt from scratch on every load, so a plant that has
  // to survive the reload below goes into storage instead of a one-off `invoke`.
  await page.evaluate(() => {
    const now = new Date().toISOString();
    localStorage.setItem('__resa_extra_plants__', JSON.stringify([
      {
        id: 'plant-yucca',
        name: 'Happy yucca',
        species: 'yucca',
        wateringIntervalDays: 14,
        lastWateredAt: now,
        createdAt: now,
        updatedAt: now
      }
    ]));
  });
  await page.reload();

  await page.getByRole('button', { name: '幻灯片视图' }).click();
  const spotlight = page.getByTestId('plants-spotlight');
  await expect(spotlight).toBeVisible();
  // Thirstiest first, so the overdue monstera owns the first slide.
  await expect(spotlight.locator('.plants-spotlight__caption')).toContainText('Dry one');
  await expect(spotlight.locator('.plants-spotlight__slide[data-active="true"]')).toHaveCount(1);
  await expect(page.getByRole('tab')).toHaveCount(2);

  await page.getByRole('button', { name: '下一株植物' }).click();
  await expect(spotlight.locator('.plants-spotlight__caption')).toContainText('Happy yucca');

  await page.getByRole('button', { name: '列表视图' }).click();
  await expect(page.getByTestId('plants-scroll')).toBeVisible();
});
