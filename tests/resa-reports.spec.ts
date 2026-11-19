import { expect, test } from '@playwright/test';

// The report block is the second one-cell launcher. The spec pins what the
// modal promises: real numbers from the task rows, a chart that fits, the
// range buttons actually re-query, and no horizontal overflow at any width.

// The backend always answers with a continuous daily series; the fixture does
// the same, otherwise a missing day would also hide a week boundary.
const DAYS = Array.from({ length: 30 }, (_, index) => {
  const date = new Date(2026, 9, 21 + index);
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return {
    date: iso,
    created: index % 4 === 0 ? 2 : index % 3 === 0 ? 1 : 0,
    completed: index % 5 === 0 ? 1 : 0,
    focusSeconds: index % 6 === 0 ? 900 : 0
  };
});

const REPORT = {
  days: DAYS,
  totals: {
    created: 9,
    completed: 8,
    open: 4,
    overdue: 2,
    archived: 1,
    completionRate: 0.6667,
    averageCloseDays: 2.5,
    medianCloseDays: 2
  },
  quadrants: [
    { priority: 'important_urgent', open: 2, completed: 4 },
    { priority: 'important_not_urgent', open: 1, completed: 2 },
    { priority: 'not_important_urgent', open: 1, completed: 1 },
    { priority: 'not_important_not_urgent', open: 0, completed: 1 }
  ],
  lanes: [
    { id: 'lane-1', name: 'فنی واجرایی', open: 2, completed: 5 },
    { id: 'lane-2', name: 'مالی و اداری', open: 2, completed: 3 }
  ],
  generatedAt: '2026-11-19T08:00:00.000Z'
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('nowly:onboarding-seen', 'true'); } catch { /* storage disabled */ }
    const settings = {
      wallpaperEnabled: false, launchAtLogin: false, targetMonitorId: null,
      density: 'balanced', weekStart: 'monday', dateFormat: 'localized',
      showWeekends: true, calendarEnabled: true, matrixEnabled: true, notesEnabled: true
    };
    Reflect.set(window, '__moduleLayout__', [{ id: 'reports', x: 0, y: 0, w: 1, h: 1 }]);
    Reflect.set(window, '__reportCalls__', []);
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
          if (command === 'get_time_settings') return { clocks: [], focus: {}, alarms: [] };
          if (command === 'list_alarms') return [];
          if (command === 'get_task_report') {
            const calls = Reflect.get(window, '__reportCalls__') as unknown[];
            calls.push(args.days);
            return Reflect.get(window, '__report__');
          }
          return 'ok';
        },
        transformCallback: (callback: (payload: unknown) => void) => {
          Reflect.set(window, '_1', callback);
          return 1;
        }
      }
    });
    Reflect.set(window, '__report__', null);
  });
  await page.addInitScript((report) => {
    Reflect.set(window, '__report__', report);
  }, JSON.parse(JSON.stringify(REPORT)));
  await page.goto('/');
});

test('the report tile is one grid cell and shows the open count', async ({ page }) => {
  const tile = page.getByTestId('reports-tile');
  await expect(tile).toBeVisible();
  await expect(tile.locator('.reports-tile__badge')).toHaveText('4');

  const metrics = await page.evaluate(() => {
    const grid = document.querySelector('.module-grid') as HTMLElement | null;
    const frame = document.querySelector('[data-widget-id="reports"]') as HTMLElement | null;
    if (!frame || !grid) return null;
    const gridBox = grid.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0;
    const cell = (gridBox.width - gap * 11) / 12;
    const box = frame.getBoundingClientRect();
    return { width: box.width, height: box.height, cell, cellH: (gridBox.height - gap * 7) / 8 };
  });
  expect(metrics).not.toBeNull();
  const measured = metrics as { width: number; height: number; cell: number; cellH: number };
  expect(Math.abs(measured.width - measured.cell)).toBeLessThan(1.5);
  expect(Math.abs(measured.height - measured.cellH)).toBeLessThan(1.5);
});

test('the dialog shows totals, chart, quadrants and lanes', async ({ page }) => {
  await page.getByTestId('reports-tile').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const kpis = dialog.locator('.reports-kpi');
  await expect(kpis).toHaveCount(6);
  await expect(kpis.nth(0).locator('.reports-kpi__value')).toHaveText('9');
  await expect(kpis.nth(1).locator('.reports-kpi__value')).toHaveText('8');
  await expect(kpis.nth(3).locator('.reports-kpi__value')).toHaveText('2');
  await expect(kpis.nth(4).locator('.reports-kpi__value')).toHaveText('67%');

  await expect(dialog.locator('.reports-chart__week')).toHaveCount(5);
  await expect(dialog.locator('.reports-row')).toHaveCount(6);
  await expect(dialog.locator('.reports-rows').first().locator('.reports-row')).toHaveCount(4);
  await expect(dialog).toContainText('فنی واجرایی');

  const overflow = await page.evaluate(() => {
    const body = document.querySelector('.reports-dialog .good-dialog__body') as HTMLElement | null;
    return body ? body.scrollWidth - body.clientWidth : -1;
  });
  expect(overflow).toBeLessThanOrEqual(1);
});

test('the range buttons re-query the backend', async ({ page }) => {
  await page.getByTestId('reports-tile').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: '90 天' }).click();
  await expect
    .poll(() => page.evaluate(() => (Reflect.get(window, '__reportCalls__') as number[]).at(-1)))
    .toBe(90);
});
