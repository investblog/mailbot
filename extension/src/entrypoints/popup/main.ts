import { browser } from 'wxt/browser';
import { applyI18n, t, lang } from '@shared/i18n';
import { initTheme, toggleTheme, getTheme } from '@shared/theme';
import { send } from '@shared/protocol';
import { renderBody } from '@shared/render';
import { POLL_OPEN_MS } from '@shared/constants';
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

// --- pin to side panel (chrome/edge, popup mode only) ---
const sidePanel = (browser as { sidePanel?: { open(opts: { windowId?: number }): Promise<void> } }).sidePanel;
if (!isSidepanel && sidePanel?.open) {
  const pin = $('#pin');
  pin.hidden = false;
  pin.addEventListener('click', async () => {
    try {
      const w = await browser.windows.getCurrent();
      await sidePanel.open({ windowId: w.id });
      window.close();
    } catch { /* ignore */ }
  });
}

// --- inbox ---
let current: BoxDTO | null = null;

function fmtExpiry(box: BoxDTO): string {
  const h = Math.max(0, Math.round((box.expires_at - Date.now() / 1000) / 3600));
  return t('expires_in', { h });
}

async function copy(text: string, el?: HTMLElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    if (el) {
      const prev = el.textContent;
      el.textContent = t('copied');
      setTimeout(() => { el.textContent = prev; }, 1200);
    }
  } catch { /* denied */ }
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
    const card = document.createElement('article');
    card.className = 'msg';

    if (m.otp) {
      const otp = document.createElement('button');
      otp.className = 'otp';
      otp.type = 'button';
      otp.textContent = m.otp;
      otp.title = t('copy');
      otp.addEventListener('click', () => copy(m.otp!, otp));
      card.appendChild(otp);
    }

    const subj = document.createElement('div');
    subj.className = 'msg-subj';
    subj.textContent = m.subject || '(no subject)';
    card.appendChild(subj);

    const from = document.createElement('div');
    from.className = 'msg-from';
    from.textContent = m.from || '';
    card.appendChild(from);

    const body = document.createElement('div');
    body.className = 'msg-body';
    body.innerHTML = renderBody(m.tokens); // токены уже экранированы в renderBody
    card.appendChild(body);

    list.appendChild(card);
  }
}

function renderState(boxes: BoxDTO[], messages: MessageDTO[]): void {
  current = boxes[0] || null;
  $('#addr').textContent = current ? current.address : '—';
  $('#addr-meta').textContent = current ? fmtExpiry(current) : '';
  renderMessages(messages.filter((m) => !current || m.address === current.address));
}

async function refresh(type: 'GET_STATE' | 'NEW_BOX' | 'EXTEND' | 'DELETE' | 'POLL', address?: string): Promise<void> {
  const res = await send(address ? ({ type, address } as never) : ({ type } as never));
  if (res.ok) renderState(res.boxes, res.messages);
  else $('#addr-meta').textContent = t('error');
}

$('#copy-addr').addEventListener('click', (e) => { if (current) copy(current.address, e.currentTarget as HTMLElement); });
$('#new').addEventListener('click', () => refresh('NEW_BOX'));
$('#extend').addEventListener('click', () => { if (current) refresh('EXTEND', current.address); });
$('#delete').addEventListener('click', () => { if (current) refresh('DELETE', current.address); });

void refresh('GET_STATE');
const pollTimer = setInterval(() => void refresh('POLL'), POLL_OPEN_MS) as unknown as number;
window.addEventListener('unload', () => clearInterval(pollTimer));
