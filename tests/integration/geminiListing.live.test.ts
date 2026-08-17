import { describe, expect, it } from 'vitest';
import { ListingAnalysisService } from '@/server/core/analysis/listing/ListingAnalysisService';
import { GeminiLLMProvider } from '@/server/core/providers/ai/llm/GeminiLLMProvider';
import { parseManualListing } from '@/server/core/providers/listing/listingSchema';
import { InMemoryCacheStore } from '@/server/core/shared/cache';
import { NoopUsageRecorder } from '@/server/core/shared/usage';

/**
 * Análise qualitativa de anúncio contra a API real do Gemini.
 *
 * Pulado sem `GEMINI_API_KEY`. Consome cota, então usa um anúncio por
 * plataforma e aproveita o cache entre asserções.
 */

const apiKey = process.env['GEMINI_API_KEY']?.trim();
const cheapModel = process.env['LLM_MODEL_CHEAP']?.trim() || 'gemini-3.5-flash-lite';
const smartModel = process.env['LLM_MODEL_SMART']?.trim() || 'gemini-3.5-flash';

const describeLive = apiKey ? describe : describe.skip;

/** Anúncio deliberadamente fraco, para o modelo ter o que apontar. */
const ANUNCIO_FRACO = {
  title: 'Apartamento',
  description: 'Apartamento bom. Tem cama e banheiro.',
  propertyType: 'Apartamento',
  bedrooms: 2,
  maxGuests: 4,
  amenities: ['Wi-Fi'],
  houseRules: ['Não fumar'],
  cancellationPolicy: 'Rigorosa',
  rating: 4.1,
  reviewCount: 12,
  photos: [{ position: 0 }, { position: 1 }, { position: 2 }],
  instantBook: false,
};

describeLive('Análise de anúncio com Gemini (API real)', () => {
  const llm = new GeminiLLMProvider({ apiKey: apiKey!, cheapModel, smartModel });

  it('produz julgamento qualitativo dentro do contrato', async () => {
    const listing = parseManualListing('AIRBNB', ANUNCIO_FRACO);

    const recorder = new NoopUsageRecorder();
    const service = new ListingAnalysisService({
      llm,
      cache: new InMemoryCacheStore(),
      usageRecorder: recorder,
    });

    const result = await service.analyze(listing, { analysisId: 'live-listing' });

    expect(result.platform).toBe('AIRBNB');
    expect(result.score.score).toBeGreaterThanOrEqual(0);
    expect(result.score.score).toBeLessThanOrEqual(100);

    // A camada de IA precisa ter rodado de fato, não silenciosamente pulada.
    expect(recorder.entries).toHaveLength(1);
    expect(recorder.entries[0]).toMatchObject({
      provider: 'gemini',
      operation: 'airbnb-analysis',
      success: true,
    });
    expect(recorder.entries[0]!.inputTokens).toBeGreaterThan(0);

    // Um anúncio com título de uma palavra e descrição de 40 caracteres
    // precisa gerar fraquezas — se não gerar, o prompt não está funcionando.
    expect(result.weaknesses.length).toBeGreaterThan(0);
    expect(result.problems.length).toBeGreaterThan(0);
  }, 90_000);

  it('não inventa dado que não foi fornecido', async () => {
    const listing = parseManualListing('AIRBNB', {
      title: 'Apartamento',
      description: 'Apartamento bom.',
      photos: [{ position: 0 }],
    });

    const result = await new ListingAnalysisService({ llm }).analyze(listing);

    // Nada de nota, comodidades ou avaliações foi informado; o modelo tem de
    // reportar como ausente em vez de preencher com valor plausível.
    const texto = [
      ...result.missingInfo,
      ...result.weaknesses,
      ...result.problems.map((p) => p.detail),
    ]
      .join(' ')
      .toLowerCase();

    expect(result.missingInfo.length).toBeGreaterThan(0);
    // O diagnóstico precisa mencionar a ausência de informação, não afirmar
    // números que ninguém forneceu.
    expect(texto).toMatch(/não|sem|ausen|falta|informa/);
  }, 90_000);

  it('analisa Booking com o prompt e os eixos da plataforma', async () => {
    const listing = parseManualListing('BOOKING', {
      title: 'Apartamento Centro',
      description: 'Apartamento no centro da cidade com dois quartos.',
      rating: 7.9,
      reviewCount: 45,
      amenities: ['Wi-Fi', 'Ar-condicionado'],
      roomTypes: ['Apartamento com 2 quartos'],
      breakfastIncluded: false,
      cancellationPolicy: 'Não reembolsável',
      photos: Array.from({ length: 6 }, (_u, i) => ({ position: i })),
    });

    const result = await new ListingAnalysisService({ llm }).analyze(listing);

    expect(result.platform).toBe('BOOKING');
    expect(result.score.components.map((c) => c.key)).toContain('policies');
    expect(result.problems.some((p) => p.code === 'STRICT_CANCELLATION')).toBe(
      true,
    );
  }, 90_000);
});
