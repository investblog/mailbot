import { browser } from 'wxt/browser';
import { applyI18n, t, lang } from '@shared/i18n';
import { initTheme, toggleTheme, getTheme } from '@shared/theme';
import { send } from '@shared/protocol';
import { renderBody } from '@shared/render';
import { POLL_FALLBACK_MS } from '@shared/constants';
import { getStoreInfo } from '@shared/store-links';
import type { BoxDTO, MessageDTO } from '@shared/types';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const isSidepanel = new URLSearchParams(location.search).has('sidepanel');
if (isSidepanel) document.body.classList.add('sidepanel');

document.documentElement.lang = lang();
initTheme();
applyI18n();

// --- theme toggle ---
function updateThemeIcon(): void {
  $('#theme-toggle use').setAttribute('href', getTheme() === 'dark' ? '#i-sun' : '#i-moon');
}
updateThemeIcon();
$('#theme-toggle').addEventListener('click', () => { toggleTheme(); updateThemeIcon(); });

// --- side panel: попап разворачивает докнутую панель (chrome) / сайдбар (firefox); панель → сворачивает себя ---
const sidePanel = (browser as { sidePanel?: { open(opts: { windowId?: number }): Promise<void> } }).sidePanel;
const sidebarAction = (browser as { sidebarAction?: { open(): Promise<void> } }).sidebarAction;
const canOpenPanel = !isSidepanel && (!!sidePanel?.open || !!sidebarAction?.open);

// windowId кэшируем заранее: sidePanel.open() требует user-gesture, а `await` ПЕРЕД ним
// «съедает» жест (Chrome) → open молча отклоняется. С кэшем зовём open синхронно в обработчике.
let curWindowId: number | undefined;
if (canOpenPanel && sidePanel?.open) browser.windows.getCurrent().then((w) => { curWindowId = w.id; }).catch(() => { /* ignore */ });

function openSidePanel(): void {
  if (sidePanel?.open) { // chrome/edge
    if (curWindowId != null) {
      try { void sidePanel.open({ windowId: curWindowId }); window.close(); } catch { /* ignore */ }
    } else {
      // windowId ещё не закэширован (редко) — фолбэк с await; жест может потеряться.
      browser.windows.getCurrent()
        .then((w) => sidePanel.open({ windowId: w.id }))
        .then(() => window.close())
        .catch(() => { /* ignore */ });
    }
  } else if (sidebarAction?.open) { // firefox
    try { void sidebarAction.open(); window.close(); } catch { /* ignore */ }
  }
}

const pin = $('#pin');
if (isSidepanel) {
  // уже в панели — кнопка её сворачивает (закрытие страницы панели = collapse)
  pin.hidden = false;
  pin.querySelector('use')?.setAttribute('href', '#i-panel-close');
  pin.title = t('collapse');
  pin.setAttribute('aria-label', t('collapse'));
  pin.addEventListener('click', () => window.close());
} else if (canOpenPanel) {
  pin.hidden = false;
  pin.addEventListener('click', openSidePanel);
}

// --- footer: review-ссылка стора (per-browser; появится, когда в store-links задан URL) ---
const store = getStoreInfo();
if (store) {
  const review = document.createElement('a');
  review.className = 'footer-review';
  review.href = store.url;
  review.target = '_blank';
  review.rel = 'noreferrer';
  review.title = `${t('rateUs')} · ${store.label}`;
  const icon = document.createElement('img');
  icon.src = store.icon; icon.width = 14; icon.height = 14; icon.alt = '';
  review.append(icon, document.createTextNode(t('rateUs')));
  $('.footer-left').prepend(review);
}

// --- copy с success-фидбеком (house) ---
function flashCopied(btn: HTMLElement): void {
  btn.classList.add('is-success');
  const useEl = btn.querySelector('use');
  const prev = useEl?.getAttribute('href') ?? null;
  if (useEl) useEl.setAttribute('href', '#i-check');
  setTimeout(() => {
    btn.classList.remove('is-success');
    if (useEl && prev) useEl.setAttribute('href', prev);
  }, 1400);
}
async function copy(text: string, btn?: HTMLElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) flashCopied(btn);
  } catch { /* denied */ }
}

function fmtTime(ms: number): string {
  try { return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

// --- drawer: полное письмо ---
function openDrawer(m: MessageDTO): void {
  const drawer = document.createElement('aside');
  drawer.className = 'drawer';
  const close = (): void => { drawer.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };

  const overlay = document.createElement('div');
  overlay.className = 'drawer__overlay';
  overlay.addEventListener('click', close);

  const panel = document.createElement('div');
  panel.className = 'drawer__panel';

  const header = document.createElement('div');
  header.className = 'drawer__header';
  const title = document.createElement('h2');
  title.className = 'drawer__title';
  title.textContent = m.subject || '(no subject)';
  const actions = document.createElement('div');
  actions.className = 'drawer__actions';

  // В попапе — кнопка «открыть это письмо в боковой панели» (комфортнее читать).
  if (canOpenPanel) {
    const expand = document.createElement('button');
    expand.className = 'drawer__close';
    expand.type = 'button';
    expand.title = t('pin');
    expand.setAttribute('aria-label', t('pin'));
    expand.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-panel-open"></use></svg>';
    expand.addEventListener('click', () => {
      void browser.storage.local.set({ mb_open_msg: m.id }); // панель откроет это же письмо
      openSidePanel();
    });
    actions.appendChild(expand);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'drawer__close';
  closeBtn.type = 'button';
  closeBtn.title = t('close');
  closeBtn.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-close"></use></svg>';
  closeBtn.addEventListener('click', close);
  actions.appendChild(closeBtn);
  header.append(title, actions);

  const body = document.createElement('div');
  body.className = 'drawer__body';

  const from = document.createElement('div');
  from.className = 'msg-from';
  from.textContent = m.from || '';
  body.appendChild(from);

  if (m.otp) {
    const otp = document.createElement('button');
    otp.className = 'otp otp--lg';
    otp.type = 'button';
    otp.textContent = m.otp;
    otp.title = t('copy');
    otp.addEventListener('click', () => copy(m.otp!, otp));
    body.appendChild(otp);
  }

  const text = document.createElement('div');
  text.className = 'msg-body';
  text.innerHTML = renderBody(m.tokens); // токены уже экранированы в renderBody
  body.appendChild(text);

  for (const a of m.attachments || []) {
    const att = document.createElement('div');
    att.className = 'msg-attach';
    att.textContent = `📎 ${a}`;
    body.appendChild(att);
  }

  panel.append(header, body);
  drawer.append(overlay, panel);
  document.body.appendChild(drawer);
  document.addEventListener('keydown', onKey);
}

// --- confirm dialog (стиль оригинального 301-ui .dialog) ---
function confirmDialog(opts: {
  title: string; message: string; emphasis?: string;
  confirm: string; cancel: string; variant?: 'warning' | 'danger' | 'info';
}): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = document.createElement('div');
    dlg.className = `dialog${opts.variant ? ` dialog--${opts.variant}` : ''}`;
    const done = (v: boolean): void => {
      dlg.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') done(false);
      else if (e.key === 'Enter') done(true);
    };

    const overlay = document.createElement('div');
    overlay.className = 'dialog__overlay';
    overlay.addEventListener('click', () => done(false));

    const panel = document.createElement('div');
    panel.className = 'dialog__panel';

    const header = document.createElement('div');
    header.className = 'dialog__header';
    const title = document.createElement('h2');
    title.className = 'dialog__title';
    title.textContent = opts.title;
    header.appendChild(title);

    const body = document.createElement('div');
    body.className = 'dialog__body';
    body.textContent = opts.message;
    if (opts.emphasis) {
      body.appendChild(document.createElement('br'));
      const strong = document.createElement('strong');
      strong.textContent = opts.emphasis;
      body.appendChild(strong);
    }

    const footer = document.createElement('div');
    footer.className = 'dialog__footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.type = 'button';
    cancelBtn.textContent = opts.cancel;
    cancelBtn.addEventListener('click', () => done(false));
    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn--tg';
    okBtn.type = 'button';
    okBtn.textContent = opts.confirm;
    okBtn.addEventListener('click', () => done(true));
    footer.append(cancelBtn, okBtn);

    panel.append(header, body, footer);
    dlg.append(overlay, panel);
    document.body.appendChild(dlg);
    document.addEventListener('keydown', onKey);
    okBtn.focus();
  });
}

// --- inbox ---
let current: BoxDTO | null = null;

function fmtExpiry(box: BoxDTO): string {
  const h = Math.max(0, Math.round((box.expires_at - Date.now() / 1000) / 3600));
  return t('expires_in', { h });
}

function renderMessages(messages: MessageDTO[]): void {
  const list = $('#list');
  list.innerHTML = '';
  if (!messages.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = t('empty');
    list.appendChild(empty);
    return;
  }
  for (const m of [...messages].sort((a, b) => b.created_at - a.created_at)) {
    const row = document.createElement('button');
    row.className = 'msg-row';
    row.type = 'button';
    row.addEventListener('click', () => openDrawer(m));

    const main = document.createElement('div');
    main.className = 'msg-row__main';
    const subj = document.createElement('div');
    subj.className = 'msg-row__subj';
    subj.textContent = m.subject || '(no subject)';
    const fr = document.createElement('div');
    fr.className = 'msg-row__from';
    fr.textContent = m.from || '';
    main.append(subj, fr);

    const side = document.createElement('div');
    side.className = 'msg-row__side';
    if (m.otp) {
      const otp = document.createElement('span');
      otp.className = 'otp';
      otp.textContent = m.otp;
      otp.title = t('copy');
      otp.addEventListener('click', (e) => { e.stopPropagation(); copy(m.otp!, otp); });
      side.appendChild(otp);
    }
    const time = document.createElement('span');
    time.className = 'msg-row__time';
    time.textContent = fmtTime(m.created_at);
    side.appendChild(time);

    row.append(main, side);
    list.appendChild(row);
  }
}

let lastMessages: MessageDTO[] = [];

function renderState(boxes: BoxDTO[], messages: MessageDTO[]): void {
  current = boxes[0] || null;
  $('#addr').textContent = current ? current.address : '—';
  $('#addr-meta').textContent = current ? fmtExpiry(current) : '';
  const shown = messages.filter((m) => !current || m.address === current.address);
  lastMessages = shown;
  renderMessages(shown);
}

// Открыли письмо в панели из дровера попапа → панель при загрузке открывает его же.
async function maybeOpenDeepLink(): Promise<void> {
  if (!isSidepanel) return;
  const id = (await browser.storage.local.get('mb_open_msg')).mb_open_msg as string | undefined;
  if (!id) return;
  await browser.storage.local.remove('mb_open_msg');
  const m = lastMessages.find((x) => x.id === id);
  if (m) openDrawer(m);
}

async function refresh(type: 'GET_STATE' | 'NEW_BOX' | 'EXTEND' | 'DELETE' | 'POLL', address?: string): Promise<void> {
  const res = await send(address ? ({ type, address } as never) : ({ type } as never));
  if (res.ok) { renderState(res.boxes, res.messages); return; }
  // Тихий ретрай для фонового POLL: не затираем валидное состояние одним сбоем сети.
  // Ошибку показываем только на действиях пользователя (GET_STATE при старте / NEW/EXTEND/DELETE).
  if (type !== 'POLL') $('#addr-meta').textContent = t('error');
}

// --- Доставка: основной сигнал — Web Push (SW шлёт NEW_MAIL → мгновенный refresh).
// Поверх — лёгкий safety-поллинг пока окно открыто (push не 100%); пауза на скрытой вкладке.
let pollTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleFallback(): void {
  clearTimeout(pollTimer);
  if (document.hidden) return;
  pollTimer = setTimeout(async () => { await refresh('POLL'); scheduleFallback(); }, POLL_FALLBACK_MS);
}

// Действие пользователя → свежее состояние + перезавод fallback-таймера.
async function userAction(type: 'NEW_BOX' | 'EXTEND' | 'DELETE', address?: string): Promise<void> {
  await refresh(type, address);
  scheduleFallback();
}

// Push о новом письме (из background SW) → обновляемся немедленно.
browser.runtime.onMessage.addListener(((msg: { type?: string }) => {
  if (msg?.type === 'NEW_MAIL') void refresh('POLL');
}) as any);

$('#copy-addr').addEventListener('click', (e) => { if (current) copy(current.address, e.currentTarget as HTMLElement); });
$('#addr').addEventListener('click', () => { if (current) copy(current.address, $('#copy-addr')); });
$('#new').addEventListener('click', () => {
  // Новый адрес вытесняет текущий из UI (старый с его кодами больше не показывается) → предупреждаем.
  if (!current) { void userAction('NEW_BOX'); return; }
  const addr = current.address;
  void (async () => {
    const ok = await confirmDialog({
      title: t('newConfirmTitle'),
      message: t('newConfirmBody'),
      emphasis: addr,
      confirm: t('new'),
      cancel: t('cancel'),
      variant: 'warning',
    });
    if (ok) void userAction('NEW_BOX');
  })();
});
$('#extend').addEventListener('click', () => { if (current) void userAction('EXTEND', current.address); });
$('#delete').addEventListener('click', () => { if (current) void userAction('DELETE', current.address); });

document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(pollTimer);
  else { void refresh('POLL'); scheduleFallback(); } // вернулись → опрос сразу + перезавод
});
window.addEventListener('unload', () => clearTimeout(pollTimer));

void (async () => { await refresh('GET_STATE'); await maybeOpenDeepLink(); scheduleFallback(); })();
