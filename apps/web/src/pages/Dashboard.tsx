import { useEffect, useMemo, useState } from 'react';
import { StatsCards } from '@/components/StatsCards';
import { Filtros } from '@/components/Filtros';
import { LoteCard } from '@/components/LoteCard';
import { Paginacao } from '@/components/Paginacao';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useFiltrosUrl, useDebounce } from '@/hooks';
import { buscarLotes, buscarStats } from '@/api';
import type { ListaResposta, Stats } from '@/types';
import { SearchX, TriangleAlert } from 'lucide-react';

export default function Dashboard() {
  const { filtros, setFiltros, setFiltro } = useFiltrosUrl({ score_tipo: 'confirmado' });
  const [busca, setBusca] = useState(filtros.busca ?? '');
  const buscaDebounced = useDebounce(busca);

  const [stats, setStats] = useState<Stats | null>(null);
  const [dados, setDados] = useState<ListaResposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // busca livre entra na URL só depois do debounce
  useEffect(() => {
    if ((filtros.busca ?? '') !== buscaDebounced) setFiltro('busca', buscaDebounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaDebounced]);

  useEffect(() => {
    buscarStats().then(setStats).catch(() => setStats(null));
  }, []);

  const params = useMemo(() => {
    const p: Record<string, string> = { per_page: '24', ...filtros };
    // 'todos' é só rótulo da UI: some da query
    if (p.score_tipo === 'todos') delete p.score_tipo;
    return p;
  }, [filtros]);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    buscarLotes(params)
      .then((r) => { if (!cancelado) setDados(r); })
      .catch((e: Error) => { if (!cancelado) setErro(e.message); })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [params]);

  const page = Number(filtros.page ?? 1);

  return (
    <main className="container space-y-6 py-6">
        <StatsCards stats={stats} />

        <Filtros
          stats={stats}
          filtros={filtros}
          setFiltro={setFiltro}
          setFiltros={setFiltros}
          busca={busca}
          setBusca={setBusca}
        />

        {filtros.score_tipo === 'especulativo' && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Score <strong>especulativo</strong>: calculado sobre o lance corrente de um pregão
              recém-aberto, sem lance inicial publicado. O desconto tende a parecer maior do que é.
            </p>
          </div>
        )}

        {erro && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
            <p className="font-medium text-destructive">Não foi possível carregar os lotes</p>
            <p className="mt-1 text-sm text-muted-foreground">{erro}</p>
            <Button className="mt-4" variant="outline" onClick={() => setFiltros({ ...filtros })}>
              Tentar de novo
            </Button>
          </div>
        )}

        {carregando && !erro && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="aspect-[4/3] w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ))}
          </div>
        )}

        {!carregando && !erro && dados && dados.itens.length === 0 && (
          <div className="flex flex-col items-center rounded-lg border border-dashed p-12 text-center">
            <SearchX className="h-10 w-10 text-muted-foreground" />
            <p className="mt-4 font-medium">Nenhum lote com esses filtros</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Tente ampliar a faixa de preço, trocar a condição, ou incluir os scores
              especulativos.
            </p>
            <Button className="mt-4" variant="outline" onClick={() => { setBusca(''); setFiltros({}); }}>
              Limpar filtros
            </Button>
          </div>
        )}

        {!carregando && !erro && dados && dados.itens.length > 0 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {dados.itens.map((lote) => <LoteCard key={lote.id} lote={lote} />)}
            </div>
            <Paginacao
              page={page}
              totalPages={dados.total_pages}
              total={dados.total}
              aoMudar={(p) => { setFiltro('page', String(p)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            />
          </>
        )}
    </main>
  );
}
