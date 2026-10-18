import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

export type SmsResult = { ok: true } | { ok: false; retry: boolean; reason: string };

/** Outbound SMS port; Notify.lk below. Tests bind a recording sender instead. */
export abstract class SmsSender {
  abstract get available(): boolean;
  /** `to` is E.164 (+947XXXXXXXX). Never throws: failures come back as results. */
  abstract send(to: string, text: string, unicode: boolean): Promise<SmsResult>;
}

/**
 * Notify.lk (https://developer.notify.lk/api-endpoints/): POST /api/v1/send with
 * user_id, api_key, sender_id, to (94XXXXXXXXX) and message; `type=unicode` for
 * Sinhala and Tamil. Replies {"status":"success","data":"Sent"} on success.
 * Credentials go in the form body, so they never appear in URLs or logs.
 */
@Injectable()
export class NotifyLkSms extends SmsSender {
  private readonly logger = new Logger('NotifyLkSms');

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }

  get available(): boolean {
    return !!(
      this.config.NOTIFYLK_USER_ID &&
      this.config.NOTIFYLK_API_KEY &&
      this.config.NOTIFYLK_SENDER_ID
    );
  }

  async send(to: string, text: string, unicode: boolean): Promise<SmsResult> {
    if (!this.available) return { ok: false, retry: false, reason: 'sms_not_configured' };
    const form = new URLSearchParams({
      user_id: this.config.NOTIFYLK_USER_ID!,
      api_key: this.config.NOTIFYLK_API_KEY!,
      sender_id: this.config.NOTIFYLK_SENDER_ID!,
      to: to.replace(/^\+/, ''),
      message: text,
      ...(unicode ? { type: 'unicode' } : {}),
    });
    try {
      const response = await fetch(this.config.NOTIFYLK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: AbortSignal.timeout(15_000),
      });
      const payload = (await response.json().catch(() => null)) as {
        status?: string;
        message?: string;
      } | null;
      if (response.ok && payload?.status === 'success') return { ok: true };
      // Server-side trouble is worth retrying; a refused request (bad number, no credit) is not.
      const retry = response.status >= 500 || response.status === 429;
      const reason = `gateway_${response.status}${payload?.message ? `: ${payload.message}` : ''}`;
      this.logger.warn({ msg: 'sms refused', status: response.status, retry });
      return { ok: false, retry, reason: reason.slice(0, 200) };
    } catch (error) {
      this.logger.warn({
        msg: 'sms request failed',
        error: error instanceof Error ? error.name : 'Error',
      });
      return { ok: false, retry: true, reason: 'gateway_unreachable' };
    }
  }
}
