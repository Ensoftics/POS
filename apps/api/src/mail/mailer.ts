export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, e.g. List-Unsubscribe on marketing e-mail. */
  headers?: Record<string, string>;
}

/**
 * Outbound email port. The SMTP adapter covers any provider with SMTP relay
 * (Mailpit locally; SES, Postmark, SendGrid etc. in production). Swap the
 * provider binding in MailModule to use an HTTP API adapter instead.
 */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}
