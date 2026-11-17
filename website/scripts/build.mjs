import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { SHOWCASE_SLIDES, screenshotPath } from './showcase-scenes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PAGE_NAMES = ['index', 'download', 'guide', 'support', 'privacy', 'terms', 'data-deletion', 'calendar', 'tasks', 'notes', 'time', 'desktop', 'capture', 'connections'];
const CONFIG_KEYS = ['productName', 'officialDomain', 'supportEmail', 'developerName', 'releasesUrl', 'issuesUrl'];
const SITE_LOCALES = {
  'zh-CN': { prefix: '', content: 'zh.json', lang: 'zh-CN', dir: 'ltr', label: '简体中文', hreflang: 'zh-CN', screenshot: 'zh', slideLabel: 1, slideCaption: 3, captionSuffix: '真实应用界面 · 合成示例数据。' },
  en: { prefix: 'en', content: 'en.json', lang: 'en', dir: 'ltr', label: 'English', hreflang: 'en', screenshot: 'en', slideLabel: 2, slideCaption: 4, captionSuffix: 'Actual app interface · Synthetic example data.' },
  fa: { prefix: 'fa', content: 'fa.json', lang: 'fa', dir: 'rtl', label: 'فارسی', hreflang: 'fa', screenshot: 'fa', slideLabel: 5, slideCaption: 6, captionSuffix: 'رابط واقعی برنامه · داده‌های نمونهٔ ساختگی.' }
};
const HOME_HEADINGS = {
  'zh-CN': { bring: '把工作整理到一个桌面', fits: '属于你的工作方式', faq: '常见问题', showcaseLabel: '模块截图展示', choose: '选择模块截图', skip: '跳到正文', nav: '主导航', legal: '法律与支持', arrow: '→' },
  en: { bring: 'Bring your work together', fits: 'A workspace that fits you', faq: 'Common questions', showcaseLabel: 'Module screenshots', choose: 'Choose module screenshot', skip: 'Skip to content', nav: 'Main navigation', legal: 'Legal and support', arrow: '→' },
  fa: { bring: 'کارهایت را در یکجا جمع کن', fits: 'فضای کاری‌ای که با تو جور است', faq: 'پرسش‌های رایج', showcaseLabel: 'نمایش ماژول‌ها', choose: 'انتخاب تصویر ماژول', skip: 'رفتن به محتوا', nav: 'ناوبری اصلی', legal: 'حقوقی و پشتیبانی', arrow: '←' }
};
function localeUrl(locale, page) {
  const prefix = SITE_LOCALES[locale].prefix;
  return `${prefix ? `${prefix}/` : ''}${page}.html`;
}
function relativeLocaleUrl(fromPrefix, to, page) {
  const depth = fromPrefix ? 1 : 0;
  return `${'../'.repeat(depth)}${localeUrl(to, page)}`;
}
// The `zh-CN/` tree is kept as a legacy alias of the root Chinese pages.
const LOCALE_OUTPUTS = [
  { locale: 'zh-CN', prefix: '' },
  { locale: 'en', prefix: 'en' },
  { locale: 'fa', prefix: 'fa' },
  { locale: 'zh-CN', prefix: 'zh-CN' }
];
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

// The release repository is shared with the app (`../resa.config.json`): when it
// is set, the site's download and issues links follow it, so pointing the app at
// your own repository also points the site there. `website/config.json` stays
// authoritative for everything else and is the fallback for these two URLs.
async function readSharedRepo() {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(ROOT, '..', 'resa.config.json'), 'utf8'));
    return typeof parsed.repo === 'string' ? parsed.repo.trim() : '';
  } catch {
    return '';
  }
}
export async function readPublicConfig() {
  const config = JSON.parse(await fs.readFile(path.join(ROOT, 'config.json'), 'utf8'));
  const repo = (process.env.RESA_REPO ?? '').trim() || await readSharedRepo();
  return repo
    ? { ...config, releasesUrl: `https://github.com/${repo}/releases`, issuesUrl: `https://github.com/${repo}/issues` }
    : config;
}
function validateConfig(config) {
  if (Object.keys(config).some(key => !CONFIG_KEYS.includes(key)) || CONFIG_KEYS.some(key => typeof config[key] !== 'string' || !config[key].trim() || /REPLACE_BEFORE_DEPLOY|\{\{/i.test(config[key]))) throw new Error('Invalid public configuration');
  for (const key of ['officialDomain', 'releasesUrl', 'issuesUrl']) {
    const url = new URL(config[key]);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Public URLs must use HTTPS without credentials, query or fragment');
  }
  if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(config.supportEmail)) throw new Error('Invalid public configuration email');
}
function pageLink(page) {
  if (!PAGE_NAMES.includes(page)) throw new Error(`Unknown page: ${page}`);
  return `${page}.html`;
}
function textParagraphs(paragraphs) { return paragraphs.map(text => `<p>${escapeHtml(text)}</p>`).join(''); }
function sectionsHtml(sections) {
  return sections.map(section => `<section class="document__section"><h2>${escapeHtml(section.title)}</h2>${textParagraphs(section.paragraphs)}${(section.links ?? []).map(link => `<a class="site__text-link" href="${pageLink(link.page)}">${escapeHtml(link.text)}</a>`).join('')}</section>`).join('');
}
function showcaseHtml(assets, locale) {
  const settings = SITE_LOCALES[locale];
  const headings = HOME_HEADINGS[locale];
  const caption = slide => `${slide[settings.slideCaption]} ${settings.captionSuffix}`;
  return `<section class="hero__showcase" data-showcase role="region" aria-label="${headings.showcaseLabel}"><figure class="hero__figure"><img class="hero__image" src="${assets}/${screenshotPath(SHOWCASE_SLIDES[0][0], settings.screenshot)}" width="1280" height="800" alt="${escapeHtml(caption(SHOWCASE_SLIDES[0]))}"><figcaption>${escapeHtml(caption(SHOWCASE_SLIDES[0]))}</figcaption></figure><div class="hero__controls" data-controls hidden><div class="hero__choices" role="group" aria-label="${headings.choose}">${SHOWCASE_SLIDES.map((slide, i) => `<button type="button" class="hero__choice" data-slide data-src="${assets}/${screenshotPath(slide[0], settings.screenshot)}" data-caption="${escapeHtml(caption(slide))}" aria-pressed="${i === 0}">${escapeHtml(slide[settings.slideLabel])}</button>`).join('')}</div></div></section><script type="module" src="${assets}/showcase.js"></script>`;
}
function homeHtml(content, config, assets, locale) {
  const home = content.home;
  const headings = HOME_HEADINGS[locale];
  const icons = { calendar: 'CalendarDays', tasks: 'SquareKanban', notes: 'FileText', capture: 'Crop', desktop: 'MonitorDown', guide: 'LayoutGrid', connections: 'Plug' };
  const icon = (name, card = false) => `<svg class="site__icon${card ? ' site__icon--card' : ''}" width="${card ? 20 : 18}" height="${card ? 20 : 18}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="${assets}/icons.svg#${name}"></use></svg>`;
  return `<section class="hero"><div class="hero__copy"><p class="site__eyebrow">${escapeHtml(home.eyebrow)}</p><h1>${escapeHtml(home.heading)}</h1><p class="hero__lead">${escapeHtml(home.lead)}</p><div class="site__actions"><a class="site__button site__button--primary" href="${escapeHtml(config.releasesUrl)}">${icon('Download')}${escapeHtml(content.labels.download)}</a><a class="site__button" href="guide.html">${escapeHtml(content.labels.guide)}</a></div><p class="site__meta">${escapeHtml(content.labels.compatibility)}</p></div>${showcaseHtml(assets, locale)}</section><script type="module" src="${assets}/motion.js"></script>
    <section class="site__section"><h2>${headings.bring}</h2><div class="site__cards">${home.scenes.map(scene => `<article class="site__card"><h3 class="site__card-title">${icon(icons[scene.page], true)}<span>${escapeHtml(scene.title)}</span></h3><p>${escapeHtml(scene.text)}</p><a href="${pageLink(scene.page)}">${escapeHtml(content.labels.guide)} ${headings.arrow}</a></article>`).join('')}</div></section>
    <section class="site__section"><h2>${headings.fits}</h2><div class="site__cards site__cards--three">${home.differences.map(item => `<article class="site__card"><h3 class="site__card-title">${icon(icons[item.page], true)}<span>${escapeHtml(item.title)}</span></h3><p>${escapeHtml(item.text)}</p><a href="${pageLink(item.page)}">${escapeHtml(content.labels.guide)} ${headings.arrow}</a></article>`).join('')}</div></section>
    <section class="site__notice"><h2>${escapeHtml(home.privacyTitle)}</h2><p>${escapeHtml(home.privacyText)}</p><a href="privacy.html">${escapeHtml(content.pages.privacy.title)} ${headings.arrow}</a></section>
    <section class="site__section"><h2>${headings.faq}</h2><div class="site__faq">${home.faq.map(item => `<details class="site__faq-item"><summary>${escapeHtml(item.question)}</summary><p>${escapeHtml(item.answer)}</p></details>`).join('')}</div></section>
    <section class="site__notice"><h2>${escapeHtml(content.tagline)}</h2><div class="site__actions"><a class="site__button site__button--primary" href="download.html">${escapeHtml(content.labels.download)}</a><a class="site__button" href="guide.html">${escapeHtml(content.labels.guide)}</a></div></section>`;
}
function documentHtml(page, content, config, locale) {
  const entry = content.pages[page];
  if (!entry || !entry.sections?.length) throw new Error(`Missing content: ${locale}/${page}`);
  let extra = '';
  if (page === 'download') extra = `<div class="site__actions"><a class="site__button site__button--primary" href="${escapeHtml(config.releasesUrl)}">${escapeHtml(content.labels.download)}</a></div>`;
  if (page === 'support') extra = `<div class="site__actions"><a class="site__button" href="mailto:${escapeHtml(config.supportEmail)}">${escapeHtml(config.supportEmail)}</a><a class="site__button" href="${escapeHtml(config.issuesUrl)}">GitHub Issues</a></div>`;
  if (page === 'privacy') extra = '<p><a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy · Limited Use</a></p>';
  return `<article class="document"><header class="document__header"><p class="site__eyebrow">${escapeHtml(content.tagline)}</p><h1>${escapeHtml(entry.title)}</h1><p class="hero__lead">${escapeHtml(entry.lead)}</p>${extra}</header>${sectionsHtml(entry.sections)}</article>`;
}
export async function buildSite({ output = path.join(ROOT, 'dist'), config } = {}) {
  config ??= await readPublicConfig();
  validateConfig(config);
  const template = await fs.readFile(path.join(ROOT, 'templates', 'page.html'), 'utf8');
  const version = JSON.parse(await fs.readFile(path.join(ROOT, '..', 'package.json'), 'utf8')).version;
  await fs.mkdir(path.join(output, 'assets'), { recursive: true });
  await fs.copyFile(path.join(ROOT, '..', 'public', 'logo.png'), path.join(output, 'assets', 'logo.png'));
  for (const language of ['zh', 'en', 'fa']) {
    await fs.mkdir(path.join(output, 'assets', 'screenshots', language), { recursive: true });
    for (const slide of SHOWCASE_SLIDES) {
      const relative = screenshotPath(slide[0], language);
      await fs.copyFile(path.join(ROOT, 'assets', relative), path.join(output, 'assets', relative));
    }
  }
  for (const script of ['showcase.js', 'motion.js']) await fs.copyFile(path.join(ROOT, 'assets', script), path.join(output, 'assets', script));
  const iconSource = await fs.readFile(path.join(ROOT, '..', 'src', 'components', 'icon-data.ts'), 'utf8');
  const glyphs = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(iconSource)).toString('base64'));
  const iconNames = ['CalendarDays', 'SquareKanban', 'FileText', 'Crop', 'MonitorDown', 'LayoutGrid', 'Plug', 'Download'];
  await fs.writeFile(path.join(output, 'assets', 'icons.svg'), '<svg xmlns="http://www.w3.org/2000/svg">' + iconNames.map(name => '<symbol id="' + name + '" viewBox="0 0 24 24">' + glyphs.iconBodies[name].outline + '</symbol>').join('') + '</svg>');
  const design = await fs.readFile(path.join(ROOT, '..', 'design.md'), 'utf8');
  const tokens = design.match(/```css\r?\n(:root \{[\s\S]*?)\r?\n```/);
  if (!tokens) throw new Error('Missing authoritative design tokens');
  const css = await fs.readFile(path.join(ROOT, 'assets', 'site.css'), 'utf8');
  await fs.writeFile(path.join(output, 'assets', 'site.css'), `${tokens[1]}\n${css}`);
  for (const { locale, prefix } of LOCALE_OUTPUTS) {
    const settings = SITE_LOCALES[locale];
    const headings = HOME_HEADINGS[locale];
    const content = JSON.parse(await fs.readFile(path.join(ROOT, 'content', settings.content), 'utf8'));
    const directory = path.join(output, prefix);
    await fs.mkdir(directory, { recursive: true });
    for (const page of PAGE_NAMES) {
      const siteRoot = config.officialDomain.replace(/\/$/, '');
      const chineseUrl = `${siteRoot}/${localeUrl('zh-CN', page)}`;
      const englishUrl = `${siteRoot}/${localeUrl('en', page)}`;
      const persianUrl = `${siteRoot}/${localeUrl('fa', page)}`;
      const data = {
        lang: settings.lang, dir: settings.dir, description: escapeHtml(page === 'index' ? content.description : content.pages[page].lead),
        title: escapeHtml(`${page === 'index' ? content.tagline : content.pages[page].title} · ${config.productName}`),
        canonical: escapeHtml(`${siteRoot}/${localeUrl(locale, page)}`), chineseUrl: escapeHtml(chineseUrl), englishUrl: escapeHtml(englishUrl), persianUrl: escapeHtml(persianUrl),
        assets: prefix ? '../assets' : 'assets', productName: escapeHtml(config.productName), tagline: escapeHtml(content.tagline),
        skipLabel: headings.skip, navLabel: headings.nav, legalLabel: headings.legal,
        navigation: Object.entries(content.nav).map(([key, label]) => `<a href="${pageLink(key)}"${page === key ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a>`).join(''),
        languageLinks: Object.entries(SITE_LOCALES).filter(([key]) => key !== locale).map(([key, other]) => `<a href="${relativeLocaleUrl(prefix, key, page)}" lang="${other.hreflang}" hreflang="${other.hreflang}">${other.label}</a>`).join(''),
        body: page === 'index' ? homeHtml(content, config, prefix ? '../assets' : 'assets', locale) : documentHtml(page, content, config, locale),
        footer: escapeHtml(content.labels.footer), versionLabel: escapeHtml(content.labels.version), version: escapeHtml(version),
        legalLinks: ['privacy', 'terms', 'data-deletion', 'support'].map(key => `<a href="${pageLink(key)}">${escapeHtml(content.pages[key].title)}</a>`).join(''),
        supportEmail: escapeHtml(config.supportEmail), developerName: escapeHtml(config.developerName)
      };
      const html = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        if (!(key in data)) throw new Error(`Unknown template variable: ${key}`);
        return data[key];
      });
      await fs.writeFile(path.join(directory, `${page}.html`), html);
    }
  }
  await fs.writeFile(path.join(output, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${config.officialDomain}/sitemap.xml\n`);
  await fs.writeFile(path.join(output, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Object.keys(SITE_LOCALES).flatMap(locale => PAGE_NAMES.map(page => `<url><loc>${escapeHtml(`${config.officialDomain.replace(/\/$/, '')}/${localeUrl(locale, page)}`)}</loc></url>`)).join('')}</urlset>`);
  const errors = await validateOutput(output);
  if (errors.length) throw new Error(errors.join('\n'));
  return output;
}
export async function validateOutput(output) {
  const errors = [];
  for (const prefix of ['', 'en', 'fa', 'zh-CN']) {
    for (const page of PAGE_NAMES) {
      const relative = path.join(prefix, `${page}.html`);
      const html = await fs.readFile(path.join(output, relative), 'utf8').catch(() => '');
      if (!html) { errors.push(`Missing page: ${relative}`); continue; }
      const safeHtml = html.replace(/<script type="module" src="(?:\.\.\/)?assets\/(?:showcase|motion)\.js"><\/script>/g, '');
      if (/<(?:script|iframe)\b|\{\{\w+\}\}|REPLACE_BEFORE_DEPLOY|testAccount|videoUrl/i.test(safeHtml)) errors.push(`Invalid public output: ${relative}`);
      for (const [, attribute, value] of html.matchAll(/\b(href|src|data-src)="([^"]+)"/g)) {
        if (/^(?:https:|mailto:|#)/.test(value)) continue;
        const target = path.resolve(output, prefix, value.split('#')[0]);
        if (!target.startsWith(`${path.resolve(output)}${path.sep}`) || !await fs.stat(target).catch(() => false)) errors.push(`${relative}: missing ${attribute} ${value}`);
      }
    }
  }
  return errors;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildSite().then(output => console.log(`Website built: ${output}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
