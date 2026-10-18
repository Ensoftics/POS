import { resolveApiUrl } from '@/lib/api';

describe('API address', () => {
  it('uses the emulator host only in development', () => {
    expect(resolveApiUrl(undefined, true)).toBe('http://10.0.2.2:4000/api/v1');
    expect(resolveApiUrl('http://192.168.1.10:4000/api/v1', true)).toBe(
      'http://192.168.1.10:4000/api/v1',
    );
  });

  it('requires https in release builds', () => {
    expect(resolveApiUrl('https://api.example.lk/api/v1', false)).toBe(
      'https://api.example.lk/api/v1',
    );
    expect(() => resolveApiUrl(undefined, false)).toThrow(/https/);
    expect(() => resolveApiUrl('http://api.example.lk/api/v1', false)).toThrow(/https/);
  });
});
