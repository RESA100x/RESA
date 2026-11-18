import { expect, test } from '@playwright/test';

// The three workspace additions the RESA fork ships: a global command palette,
// recurring tasks and one-click backups. The spec stubs the Tauri bridge so the
// browser preview can drive them, and asserts each one is actually reachable
// from the UI rather than only from a shortcut.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 6, 23, 9, 42));
  await page.addInitScript(() => {
    try { localStorage.setItem('nowly:onboarding-seen', 'true'); } catch { /* storage disabled */ }
    const now = '2026-07-23T09:42:00.000Z';
    const lanes = [
      { id:'lane-todo', name:'待处理', color:'#4FC9DA', position:0, createdAt:now, updatedAt:now },
      { id:'lane-doing', name:'进行中', color:'#E8C444', position:1, createdAt:now, updatedAt:now },
      { id:'lane-done', name:'已完成', color:'#B8D935', position:2, createdAt:now, updatedAt:now }
    ];
    let tasks: any[] = [
      {
        id:'t1', title:'发布周报', description:'汇总本周数据', priority:'important_urgent', dueDate:'2026-07-23',
        completed:false, laneId:'lane-todo', boardPosition:0, tagIds:[], steps:[], linkedEventId:null,
        recurrence:{ freq:'weekly', interval:1, byDay:['MO'], end:{ kind:'never' } }, recurrenceParentId:null,
        createdAt:now, updatedAt:now
      },
      {
        id:'t2', title:'买水果', description:'', priority:'not_important_not_urgent', dueDate:null,
        completed:false, laneId:'lane-todo', boardPosition:1, tagIds:[], steps:[], linkedEventId:null,
        recurrence:null, recurrenceParentId:null, createdAt:now, updatedAt:now
      }
    ];
    const snapshot = () => ({ tasks, lanes, tags:[], defaultLaneId:'lane-todo', viewPreferences:{} });
    const settings = {
      wallpaperEnabled:false, launchAtLogin:false, targetMonitorId:null, density:'balanced',
      weekStart:'monday', dateFormat:'localized', showWeekends:true,
      calendarEnabled:true, matrixEnabled:true, notesEnabled:true
    };
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
      invoke: async (command: string, args: any = {}) => {
        if (command === 'list_events_in_range') return [];
        if (command === 'list_notes') return [];
        if (command === 'get_app_settings') return settings;
        if (command === 'get_task_workspace_snapshot') return snapshot();
        if (command === 'search_all') {
          const query = String(args.query ?? '').trim().toLowerCase();
          if (!query) return [];
          return tasks
            .filter((task) => String(task.title).toLowerCase().includes(query) || String(task.description).toLowerCase().includes(query))
            .map((task) => ({ kind:'task', id:task.id, title:task.title, snippet:task.description, date:task.dueDate ?? null }));
        }
        if (command === 'update_task') {
          const previous = tasks.find((task) => task.id === args.id);
          if (!previous) throw { code:'not_found', message:'未找到该任务。' };
          const updated = { ...previous, ...args.draft, updatedAt:now };
          tasks = tasks.map((task) => task.id === args.id ? updated : task);
          return updated;
        }
        if (command === 'set_task_recurrence') {
          const previous = tasks.find((task) => task.id === args.id);
          if (!previous) throw { code:'not_found', message:'未找到该任务。' };
          const updated = { ...previous, recurrence:args.recurrence ?? null, updatedAt:now };
          tasks = tasks.map((task) => task.id === args.id ? updated : task);
          return updated;
        }
        if (command === 'enter_wallpaper_mode' || command === 'enter_foreground_mode') return 'ok';
        throw new Error(`Unexpected command: ${command}`);
      },
      transformCallback: (callback: (payload: unknown) => void) => {
        const id = Math.floor(Math.random() * 2 ** 32);
        Reflect.set(window, `_${id}`, callback);
        return id;
      }
    }});
  });
  await page.goto('/');
});

test('the topbar surfaces the command palette and it searches the workspace', async ({ page }) => {
  const trigger = page.getByRole('button', { name:'全局搜索', exact:true });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const palette = page.getByRole('dialog', { name:'命令面板', exact:true });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole('option', { name:'新建任务' })).toBeVisible();

  await page.getByRole('combobox', { name:'搜索任务、日程或便签…' }).fill('发布');
  await expect(palette.getByRole('option', { name:/发布周报/ })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});

test('Ctrl+K opens the palette without touching the pointer', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name:'命令面板', exact:true })).toBeVisible();
});

test('a recurring task shows a repeat badge and an editable rule', async ({ page }) => {
  await expect(page.getByText('重复任务')).toBeVisible();

  await page.getByRole('button', { name:'编辑任务：买水果' }).click();
  const dialog = page.getByRole('dialog', { name:'编辑任务', exact:true });
  await expect(dialog.getByRole('combobox', { name:'重复' })).toBeVisible();

  await dialog.getByRole('combobox', { name:'重复' }).click();
  await page.getByRole('option', { name:'每周' }).click();
  await expect(dialog.getByRole('combobox', { name:'重复' })).toContainText('每周');
  await expect(dialog.getByText('完成后会自动生成下一个任务。')).toBeVisible();
  await dialog.getByRole('button', { name:'保存任务' }).click();

  // The saved task keeps the rule, so its row now carries the repeat badge too.
  await expect(page.getByRole('button', { name:'编辑任务：买水果' })).toBeVisible();
  await expect(page.getByText('重复任务')).toHaveCount(2);
});

test('settings exposes backup and restore in the data tab', async ({ page }) => {
  await page.getByRole('button', { name:'打开设置' }).click();
  const dialog = page.getByRole('dialog', { name:'设置', exact:true });
  await dialog.getByRole('tab', { name:'数据' }).click();
  await expect(dialog.getByRole('button', { name:'创建备份' })).toBeVisible();
  await expect(dialog.getByRole('button', { name:'还原备份' })).toBeVisible();
});
