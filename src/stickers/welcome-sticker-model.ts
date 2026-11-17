import { fitStickerIntoBounds, type StickerBounds, type StickerObject, type TextSticker } from './sticker-model';

export const WELCOME_LOGO_ASSET = '00000000000000000000000000000001';
type Greeting = [id: string, text: string, x: number, y: number, size: number, rotation: number, opacity: number, tone?: 'blue' | 'violet'];
const greetings: Greeting[] = [
  ['back-en', 'Welcome to RESA', .26, .08, 68, -7, 14, 'blue'],
  ['back-fr', 'Bienvenue sur RESA', .85, .32, 76, 8, 12, 'violet'],
  ['back-de', 'Willkommen bei RESA', .12, .67, 56, -8, 13, 'blue'],
  ['back-zh', '欢迎使用 RESA', .71, .89, 72, -5, 13, 'violet'],
  ['fa', 'به RESA خوش آمدید', .23, .22, 40, -8, 46, 'blue'],
  ['ja', 'RESA へようこそ', .72, .17, 34, 6, 48, 'violet'],
  ['de', 'Willkommen bei RESA', .16, .42, 26, 4, 28],
  ['es', 'Bienvenido a RESA', .81, .44, 44, -7, 37, 'violet'],
  ['ko', 'RESA에 오신 것을 환영합니다', .18, .57, 22, -5, 35],
  ['it', 'Benvenuto su RESA', .79, .62, 26, 8, 45, 'blue'],
  ['tr', "RESA'ye hoş geldiniz", .38, .76, 16, 3, 35],
  ['pt', 'Bem-vindo ao RESA', .24, .80, 32, 7, 42, 'blue'],
  ['ar', 'مرحبًا بك في RESA', .57, .81, 36, -7, 42, 'violet'],
  ['ru', 'Добро пожаловать в RESA', .82, .77, 20, -4, 30],
  ['nl', 'Welkom bij RESA', .15, .91, 16, -5, 28],
  ['hi', 'RESA में आपका स्वागत है', .34, .90, 18, 4, 28],
  ['vi', 'Chào mừng đến với RESA', .71, .93, 16, -4, 32],
  ['sv', 'Välkommen till RESA', .86, .20, 16, 5, 32],
  ['id', 'Selamat datang di RESA', .15, .10, 16, 4, 36],
  ['pl', 'Witamy w RESA', .55, .08, 20, -3, 30],
  ['el', 'Καλώς ήρθατε στο RESA', .17, .32, 16, -3, 38],
  ['th', 'ยินดีต้อนรับสู่ RESA', .85, .53, 16, 4, 32]
];

export function buildWelcomeStickers(bounds: StickerBounds): StickerObject[] {
  const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
  const scale = Math.min(width / 1408, height / 680);
  function text(id: string, value: string, x: number, y: number, size: number, rotation = 0, opacity = 100, tone?: 'blue' | 'violet'): TextSticker {
    const fontSize = Math.max(12, Math.min(160, Math.round(size * scale)));
    const textWidth = Math.min(width - 24, [...value].reduce((sum, char) => sum + (/[^\u0000-\u024f]/.test(char) ? 1 : .65), 0) * fontSize);
    const textHeight = fontSize * 1.5;
    return fitStickerIntoBounds({
      id: `welcome-${id}`, kind: 'text', text: value, x: bounds.left + width * x - textWidth / 2,
      y: bounds.top + height * y - textHeight / 2, width: textWidth, height: textHeight,
      fontSize, color: tone === 'blue' ? '#6F91C8' : tone === 'violet' ? '#9381BD' : '#6E789D',
      rotation, opacity, locked: true, bold: false, italic: false, underline: false, align: 'center'
    }, bounds);
  }
  const logoSize = 144 * scale;
  return [
    ...greetings.map(([id, value, x, y, size, rotation, opacity, tone]) => text(id, value, x, y, size, rotation, opacity, tone)),
    { id: 'welcome-logo', kind: 'image', assetId: WELCOME_LOGO_ASSET, style: 'original', locked: true,
      x: bounds.left + width / 2 - logoSize / 2, y: bounds.top + height * .24, width: logoSize,
      height: logoSize, opacity: 100, rotation: 0 },
    { ...text('title', 'به RESA خوش آمدید', .5, .53, 48), color: '#343B58' },
    text('subtitle', 'Welcome to RESA', .5, .62, 24)
  ];
}
