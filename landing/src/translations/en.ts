import type { TranslationMap } from '../i18n';

const en: TranslationMap = {
  'meta.title': 'MailBot — Disposable email in Telegram',
  'meta.description': 'Disposable email inside Telegram. Press /start, get an address, every message lands in your chat — the OTP code on the first line. Lives 24h, then expires. Nothing stored.',

  'nav.how': 'How it works',
  'nav.features': 'Features',
  'nav.faq': 'FAQ',
  'nav.cta': 'Open in Telegram',
  'nav.theme': 'Toggle theme',

  'hero.badge': 'Free · No signup',
  'hero.title': 'Disposable email, inside Telegram',
  'hero.subtitle': 'Press /start, get an address, paste it anywhere. Every message lands in your chat — the OTP code on the first line. The address lives 24 hours, then expires on its own.',
  'hero.cta_primary': 'Open in Telegram',
  'hero.cta_secondary': 'How it works',
  'hero.step1': '/start',
  'hero.step2': 'paste the address',
  'hero.step3': 'code in your chat',

  'how.title': 'Three steps, zero setup',
  'how.subtitle': 'No registration, no app, no inbox to manage. Just the bot.',
  'how.s1.title': 'Press /start',
  'how.s1.text': 'Open the bot and send /start. You instantly get a fresh address like x7k2p9a1@mailbot.click.',
  'how.s2.title': 'Use it anywhere',
  'how.s2.text': 'Paste the address into any signup or login form that emails you a code or a link.',
  'how.s3.title': 'Code lands in chat',
  'how.s3.text': 'The email arrives in your Telegram chat — the OTP code highlighted on the first line, ready to copy.',

  'features.title': 'Built for catching codes',
  'features.subtitle': 'A focused tool, not another inbox.',
  'features.f1.title': 'OTP on the first line',
  'features.f1.text': 'Smart scoring extracts the verification code and puts it first — tap to copy. No digging through the email.',
  'features.f2.title': '24-hour addresses',
  'features.f2.text': 'Each address lives a day, then expires on its own. Need a new one? Just tap "New address".',
  'features.f3.title': 'Nothing stored',
  'features.f3.text': 'Emails are delivered to your chat and not kept on our side. The message lives in Telegram, with you.',
  'features.f4.title': 'Private by design',
  'features.f4.text': 'Keep your real inbox clean and out of spam lists. Use a throwaway address for one-off signups.',
  'features.f5.title': 'Edge-fast',
  'features.f5.text': "Runs entirely on Cloudflare's edge. Codes typically reach your chat within seconds of arrival.",
  'features.f6.title': 'No signup, free',
  'features.f6.text': "No account, no email, no password. Open the bot in Telegram and you're ready.",

  'faq.title': 'FAQ',
  'faq.q1.q': 'Is it really free?',
  'faq.q1.a': 'Yes. No account, no payment, nothing to sign up for. Open the bot and use it.',
  'faq.q2.q': 'What happens after 24 hours?',
  'faq.q2.a': 'The address expires and stops receiving mail. Messages already delivered stay in your Telegram chat.',
  'faq.q3.q': 'Do you store my emails?',
  'faq.q3.a': "No. Mail is parsed at the edge and forwarded to your chat. We don't keep the contents on our side.",
  'faq.q4.q': 'Can I send email from the address?',
  'faq.q4.a': "No — it's receive-only, built for catching one-time codes and confirmation links.",
  'faq.q5.q': 'Should I use it for important accounts?',
  'faq.q5.a': "No. It's a throwaway address: temporary by design. Use your real inbox for anything you need to keep.",
  'faq.q6.q': "What if the code isn't detected?",
  'faq.q6.a': "The full email still arrives in your chat — you'll see the code in the body. We only highlight it when we're confident.",

  'cta.title': 'Grab a disposable address now',
  'cta.text': 'It takes one tap. The bot does the rest.',
  'cta.button': 'Open in Telegram',

  'footer.copy': '© {year} MailBot',
  'footer.telegram': 'Telegram bot',
};

export default en;
