import { describe, expect, it } from 'vitest';
import {
  isSriLankanMobile,
  personalise,
  smsBodyLimit,
  smsLength,
  smsOptOutLine,
} from './messaging';

describe('SMS length', () => {
  it('counts GSM-7 text in 160/153-character parts', () => {
    expect(smsLength('Hello Nimali, 20% off this week!')).toEqual({
      unicode: false,
      length: 32,
      segments: 1,
    });
    expect(smsLength('a'.repeat(160)).segments).toBe(1);
    expect(smsLength('a'.repeat(161)).segments).toBe(2);
    expect(smsLength('a'.repeat(306)).segments).toBe(2);
    expect(smsLength('a'.repeat(307)).segments).toBe(3);
    // Extension characters count twice.
    expect(smsLength('€10 [sale]')).toMatchObject({ unicode: false, length: 13 });
  });

  it('switches to Unicode for Sinhala and Tamil, with 70/67-character parts', () => {
    expect(smsLength('ආයුබෝවන්')).toMatchObject({ unicode: true, segments: 1 });
    expect(smsLength('வணக்கம் '.repeat(10))).toMatchObject({ unicode: true, segments: 2 });
    expect(smsLength('x'.repeat(70) + 'අ').segments).toBe(2);
  });
});

describe('message text', () => {
  it('puts in the first name and tidies up when there is none', () => {
    expect(personalise('Hi {name}, new sarees are in!', 'Nimali Perera')).toBe(
      'Hi Nimali, new sarees are in!',
    );
    expect(personalise('Hi {name}, new sarees are in!', '  ')).toBe('Hi, new sarees are in!');
  });

  it('leaves room for the opt-out line and names', () => {
    expect(smsOptOutLine('https://pos.lk/u/abc')).toBe('\nStop: https://pos.lk/u/abc');
    expect(smsBodyLimit(30, 0)).toBe(621 - 37);
    expect(smsBodyLimit(30, 2)).toBe(621 - 37 - 40);
  });

  it('recognises Sri Lankan mobile numbers', () => {
    expect(isSriLankanMobile('+94771234567')).toBe(true);
    expect(isSriLankanMobile('+94112345678')).toBe(false); // landline
    expect(isSriLankanMobile('+447700900123')).toBe(false);
  });
});
