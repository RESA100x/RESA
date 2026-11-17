import { getSceneLayout, screenshotPath } from './showcase-scenes.mjs';

export const CAPTURE_TIME = '2026-10-15T09:42:00+08:00';
export const CAPTURE_TIMEZONE = 'Asia/Shanghai';

export function captureTimezone(language) {
  return language === 'fa' ? 'Asia/Tehran' : CAPTURE_TIMEZONE;
}

export function createShowcaseFixture(sceneId, language) {
  screenshotPath(sceneId, language);
  const text = (zh, en, fa) => language === 'zh' ? zh : language === 'fa' ? (fa ?? en) : en;
  const stamp = '2026-10-12T00:00:00Z';
  const colors = ['#4FC9DA', '#E8C444', '#B8D935', '#4F55DA'];
  const categories = [text('项目', 'Project', 'پروژه'), text('学习', 'Learning', 'یادگیری'), text('生活', 'Life', 'زندگی')].map((name, position) => ({ id: `category-${position}`, name, color: colors[position], position, createdAt: stamp, updatedAt: stamp }));
  const eventTitles = text(
    ['十月目标梳理', '设计方向讨论', '阅读与摘录', '产品原型评审', '散步与放空', '项目进度同步', '学习小组讨论', '整理调研结论', '发布准备检查', '午间阅读', '每周项目回顾', '下一阶段规划', '知识分享', '月末复盘'],
    ['October goals', 'Design direction', 'Reading and notes', 'Prototype review', 'Walk and recharge', 'Project check-in', 'Study group', 'Research synthesis', 'Release checklist', 'Lunchtime reading', 'Weekly review', 'Next phase planning', 'Knowledge sharing', 'October reflection'],
    ['هدف‌های ماه', 'گفت‌وگو دربارهٔ جهت طراحی', 'خواندن و یادداشت‌برداری', 'بازبینی نمونهٔ اولیه', 'پیاده‌روی و تجدید انرژی', 'هم‌سنجی پروژه', 'جلسهٔ گروه مطالعه', 'جمع‌بندی پژوهش', 'بررسی فهرست انتشار', 'مطالعهٔ ناهار', 'بازبینی هفتگی', 'برنامه‌ریزی مرحلهٔ بعد', 'اشتراک دانش', 'مرور ماه']
  );
  const events = eventTitles.map((title, index) => {
    const day = [2, 5, 7, 9, 11, 13, 14, 15, 16, 18, 20, 22, 26, 29][index];
    const date = `2026-10-${String(day).padStart(2, '0')}`;
    const category = categories[index % categories.length];
    return { id: `event-${index}`, title, startAt: `${date}T02:00:00Z`, endAt: `${date}T03:00:00Z`, allDay: false, category: category.id, color: category.color, note: text('带上整理好的问题，讨论目标、进展与下一步行动。', 'Review prepared questions, agree on the goal and record the next concrete actions.', 'پرسش‌های آماده را مرور کنید، هدف را روشن کنید و قدم‌های بعدی را ثبت کنید.'), reminders: [], recurrence: null, occurrenceStartAt: null, startTz: null, endTz: null, rrule: null, seriesId: null, seriesStartAt: null, isOverridden: false, subscriptionId: null, createdAt: stamp, updatedAt: stamp };
  });
  const lanes = [text('待处理', 'To do', 'در انتظار'), text('进行中', 'In progress', 'در حال انجام'), text('待验收', 'In review', 'در بازبینی')].map((name, position) => ({ id: ['todo', 'doing', 'review'][position], name, color: colors[position], position, createdAt: stamp, updatedAt: stamp }));
  const tags = [text('设计', 'Design', 'طراحی'), text('研究', 'Research', 'پژوهش'), text('计划', 'Planning', 'برنامه‌ریزی')].map((name, index) => ({ id: `tag-${index}`, name, color: colors[index], archivedAt: null, createdAt: stamp, updatedAt: stamp }));
  const taskTitles = text(
    ['梳理发布清单', '准备评审材料', '确认本周里程碑', '整理阅读笔记', '完善产品原型', '撰写设计说明', '验证关键流程', '制定学习计划', '汇总讨论结论', '完成调研摘要', '归档项目资料', '整理灵感清单'],
    ['Outline release checklist', 'Prepare review materials', 'Confirm weekly milestones', 'Organize reading notes', 'Refine product prototype', 'Write design rationale', 'Verify key workflows', 'Plan learning sessions', 'Summarize decisions', 'Complete research digest', 'Archive project resources', 'Collect new ideas'],
    ['تدوین فهرست انتشار', 'آماده‌سازی مواد بازبینی', 'تأیید نقاط عطف هفته', 'مرتب‌سازی یادداشت‌های مطالعه', 'بهبود نمونهٔ اولیهٔ محصول', 'نوشتن توضیح طراحی', 'بررسی مسیرهای کلیدی', 'برنامه‌ریزی جلسات یادگیری', 'جمع‌بندی تصمیم‌ها', 'تکمیل خلاصهٔ پژوهش', 'بایگانی منابع پروژه', 'جمع‌آوری ایده‌های تازه']
  );
  const priorities = ['important_urgent', 'important_not_urgent', 'not_important_urgent', 'not_important_not_urgent'];
  const tasks = taskTitles.map((title, index) => ({ id: `task-${index}`, title, description: text('明确完成标准，记录关键结论，并安排下一步可执行的行动。', 'Define completion criteria, capture the key decisions and schedule a concrete next action.', 'معیار پایان کار را روشن کنید، تصمیم‌های کلیدی را ثبت کنید و یک اقدام مشخص برای قدم بعدی بگذارید.'), priority: priorities[index % 4], dueDate: `2026-10-${String(15 + index).padStart(2, '0')}`, completed: index >= 10, completedAt: index >= 10 ? stamp : null, laneId: lanes[Math.floor(index / 4)].id, boardPosition: index % 4, tagIds: [tags[index % 3].id], steps: [], createdAt: stamp, updatedAt: stamp }));
  const noteRows = text([
    ['本周的三件重要小事', '先完成项目评审，再整理阅读笔记，最后给周末留出空白。每天只选择一件最重要的事，做完后再处理零散任务。'],
    ['项目讨论记录', '目标：让第一次使用更清晰。\n结论：精简入口，保留明确反馈。\n下一步：验证原型并记录观察结果，整理成可供团队复用的检查清单。'],
    ['阅读摘录与思考', '阅读之后，用自己的话解释一个观点，再写下它与当前工作的联系。好的笔记应当帮助下一次行动，而不只是保存原文。'],
    ['学习计划', '周二练习基础概念，周四完成一个小练习，周末用完整案例复习。每次学习后记录一个问题，下次开始时先回答它。'],
    ['设计灵感', '把复杂信息分成清楚的小组，为重要内容保留留白。先检查文字是否准确，再考虑布局；每个操作都应当有明确的结果。'],
    ['周末留白清单', '去公园散步，做一顿简单的饭，读完书架上那一章。留出不被安排的时间，把注意力慢慢带回当下，感受日常生活里的细小变化。']
  ], [
    ['Three things for this week', 'Finish the project review, organize reading notes and leave room for the weekend. Choose one meaningful priority each morning before moving on to smaller tasks.'],
    ['Project discussion notes', 'Goal: make the first visit clearer.\nDecision: simplify entry points and keep feedback explicit.\nNext: validate the prototype and record observations.'],
    ['Reading and reflection', 'Explain one idea in your own words, then connect it to your current work. Useful notes should help you take the next action rather than simply store quotations.'],
    ['Learning plan', 'Practice core concepts on Tuesday, finish a small exercise on Thursday and revisit a complete example over the weekend. Write one question after each session.'],
    ['Design inspiration', 'Group related information and leave space around what matters. Check the wording before the layout. Every action should lead to a clear and understandable result.'],
    ['Room for the weekend', 'Walk through the park, cook something simple and finish the next chapter. Keep some time unscheduled and bring your attention back to the present.']
  ], [
    ['سه کار مهم این هفته', 'اول بازبینی پروژه را تمام کنید، بعد یادداشت‌های مطالعه را مرتب کنید و آخر هفته را خالی بگذارید. هر روز فقط یک کار مهم را انتخاب کنید و بعد سراغ کارهای پراکنده بروید.'],
    ['یادداشت گفت‌وگوی پروژه', 'هدف: اولین تجربهٔ استفاده روشن‌تر شود.\nتصمیم: ورودی‌ها ساده شوند و بازخورد صریح بماند.\nقدم بعدی: نمونهٔ اولیه را بررسی کنید و مشاهدات را ثبت کنید.'],
    ['نقل و اندیشهٔ خوانده‌ها', 'بعد از خواندن، یک ایده را با زبان خودتان توضیح دهید و آن را به کار فعلی‌تان وصل کنید. یادداشت خوب باید به اقدام بعدی کمک کند، نه اینکه فقط متن اصلی را نگه دارد.'],
    ['برنامهٔ یادگیری', 'سه‌شنبه مفاهیم پایه را تمرین کنید، پنجشنبه یک تمرین کوچک را تمام کنید و آخر هفته با یک مثال کامل مرور کنید. بعد از هر جلسه یک پرسش بنویسید.'],
    ['الهام طراحی', 'اطلاعات پیچیده را به گروه‌های روشن تقسیم کنید و برای محتوای مهم فضای خالی بگذارید. اول درستی متن را بررسی کنید، بعد چیدمان را؛ هر عمل باید نتیجهٔ روشنی داشته باشد.'],
    ['فهرست فراغت آخر هفته', 'در پارک قدم بزنید، یک غذای ساده بپزید و فصل بعدی کتاب را تمام کنید. زمانی را بدون برنامه بگذارید و توجه را آرام به لحظهٔ حال برگردانید.']
  ]);
  const notes = noteRows.map(([title, content], index) => ({ id: `note-${index}`, title, content, color: colors[index % 4], pinned: index < 2, styleVariant: index % 9, icon: ['smile', 'cool', 'spark', 'star', 'love', 'heart'][index], createdAt: stamp, updatedAt: stamp }));
  const stickerTexts = text(['专注当下', '先做重要的事', '让想法慢慢生长', '记录 · 思考 · 行动', '留一点时间给自己', '今天也有新的可能'], ['Be here, now', 'Start with what matters', 'Give ideas room to grow', 'Capture · Reflect · Act', 'Leave time for yourself', 'A fresh possibility today'], ['همین حالا، همین‌جا', 'از کار مهم شروع کن', 'به ایده‌ها فرصت رشد بده', 'ثبت · اندیشه · اقدام', 'کمی وقت برای خودت بگذار', 'امروز هم ممکن تازه‌ای هست']);
  const stickerBoard = { version: 1, revision: 0, objects: stickerTexts.map((value, index) => ({ id: `sticker-${index}`, kind: 'text', text: value, x: [70, 100, 80, 120, 80, 100][index], y: 40 + index * 88, width: 600, height: index === 0 ? 84 : 70, fontSize: index === 0 ? 54 : 30, color: ['#211F1C', '#30A6B6', '#716D66'][index % 3], bold: index < 2, italic: false, underline: false, align: 'center', rotation: 0, opacity: 100, locked: false })) };
  const positions = [
    { x: 70, y: 55, width: 430, height: 90, rotation: -6 },
    { x: 70, y: 180, width: 460, height: 70, rotation: 4 },
    { x: 160, y: 275, width: 550, height: 70, rotation: -4 },
    { x: 70, y: 365, width: 580, height: 70, rotation: 3 },
    { x: 90, y: 455, width: 600, height: 70, rotation: -3 },
    { x: 90, y: 525, width: 600, height: 60, rotation: 2 }
  ];
  stickerBoard.objects.forEach((object, index) => {
    Object.assign(object, positions[index]);
    if (index === 0) object.fontSize = language === 'fa' ? 40 : language === 'en' ? 44 : 54;
    if (index === 5) object.fontSize = 26;
    if (index === 1) object.text += ' ✨';
    if (index === 5) object.text += ' 😊';
  });
  stickerBoard.objects.unshift({ id: 'nowly-logo', kind: 'image', assetId: '00000000000000000000000000000001', style: 'original', x: 555, y: 45, width: 160, height: 160, rotation: 8, opacity: 100, locked: false });
  const active = sceneId === 'focus';
  return {
    language, sceneId, layout: getSceneLayout(sceneId), events, categories, notes, stickerBoard,
    taskWorkspace: { tasks, lanes, tags, defaultLaneId: 'todo', viewPreferences: {} },
    settings: { wallpaperEnabled: false, launchAtLogin: false, targetMonitorId: null, density: 'balanced', weekStart: language === 'fa' ? 'saturday' : 'monday', dateFormat: 'localized', showWeekends: true, iconStyle: 'duotone', hideTopbarInWallpaper: true, quickPanelEnabled: false, quickPanelShortcut: 'Ctrl+Space', screenshotShortcut: 'Ctrl+Alt+A', screenshotHistoryShortcut: 'Ctrl+Alt+H', recentColors: [] },
    timeSettings: { displayContent: active ? 'focus' : 'clocks', focusPreferences: { defaultMinutes: 25 }, appearance: { mode: 'digital', layout: 'stacked', hourCycle: 'h23', showSeconds: false, showLabel: true, showDate: language !== 'en', showDifference: language !== 'en', fontMode: 'auto', fontSize: 96 }, clocks: [
      { id: 'shanghai', label: text('上海', 'Shanghai', 'تهران'), timeZone: language === 'fa' ? 'Asia/Tehran' : 'Asia/Shanghai' },
      { id: 'london', label: text('伦敦', 'London', 'لندن'), timeZone: 'Europe/London' },
      { id: 'new-york', label: text('纽约', 'New York', 'نیویورک'), timeZone: 'America/New_York' }
    ] },
    focusSnapshot: { status: active ? 'running' : 'idle', sessionId: active ? 'showcase-focus' : null, plannedSeconds: 1500, remainingSeconds: active ? 1122 : 1500, focusedSeconds: active ? 378 : 0, startedAt: active ? '2026-10-15T01:35:42Z' : null, stageSequence: active ? 1 : 0, stageChangedAt: active ? '2026-10-15T01:35:42Z' : null }
  };
}

// This function is serialized into the browser; keep it free of module dependencies.
export function createFixtureBackend(fixture) {
  let listenerId = 0;
  let stickerBoard = structuredClone(fixture.stickerBoard);
  return async (command, args = {}) => {
    if (command === 'read_sticker_image') {
      if (args.id !== '00000000000000000000000000000001' || !fixture.logoBytes?.length) throw new Error('Missing showcase Nowly logo image');
      return [...fixture.logoBytes];
    }
    if (command === 'save_sticker_board') {
      stickerBoard = structuredClone({ ...args.board, revision: stickerBoard.revision + 1 });
      return structuredClone(stickerBoard);
    }
    const values = {
      get_time_settings: fixture.timeSettings, get_sticker_board: stickerBoard,
      get_app_settings: fixture.settings, get_task_workspace_snapshot: fixture.taskWorkspace,
      list_notes: fixture.notes, list_module_layout: fixture.layout, list_categories: fixture.categories,
      list_tasks: fixture.taskWorkspace.tasks, get_focus_timer_snapshot: fixture.focusSnapshot,
      get_pending_focus_completion: null, check_for_update: null, list_alarms: [], list_calendar_subscriptions: [],
      list_oauth_accounts: [], list_external_events_in_range: [], list_focus_sessions: [], list_attachments: [],
      list_custom_modules: [], list_monitors: []
    };
    if (Object.hasOwn(values, command)) return structuredClone(values[command]);
    if (command === 'list_events_in_range') return structuredClone(fixture.events.filter(event => event.startAt >= args.range.startAt && event.startAt < args.range.endAtExclusive));
    if (command === 'get_focus_statistics') return { totalFocusedSeconds: 3000, completedCount: 2, interruptedCount: 0, completionRate: 1, points: (args.boundaries ?? []).map(boundary => ({ period: boundary.period, focusedSeconds: 0, completedCount: 0, interruptedCount: 0 })) };
    if (command === 'plugin:event|listen') return ++listenerId;
    if (['plugin:event|unlisten', 'plugin:event|emit', 'plugin:event|emit_to'].includes(command)) return null;
    throw new Error(`Unsupported showcase IPC command: ${command}`);
  };
}
