import type { MailMessage } from './mailer';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function layout(body: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f172a;line-height:1.5;max-width:560px;margin:auto;padding:24px">${body}<p style="color:#64748b;font-size:12px;margin-top:32px">Ensoftic POS</p></body></html>`;
}

export function passwordResetEmail(input: {
  to: string;
  fullName: string;
  resetUrl: string;
  ttlMinutes: number;
}): MailMessage {
  const name = escapeHtml(input.fullName);
  const url = escapeHtml(input.resetUrl);
  return {
    to: input.to,
    subject: 'Reset your password',
    text: [
      `Hello ${input.fullName},`,
      '',
      'We received a request to reset your password. Open this link to choose a new one:',
      input.resetUrl,
      '',
      `The link expires in ${input.ttlMinutes} minutes and can be used once.`,
      'If you did not request this, you can ignore this email; your password will not change.',
    ].join('\n'),
    html: layout(
      `<p>Hello ${name},</p><p>We received a request to reset your password.</p>` +
        `<p><a href="${url}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Choose a new password</a></p>` +
        `<p>The link expires in ${input.ttlMinutes} minutes and can be used once.</p>` +
        `<p>If you did not request this, you can ignore this email; your password will not change.</p>`,
    ),
  };
}

export function passwordChangedEmail(input: { to: string; fullName: string }): MailMessage {
  const name = escapeHtml(input.fullName);
  return {
    to: input.to,
    subject: 'Your password was changed',
    text: `Hello ${input.fullName},\n\nYour password was just changed and all devices were signed out.\nIf this was not you, reset your password immediately and contact your administrator.`,
    html: layout(
      `<p>Hello ${name},</p><p>Your password was just changed and all devices were signed out.</p>` +
        `<p>If this was not you, reset your password immediately and contact your administrator.</p>`,
    ),
  };
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  MANAGER: 'Manager',
  CASHIER: 'Cashier',
  INVENTORY_STAFF: 'Inventory staff',
};

export function invitationEmail(input: {
  to: string;
  businessName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
  ttlDays: number;
}): MailMessage {
  const role = ROLE_LABELS[input.role] ?? input.role;
  const business = escapeHtml(input.businessName);
  const inviter = escapeHtml(input.inviterName);
  const url = escapeHtml(input.acceptUrl);
  return {
    to: input.to,
    subject: `You're invited to join ${input.businessName}`,
    text: [
      'Hello,',
      '',
      `${input.inviterName} invited you to join ${input.businessName} on Ensoftic POS as ${role}.`,
      'Open this link to accept:',
      input.acceptUrl,
      '',
      `The link expires in ${input.ttlDays} days and can be used once.`,
      'If you were not expecting this, you can ignore this email.',
    ].join('\n'),
    html: layout(
      `<p>Hello,</p><p>${inviter} invited you to join <strong>${business}</strong> on Ensoftic POS as ${escapeHtml(role)}.</p>` +
        `<p><a href="${url}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Accept invitation</a></p>` +
        `<p>The link expires in ${input.ttlDays} days and can be used once.</p>` +
        `<p>If you were not expecting this, you can ignore this email.</p>`,
    ),
  };
}

export function verifyEmailEmail(input: {
  to: string;
  fullName: string;
  verifyUrl: string;
  ttlHours: number;
}): MailMessage {
  const name = escapeHtml(input.fullName);
  const url = escapeHtml(input.verifyUrl);
  return {
    to: input.to,
    subject: 'Confirm your email address',
    text: [
      `Hello ${input.fullName},`,
      '',
      'Please confirm this is your email address by opening this link:',
      input.verifyUrl,
      '',
      `The link expires in ${input.ttlHours} hours and can be used once.`,
      'If you did not create an Ensoftic POS account, you can ignore this email.',
    ].join('\n'),
    html: layout(
      `<p>Hello ${name},</p><p>Please confirm this is your email address.</p>` +
        `<p><a href="${url}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Confirm email</a></p>` +
        `<p>The link expires in ${input.ttlHours} hours and can be used once.</p>` +
        `<p>If you did not create an Ensoftic POS account, you can ignore this email.</p>`,
    ),
  };
}

/** Subscription notices (trial ending, renewal due, payment received, past due, suspended). */
export function billingNoticeEmail(input: {
  to: string;
  subject: string;
  paragraphs: string[];
  actionUrl: string;
  actionLabel: string;
}): MailMessage {
  const url = escapeHtml(input.actionUrl);
  return {
    to: input.to,
    subject: input.subject,
    text: [...input.paragraphs, '', `${input.actionLabel}: ${input.actionUrl}`].join('\n\n'),
    html: layout(
      input.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('') +
        `<p><a href="${url}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escapeHtml(input.actionLabel)}</a></p>`,
    ),
  };
}

/** The morning digest: stock alerts and, for managers, yesterday's sales. */
export function digestEmail(input: {
  to: string;
  fullName: string;
  businessName: string;
  lines: string[];
  url: string;
}): MailMessage {
  const name = escapeHtml(input.fullName);
  const business = escapeHtml(input.businessName);
  const url = escapeHtml(input.url);
  return {
    to: input.to,
    subject: `${input.businessName}: your morning summary`,
    text: [
      `Good morning ${input.fullName},`,
      '',
      ...input.lines.map((line) => `- ${line}`),
      '',
      `Details: ${input.url}`,
      'You can turn these e-mails off on the Notifications page.',
    ].join('\n'),
    html: layout(
      `<p>Good morning ${name},</p><p>Here is what needs attention at <strong>${business}</strong>:</p>` +
        `<ul>${input.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` +
        `<p><a href="${url}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open notifications</a></p>` +
        `<p style="color:#64748b;font-size:12px">You can turn these e-mails off on the Notifications page.</p>`,
    ),
  };
}

/**
 * A business's marketing e-mail to one customer. The body is the owner's plain
 * text (escaped, line breaks kept); every message carries the opt-out link,
 * also as List-Unsubscribe so mail apps can offer it.
 */
export function campaignEmail(input: {
  to: string;
  subject: string;
  body: string;
  businessName: string;
  unsubscribeUrl: string;
}): MailMessage {
  const business = escapeHtml(input.businessName);
  const url = escapeHtml(input.unsubscribeUrl);
  const paragraphs = input.body
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replaceAll('\n', '<br>')}</p>`)
    .join('');
  return {
    to: input.to,
    subject: input.subject,
    text: [
      input.body,
      '',
      '--',
      `${input.businessName}`,
      `You receive this because you agreed to messages from ${input.businessName}.`,
      `Stop these messages: ${input.unsubscribeUrl}`,
    ].join('\n'),
    html:
      `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f172a;line-height:1.5;max-width:560px;margin:auto;padding:24px">` +
      `<p style="font-weight:600">${business}</p>${paragraphs}` +
      `<p style="color:#64748b;font-size:12px;margin-top:32px">You receive this because you agreed to messages from ${business}. ` +
      `<a href="${url}" style="color:#64748b">Stop these messages</a>.</p></body></html>`,
    headers: { 'List-Unsubscribe': `<${input.unsubscribeUrl}>` },
  };
}
