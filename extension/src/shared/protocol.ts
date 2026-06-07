// Типизированный протокол popup ↔ background.
import { browser } from 'wxt/browser';
import type { BoxDTO, MessageDTO } from './types';

export type Req =
  | { type: 'GET_STATE' }
  | { type: 'NEW_BOX' }
  | { type: 'EXTEND'; address: string }
  | { type: 'DELETE'; address: string }
  | { type: 'POLL' };

export interface StateRes {
  ok: true;
  boxes: BoxDTO[];
  messages: MessageDTO[];
}
export interface ErrRes {
  ok: false;
  error: string;
}
export type Res = StateRes | ErrRes;

export function send(msg: Req): Promise<Res> {
  return browser.runtime.sendMessage(msg) as Promise<Res>;
}
