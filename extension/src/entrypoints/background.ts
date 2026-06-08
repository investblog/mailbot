import { browser } from 'wxt/browser';
import { session, getBoxes, createBox, extendBox, deleteBox, getMessages } from '@shared/api';
import { lang, t } from '@shared/i18n';
import { STORAGE, POLL_ALARM_NAME, POLL_ALARM_MIN } from '@shared/constants';
import type { Req, Res } from '@shared/protocol';

// Кросс-браузерный action (MV3 chrome → action, MV2 firefox → browserAction).
const action = (browser as any).action ?? (browser as any).browserAction;

async function setBadge(n: number): Promise<void> {
  try {
    await action?.setBadgeText?.({ text: n > 0 ? String(n) : '' });
    await action?.setBadgeBackgroundColor?.({ color: '#fe4622' });
  } catch { /* no-op */ }
}

// Гарантировать сессию (owner создаётся из device-token на сервере).
async function ensureSession(): Promise<void> {
  try { await session(lang()); } catch { /* офлайн — попробуем позже */ }
}

// Самовосстановление: если owner ещё/уже не существует на сервере (401 "no session"),
// создаём сессию из device-token и повторяем запрос один раз. Покрывает новый device-token,
// смену ID распакованного расширения и несоздавшуюся при старте сессию — раньше это давало
// залипшую «Connection error» (каждый POLL → 401 без выхода).
async function withSession<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!/\b401\b/.test(String(e))) throw e;
    await session(lang());
    return await fn();
  }
}

// Фоновый опрос: новые письма → нотификация + badge. Курсор хранится локально.
async function poll(): Promise<void> {
  try {
    const cur = ((await browser.storage.local.get(STORAGE.cursor))[STORAGE.cursor] as string) || '';
    const { messages, next_cursor } = await withSession(() => getMessages(cur));
    if (!messages.length) return;
    for (const m of messages) {
      browser.notifications?.create(`mb-${m.id}`, {
        type: 'basic',
        // public/icon/* не входит в типизированный PublicPath WXT — каст (файл есть в рантайме).
        iconUrl: (browser.runtime.getURL as (p: string) => string)('/icon/128.png'),
        title: m.otp ? `${m.otp} · ${t('otp')}` : t('inbox'),
        message: `${m.subject || ''} — ${m.from || ''}`.slice(0, 200),
      });
    }
    const unread = (((await browser.storage.local.get('mb_unread'))['mb_unread'] as number) || 0) + messages.length;
    await browser.storage.local.set({ [STORAGE.cursor]: next_cursor, mb_unread: unread });
    await setBadge(unread);
  } catch { /* офлайн/нет сессии */ }
}

// Хаб для popup: любое действие → возвращаем свежее состояние и сбрасываем непрочитанное.
async function handle(msg: Req): Promise<Res> {
  try {
    const { boxes, messages, next_cursor } = await withSession(async () => {
      if (msg.type === 'NEW_BOX') await createBox(lang());
      else if (msg.type === 'EXTEND') await extendBox(msg.address);
      else if (msg.type === 'DELETE') await deleteBox(msg.address);

      const boxes = await getBoxes();
      const { messages, next_cursor } = await getMessages('');
      return { boxes, messages, next_cursor };
    });
    // popup открыт → всё прочитано: сбрасываем badge и двигаем курсор в конец.
    await browser.storage.local.set({ mb_unread: 0, [STORAGE.cursor]: next_cursor });
    await setBadge(0);
    return { ok: true, boxes, messages };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async (details) => {
    await ensureSession();
    await browser.alarms.create(POLL_ALARM_NAME, { periodInMinutes: POLL_ALARM_MIN });
    if (details.reason === 'install') {
      browser.tabs?.create({ url: browser.runtime.getURL('/welcome.html') });
    }
  });

  browser.runtime.onStartup.addListener(async () => {
    await ensureSession();
    await browser.alarms.create(POLL_ALARM_NAME, { periodInMinutes: POLL_ALARM_MIN });
  });

  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === POLL_ALARM_NAME) void poll();
  });

  // Клик по нотификации → открыть popup невозможно программно; открываем бот/попап-страницу не нужно.
  browser.notifications?.onClicked.addListener((id) => browser.notifications.clear(id));

  browser.runtime.onMessage.addListener(((message: unknown, _sender: unknown, sendResponse: (r: Res) => void) => {
    void handle(message as Req).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }) as any);
});
