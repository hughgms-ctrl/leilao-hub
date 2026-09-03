import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CarrosselFotos } from '@/components/CarrosselFotos';
import { brl, pct, titulo, cn } from '@/lib/utils';
import type { Lote } from '@/types';
import { ExternalLink, Gauge, MapPin, TriangleAlert, BadgeCheck, Scale, CalendarClock } from 'lucide-react';

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

  // Prazo para dar lance. Antes o card não dizia nada, e não havia como
  // saber se o lote fechava amanhã ou já tinha fechado.
  const prazo = (() => {
    if (!lote.data_fim) return null;
    const fim = new Date(lote.data_fim);
    const dias = Math.ceil((fim.getTime() - Date.now()) / 86_400_000);
    if (Number.isNaN(dias) || dias < 0) return null;
    const quando =
      dias === 0 ? 'encerra hoje' : dias === 1 ? 'encerra amanhã' : `encerra em ${dias} dias`;
    return { quando, urgente: dias <= 3, data: fim.toLocaleDateString('pt-BR') };
  })();

  // Quanto o lance está abaixo da FIPE. Só faz sentido com os dois lados
  // e com lance MENOR — lote acima da tabela não ganha selo de desconto.
  const fipe = lote.fipe_preco === null ? null : Number(lote.fipe_preco);
  const lance = lote.lance_referencia === null ? null : Number(lote.lance_referencia);
  const abatimento =
    fipe && lance && fipe > 0 && lance < fipe ? (fipe - lance) / fipe : null;

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

          {prazo && (
            <p
              className={cn(
                'flex items-center gap-1 text-xs font-medium',
                prazo.urgente ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
              )}
              title={`Encerramento: ${prazo.data}`}
            >
              <CalendarClock className="h-3 w-3 shrink-0" />
              {prazo.quando}
            </p>
          )}

          <div className="flex flex-wrap gap-1.5">
            {/* "indefinida" é o default interno quando o leiloeiro não
                informa condição — não diz nada a quem compra, e ocupava
                espaço em quase todo card. */}
            {lote.condicao && lote.condicao.toLowerCase() !== 'indefinida' && (
              <Badge variant="secondary">{titulo(lote.condicao)}</Badge>
            )}
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

          {/* A distância entre o lance e a FIPE é a razão de existir do
              produto — e nenhum concorrente tem esse dado. Antes saía como
              dois rótulos do mesmo tamanho, um embaixo do outro, e passava
              batido. Agora o preço é o herói e o desconto é a legenda. */}
          <div className="mt-auto space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-2xl font-semibold tabular-nums tracking-tight">
                {brl(lote.lance_referencia)}
              </span>
              {abatimento !== null && (
                <span className="shrink-0 rounded-md bg-emerald-50 px-1.5 py-0.5 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/25">
                  −{Math.round(abatimento * 100)}%
                </span>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {lote.fipe_preco ? (
                <>
                  FIPE <span className="tabular-nums">{brl(lote.fipe_preco)}</span>
                </>
              ) : (
                'sem referência FIPE'
              )}
              {lote.custo_estimado_total && (
                <>
                  {' · custo est. '}
                  <span className="tabular-nums">{brl(lote.custo_estimado_total)}</span>
                </>
              )}
            </p>
          </div>
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
