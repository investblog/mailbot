export type Token =
  | { type: 'text'; value: string }
  | { type: 'link'; label: string; href: string };

export interface BoxDTO {
  address: string;
  expires_at: number; // unix seconds
}

export interface MessageDTO {
  id: string;
  address: string;
  from: string;
  subject: string;
  otp: string | null;
  created_at: number; // unix ms
  body: string;
  tokens: Token[];
  links: string[];
  attachments: string[];
}

export interface Settings {
  locale?: 'ru' | 'en';
}
