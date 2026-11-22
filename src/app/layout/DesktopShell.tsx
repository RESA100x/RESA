import { Check, LayoutGrid, MonitorDown, Plus, Search, Settings } from '../../components/icons';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  builtinDefinitions,
  getWidgetDefinition,
  type WidgetDefinition,
  type WidgetId
} from '../../widgets/widget-registry';
import type { MonitorInfo, MonitorWallpaperArea, UpdateInfo } from '../../data/nowly-repository';
import { useNowlyRepository } from '../../data/RepositoryContext';
import { useModuleLayout } from '../../widgets/useModuleLayout';
import { TemplatePickerDialog } from '../../widgets/TemplatePickerDialog';
import { AboutDialog } from '../../settings/AboutDialog';
import { ModuleGrid, type ModuleGridItem } from './ModuleGrid';
import { Tip } from '../../components/Tip';
import { BlurControl } from '../BlurControl';
import { DEFAULT_BLUR, useBlur } from '../useBlur';
import { t } from '../../i18n';
import { WelcomeSticker } from '../../stickers/WelcomeSticker';

type DesktopShellProps = {
  mode?: 'foreground' | 'wallpaper';
  time: string;
  dateText: string;
  summary: string;
  modules: Partial<Record<WidgetId, ReactNode>>;
  definitions?: WidgetDefinition[];
  isModeSwitching?: boolean;
  onSetWallpaper?: () => void;
  onWallpaperDoubleClick?: () => void;
  onOpenSettings?: () => void;
  // Opens the command palette (Ctrl+K); the topbar button keeps it discoverable.
  onOpenSearch?: () => void;
  configurations?: Partial<Record<WidgetId, () => void>>;
  // Hide the topbar and module headers as wallpaper. Defaults on; all headers
  // return in the foreground.
  hideTopbarInWallpaper?: boolean;
  hideModuleBackgroundInWallpaper?: boolean;
  // Opt-in per-monitor wallpaper. When off (the default) nothing below changes.
  multiMonitorWallpaper?: boolean;
  monitors?: MonitorInfo[];
  // Which monitor's layout the foreground window edits (undefined = the single
  // global layout).
  monitorKey?: string | null;
  // Human-readable name of the monitor being edited, shown while editing.
  layoutTargetLabel?: string;
  overlay?: ReactNode;
  // The launch-time update check result. When it reports a newer release the
  // logo button shows a red dot, and the About dialog surfaces the changelog.
  update?: UpdateInfo | null;
};

// Render today's accumulated focus time as a compact, human-friendly label for
// The wallpaper layer sits behind the app content. It stays hidden until a
// wallpaper source is configured; for now it only anchors the stacking order
// so the blur filter can soften the modules over the desktop wallpaper.
function WallpaperLayer() {
  return <div className="wallpaper-layer" data-testid="wallpaper-layer" aria-hidden="true" hidden />;
}

// One monitor's slice of the spanning wallpaper window. Each slice owns its own
// layout, so a module can sit on one screen without appearing on the others.
function MonitorPanel({
  monitorId,
  rect,
  modules,
  definitions
}: {
  monitorId: string;
  // Physical pixels relative to the spanning window's top-left.
  rect: { left: number; top: number; width: number; height: number };
  modules: Partial<Record<WidgetId, ReactNode>>;
  definitions: WidgetDefinition[];
}) {
  const { layout, loaded } = useModuleLayout(definitions, monitorId);
  const items: ModuleGridItem[] = layout
    .filter(
      (entry) => modules[entry.id] !== undefined && getWidgetDefinition(entry.id, definitions) !== undefined
    )
    .map((entry) => ({
      id: entry.id,
      rect: { x: entry.x, y: entry.y, w: entry.w, h: entry.h },
      content: modules[entry.id]
    }));
  const scale = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  return (
    <div
      className="wallpaper-monitor"
      data-testid={`wallpaper-monitor-${monitorId}`}
      style={{
        left: rect.left / scale,
        top: rect.top / scale,
        width: rect.width / scale,
        height: rect.height / scale
      }}
    >
      <main className="workspace" aria-busy={!loaded}>
        {loaded ? (
          <ModuleGrid
            items={items}
            editing={false}
            definitions={definitions}
            onMove={() => undefined}
            onResize={() => undefined}
          />
        ) : null}
      </main>
    </div>
  );
}

// The wallpaper window spans the whole virtual desktop; every monitor is placed
// at its own offset inside it. Positions are physical pixels, converted to CSS
// pixels with the device pixel ratio the webview was pinned to.
function WallpaperSpan({
  monitors,
  modules,
  definitions,
  style
}: {
  monitors: MonitorInfo[];
  modules: Partial<Record<WidgetId, ReactNode>>;
  definitions: WidgetDefinition[];
  style?: CSSProperties;
}) {
  const repository = useNowlyRepository();
  // Work areas (taskbar excluded) so modules never end up behind a taskbar.
  const [areas, setAreas] = useState<MonitorWallpaperArea[] | null>(null);
  useEffect(() => {
    let active = true;
    void repository
      .listMonitorWallpaperAreas?.()
      .then((list) => {
        if (active) setAreas(list);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [repository]);
  const left = Math.min(...monitors.map((monitor) => monitor.positionX));
  const top = Math.min(...monitors.map((monitor) => monitor.positionY));
  return (
    <div className="wallpaper-span" style={style}>
      {monitors.map((monitor) => {
        const area = areas?.find(
          (item) =>
            item.id === monitor.id ||
            (item.positionX === monitor.positionX &&
              item.positionY === monitor.positionY &&
              item.width === monitor.width &&
              item.height === monitor.height)
        );
        const rect = area
          ? {
              left: area.left - left,
              top: area.top - top,
              width: area.right - area.left,
              height: area.bottom - area.top
            }
          : {
              left: monitor.positionX - left,
              top: monitor.positionY - top,
              width: monitor.width,
              height: monitor.height
            };
        return (
          <MonitorPanel
            key={monitor.id}
            monitorId={monitor.id}
            rect={rect}
            modules={modules}
            definitions={definitions}
          />
        );
      })}
    </div>
  );
}

export function DesktopShell({
  mode = 'foreground',
  dateText,
  summary,
  modules,
  definitions = builtinDefinitions,
  isModeSwitching = false,
  onSetWallpaper,
  onWallpaperDoubleClick,
  onOpenSettings,
  onOpenSearch,
  configurations,
  hideTopbarInWallpaper = true,
  hideModuleBackgroundInWallpaper = false,
  multiMonitorWallpaper = false,
  monitors = [],
  monitorKey,
  layoutTargetLabel,
  overlay,
  update
}: DesktopShellProps) {
  const foreground = mode === 'foreground';
  // A single WebView2 cannot render two different DPI scales correctly, so the
  // spanning mode is only used when every monitor shares one scale factor.
  const sharedScale =
    monitors.length > 1 &&
    monitors.every((monitor) => Math.abs(monitor.scaleFactor - monitors[0].scaleFactor) < 0.001);
  const spanMode = !foreground && multiMonitorWallpaper && sharedScale;
  // The no-topbar shell state also hides module headers via workspace CSS.
  // A double-click anywhere in wallpaper mode still returns to the foreground.
  const showTopbar = foreground || !hideTopbarInWallpaper;
  const { layout, loaded, move, resize, addWidget, removeWidget, presentIds } =
    useModuleLayout(definitions, spanMode ? undefined : monitorKey);
  const { blur, setBlur } = useBlur();
  const [isEditing, setIsEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const updateAvailable = update?.updateAvailable ?? false;
  const [previewingBlur, setPreviewingBlur] = useState(false);

  // Blur persists as a wallpaper-only look. As the wallpaper it softens the
  // whole app content, topbar included, so the modules read as a frosted layer
  // over the desktop. While the slider popover is open we also preview the blur
  // live in foreground, but only on the workspace — leaving the topbar (and the
  // slider itself) crisp so you never lose the control you're dragging.
  const blurred = blur > DEFAULT_BLUR;
  const blurFilter = `blur(${blur}px)`;
  const topbarStyle = !foreground && blurred ? { filter: blurFilter } : undefined;
  const workspaceStyle =
    (!foreground || previewingBlur) && blurred ? { filter: blurFilter } : undefined;

  const items: ModuleGridItem[] = layout
    .filter(
      (entry) => modules[entry.id] !== undefined && getWidgetDefinition(entry.id, definitions) !== undefined
    )
    .map((entry) => ({
      id: entry.id,
      rect: { x: entry.x, y: entry.y, w: entry.w, h: entry.h },
      content: modules[entry.id]
    }));

  return (
    <div
      data-testid="desktop-root"
      onDoubleClickCapture={foreground ? undefined : onWallpaperDoubleClick}
      className={`app-shell${showTopbar ? '' : ' app-shell--no-topbar'}${!foreground && hideModuleBackgroundInWallpaper ? ' app-shell--transparent-modules' : ''}`}
    >
      <WallpaperLayer />
      {showTopbar ? (
      <header className="topbar" style={topbarStyle}>
        <div className="date-copy">
          <strong>{dateText}</strong>
          <p>{summary}</p>
        </div>
        <div className="top-actions">
          {foreground && isEditing && layoutTargetLabel ? (
            <span className="layout-target" title={layoutTargetLabel}>
              {t('shell.layoutForMonitor', { name: layoutTargetLabel })}
            </span>
          ) : null}
          {foreground ? (
            <Tip content={t('commandPalette.openHint')}>
              <button type="button" className="btn btn-icon topbar-search" aria-label={t('commandPalette.open')} onClick={onOpenSearch}>
                <Search aria-hidden="true" />
                <kbd className="topbar-search__kbd" aria-hidden="true">Ctrl K</kbd>
              </button>
            </Tip>
          ) : null}
          {foreground ? (
            <Tip content={t('about.open')}>
              <button type="button" className="btn btn-icon about-button" aria-label={t('about.open')} onClick={() => setAboutOpen(true)}>
                <img src="/logo.png" alt="" className="about-button__logo" aria-hidden="true" />
                {updateAvailable ? <span className="about-button__dot" aria-hidden="true" /> : null}
              </button>
            </Tip>
          ) : null}
          {foreground ? (
            <BlurControl blur={blur} onChange={setBlur} onOpenChange={setPreviewingBlur} tipContent={t('blur.adjust')} />
          ) : null}
          {foreground && isEditing ? (
            <Tip content={t('shell.addModule')}>
              <button type="button" className="btn" aria-label={t('shell.addModule')} disabled={!loaded} onClick={() => setPickerOpen(true)}>
                <Plus aria-hidden="true" />
                {t('shell.addModule')}
              </button>
            </Tip>
          ) : null}
          {foreground ? (
            <Tip content={isEditing ? t('shell.finishEditing') : t('shell.editLayout')}>
              <button type="button" data-guide="edit-layout" className={`btn btn-icon${isEditing ? ' is-active' : ''}`} disabled={!loaded} aria-label={isEditing ? t('shell.finishEditing') : t('shell.editLayout')} aria-pressed={isEditing} onClick={() => setIsEditing((current) => !current)}>
                {isEditing ? <Check aria-hidden="true" /> : <LayoutGrid aria-hidden="true" />}
              </button>
            </Tip>
          ) : null}
          {foreground ? (
            <Tip content={t('shell.openSettings')}>
              <button type="button" data-guide="settings" className="btn btn-icon" aria-label={t('shell.openSettings')} onClick={onOpenSettings}>
                <Settings aria-hidden="true" />
              </button>
            </Tip>
          ) : null}
          {foreground ? (
            <Tip content={t('shell.setWallpaper')} align="end">
              <button type="button" data-guide="wallpaper" className="btn btn-icon btn-primary" aria-label={t('shell.setWallpaper')} disabled={isModeSwitching} onClick={onSetWallpaper}>
                <MonitorDown aria-hidden="true" />
              </button>
            </Tip>
          ) : null}
        </div>
      </header>
      ) : null}
      {spanMode ? (
        <WallpaperSpan
          monitors={monitors}
          modules={modules}
          definitions={definitions}
          style={workspaceStyle}
        />
      ) : (
        <main className="workspace" data-guide="workspace" aria-busy={!loaded} style={workspaceStyle}>
          {!loaded || items.length === 0 ? <WelcomeSticker loading={!loaded} /> : <ModuleGrid
            items={items}
            editing={foreground && isEditing}
            definitions={definitions}
            onMove={move}
            onResize={resize}
            onRemove={removeWidget}
            configurations={configurations}
          />}
        </main>
      )}
      {overlay}

      {foreground && pickerOpen ? (
        <TemplatePickerDialog
          presentIds={presentIds}
          onClose={() => setPickerOpen(false)}
          onAdd={(id) => addWidget(id)}
          onRemove={(id) => removeWidget(id)}
        />
      ) : null}

      {foreground && aboutOpen ? (
        <AboutDialog update={update} onClose={() => setAboutOpen(false)} />
      ) : null}
    </div>
  );
}
