import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { brl, pct, titulo, cn } from '@/lib/utils';
import type { Lote } from '@/types';
import { ExternalLink, ImageOff, TriangleAlert } from 'lucide-react';

/** verde > 0.4 | amarelo 0.2–0.4 | neutro < 0.2 */
function faixaScore(score: number) {
  if (score > 0.4) return { caixa: 'bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25' };
  if (score >= 0.2) return { caixa: 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25' };
  return { caixa: 'bg-muted text-muted-foreground ring-border' };
}

export function LoteCard({ lote }: { lote: Lote }) {
  const score = lote.score_oportunidade === null ? null : Number(lote.score_oportunidade);
  const faixa = score === null ? null : faixaScore(score);
  const especulativo = lote.score_tipo === 'especulativo';

  return (
    <Card className="flex flex-col overflow-hidden transition-shadow hover:shadow-md">
      <div className="relative aspect-[4/3] bg-muted">
        {lote.imagem ? (
          <img
            src={lote.imagem}
            alt={`${lote.marca ?? ''} ${lote.modelo ?? ''}`}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-8 w-8" />
          </div>
        )}
        {score !== null && (
          <div className={cn('absolute right-2 top-2 rounded-md px-2 py-1 text-sm font-semibold ring-1 backdrop-blur', faixa!.caixa)}>
            {pct(score)}
          </div>
        )}
      </div>

      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="font-semibold leading-tight">
            {titulo(lote.marca)} {titulo(lote.modelo)}
          </h3>
          <p className="text-sm text-muted-foreground">
            {lote.ano_fabricacao ?? '—'}/{lote.ano_modelo ?? '—'}
            {lote.cidade && ` · ${titulo(lote.cidade)}`}
            {lote.uf && `/${lote.uf}`}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {lote.condicao && <Badge variant="secondary">{titulo(lote.condicao)}</Badge>}
          {lote.origem && <Badge variant="outline">{titulo(lote.origem)}</Badge>}
          {especulativo && (
            <Badge variant="warning" title="Score calculado sobre lance de pregão recém-aberto, sem lance inicial publicado">
              <TriangleAlert className="mr-1 h-3 w-3" /> especulativo
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

        {lote.pagina_url && (
          <a
            href={lote.pagina_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Ver no leiloeiro <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </CardContent>
    </Card>
  );
}
