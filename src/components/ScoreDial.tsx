/**
 * Medidor circular do score.
 *
 * A cor segue faixas fixas (vermelho/âmbar/verde) para que a leitura não
 * dependa de comparar números — e as faixas são as mesmas em todo o produto.
 */

export function scoreTone(score: number | null): 'bad' | 'mid' | 'good' | 'none' {
  if (score === null) return 'none';
  if (score < 50) return 'bad';
  if (score < 75) return 'mid';
  return 'good';
}

const TONE_COLOR: Record<ReturnType<typeof scoreTone>, string> = {
  bad: '#dc2626',
  mid: '#d97706',
  good: '#16a34a',
  none: '#c3c8d4',
};

export function ScoreDial({
  score,
  size = 160,
  label,
}: {
  score: number | null;
  size?: number;
  label?: string;
}) {
  const radius = size / 2 - 12;
  const circumference = 2 * Math.PI * radius;
  const filled = score === null ? 0 : (score / 100) * circumference;
  const color = TONE_COLOR[scoreTone(score)];

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={
          score === null
            ? `${label ?? 'Score'}: não avaliado`
            : `${label ?? 'Score'}: ${score} de 100`
        }
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#eceef2"
          strokeWidth={12}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size * 0.28}
          fontWeight={600}
          fill="#111827"
        >
          {score ?? '—'}
        </text>
      </svg>
      {label && <span className="text-sm text-ink-500">{label}</span>}
    </div>
  );
}

/** Card compacto com barra, para as dimensões secundárias. */
export function ScoreCard({
  label,
  score,
  note,
}: {
  label: string;
  score: number | null;
  note?: string;
}) {
  const color = TONE_COLOR[scoreTone(score)];

  return (
    <div className="rounded-xl border border-ink-100 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-ink-700">{label}</span>
        <span className="text-2xl font-semibold tabular-nums" style={{ color }}>
          {score ?? '—'}
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-100">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${score ?? 0}%`, backgroundColor: color }}
        />
      </div>

      <p className="mt-2 text-xs text-ink-500">
        {score === null ? (note ?? 'Não avaliado') : `${score}/100`}
      </p>
    </div>
  );
}
