import { z } from 'zod';
import { ValidationError } from '@/server/core/shared/errors';
import type { ListingData, Platform } from '@/server/core/types';

/**
 * Validação da entrada manual de um anúncio.
 *
 * Este é o caminho principal do MVP: o próprio dono informa os dados do seu
 * anúncio. Como não há scraping, tudo que chega aqui é digitado por uma
 * pessoa — e portanto precisa ser validado com rigor antes de virar
 * diagnóstico.
 *
 * Campo vazio é `undefined`, nunca string vazia: a diferença entre "o usuário
 * não preencheu" e "o anúncio não tem" é o que alimenta `missingInfo`.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();

const optionalCount = (max: number) =>
  z.coerce.number().int().min(0).max(max).optional();

/** Aceita URL só das plataformas esperadas, para não guardar link aleatório. */
function platformUrl(platform: Platform) {
  const hosts =
    platform === 'AIRBNB'
      ? ['airbnb.com', 'airbnb.com.br', 'abnb.me']
      : ['booking.com'];

  return z
    .string()
    .trim()
    .url('Informe uma URL válida')
    .refine(
      (value) => {
        try {
          const host = new URL(value).hostname.replace(/^www\./, '');
          return hosts.some((h) => host === h || host.endsWith(`.${h}`));
        } catch {
          return false;
        }
      },
      { message: `A URL precisa ser de ${hosts[0]}` },
    )
    .optional();
}

const stringList = (maxItems: number, maxLength = 200) =>
  z
    .array(z.string().trim().min(1).max(maxLength))
    .max(maxItems)
    .default([])
    // Remove duplicatas preservando a ordem informada.
    .transform((items) => [...new Set(items)]);

const photoRef = z.object({
  position: z.coerce.number().int().min(0).max(200),
  url: z.string().trim().url().optional(),
  caption: optionalText(300),
  roomHint: optionalText(60),
});

/**
 * A nota do Airbnb vai de 0 a 5 e a do Booking de 0 a 10.
 *
 * O limite é aplicado no próprio schema, e não numa checagem depois, para
 * haver um único caminho de validação — com dois, a mensagem que o usuário
 * recebe depende de qual barreira ele bate primeiro.
 */
function ratingField(platform: Platform) {
  const max = platform === 'AIRBNB' ? 5 : 10;
  const nome = platform === 'AIRBNB' ? 'Airbnb' : 'Booking.com';

  return z.coerce
    .number()
    .min(0, `A nota não pode ser negativa`)
    .max(max, `A nota do ${nome} vai até ${max}`)
    .optional();
}

const baseListing = z.object({
  title: optionalText(200),
  description: optionalText(8000),
  propertyType: optionalText(80),
  bedrooms: optionalCount(50),
  bathrooms: z.coerce.number().min(0).max(50).optional(),
  beds: optionalCount(100),
  maxGuests: optionalCount(100),

  amenities: stringList(200, 120),
  houseRules: stringList(60, 300),
  cancellationPolicy: optionalText(200),
  checkIn: optionalText(50),
  checkOut: optionalText(50),
  minimumStay: optionalCount(365),

  reviewCount: optionalCount(1_000_000),
  reviewHighlights: z
    .object({
      positive: stringList(30, 300),
      negative: stringList(30, 300),
    })
    .optional(),

  photos: z.array(photoRef).max(200).default([]),
});

export const airbnbManualSchema = baseListing.extend({
  externalUrl: platformUrl('AIRBNB'),
  rating: ratingField('AIRBNB'),
  isSuperhost: z.boolean().optional(),
  instantBook: z.boolean().optional(),
});

export const bookingManualSchema = baseListing.extend({
  externalUrl: platformUrl('BOOKING'),
  rating: ratingField('BOOKING'),
  roomTypes: stringList(40, 120),
  breakfastIncluded: z.boolean().optional(),
});

export type AirbnbManualInput = z.input<typeof airbnbManualSchema>;
export type BookingManualInput = z.input<typeof bookingManualSchema>;

/**
 * Valida a entrada manual e monta o DTO normalizado.
 *
 * A nota do Booking vai de 0 a 10 e a do Airbnb de 0 a 5. Guardamos como
 * informado e normalizamos só no scoring — converter aqui perderia o valor
 * que o usuário reconhece do painel dele.
 */
export function parseManualListing(
  platform: Platform,
  raw: unknown,
): ListingData {
  const schema = platform === 'AIRBNB' ? airbnbManualSchema : bookingManualSchema;
  const parsed = schema.safeParse(raw);

  if (!parsed.success) {
    throw new ValidationError('Dados do anúncio inválidos.', {
      platform,
      issues: parsed.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      })),
    });
  }

  const data = parsed.data;

  return {
    platform,
    source: 'MANUAL',
    isMock: false,
    capturedAt: new Date().toISOString(),
    // Fotos ordenadas pela posição informada, para a análise de capa e ordem
    // trabalhar sobre a sequência real do anúncio.
    ...stripUndefined({ ...data }),
    amenities: data.amenities,
    houseRules: data.houseRules,
    photos: [...data.photos]
      .sort((a, b) => a.position - b.position)
      .map((p) => stripUndefined(p) as ListingData['photos'][number]),
  } as ListingData;
}

/** Remove chaves undefined para não sobrescrever campos com vazio. */
function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
