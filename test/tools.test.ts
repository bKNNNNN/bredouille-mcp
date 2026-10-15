import { describe, expect, it } from 'vitest';
import { SAFETY_LINE } from '../src/text';
import { WIDGET_MIME, WIDGET_URI } from '../src/widget';
import { connectedClient, mockFetch, testContext, textOf } from './helpers';

const TULLE = { lat: 45.27, lon: 1.77 };

/** Every answer ends with the safety line and a bredouille.app link. */
function expectFooter(text: string): void {
  expect(text).toContain(SAFETY_LINE);
  expect(text).toMatch(/Sur bredouille\.app : https:\/\/bredouille\.app\/\S*$/);
}

function expectFrenchTypography(text: string): void {
  expect(text).not.toMatch(/[–—]/);
  expect(text).not.toMatch(/ [:;?!»]/);
  expect(text).not.toMatch(/« /);
}

const call = async (name: string, args: Record<string, unknown>, fetcher = mockFetch()) => {
  const client = await connectedClient(testContext(fetcher));
  const result = await client.callTool({ name, arguments: args });
  await client.close();
  return result;
};

describe('tools/list', () => {
  it('lists the six tools with French descriptions, read-only hints and the widget template', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['conditions_lieu', 'fiabilite', 'geocoder', 'meilleurs_jours', 'pourquoi', 'regles_et_chasse']);
    for (const t of tools) {
      expect(t.description).toBeTruthy();
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.annotations?.destructiveHint).toBe(false);
      expect(t.title).toBeTruthy();
      expectFrenchTypography(t.description!);
    }
    const conditions = tools.find((t) => t.name === 'conditions_lieu')!;
    expect(conditions._meta?.['openai/outputTemplate']).toBe(WIDGET_URI);
    expect((conditions._meta?.ui as { resourceUri: string }).resourceUri).toBe(WIDGET_URI);
    expect(conditions.inputSchema.required).toEqual(['lat', 'lon']);
    await client.close();
  });

  it('serves the species list, the reading guide and the widget as resources', async () => {
    const client = await connectedClient();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(['bredouille://especes', 'bredouille://lire-l-indice', WIDGET_URI].sort());
    const species = await client.readResource({ uri: 'bredouille://especes' });
    const text = (species.contents[0] as { text: string }).text;
    expect(text).toContain('boletus_edulis_grp | Cèpes');
    expect(text).toContain('vérifié');
    const widget = await client.readResource({ uri: WIDGET_URI });
    const w = widget.contents[0] as { mimeType: string; text: string; _meta: Record<string, unknown> };
    expect(w.mimeType).toBe(WIDGET_MIME);
    expect(w.text).toContain('Ouvrir sur bredouille.app');
    expect(w.text).toContain('#a84e32');
    expect(w._meta['openai/widgetCSP']).toEqual({ connect_domains: [], resource_domains: [], redirect_domains: ['https://bredouille.app'] });
    await client.close();
  });
});

describe('conditions_lieu', () => {
  it('gives 8 dated days for one species, with the place name and the species page', async () => {
    const fetcher = mockFetch();
    const result = await call('conditions_lieu', { ...TULLE, espece: 'cèpes' }, fetcher);
    const text = textOf(result);
    expect(text).toContain('près de Tulle (Corrèze)');
    expect(text).toContain('jeudi 15 octobre (aujourd’hui) : Moins bon que d’habitude');
    expect(text).toContain('jeudi 22 octobre (J+7, prévision) : Habituel');
    expect(text.match(/^- /gm)).toHaveLength(8);
    expect(text).toContain('https://bredouille.app/champignons/cepes/');
    expectFooter(text);
    expectFrenchTypography(text);
    const s = (result as unknown as { structuredContent: { rows: { days: unknown[] }[]; place: string } }).structuredContent;
    expect(s.rows[0]!.days).toHaveLength(8);
    expect(s.place).toBe('Tulle (Corrèze)');
  });

  it('never sends the exact coordinates upstream and never prints the cell coordinates', async () => {
    const fetcher = mockFetch();
    const result = await call('conditions_lieu', { lat: 45.268512, lon: 1.766321 }, fetcher);
    const point = fetcher.calls.find((u) => u.pathname === '/api/point')!;
    expect(point.searchParams.get('lat')).toBe('45.27');
    expect(point.searchParams.get('lon')).toBe('1.77');
    expect(textOf(result)).not.toMatch(/45[.,]27|1[.,]7[67]/);
  });

  it('summarises every species without a species, and one day with a day', async () => {
    const all = textOf(await call('conditions_lieu', TULLE));
    expect(all).toContain('- Morilles : aujourd’hui hors saison');
    expect(all).toContain('https://bredouille.app/#carte');
    const one = textOf(await call('conditions_lieu', { ...TULLE, jour: 'samedi' }));
    expect(one).toContain('samedi 17 octobre (J+2)');
  });

  it('refuses politely outside metropolitan France, and at sea or abroad inside the box', async () => {
    const far = textOf(await call('conditions_lieu', { lat: 40.4, lon: -3.7 }));
    expect(far).toContain('hors de la carte');
    expectFooter(far);
    const empty = { run_date: '2026-10-15', cell: { lon: 4.35, lat: 50.85 }, species: [{ code: 'boletus_edulis_grp', days: [{ day: '2026-10-15', status: 'ok', value: null }] }] };
    const brussels = textOf(await call('conditions_lieu', { lat: 50.85, lon: 4.35 }, mockFetch((u) => (u.pathname === '/api/point' ? { status: 200, body: empty } : null))));
    expect(brussels).toContain('hors de la carte');
  });

  it('refuses an unknown species, a day it cannot read and a day out of range', async () => {
    expect(textOf(await call('conditions_lieu', { ...TULLE, espece: 'amanite' }))).toContain('Espèce inconnue');
    expect(textOf(await call('conditions_lieu', { ...TULLE, jour: 'bientôt' }))).toContain('Jour non compris');
    expect(textOf(await call('conditions_lieu', { ...TULLE, jour: '2026-11-30' }))).toContain('J+7');
  });

  it('says the source is down, without detail, when the API fails', async () => {
    const result = await call('conditions_lieu', TULLE, mockFetch((u) => (u.pathname === '/api/point' ? { status: 503, body: { error: 'x' } } : null)));
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('ne répond pas');
    expectFooter(textOf(result));
  });

  it('rejects invalid coordinates at the schema', async () => {
    const result = await call('conditions_lieu', { lat: 'abc', lon: 1 });
    expect(result.isError).toBe(true);
  });
});

describe('meilleurs_jours', () => {
  it('is honest when no day reaches the usual level', async () => {
    const text = textOf(await call('meilleurs_jours', { ...TULLE, espece: 'girolles' }));
    expect(text).toContain('Aucun jour n’atteint le niveau habituel');
    expectFooter(text);
  });

  it('names the usual days when nothing is above usual', async () => {
    const text = textOf(await call('meilleurs_jours', { ...TULLE, espece: 'boletus_edulis_grp' }));
    expect(text).toContain('Aucun jour au-dessus de l’habituel cette semaine');
    expect(text).toContain('mardi 20 octobre');
  });

  it('names the best days when some are better than usual', async () => {
    const better = {
      run_date: '2026-10-15',
      cell: { lon: 1.77, lat: 45.27 },
      species: [{ code: 'boletus_edulis_grp', days: ['15', '16', '17', '18', '19', '20', '21', '22'].map((d, i) => ({ day: `2026-10-${d}`, status: 'ok', value: [30, 50, 75, 92, 91, 60, 40, 20][i]! })) }],
    };
    const result = await call('meilleurs_jours', { ...TULLE, espece: 'cepes' }, mockFetch((u) => (u.pathname === '/api/point' ? { status: 200, body: better } : null)));
    const text = textOf(result);
    expect(text).toContain('Meilleurs jours de la semaine : dimanche 18 octobre (J+3), lundi 19 octobre (J+4)');
    expect((result as unknown as { structuredContent: { highlight: string } }).structuredContent.highlight).toBe('2026-10-18');
  });
});

describe('pourquoi', () => {
  it('explains the limiting factor, rain, soil and temperature in plain French', async () => {
    const text = textOf(await call('pourquoi', { ...TULLE, espece: 'cèpes', jour: 'demain' }));
    expect(text).toContain('vendredi 16 octobre (demain)');
    expect(text).toContain('Ce qui freine surtout : l’humidité du sol.');
    expect(text).toMatch(/Pluie : \d+ mm tombés entre 1 et 4 semaines avant/);
    expect(text).toContain('Sol : plus sec que d’habitude');
    expect(text).toContain('Météo prévue');
    expectFooter(text);
    expectFrenchTypography(text);
  });
});

describe('geocoder', () => {
  it('resolves « près de Tulle » with attribution', async () => {
    const fetcher = mockFetch();
    const text = textOf(await call('geocoder', { lieu: 'près de Tulle' }, fetcher));
    expect(fetcher.calls.some((u) => u.searchParams.get('nom') === 'Tulle')).toBe(true);
    expect(text).toContain('Tulle (Corrèze) : lat 45.2685, lon 1.7663');
    expect(text).toContain('geo.api.gouv.fr');
    expectFooter(text);
  });

  it('uses a département hint and says when nothing is found', async () => {
    const fetcher = mockFetch();
    await call('geocoder', { lieu: 'Tulle (19)' }, fetcher);
    expect(fetcher.calls.find((u) => u.searchParams.get('nom') === 'Tulle')?.searchParams.get('codeDepartement')).toBe('19');
    expect(textOf(await call('geocoder', { lieu: 'Atlantide' }))).toContain('Aucune commune');
  });
});

describe('fiabilite', () => {
  it('gives the published score and status', async () => {
    const text = textOf(await call('fiabilite', { espece: 'cepes' }));
    expect(text).toContain('Cèpes : indice vérifié.');
    expect(text).toContain('Score : 0,61');
    expect(text).toContain('https://bredouille.app/especes/cepes/');
    expect(text).toContain('https://bredouille.app/fiabilite/');
    expectFooter(text);
    expect(textOf(await call('fiabilite', { espece: 'morille' }))).toContain('indice à confirmer');
  });
});

describe('regles_et_chasse', () => {
  it('gives the rules found and the hunting dates with sources', async () => {
    const text = textOf(await call('regles_et_chasse', { departement: 'Vosges' }));
    expect(text).toContain('Vosges (88)');
    expect(text).toContain('5 litres par personne');
    expect(text).toContain('ouverture générale le 20 septembre 2026');
    expect(text).toContain('legifrance.gouv.fr');
    expectFooter(text);
  });

  it('says « à vérifier en préfecture » when nothing was read', async () => {
    const text = textOf(await call('regles_et_chasse', { departement: '2A' }));
    expect(text).toContain('Corse-du-Sud (2A)');
    expect(text).toContain('à vérifier en préfecture');
  });

  it('still answers the hunting part when the rules file is down', async () => {
    const text = textOf(await call('regles_et_chasse', { departement: 'correze' }, mockFetch((u) => (u.pathname === '/out/access/rules.json' ? { status: 500, body: {} } : null))));
    expect(text).toContain('Règles indisponibles');
    expect(text).toContain('Chasse 2026-2027');
  });

  it('refuses an unknown département', async () => {
    expect(textOf(await call('regles_et_chasse', { departement: 'Atlantide' }))).toContain('Département non reconnu');
  });
});
