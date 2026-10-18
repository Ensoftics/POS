import { Inject, Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { type MailMessage, Mailer } from './mailer';

@Injectable()
export class SmtpMailer extends Mailer {
  private readonly transport: Transporter;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
    this.transport = createTransport(config.SMTP_URL);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.config.MAIL_FROM, ...message });
  }
}
