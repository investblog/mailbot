// Счётчик непрочитанных на иконке — house-стандарт (как redirect-inspector / cookiepeak / debloat):
// бренд-фон, белый текст, формат «99+», flash-пульс на новом письме, тултип.
import { browser } from 'wxt/browser';

// Cross-browser: Chrome/Edge MV3 → action, Firefox MV2 → browserAction.
const actionApi = (browser as any).action ?? (browser as any).browserAction;

const BADGE_COLOR = '#fe4622';       // бренд (primary)
const BADGE_FLASH_COLOR = '#18C27A'; // success — пульс при новом письме
const BADGE_TEXT_COLOR = '#FFFFFF';
const BADGE_MAX = 99;
const FLASH_MS = 1200;

function fmt(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  return n > BADGE_MAX ? `${BADGE_MAX}+` : String(n);
}

// Цвет текста ставится один раз (не во всех браузерах/версиях есть — guard).
let textColorSet = false;
function ensureTextColor(): void {
  if (textColorSet) return;
  try { actionApi?.setBadgeTextColor?.({ color: BADGE_TEXT_COLOR }); textColorSet = true; } catch { /* unsupported */ }
}

// Показать счётчик непрочитанных (0 → пусто).
export async function setBadgeCount(n: number): Promise<void> {
  if (!actionApi?.setBadgeText) return;
  ensureTextColor();
  const text = fmt(n);
  try {
    await actionApi.setBadgeText({ text });
    if (text) await actionApi.setBadgeBackgroundColor?.({ color: BADGE_COLOR });
    await actionApi.setTitle?.({ title: n > 0 ? `MailBot · ${n}` : 'MailBot' });
  } catch { /* контекст расширения мог стать невалидным */ }
}

// Короткий пульс success-цветом при новом письме, затем возврат к бренду.
let flashTimer: ReturnType<typeof setTimeout> | undefined;
export function flashBadge(): void {
  if (!actionApi?.setBadgeBackgroundColor) return;
  try { actionApi.setBadgeBackgroundColor({ color: BADGE_FLASH_COLOR }); } catch { return; }
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    try { actionApi.setBadgeBackgroundColor({ color: BADGE_COLOR }); } catch { /* gone */ }
  }, FLASH_MS);
}
