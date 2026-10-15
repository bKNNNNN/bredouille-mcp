import {
  AccuracySchema,
  CommunesSchema,
  DriversSchema,
  ManifestSchema,
  PointSchema,
  RulesSchema,
  type Accuracy,
  type Commune,
  type DriversResponse,
  type Manifest,
  type PointResponse,
  type Rules,
} from './schemas';
import type { Http } from './upstream';

/** Edge cache lifetime of Bredouille answers: the map changes once a day, 10 minutes is plenty. */
export const API_TTL_SECONDS = 600;
/** Communes and départements barely change. */
export const GEO_TTL_SECONDS = 86_400;

export const GEO_API_URL = 'https://geo.api.gouv.fr';

/**
 * Coordinates go upstream rounded to 0.01° (about 1 km), the grid the map
 * publishes. The API never learns a finer place, and nearby questions share
 * one cache entry.
 */
export const roundCoord = (v: number): string => v.toFixed(2);

export interface DataSource {
  manifest(): Promise<Manifest>;
  point(lat: number, lon: number, species?: string): Promise<PointResponse>;
  drivers(lat: number, lon: number, species: string): Promise<DriversResponse>;
  accuracy(): Promise<Accuracy>;
  rules(): Promise<Rules>;
  communesByName(name: string, dept?: string): Promise<Commune[]>;
  communesByPostcode(postcode: string): Promise<Commune[]>;
  communeAt(lat: number, lon: number): Promise<Commune[]>;
  communesOfDept(dept: string): Promise<Commune[]>;
}

const COMMUNE_FIELDS = 'nom,code,codeDepartement,departement,centre,population';

export function createDataSource(http: Http, apiBase: string): DataSource {
  const api = apiBase.replace(/\/+$/, '');
  const geo = (path: string, params: Record<string, string>): string => `${GEO_API_URL}${path}?${new URLSearchParams(params).toString()}`;
  return {
    manifest: () => http.getJson(`${api}/api/manifest`, ManifestSchema, API_TTL_SECONDS, 'manifest'),
    point: (lat, lon, species) => {
      const q = new URLSearchParams({ lon: roundCoord(lon), lat: roundCoord(lat) });
      if (species) q.set('species', species);
      return http.getJson(`${api}/api/point?${q.toString()}`, PointSchema, API_TTL_SECONDS, 'point');
    },
    drivers: (lat, lon, species) => {
      const q = new URLSearchParams({ lon: roundCoord(lon), lat: roundCoord(lat), species });
      return http.getJson(`${api}/api/drivers?${q.toString()}`, DriversSchema, API_TTL_SECONDS, 'drivers');
    },
    accuracy: () => http.getJson(`${api}/data/latest/accuracy.json`, AccuracySchema, API_TTL_SECONDS, 'accuracy'),
    rules: () => http.getJson(`${api}/out/access/rules.json`, RulesSchema, API_TTL_SECONDS, 'rules'),
    communesByName: (name, dept) =>
      http.getJson(
        geo('/communes', { nom: name, fields: COMMUNE_FIELDS, boost: 'population', limit: '5', ...(dept ? { codeDepartement: dept } : {}) }),
        CommunesSchema,
        GEO_TTL_SECONDS,
        'geo-name',
      ),
    communesByPostcode: (postcode) => http.getJson(geo('/communes', { codePostal: postcode, fields: COMMUNE_FIELDS }), CommunesSchema, GEO_TTL_SECONDS, 'geo-postcode'),
    communeAt: (lat, lon) =>
      http.getJson(geo('/communes', { lat: roundCoord(lat), lon: roundCoord(lon), fields: COMMUNE_FIELDS }), CommunesSchema, GEO_TTL_SECONDS, 'geo-reverse'),
    communesOfDept: (dept) =>
      http.getJson(geo(`/departements/${encodeURIComponent(dept)}/communes`, { fields: COMMUNE_FIELDS }), CommunesSchema, GEO_TTL_SECONDS, 'geo-dept'),
  };
}
