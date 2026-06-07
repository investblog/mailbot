import { applyI18n, t, lang } from '@shared/i18n';
import { send } from '@shared/protocol';
import { renderBody } from '@shared/render';
import { POLL_OPEN_MS } from '@shared/constants';
import type { BoxDTO, MessageDTO } from '@shared/types';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

let current: BoxDTO | null = null;

document.documentElement.lang = lang();
applyI18n();

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
  } catch { /* clipboard denied */ }
}

function renderMessages(messages: MessageDTO[]): void {
  const list = $('#list');
  list.innerHTML = '';
  if (!messages.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = t('empty');
    list.appendChild(empty);
    return;
  }
  // Новые сверху.
  for (const m of [...messages].sort((a, b) => b.created_at - a.created_at)) {
    const card = document.createElement('article');
    card.className = 'msg';

    if (m.otp) {
      const otp = document.createElement('button');
      otp.className = 'otp';
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
  const res = await send(address ? ({ type, address } as any) : ({ type } as any));
  if (res.ok) renderState(res.boxes, res.messages);
  else $('#addr-meta').textContent = t('error');
}

// --- wire ---
$('#copy-addr').addEventListener('click', (e) => { if (current) copy(current.address, e.currentTarget as HTMLElement); });
$('#new').addEventListener('click', () => refresh('NEW_BOX'));
$('#extend').addEventListener('click', () => { if (current) refresh('EXTEND', current.address); });
$('#delete').addEventListener('click', () => { if (current) refresh('DELETE', current.address); });

// Первичная загрузка + поллинг пока popup открыт.
void refresh('GET_STATE');
const pollTimer = setInterval(() => void refresh('POLL'), POLL_OPEN_MS) as unknown as number;
window.addEventListener('unload', () => clearInterval(pollTimer));
