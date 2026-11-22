import { expect, test, type Page } from '@playwright/test';

// The library is both shapes at once: a 1x1 launcher tile and, when the cell is
// widened, a slideshow of the shelf. These specs pin the promises the user
// asked for — add a book, see it on the shelf, open it, finish it — and the
// resize-driven switch between the tile and the spotlight.

type BookRow = Record<string, unknown>;

function seed(page: Page, layout: Array<{ id: string; x: number; y: number; w: number; h: number }>) {
  return page.addInitScript((initialLayout) => {
    try {
      localStorage.setItem('nowly:onboarding-seen', 'true');
      localStorage.setItem('nowly.language', 'fa');
    } catch {
      /* storage disabled */
    }
    const now = new Date().toISOString();
    const books: BookRow[] = [];
    const settings = {
      wallpaperEnabled: false, launchAtLogin: false, targetMonitorId: null,
      density: 'balanced', weekStart: 'monday', dateFormat: 'localized',
      showWeekends: true, calendarEnabled: true, matrixEnabled: true, notesEnabled: true
    };
    Reflect.set(window, '__moduleLayout__', initialLayout);
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
          if (command === 'list_books') return books;
          if (command === 'create_book') {
            const draft = args.draft as BookRow;
            const created = { ...draft, id: `b${books.length + 1}`, createdAt: now, updatedAt: now };
            books.push(created);
            return created;
          }
          if (command === 'update_book') {
            const index = books.findIndex((book) => book.id === args.id);
            const updated = { ...books[index], ...(args.draft as BookRow), updatedAt: now };
            books[index] = updated;
            return updated;
          }
          if (command === 'delete_book') {
            const index = books.findIndex((book) => book.id === args.id);
            if (index >= 0) books.splice(index, 1);
            return null;
          }
          if (command === 'read_book_cover') {
            const book = books.find((row) => row.id === args.id);
            return typeof book?.cover === 'string' && book.cover.startsWith('data:image/')
              ? book.cover
              : null;
          }
          return 'ok';
        },
        transformCallback: (callback: (payload: unknown) => void) => {
          const id = 1;
          Reflect.set(window, `_${id}`, callback);
          return id;
        }
      }
    });
  }, layout);
}

test('the 1x1 cell is a launcher tile that opens the shelf', async ({ page }) => {
  await seed(page, [{ id: 'library', x: 0, y: 0, w: 1, h: 1 }]);
  await page.goto('/');

  const tile = page.getByTestId('library-tile');
  await expect(tile).toBeVisible();
  await expect(tile).toHaveAccessibleName(/کتابخانه/);
  await expect(page.getByTestId('book-spotlight')).toHaveCount(0);

  await tile.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('قفسهٔ شما خالی است. اولین کتاب را اضافه کنید.')).toBeVisible();
});

test('a book added through the form lands on the shelf', async ({ page }) => {
  await seed(page, [{ id: 'library', x: 0, y: 0, w: 1, h: 1 }]);
  await page.goto('/');

  await page.getByTestId('library-tile').click();
  await page.getByRole('button', { name: 'افزودن کتاب' }).click();

  await page.getByRole('textbox', { name: 'عنوان' }).fill('کیمیاگر');
  await page.getByRole('textbox', { name: 'نویسنده' }).fill('پائولو کوئیلو');
  await page.getByRole('textbox', { name: 'معرفی‌کننده' }).fill('سارا');
  await page.getByRole('button', { name: 'ذخیره', exact: true }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.library-card')).toHaveCount(1);
  await expect(dialog.locator('.library-card')).toContainText('کیمیاگر');

  const stored = await page.evaluate(() => {
    const bridge = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: (command: string) => Promise<unknown> };
    return bridge.invoke('list_books');
  });
  const created = (stored as Array<{ title: string; author: string; recommender: string }>)[0];
  expect(created.title).toBe('کیمیاگر');
  expect(created.author).toBe('پائولو کوئیلو');
  expect(created.recommender).toBe('سارا');
});

test('a widened cell becomes the shelf slideshow', async ({ page }) => {
  await seed(page, [{ id: 'library', x: 0, y: 0, w: 5, h: 3 }]);
  await page.goto('/');

  await expect(page.getByTestId('book-spotlight')).toHaveCount(0);
  await expect(page.getByTestId('library-tile')).toBeVisible();

  // Add a book so the spotlight has something to show, then the wide cell
  // switches from the tile to the slideshow on its own.
  await page.getByTestId('library-tile').click();
  await page.getByRole('button', { name: 'افزودن کتاب' }).click();
  await page.getByRole('textbox', { name: 'عنوان' }).fill('شازده کوچولو');
  await page.getByRole('button', { name: 'ذخیره', exact: true }).click();
  await page.getByRole('button', { name: 'بستن' }).last().click();

  await expect(page.getByTestId('book-spotlight')).toBeVisible();
  await expect(page.getByTestId('book-spotlight')).toContainText('شازده کوچولو');
});

test('finishing a book from its card updates the status', async ({ page }) => {
  await seed(page, [{ id: 'library', x: 0, y: 0, w: 1, h: 1 }]);
  await page.goto('/');

  await page.getByTestId('library-tile').click();
  await page.getByRole('button', { name: 'افزودن کتاب' }).click();
  await page.getByRole('textbox', { name: 'عنوان' }).fill('اثر مرکب');
  await page.getByRole('button', { name: 'ذخیره', exact: true }).click();

  await page.locator('.library-card').click();
  const card = page.getByRole('dialog').last();
  await expect(card).toContainText('اثر مرکب');
  await card.getByRole('button', { name: 'علامت‌گذاری به‌عنوان تمام‌شده' }).click();
  await expect(card.locator('.library-chip--read')).toHaveText('تمام‌شده');

  const stored = await page.evaluate(() => {
    const bridge = Reflect.get(window, '__TAURI_INTERNALS__') as { invoke: (command: string) => Promise<unknown> };
    return bridge.invoke('list_books');
  });
  expect((stored as Array<{ status: string; finishedAt: string | null }>)[0].status).toBe('read');
});
