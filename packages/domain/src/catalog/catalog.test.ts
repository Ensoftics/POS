import { describe, expect, it } from 'vitest';
import {
  checkBarcode,
  disallowedAttributes,
  formatMoney,
  minorToDecimalString,
  parseCsv,
  parseMoney,
  parseQuantity,
  toCsv,
  toCsvCell,
  variantAttributesKey,
} from '../index';

describe('money', () => {
  it('parses decimal input into minor units without floating point', () => {
    expect(parseMoney('1,250.5', 'LKR')).toEqual({ ok: true, minor: 125050 });
    expect(parseMoney('0.1', 'LKR')).toEqual({ ok: true, minor: 10 });
    expect(parseMoney('0.29', 'LKR')).toEqual({ ok: true, minor: 29 }); // 0.29*100 = 28.999… in floats
    expect(parseMoney('100', 'JPY')).toEqual({ ok: true, minor: 100 });
    expect(parseMoney(' 007 ', 'LKR')).toEqual({ ok: true, minor: 700 });
  });

  it('rejects malformed, negative, over-precise and huge amounts', () => {
    expect(parseMoney('12.345', 'LKR')).toEqual({ ok: false, issue: 'too_many_decimals' });
    expect(parseMoney('1.5', 'JPY')).toEqual({ ok: false, issue: 'too_many_decimals' });
    expect(parseMoney('-1', 'LKR')).toEqual({ ok: false, issue: 'negative' });
    expect(parseMoney('1e5', 'LKR')).toEqual({ ok: false, issue: 'invalid' });
    expect(parseMoney('', 'LKR')).toEqual({ ok: false, issue: 'invalid' });
    expect(parseMoney('99999999999999', 'LKR')).toEqual({ ok: false, issue: 'too_large' });
  });

  it('formats minor units back to strings', () => {
    expect(minorToDecimalString(125050, 'LKR')).toBe('1250.50');
    expect(minorToDecimalString(5, 'LKR')).toBe('0.05');
    expect(minorToDecimalString(300, 'JPY')).toBe('300');
    expect(formatMoney(125050, 'USD', 'en-US')).toBe('$1,250.50');
  });
});

describe('barcodes', () => {
  it('accepts valid GTINs and internal codes', () => {
    expect(checkBarcode('4006381333931')).toBeNull(); // EAN-13
    expect(checkBarcode('036000291452')).toBeNull(); // UPC-A
    expect(checkBarcode('96385074')).toBeNull(); // EAN-8
    expect(checkBarcode('SHOP-0001')).toBeNull();
  });

  it('rejects bad check digits and illegal characters', () => {
    expect(checkBarcode('4006381333932')).toBe('checksum');
    expect(checkBarcode('ab')).toBe('invalid');
    expect(checkBarcode('has space')).toBe('invalid');
  });
});

describe('quantities', () => {
  it('normalises decimals and enforces whole units', () => {
    expect(parseQuantity('2.500', { allowFraction: true })).toEqual({ ok: true, value: '2.5' });
    expect(parseQuantity('2.5', { allowFraction: false })).toEqual({
      ok: false,
      issue: 'fraction_not_allowed',
    });
    expect(parseQuantity('3.0', { allowFraction: false })).toEqual({ ok: true, value: '3' });
    expect(parseQuantity('1.2345', { allowFraction: true })).toEqual({
      ok: false,
      issue: 'too_many_decimals',
    });
  });
});

describe('variant attributes', () => {
  it('builds an order- and case-insensitive key', () => {
    expect(variantAttributesKey({ size: 'M', colour: 'Red' })).toBe(
      variantAttributesKey({ colour: ' red ', size: 'm' }),
    );
    expect(variantAttributesKey({})).toBe('');
  });

  it('reports attributes the business has not enabled', () => {
    expect(disallowedAttributes({ shade: '01', size: 'M' }, ['size'])).toEqual(['shade']);
  });
});

describe('csv', () => {
  it('parses quotes, commas, newlines and a BOM', () => {
    const text = '﻿name,price\r\n"Lipstick, red","1,200.00"\n"Say ""hi""",5\n\n"multi\nline",1\n';
    expect(parseCsv(text)).toEqual([
      ['name', 'price'],
      ['Lipstick, red', '1,200.00'],
      ['Say "hi"', '5'],
      ['multi\nline', '1'],
    ]);
  });

  it('rejects unterminated quotes', () => {
    expect(() => parseCsv('"oops')).toThrow(/Unterminated/);
  });

  it('round-trips and neutralises formulas', () => {
    expect(toCsvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(toCsvCell('+94 77')).toBe("'+94 77");
    expect(toCsvCell(-5)).toBe('-5'); // numbers are not text formulas
    const csv = toCsv([
      ['a,b', 'c'],
      [null, 'line\nbreak'],
    ]);
    expect(parseCsv(csv)).toEqual([
      ['a,b', 'c'],
      ['', 'line\nbreak'],
    ]);
  });
});
