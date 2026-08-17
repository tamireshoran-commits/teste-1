/**
 * Executa tarefas com paralelismo limitado, preservando a ordem do resultado.
 *
 * Analisar 24 fotos de uma vez estoura rate limit na primeira rajada; em série,
 * demora demais. Um pool pequeno resolve os dois lados.
 *
 * Nunca rejeita: cada item devolve `{ ok: true, value }` ou
 * `{ ok: false, error }`. É isso que garante que a falha de uma foto não
 * derrube o lote inteiro — o chamador decide o que fazer com cada falha.
 */
export type Settled<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

export async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  task: (item: TInput, index: number) => Promise<TOutput>,
): Promise<Array<Settled<TOutput>>> {
  const results = new Array<Settled<TOutput>>(items.length);
  const limit = Math.max(1, Math.floor(concurrency));

  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;

      try {
        results[index] = { ok: true, value: await task(items[index]!, index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );

  await Promise.all(workers);

  return results;
}
