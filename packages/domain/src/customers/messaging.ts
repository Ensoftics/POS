/** Customer messaging: message text rules shared by the API and the apps. */

export const MESSAGE_CHANNELS = ['EMAIL', 'SMS'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/** The SMS gateway's limit for one message, including the opt-out line. */
export const SMS_MAX_CHARS = 621;
export const EMAIL_MAX_CHARS = 2000;
/** Placeholder replaced by the customer's first name. */
export const NAME_PLACEHOLDER = '{name}';

// GSM 03.38 basic character set; anything else makes the message Unicode.
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
// Extension characters take two places each.
const GSM_EXTENDED = '^{}\\[~]|€\f';

export interface SmsLength {
  /** Unicode is needed for Sinhala, Tamil and other characters outside GSM-7. */
  unicode: boolean;
  /** Characters as the network counts them. */
  length: number;
  /** Billable parts: 160/153 per part in GSM-7, 70/67 in Unicode. */
  segments: number;
}

export function smsLength(text: string): SmsLength {
  let gsmLength = 0;
  let unicode = false;
  for (const char of text) {
    if (GSM_BASIC.includes(char)) gsmLength += 1;
    else if (GSM_EXTENDED.includes(char)) gsmLength += 2;
    else {
      unicode = true;
      break;
    }
  }
  if (unicode) {
    // UTF-16 code units: characters outside the BMP (emoji) take two.
    const length = text.length;
    return { unicode, length, segments: length <= 70 ? 1 : Math.ceil(length / 67) };
  }
  return {
    unicode,
    length: gsmLength,
    segments: gsmLength <= 160 ? 1 : Math.ceil(gsmLength / 153),
  };
}

/** Fills in {name} with the customer's first name (or nothing) and tidies spaces it leaves. */
export function personalise(body: string, customerName: string): string {
  const first = customerName.trim().split(/\s+/)[0] ?? '';
  return body
    .replaceAll(NAME_PLACEHOLDER, first)
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** The line added to every SMS so the customer can stop messages. */
export function smsOptOutLine(url: string): string {
  return `\nStop: ${url}`;
}

/**
 * The longest body (before personalisation) that still fits one SMS with the
 * opt-out line. Names are counted at a generous 20 characters.
 */
export function smsBodyLimit(optOutUrlLength: number, placeholders: number): number {
  return SMS_MAX_CHARS - smsOptOutLine('x'.repeat(optOutUrlLength)).length - placeholders * 20;
}

/** Sri Lankan mobile numbers in E.164 (+947XXXXXXXX), the ones the SMS gateway delivers to. */
export function isSriLankanMobile(e164: string): boolean {
  return /^\+947\d{8}$/.test(e164);
}
