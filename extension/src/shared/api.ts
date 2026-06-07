// Клиент MailBot API. Bearer = device-token. Все вызовы — JSON.
import { API_BASE } from './constants';
import { getDeviceSecret } from './device';
import type { BoxDTO, MessageDTO } from './types';

async function call(path: string, opts: RequestInit = {}): Promise<any> {
  const secret = await getDeviceSecret();
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + secret,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`api ${path} ${res.status}`);
  return res.status === 204 ? null : res.json();
}

export const session = (locale?: string): Promise<{ ok: boolean }> =>
  call('/api/session', { method: 'POST', body: JSON.stringify({ locale }) });

export const getBoxes = async (): Promise<BoxDTO[]> => ((await call('/api/boxes')).boxes as BoxDTO[]) || [];

export const createBox = async (locale?: string): Promise<BoxDTO> =>
  (await call('/api/boxes', { method: 'POST', body: JSON.stringify({ locale }) })).box as BoxDTO;

export const extendBox = (address: string): Promise<any> =>
  call(`/api/boxes/${encodeURIComponent(address)}/extend`, { method: 'POST', body: '{}' });

export const deleteBox = (address: string): Promise<any> =>
  call(`/api/boxes/${encodeURIComponent(address)}`, { method: 'DELETE' });

export const getMessages = (cursor = ''): Promise<{ messages: MessageDTO[]; next_cursor: string }> =>
  call('/api/messages' + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''));
