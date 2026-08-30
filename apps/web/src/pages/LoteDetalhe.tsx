import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CarrosselFotos } from '@/components/CarrosselFotos';
import { buscarLote } from '@/api';
import type { LoteDetalhe as Detalhe } from '@/types';
import { brl, pct, titulo } from '@/lib/utils';
import { ArrowLeft, ExternalLink, FileText, BadgeCheck, TriangleAlert, Gauge } from 'lucide-react';

const dataBR = (s: string | null) =>
  !s ? '—' : new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function Linha({ rotulo, valor }: { rotulo: React.ReactNode; valor: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/60 py-2 last:border-0">
      <dt className="text-sm text-muted-foreground">{rotulo}</dt>
      <dd className="text-right text-sm font-medium">{valor ?? '—'}</dd>
    </div>
  );
}

function Secao({ titulo: t, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-5">
        <h2 className="mb-3 font-semibold">{t}</h2>
        {children}
      </CardContent>
    </Card>
  );
}

export default function LoteDetalhe() {
  const { id } = useParams<{ id: string }>();
  const [lote, setLote] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLote(null);
    setErro(null);
    buscarLote(id).then(setLote).catch((e: Error) => setErro(e.message));
  }, [id]);

  if (erro) {
    return (
      <div className="container py-10">
        <Link to="/" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <Card><CardContent className="p-10 text-center">
          <p className="font-medium text-destructive">Não foi possível carregar este lote</p>
          <p className="mt-1 text-sm text-muted-foreground">{erro}</p>
        </CardContent></Card>
      </div>
    );
  }

  if (!lote) {
    return (
      <div className="container space-y-4 py-10">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="aspect-[16/9] w-full max-w-3xl" />
        <Skeleton className="h-8 w-1/2" />
      </div>
    );
  }

  const score = lote.score_oportunidade === null ? null : Number(lote.score_oportunidade);
  const lanceRef = lote.lance_referencia === null ? null : Number(lote.lance_referencia);
  const comissao = lote.taxa_comissao ? Number(lote.taxa_comissao) : 0.05;
  const valorComissao = lanceRef !== null ? lanceRef * comissao : null;
  const custo = lote.custo_estimado_total === null ? null : Number(lote.custo_estimado_total);
  // o que sobra depois de lance + comissão são as taxas fixas estimadas
  const taxas = custo !== null && lanceRef !== null && valorComissao !== null
    ? custo - lanceRef - valorComissao
    : null;

  const nome = `${titulo(lote.marca)} ${titulo(lote.modelo)}`.trim();
  const qtdFotos = lote.imagens?.length ?? 0;
  const kmTexto = lote.km === null ? 'km não informado' : `${lote.km.toLocaleString('pt-BR')} km`;
  const historico = lote.historico_lances.map((h) => ({
    data: new Date(h.observado_em).toLocaleDateString('pt-BR'),
    valor: Number(h.valor),
  }));

  return (
    <div className="container space-y-6 py-6">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar para as oportunidades
      </Link>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <CarrosselFotos fotos={lote.imagens ?? []} alt={nome} className="aspect-[4/3] w-full rounded-lg border" />
          <p className="text-xs text-muted-foreground">
            {qtdFotos} foto{qtdFotos === 1 ? '' : 's'} · lote {lote.numero_lote ?? '—'}
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{nome}</h1>
            <p className="mt-1 text-muted-foreground">
              {lote.ano_fabricacao ?? '—'}/{lote.ano_modelo ?? '—'}
              {lote.cidade && ` · ${titulo(lote.cidade)}`}{lote.uf && `/${lote.uf}`}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {lote.condicao && <Badge variant="secondary">{titulo(lote.condicao)}</Badge>}
            {lote.origem && <Badge variant="outline">{titulo(lote.origem)}</Badge>}
            {lote.financiavel && <Badge className="gap-1"><BadgeCheck className="h-3 w-3" /> Financiável</Badge>}
            {lote.status && <Badge variant="outline">{titulo(lote.status.replace('_', ' '))}</Badge>}
          </div>

          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">Lance de referência</span>
                <span className="text-2xl font-semibold tabular-nums">{brl(lanceRef)}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Gauge className="h-4 w-4 text-muted-foreground" />
                <span>{kmTexto}</span>
              </div>

              {score !== null ? (
                <div className="rounded-md border bg-muted/40 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Score de oportunidade</span>
                    <span className="text-xl font-semibold tabular-nums">{pct(score)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Quanto o custo total estimado fica <strong>abaixo</strong> do valor FIPE
                    ajustado pela condição e origem do lote.
                  </p>
                  {lote.score_tipo === 'especulativo' ? (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        <strong>Especulativo</strong>: o leiloeiro não publicou lance inicial,
                        então a conta usa o lance corrente de um pregão recém-aberto. Tende a
                        parecer melhor do que é.
                      </span>
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
                      <strong>Confirmado</strong>: há lance inicial publicado pelo leiloeiro,
                      então existe um piso real de preço.
                    </p>
                  )}
                </div>
              ) : (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  Sem score: falta match confiável na FIPE, lance de referência, ou o lote já
                  foi vendido/retirado.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Secao titulo="Veículo">
          <dl>
            <Linha rotulo="Ano fabricação/modelo" valor={`${lote.ano_fabricacao ?? '—'}/${lote.ano_modelo ?? '—'}`} />
            <Linha rotulo="Quilometragem" valor={kmTexto} />
            <Linha rotulo="Cor" valor={titulo(lote.cor) || '—'} />
            <Linha rotulo="Combustível" valor={titulo(lote.combustivel) || '—'} />
            <Linha rotulo="Condição" valor={titulo(lote.condicao) || '—'} />
            <Linha rotulo="Origem" valor={titulo(lote.origem) || '—'} />
            <Linha rotulo="Tipo" valor={titulo(lote.tipo) || '—'} />
            <Linha rotulo="Chave" valor={lote.tem_chave === null ? '—' : lote.tem_chave ? 'Com chave' : 'Sem chave'} />
            <Linha rotulo="Financiável" valor={lote.financiavel === null ? '—' : lote.financiavel ? 'Sim' : 'Não'} />
            <Linha rotulo="Comitente" valor={titulo(lote.comitente) || '—'} />
          </dl>
        </Secao>

        <Secao titulo="Custo estimado">
          <dl>
            <Linha rotulo="Lance de referência" valor={brl(lanceRef)} />
            <Linha rotulo={`Comissão do leiloeiro (${(comissao * 100).toFixed(0)}%)`} valor={brl(valorComissao)} />
            <Linha rotulo="Taxas fixas estimadas" valor={brl(taxas)} />
            <Linha rotulo={<span className="font-semibold">Custo total</span>} valor={<span className="font-semibold">{brl(custo)}</span>} />
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            Taxas fixas estimam pátio, despachante, transferência e guincho. <strong>Não</strong>
            {' '}incluem reparo — para lote sinistrado, some a funilaria por fora.
          </p>
        </Secao>

        <Secao titulo="Referência FIPE">
          <dl>
            <Linha rotulo="Preço FIPE" valor={brl(lote.fipe_preco)} />
            <Linha rotulo="Código FIPE" valor={lote.codigo_fipe ?? '—'} />
            <Linha rotulo="Modelo casado" valor={lote.fipe_modelo ? `${lote.fipe_marca} ${lote.fipe_modelo}` : '—'} />
            <Linha rotulo="Confiança do match" valor={lote.fipe_match_score ? `${(Number(lote.fipe_match_score) * 100).toFixed(0)}%` : '—'} />
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            O match é fuzzy: o leiloeiro escreve "gol 1.0l mc4" e a FIPE, "Gol 1.0 Flex 12V".
            Confiança baixa merece conferência manual antes de dar lance.
          </p>
        </Secao>

        <Secao titulo="Leilão">
          <dl>
            <Linha rotulo="Título" valor={lote.leilao_titulo ?? '—'} />
            <Linha rotulo="Início" valor={dataBR(lote.data_inicio)} />
            <Linha rotulo="Encerramento" valor={dataBR(lote.data_fim)} />
            <Linha rotulo="Modalidade" valor={titulo(lote.modalidade) || '—'} />
            <Linha rotulo="Leiloeiro" valor={titulo(lote.leilao_leiloeiro ?? lote.leiloeiro_nome) || '—'} />
            <Linha rotulo="JUCESP" valor={lote.jucesp ?? '—'} />
            <Linha rotulo="Judicial" valor={lote.is_judicial === null ? '—' : lote.is_judicial ? 'Sim' : 'Não'} />
          </dl>
          {lote.edital_pdf_url && (
            <a href={lote.edital_pdf_url} target="_blank" rel="noopener noreferrer"
               className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              <FileText className="h-4 w-4" /> Abrir edital (PDF)
            </a>
          )}
        </Secao>
      </div>

      {lote.condicoes_pagamento && (
        <Secao titulo="Condições de pagamento">
          <p className="mb-2 text-xs text-muted-foreground">
            Trecho literal das condições de venda publicadas pelo leiloeiro — não é resumo
            nosso. Confira o texto completo antes de dar lance.
          </p>
          <blockquote className="max-h-72 overflow-y-auto whitespace-pre-line rounded-md border-l-2 border-primary/40 bg-muted/40 p-3 text-sm leading-relaxed">
            {lote.condicoes_pagamento}
          </blockquote>
        </Secao>
      )}

      {historico.length > 1 && (
        <Secao titulo="Histórico de lances">
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historico} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="data" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => brl(v)} width={90} />
                <Tooltip formatter={(v: number) => brl(v)} />
                <Line type="monotone" dataKey="valor" stroke="hsl(var(--primary))" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Secao>
      )}

      {historico.length === 1 && (
        <Secao titulo="Histórico de lances">
          <p className="text-sm text-muted-foreground">
            Um único lance observado até agora: <strong>{brl(historico[0].valor)}</strong> em{' '}
            {historico[0].data}. O gráfico aparece quando houver evolução.
          </p>
        </Secao>
      )}

      {lote.descricao && (
        <Secao titulo="Descrição do leiloeiro">
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {lote.descricao}
          </p>
        </Secao>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4">
        <p className="text-xs text-muted-foreground">
          Visto pela primeira vez em {dataBR(lote.first_seen_at)} · atualizado em {dataBR(lote.last_seen_at)}
        </p>
        {lote.pagina_url && (
          <Button asChild variant="ghost" size="sm">
            <a href={lote.pagina_url} target="_blank" rel="noopener noreferrer">
              Ver no leiloeiro <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
