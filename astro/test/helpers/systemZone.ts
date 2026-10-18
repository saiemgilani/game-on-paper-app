import { expect, vi } from 'vitest';

// The caller restores the zone with vi.unstubAllEnvs() in afterEach.
/**
 * Set the process's system zone, the one a call with no `timeZone` uses (the page script and the chart
 * both make that call). Node re-reads TZ whenever process.env.TZ is assigned, so this works mid-run;
 * the sanity checks prove the zone actually moved rather than trusting the stub.
 */
export function useSystemZone(zone: string, offsetMinutes: number, at: string) {
    vi.stubEnv('TZ', zone);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
    expect(new Date(at).getTimezoneOffset()).toBe(offsetMinutes);
}
