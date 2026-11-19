import { expect, test } from '@playwright/test';

// The phone book is the "one-cell launcher": a 1x1 block whose whole job is to
// open a modal. The spec pins the promises of that shape — the tile is really
// one grid cell, clicking it opens the searchable directory, and the directory
// answers the three questions it exists for: who is this, what is their
// extension, and who is in this group.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('nowly:onboarding-seen', 'true'); } catch { /* storage disabled */ }
    const now = new Date().toISOString();
    const contacts = [
      {
        id: 'c1', name: 'رضا احمدی', phone: '۰۹۱۲ ۳۴۵ ۶۷۸۹', extension: '۱۰۱۲',
        organization: 'فناوری اطلاعات', jobTitle: 'کارشناس شبکه', email: 'reza@company.ir',
        address: 'تهران، خیابان آزادی', birthday: '1990-05-12', categoryId: 'g1',
        isInternal: true, photo: '', note: 'شمارهٔ دفتر', createdAt: now, updatedAt: now
      },
      {
        id: 'c2', name: 'مینا رضایی', phone: '021-88991122', extension: '',
        organization: '', jobTitle: '', email: '', address: '', birthday: '',
        categoryId: 'g2', isInternal: false, photo: '', note: '', createdAt: now, updatedAt: now
      },
      {
        id: 'c3', name: 'Alex Morgan', phone: '+49 30 1234', extension: '',
        organization: 'Berlin office', jobTitle: '', email: '', address: '', birthday: '',
        categoryId: null, isInternal: false, photo: '', note: 'Berlin office',
        nickname: 'Alex', roles: ['contractor'], contractStatus: 'active',
        createdAt: now, updatedAt: now
      }
    ];
    const contactCategories = [
      { id: 'g1', name: 'همکاران', color: '#4FC9DA', position: 0, createdAt: now, updatedAt: now },
      { id: 'g2', name: 'خانواده', color: '#F06445', position: 1, createdAt: now, updatedAt: now }
    ];
    const settings = {
      wallpaperEnabled: false, launchAtLogin: false, targetMonitorId: null,
      density: 'balanced', weekStart: 'monday', dateFormat: 'localized',
      showWeekends: true, calendarEnabled: true, matrixEnabled: true, notesEnabled: true
    };
    Reflect.set(window, '__moduleLayout__', [{ id: 'phonebook', x: 0, y: 0, w: 1, h: 1 }]);
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
          if (command === 'list_contacts') return contacts;
          if (command === 'create_contact') {
            const draft = args.draft as Record<string, unknown>;
            const created = { ...draft, id: `c${contacts.length + 1}`, createdAt: now, updatedAt: now };
            contacts.push(created as (typeof contacts)[number]);
            return created;
          }
          if (command === 'list_contact_categories') return contactCategories;
          if (command === 'create_contact_category') {
            const draft = args.draft as Record<string, unknown>;
            const created = { ...draft, id: `g${contactCategories.length + 1}`, position: contactCategories.length, createdAt: now, updatedAt: now };
            contactCategories.push(created as (typeof contactCategories)[number]);
            return created;
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

test('the tile is exactly one grid cell', async ({ page }) => {
  const tile = page.getByTestId('phonebook-tile');
  await expect(tile).toBeVisible();

  const metrics = await page.evaluate(() => {
    const grid = document.querySelector('.module-grid');
    const frame = document.querySelector('[data-widget-id="phonebook"]');
    if (!grid || !frame) return null;
    const gridBox = grid.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0;
    const cellW = (gridBox.width - gap * 11) / 12;
    const cellH = (gridBox.height - gap * 7) / 8;
    return {
      frame: { w: frameBox.width, h: frameBox.height, x: frameBox.x, y: frameBox.y },
      cell: { w: cellW, h: cellH },
      gridOrigin: { x: gridBox.x, y: gridBox.y }
    };
  });
  expect(metrics).not.toBeNull();
  const { frame, cell, gridOrigin } = metrics!;
  // One column, one row, parked in the first cell.
  expect(Math.abs(frame.w - cell.w)).toBeLessThan(1.5);
  expect(Math.abs(frame.h - cell.h)).toBeLessThan(1.5);
  expect(Math.abs(frame.x - gridOrigin.x)).toBeLessThan(2);
  expect(Math.abs(frame.y - gridOrigin.y)).toBeLessThan(2);

  // The block is the icon now: no caption under it, so the name lives in the
  // accessible label. The corner badge still carries the count.
  await expect(tile).toHaveAccessibleName(/电话簿/);
  await expect(tile).toContainText('3');
});

test('clicking the tile opens the searchable phone book', async ({ page }) => {
  await page.getByTestId('phonebook-tile').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.phonebook-row')).toHaveCount(3);

  const search = page.getByRole('searchbox', { name: '搜索联系人' });
  await expect(search).toBeFocused();

  // Latin digits find a number saved with Persian ones, and the separators
  // inside a number are ignored on both sides.
  await search.fill('0912345');
  await expect(dialog.locator('.phonebook-row')).toHaveCount(1);
  await expect(dialog.locator('.phonebook-row')).toContainText('رضا احمدی');

  // The directory fields are searchable, not just the name and the number.
  await search.fill('شبکه');
  await expect(dialog.locator('.phonebook-row')).toHaveCount(1);
  await expect(dialog.locator('.phonebook-row')).toContainText('رضا احمدی');

  await search.fill('minaa');
  await expect(dialog.getByText('没有匹配「minaa」的联系人。')).toBeVisible();

  await search.fill('');
  await expect(dialog.locator('.phonebook-row')).toHaveCount(3);
});

test('the "colleagues" tab lists extensions on their own', async ({ page }) => {
  await page.getByTestId('phonebook-tile').click();
  const dialog = page.getByRole('dialog');

  await dialog.getByRole('tab', { name: /单位内部/ }).click();
  await expect(dialog.locator('.phonebook-row')).toHaveCount(1);
  await expect(dialog.locator('.phonebook-row')).toContainText('رضا احمدی');
  await expect(dialog.locator('.phonebook-row')).toContainText('分机 ۱۰۱۲');
  // The row itself carries the title and the organisation, and the bulk
  // "copy all extensions" button is gone from this tab.
  await expect(dialog.locator('.phonebook-row')).toContainText('کارشناس شبکه');
  await expect(dialog.locator('.phonebook-row')).toContainText('فناوری اطلاعات');
  await expect(dialog.getByRole('button', { name: '复制全部内线' })).toHaveCount(0);
});

test('the "groups" tab is a manager, and a group filters the list', async ({ page }) => {
  await page.getByTestId('phonebook-tile').click();
  const dialog = page.getByRole('dialog');

  // Group chips filter the flat list.
  await dialog.getByRole('button', { name: /همکاران/ }).click();
  await expect(dialog.locator('.phonebook-row')).toHaveCount(1);
  await expect(dialog.locator('.phonebook-row')).toContainText('رضا احمدی');

  await dialog.getByRole('tab', { name: '分组' }).click();
  await expect(dialog.getByTestId('phonebook-group-g1')).toContainText('همکاران');
  await expect(dialog.getByTestId('phonebook-group-g2')).toContainText('خانواده');

  await dialog.getByRole('button', { name: '新建分组' }).click();
  await dialog.getByPlaceholder('分类名称').fill('دوستانه');
  await dialog.getByRole('button', { name: '新增分类' }).click();
  await expect(dialog.getByText('دوستانه')).toBeVisible();

  const stored = await page.evaluate(() => {
    const bridge = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: (command: string) => Promise<unknown> };
    return bridge.invoke('list_contact_categories');
  });
  expect((stored as Array<{ name: string }>).map((row) => row.name)).toContain('دوستانه');
});

test('a contact added through the modal is stored with its extension', async ({ page }) => {
  await page.getByTestId('phonebook-tile').click();
  await page.getByRole('button', { name: '添加联系人' }).first().click();
  // Exact names: "电话" is also a substring of the dialog label "电话簿".
  await page.getByRole('textbox', { name: '姓名', exact: true }).fill('سارا کریمی');
  // "Works here" is a decision taken on the identity tab, and it is what makes
  // the organisation tab exist at all.
  await page.getByLabel('是本单位的同事').check();
  await page.getByRole('tab', { name: '组织信息' }).click();
  await page.getByRole('textbox', { name: '职务', exact: true }).fill('کارشناس شبکه');
  // Every channel — including the extension — lives on the channels tab.
  await page.getByRole('tab', { name: '联系方式' }).click();
  await page.getByRole('textbox', { name: '电话', exact: true }).fill('021-2233');
  await page.getByRole('textbox', { name: '分机', exact: true }).fill('۱۰۱۳');
  await page.getByRole('button', { name: '保存联系人' }).click();

  await expect(page.getByRole('dialog').locator('.phonebook-row')).toHaveCount(4);
  await expect(page.getByRole('dialog').getByText('سارا کریمی')).toBeVisible();

  const stored = await page.evaluate(() => {
    const bridge = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: (command: string) => Promise<unknown> };
    return bridge.invoke('list_contacts');
  });
  const created = (stored as Array<{ name: string; extension: string }>).find((row) => row.name === 'سارا کریمی');
  expect(created?.extension).toBe('۱۰۱۳');
});

test('the role tabs slice the directory, and an empty slice says so', async ({ page }) => {
  await page.getByTestId('phonebook-tile').click();
  const dialog = page.getByRole('dialog');

  await dialog.getByRole('tab', { name: '承包商' }).click();
  await expect(dialog.locator('.phonebook-row')).toHaveCount(1);
  await expect(dialog.locator('.phonebook-row')).toContainText('Alex Morgan');
  // A contractor is not a colleague, so the internal badge stays off.
  await expect(dialog.locator('.phonebook-row').getByText('内线')).toHaveCount(0);

  await dialog.getByRole('tab', { name: '供应商' }).click();
  await expect(dialog.locator('.phonebook-row')).toHaveCount(0);
  await expect(dialog.getByText('这个视图里还没有人。')).toBeVisible();

  // The personality filter narrows the same list without touching the tabs.
  await dialog.getByRole('tab', { name: '全部' }).click();
  await dialog.getByRole('button', { name: '类型' }).click();
  // The dropdown itself is portalled to the body, outside the dialog.
  await page.getByRole('option', { name: '单位', exact: true }).click();
  await expect(dialog.locator('.phonebook-row')).toHaveCount(0);
  await dialog.getByRole('button', { name: '清除筛选' }).click();
  await expect(dialog.locator('.phonebook-row')).toHaveCount(3);
});

test('a contact can carry a picture, which is drawn in the list', async ({ page }) => {
  await page.getByTestId('phonebook-tile').click();
  await page.getByRole('button', { name: '添加联系人' }).first().click();
  await page.getByRole('textbox', { name: '姓名', exact: true }).fill('سارا کریمی');

  // A real 16x16 PNG handed to the hidden file input, the way the picker
  // receives it. It has to decode for real: the picker draws it on a canvas.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAIUlEQVR4nGOw2VKBFd3BgRhGNdBGQ1QFVnQHBxrVQBMNAMhFixBLloSVAAAAAElFTkSuQmCC',
    'base64'
  );
  await page.locator('.phonebook-photo input[type="file"]').setInputFiles({
    name: 'sara.png',
    mimeType: 'image/png',
    buffer: png
  });
  // The picker must accept the file and swap in a preview.
  await expect(page.locator('.phonebook-photo__frame img')).toBeVisible();

  // A contact without a single channel cannot be saved, so the picture test
  // hands over a phone number the way a real visitor would.
  await page.getByRole('tab', { name: '联系方式' }).click();
  await page.getByRole('textbox', { name: '电话', exact: true }).fill('021-5566');
  await page.getByRole('button', { name: '保存联系人' }).click();
  await expect(page.getByRole('dialog').locator('.phonebook-row')).toHaveCount(4);

  const stored = await page.evaluate(() => {
    const bridge = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: (command: string) => Promise<unknown> };
    return bridge.invoke('list_contacts');
  });
  const created = (stored as Array<{ name: string; photo: string }>).find((row) => row.name === 'سارا کریمی');
  expect(created?.photo).toMatch(/^data:image\/jpeg;base64,/);
});

test('the desktop face is a tile with no rows on it', async ({ page }) => {
  await expect(page.getByTestId('phonebook-tile')).toBeVisible();
  await expect(page.locator('.phonebook-row')).toHaveCount(0);
});
