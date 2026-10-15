import { describe, expect, it } from 'vitest';
import { classify, DEFAULT_CLASSES, inMetropole, parseDay } from '../src/domain';
import { HUNTING, resolveDept, seasonStatus } from '../src/hunting';
import { clientKey, MemoryRateLimiter } from '../src/rate-limit';
import { resolveSpecies } from '../src/species';
import { frenchSpacing, longDate, parisToday, relativeLabel } from '../src/text';
import { splitQuery } from '../src/tools/geocode';
import { isStale } from '../src/tools/rules';
import { Http, UpstreamError, type EdgeCache } from '../src/upstream';
import { z } from 'zod';

describe('text', () => {
  it('counts days in Paris time across the October clock change', () => {
    expect(parisToday(new Date('2026-10-15T22:30:00Z'))).toBe('2026-10-16');
    expect(parisToday(new Date('2026-12-01T22:30:00Z'))).toBe('2026-12-01');
    expect(parisToday(new Date('2026-12-01T23:30:00Z'))).toBe('2026-12-02');
  });

  it('writes French dates and spacing', () => {
    expect(longDate('2026-10-17')).toBe('samedi 17 octobre');
    expect(relativeLabel('2026-10-18', '2026-10-15')).toBe('J+3');
    expect(frenchSpacing('Oui : « non » ?')).toBe('Oui : « non » ?');
  });
});

describe('domain', () => {
  it('reads days the way people say them', () => {
    const today = '2026-10-15'; // a Thursday
    expect(parseDay('demain', today)).toBe('2026-10-16');
    expect(parseDay('Aujourd’hui', today)).toBe(today);
    expect(parseDay('samedi', today)).toBe('2026-10-17');
    expect(parseDay('jeudi', today)).toBe(today);
    expect(parseDay('J+3', today)).toBe('2026-10-18');
    expect(parseDay('18/10', today)).toBe('2026-10-18');
    expect(parseDay('2026-10-19', today)).toBe('2026-10-19');
    expect(parseDay('2026-02-30', today)).toBeNull();
    expect(parseDay('un jour', today)).toBeNull();
  });

  it('classifies values with the published legend', () => {
    expect(classify(0, 'ok', DEFAULT_CLASSES).classId).toBe('none');
    expect(classify(39, 'ok', DEFAULT_CLASSES).classId).toBe('below');
    expect(classify(40, 'ok', DEFAULT_CLASSES).classId).toBe('usual');
    expect(classify(90, 'ok', DEFAULT_CLASSES).label).toBe('Parmi les meilleurs jours du lieu');
    expect(classify(null, 'ok', DEFAULT_CLASSES).classId).toBe('no_data');
    expect(classify(50, 'out_of_season', DEFAULT_CLASSES).classId).toBe('off_season');
  });

  it('keeps metropolitan France and Corsica only', () => {
    expect(inMetropole(45.27, 1.77)).toBe(true);
    expect(inMetropole(42.2, 9.0)).toBe(true);
    expect(inMetropole(16.25, -61.58)).toBe(false);
    expect(inMetropole(40.4, -3.7)).toBe(false);
  });

  it('resolves species from what people type', () => {
    expect(resolveSpecies('Cèpe')?.code).toBe('boletus_edulis_grp');
    expect(resolveSpecies('trompettes-de-la-mort')?.code).toBe('craterellus_cornucopioides');
    expect(resolveSpecies('pied de mouton')?.code).toBe('hydnum_repandum');
    expect(resolveSpecies('lepista_nuda')?.slug).toBe('pieds-bleus');
    expect(resolveSpecies('amanite')).toBeNull();
  });
});

describe('hunting snapshot', () => {
  it('covers the 96 metropolitan départements with sources', () => {
    expect(HUNTING.departements).toHaveLength(96);
    expect(HUNTING.departements.every((d) => d.source === null || d.source.url.startsWith('https://'))).toBe(true);
  });

  it('resolves départements by code or name', () => {
    expect(resolveDept('19')?.name).toBe('Corrèze');
    expect(resolveDept('2a')?.code).toBe('2A');
    expect(resolveDept('la Corrèze')?.code).toBe('19');
    expect(resolveDept('département des Vosges')?.code).toBe('88');
    expect(resolveDept('5')?.code).toBe('05');
    expect(resolveDept('19000')).toBeNull();
  });

  it('knows open, closed and unknown seasons', () => {
    expect(seasonStatus({ opening: '2026-09-13', closing: '2027-02-28' }, '2026-10-15')).toBe('open');
    expect(seasonStatus({ opening: '2026-09-13', closing: '2027-02-28' }, '2027-03-15')).toBe('closed');
    expect(seasonStatus({ opening: null, closing: '2027-02-28' }, '2026-10-15')).toBe('unknown');
  });

  it('flags rules checked more than 13 months ago', () => {
    expect(isStale('2026-10-14', '2026-10-15')).toBe(false);
    expect(isStale('2025-08-01', '2026-10-15')).toBe(true);
  });
});

describe('geocoder query', () => {
  it('drops « près de » and reads hints', () => {
    expect(splitQuery('près de Tulle')).toEqual({ name: 'Tulle', dept: null, postcode: null });
    expect(splitQuery('près d’Ussel')).toMatchObject({ name: 'Ussel' });
    expect(splitQuery('Tulle (19)')).toMatchObject({ name: 'Tulle', dept: '19' });
    expect(splitQuery('Tulle, Corrèze')).toMatchObject({ name: 'Tulle', dept: '19' });
    expect(splitQuery('19000')).toMatchObject({ postcode: '19000' });
    expect(splitQuery('Saint-Martin-de-Ré')).toMatchObject({ name: 'Saint-Martin-de-Ré', dept: null });
  });
});

describe('rate limit fallback', () => {
  it('allows N a minute per key, then refuses, then resets', async () => {
    let t = 1_000_000_000_000;
    const limiter = new MemoryRateLimiter(2, () => t);
    expect((await limiter.limit({ key: 'a' })).success).toBe(true);
    expect((await limiter.limit({ key: 'a' })).success).toBe(true);
    expect((await limiter.limit({ key: 'a' })).success).toBe(false);
    expect((await limiter.limit({ key: 'b' })).success).toBe(true);
    t += 60_000;
    expect((await limiter.limit({ key: 'a' })).success).toBe(true);
  });

  it('never keys on the raw address', async () => {
    const key = await clientKey('203.0.113.7');
    expect(key).toMatch(/^[0-9a-f]{24}$/);
    expect(key).not.toContain('203');
  });
});

describe('upstream client', () => {
  const schema = z.object({ ok: z.boolean() });

  it('serves the second call from the edge cache', async () => {
    const store = new Map<string, string>();
    const cache: EdgeCache = {
      match: async (r) => (store.has(r.url) ? new Response(store.get(r.url)) : undefined),
      put: async (r, res) => void store.set(r.url, await res.text()),
    };
    let calls = 0;
    const http = new Http({ fetcher: { fetch: async () => (calls++, new Response('{"ok":true}')) }, cache });
    await http.getJson('https://x.test/a', schema, 600, 't');
    await http.getJson('https://x.test/a', schema, 600, 't');
    expect(calls).toBe(1);
  });

  it('times out, and rejects bodies that do not match the schema', async () => {
    const slow = new Http({ fetcher: { fetch: (_u, init) => new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))) }, timeoutMs: 20 });
    await expect(slow.getJson('https://x.test/a', schema, 600, 't')).rejects.toMatchObject({ kind: 'timeout' });
    const bad = new Http({ fetcher: { fetch: async () => new Response('{"ok":"yes"}') } });
    await expect(bad.getJson('https://x.test/a', schema, 600, 't')).rejects.toBeInstanceOf(UpstreamError);
    const limited = new Http({ fetcher: { fetch: async () => new Response('{}', { status: 429 }) } });
    await expect(limited.getJson('https://x.test/a', schema, 600, 't')).rejects.toMatchObject({ kind: 'rate_limited' });
  });
});
