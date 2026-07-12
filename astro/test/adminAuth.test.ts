import { describe, expect, test } from 'vitest';
import { checkBasicAuth } from '../src/lib/adminAuth';

describe('checkBasicAuth', () => {
  const good = 'Basic ' + btoa('gop:sekret');
  test('rejects when creds unset', () => {
    expect(checkBasicAuth(good, undefined, undefined)).toBe(false);
    expect(checkBasicAuth(good, 'gop', undefined)).toBe(false);
  });
  test('rejects missing/wrong header', () => {
    expect(checkBasicAuth(null, 'gop', 'sekret')).toBe(false);
    expect(checkBasicAuth('Basic ' + btoa('gop:wrong'), 'gop', 'sekret')).toBe(false);
    expect(checkBasicAuth('Basic ' + btoa('gop:sekretbutlonger'), 'gop', 'sekret')).toBe(false);
  });
  test('accepts valid', () => {
    expect(checkBasicAuth(good, 'gop', 'sekret')).toBe(true);
  });
});
