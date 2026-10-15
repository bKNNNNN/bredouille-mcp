import { z } from 'zod';

/**
 * The parts of the public Bredouille API this server reads, written for this
 * repo. Unknown fields are ignored, so the API can grow without breaking us.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const code = z.string().regex(/^[a-z0-9_]{1,64}$/);

export const ClassSchema = z.object({
  id: z.string(),
  min: z.number(),
  max: z.number(),
  label_fr: z.string(),
});
export type IndexClass = z.infer<typeof ClassSchema>;

export const ManifestSchema = z.object({
  runId: z.string(),
  manifest: z.object({
    run_date: isoDate,
    index_licence: z.string().optional(),
    classes: z.array(ClassSchema).min(1),
    species: z.array(
      z.object({
        code,
        common_name_fr: z.string(),
        scientific_names: z.array(z.string()).default([]),
        confidence: z.string(),
        days: z.array(
          z.object({
            day: isoDate,
            status: z.string(),
            kind: z.string().optional(),
            lead_days: z.number().int().optional(),
            class_agreement: z.number().nullable().optional(),
          }),
        ),
      }),
    ),
  }),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export const PointSchema = z.object({
  run_date: isoDate,
  cell: z.object({ lon: z.number(), lat: z.number() }),
  species: z.array(
    z.object({
      code,
      days: z.array(z.object({ day: isoDate, status: z.string(), value: z.number().int().min(0).max(100).nullable() })),
    }),
  ),
});
export type PointResponse = z.infer<typeof PointSchema>;

const num = z.number().nullable();

export const DriversSchema = z.object({
  run_date: isoDate,
  species: code,
  params: z.object({
    lag_min_days: z.number().int(),
    lag_max_days: z.number().int(),
    rain_threshold_mm: z.number(),
    tmean_low_c: z.number(),
    tmean_high_c: z.number(),
  }),
  rain_event_min_mm: z.number(),
  rain: z.array(z.object({ day: isoDate, mm: num, weather: z.string() })),
  days: z.array(
    z.object({
      day: isoDate,
      lead_days: z.number().int(),
      kind: z.string(),
      weather: z.string(),
      tmin_c: num,
      tmax_c: num,
      swi: num,
      swi_usual: num,
      rain_lag_mm: num,
      rain_lag_usual_mm: num,
      flags: z
        .object({
          in_season: z.boolean(),
          frost: z.boolean(),
          cold: z.boolean(),
          hot: z.boolean(),
          dry_soil: z.boolean(),
          wet_soil: z.boolean(),
          rain_short: z.boolean(),
        })
        .nullable(),
      limiting: z.string().nullable(),
    }),
  ),
});
export type DriversResponse = z.infer<typeof DriversSchema>;
export type DriversDay = DriversResponse['days'][number];

const Summary = z.object({ n: z.number(), auc: z.number(), auc_ci95: z.tuple([z.number(), z.number()]), lift_top_decile: z.number() });

export const AccuracySchema = z.object({
  generated_at: z.string(),
  period: z.tuple([z.number(), z.number()]),
  method: z.object({ confidence_rule: z.string().optional() }).loose().optional(),
  species: z.record(
    z.string(),
    z
      .object({
        common_name_fr: z.string(),
        status: z.string(),
        confidence: z.string(),
        index: z.object({ index_shown: Summary.optional() }).loose().optional(),
        regions: z
          .record(z.string(), z.object({ name: z.string(), n: z.number(), confidence: z.string() }).loose())
          .default({}),
      })
      .loose(),
  ),
  forecast_skill: z
    .object({
      species: z.record(z.string(), z.array(z.object({ lead_days: z.number(), agreement: z.number(), label_fr: z.string() }).loose())).default({}),
    })
    .loose()
    .nullable()
    .optional(),
});
export type Accuracy = z.infer<typeof AccuracySchema>;

export const RulesSchema = z.object({
  disclaimer_fr: z.string(),
  retrieved_at: isoDate,
  licence: z.string().optional(),
  records: z.array(
    z
      .object({
        dept: z.string(),
        dept_name: z.string(),
        title: z.string(),
        summary_fr: z.string(),
        signed_on: isoDate.nullable().default(null),
        scope: z.object({ label: z.string() }).loose(),
        limit: z.object({ value: z.number(), unit: z.string(), per: z.string() }).nullable().default(null),
        forbidden_days: z.array(z.string()).default([]),
        forbidden_tools: z.array(z.string()).default([]),
        source_url: z.string().nullable().default(null),
        source_name: z.string().nullable().default(null),
        checked_at: isoDate,
        status: z.string(),
      })
      .loose(),
  ),
});
export type Rules = z.infer<typeof RulesSchema>;
export type RuleRecord = Rules['records'][number];

export const CommuneSchema = z.object({
  nom: z.string(),
  code: z.string(),
  codeDepartement: z.string().optional(),
  departement: z.object({ code: z.string(), nom: z.string() }).optional(),
  centre: z.object({ type: z.literal('Point'), coordinates: z.tuple([z.number(), z.number()]) }).optional(),
  population: z.number().optional(),
});
export const CommunesSchema = z.array(CommuneSchema);
export type Commune = z.infer<typeof CommuneSchema>;
