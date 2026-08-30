import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CarrosselFotos } from '@/components/CarrosselFotos';
import { brl, pct, titulo, cn } from '@/lib/utils';
import type { Lote } from '@/types';
import { ExternalLink, Gauge, MapPin, TriangleAlert, BadgeCheck, Scale } from 'lucide-react';

/** verde > 0.4 | amarelo 0.2–0.4 | neutro < 0.2 */
function faixaScore(score: number) {
  if (score > 0.4)
    return 'bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/25';
  if (score >= 0.2)
    return 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/25';
  return 'bg-background/90 text-foreground ring-border';
}

const km = (v: number | null) =>
  v === null || v === undefined
    ? 'km não informado'
    : `${v.toLocaleString('pt-BR')} km`;

export function LoteCard({ lote }: { lote: Lote }) {
  const score = lote.score_oportunidade === null ? null : Number(lote.score_oportunidade);
  const especulativo = lote.score_tipo === 'especulativo';
  const fotos = lote.imagens ?? [];
  const nome = `${titulo(lote.marca)} ${titulo(lote.modelo)}`.trim();
  const local = [titulo(lote.cidade), lote.uf].filter(Boolean).join('/');

  return (
    <Card className="group/card flex flex-col overflow-hidden transition-shadow hover:shadow-md">
      <div className="relative">
        <CarrosselFotos fotos={fotos} alt={nome} className="aspect-[4/3] w-full" />

        {/* Km sempre visível: é o dado que mais muda a decisão de compra */}
        <div className="pointer-events-none absolute bottom-2 left-2 z-10 flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
          <Gauge className="h-3 w-3" />
          {km(lote.km)}
        </div>

        {score !== null && (
          <div
            className={cn(
              'pointer-events-none absolute right-2 top-2 z-10 rounded-md px-2 py-1 text-sm font-semibold ring-1 backdrop-blur',
              faixaScore(score),
            )}
          >
            {pct(score)}
          </div>
        )}
      </div>

      {/* O card inteiro leva ao detalhe; setas do carrossel e link externo
          param a propagação para não sequestrar o clique. */}
      <Link to={`/lote/${lote.id}`} className="flex flex-1 flex-col focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <CardContent className="flex flex-1 flex-col gap-3 p-4">
          <div>
            <h3 className="font-semibold leading-tight group-hover/card:underline">{nome}</h3>
            <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
              <span>
                {lote.ano_fabricacao ?? '—'}/{lote.ano_modelo ?? '—'}
              </span>
              {lote.leiloeiro && (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate">{lote.leiloeiro}</span>
                </>
              )}
              {local && (
                <>
                  <span aria-hidden>·</span>
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className="truncate">{local}</span>
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {lote.condicao && <Badge variant="secondary">{titulo(lote.condicao)}</Badge>}
            {lote.origem && <Badge variant="outline">{titulo(lote.origem)}</Badge>}
            {lote.financiavel && (
              <Badge variant="default" className="gap-1">
                <BadgeCheck className="h-3 w-3" /> Financiável
              </Badge>
            )}
            {lote.permite_parcelamento && (
              <Badge variant="default" className="gap-1 bg-indigo-600 hover:bg-indigo-600/90" title={`Leilão judicial com proposta de pagamento parcelado (art. 895 do CPC): ${lote.parcelamento_entrada_pct ?? 25}% de sinal + até ${lote.parcelamento_parcelas_max ?? 30} parcelas`}>
                <Scale className="h-3 w-3" />
                {Number(lote.parcelamento_entrada_pct ?? 25)}% + {lote.parcelamento_parcelas_max ?? 30}x
              </Badge>
            )}
            {especulativo && (
              <Badge variant="warning" className="gap-1" title="Score sobre lance de pregão recém-aberto, sem lance inicial publicado">
                <TriangleAlert className="h-3 w-3" /> especulativo
              </Badge>
            )}
          </div>

          <dl className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Lance ref.</dt>
            <dd className="text-right font-medium tabular-nums">{brl(lote.lance_referencia)}</dd>
            <dt className="text-muted-foreground">FIPE</dt>
            <dd className="text-right tabular-nums">{brl(lote.fipe_preco)}</dd>
            {lote.custo_estimado_total && (
              <>
                <dt className="text-muted-foreground">Custo est.</dt>
                <dd className="text-right tabular-nums">{brl(lote.custo_estimado_total)}</dd>
              </>
            )}
          </dl>
        </CardContent>
      </Link>

      {lote.pagina_url && (
        <div className="px-4 pb-3">
          <a
            href={lote.pagina_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Ver no leiloeiro <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
    </Card>
  );
}
