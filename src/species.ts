import { fold } from './text';

/**
 * The species Bredouille maps. Codes are the API's; slugs are the public pages
 * on bredouille.app (/especes/<slug>/, /champignons/<slug>/). Names are for
 * matching what people type; the live list and status come from the manifest.
 */
export interface SpeciesInfo {
  readonly code: string;
  readonly slug: string;
  /** Plural, as on the site: « Cèpes ». */
  readonly name: string;
  readonly latin: string;
  readonly aliases: readonly string[];
}

export const SPECIES: readonly SpeciesInfo[] = [
  { code: 'boletus_edulis_grp', slug: 'cepes', name: 'Cèpes', latin: 'Boletus edulis et espèces proches', aliases: ['cepe', 'cepes', 'cepe de bordeaux', 'boletus edulis', 'bolet', 'bolets', 'cepes de bordeaux'] },
  { code: 'cantharellus_cibarius', slug: 'girolles', name: 'Girolles', latin: 'Cantharellus cibarius', aliases: ['girolle', 'girolles', 'chanterelle', 'chanterelles', 'cantharellus cibarius'] },
  { code: 'craterellus_cornucopioides', slug: 'trompettes-de-la-mort', name: 'Trompettes de la mort', latin: 'Craterellus cornucopioides', aliases: ['trompette de la mort', 'trompettes de la mort', 'trompette des morts', 'trompettes des morts', 'trompette', 'trompettes', 'craterelle', 'craterelles', 'craterellus cornucopioides'] },
  { code: 'craterellus_tubaeformis', slug: 'chanterelles-en-tube', name: 'Chanterelles en tube', latin: 'Craterellus tubaeformis', aliases: ['chanterelle en tube', 'chanterelles en tube', 'chanterelle grise', 'craterellus tubaeformis'] },
  { code: 'morchella_spp', slug: 'morilles', name: 'Morilles', latin: 'Morchella', aliases: ['morille', 'morilles', 'morchella'] },
  { code: 'hydnum_repandum', slug: 'pieds-de-mouton', name: 'Pieds-de-mouton', latin: 'Hydnum repandum', aliases: ['pied de mouton', 'pieds de mouton', 'hydne', 'hydne sinue', 'hydnum repandum'] },
  { code: 'imleria_badia', slug: 'bolets-bais', name: 'Bolets bais', latin: 'Imleria badia', aliases: ['bolet bai', 'bolets bais', 'imleria badia', 'xerocomus badius'] },
  { code: 'lepista_nuda', slug: 'pieds-bleus', name: 'Pieds bleus', latin: 'Lepista nuda', aliases: ['pied bleu', 'pieds bleus', 'lepiste nu', 'lepiste nue', 'lepista nuda'] },
];

const INDEX: ReadonlyMap<string, SpeciesInfo> = (() => {
  const m = new Map<string, SpeciesInfo>();
  for (const s of SPECIES) {
    for (const key of [s.code, s.slug, s.name, s.latin, ...s.aliases]) m.set(fold(key), s);
  }
  return m;
})();

/** Code, slug, French or Latin name, singular or plural, with or without accents. */
export function resolveSpecies(input: string): SpeciesInfo | null {
  const key = fold(input);
  if (!key) return null;
  return INDEX.get(key) ?? INDEX.get(key.replace(/s$/, '')) ?? INDEX.get(`${key}s`) ?? null;
}

export function speciesByCode(code: string): SpeciesInfo | null {
  return SPECIES.find((s) => s.code === code) ?? null;
}

export const speciesNames = (): string => SPECIES.map((s) => s.name.toLowerCase()).join(', ');
