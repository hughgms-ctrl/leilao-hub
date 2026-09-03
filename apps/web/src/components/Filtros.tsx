import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { titulo } from '@/lib/utils';
import type { Stats } from '@/types';
import type { Filtros as FiltrosMap } from '@/hooks';
import { Search, X, BadgeCheck, Scale, CalendarClock } from 'lucide-react';

const TODOS = '__todos__';

function Combo({
  rotulo, chave, valores, filtros, aoMudar,
}: {
  rotulo: string;
  chave: string;
  valores: { valor: string; total: number }[];
  filtros: FiltrosMap;
  aoMudar: (chave: string, valor: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{rotulo}</label>
      <Select
        value={filtros[chave] ?? TODOS}
        onValueChange={(v) => aoMudar(chave, v === TODOS ? '' : v)}
      >
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>Todos</SelectItem>
          {valores.map((v) => (
            <SelectItem key={v.valor} value={v.valor}>
              {titulo(v.valor)} ({v.total})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function Filtros({
  stats, filtros, setFiltro, setFiltros, busca, setBusca,
}: {
  stats: Stats | null;
  filtros: FiltrosMap;
  setFiltro: (chave: string, valor: string) => void;
  setFiltros: (f: FiltrosMap) => void;
  busca: string;
  setBusca: (v: string) => void;
}) {
  const tipoScore = filtros.score_tipo ?? 'confirmado';
  const algumFiltro = Object.keys(filtros).some((k) => k !== 'page');
  const aoAlternarFinanciavel = (v: string) => setFiltro('financiavel', v);

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por marca, modelo ou descrição…"
            className="pl-9"
          />
        </div>

        <div className="inline-flex rounded-md border p-1">
          {(['confirmado', 'especulativo', 'todos'] as const).map((t) => (
            <Button
              key={t}
              size="sm"
              variant={tipoScore === t ? 'default' : 'ghost'}
              onClick={() => setFiltro('score_tipo', t)}
              className="capitalize"
            >
              {t}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Combo rotulo="Leiloeiro" chave="leiloeiro" valores={(stats?.por_leiloeiro ?? []).map((l) => ({ valor: l.valor, total: l.total }))} filtros={filtros} aoMudar={setFiltro} />
        <Combo rotulo="Tipo" chave="tipo" valores={stats?.por_tipo ?? []} filtros={filtros} aoMudar={setFiltro} />
        <Combo rotulo="UF" chave="uf" valores={stats?.por_uf ?? []} filtros={filtros} aoMudar={setFiltro} />
        <Combo rotulo="Condição" chave="condicao" valores={stats?.por_condicao ?? []} filtros={filtros} aoMudar={setFiltro} />
        <Combo rotulo="Origem" chave="origem" valores={stats?.por_origem ?? []} filtros={filtros} aoMudar={setFiltro} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {([
          ['preco_min', 'Preço mín.'],
          ['preco_max', 'Preço máx.'],
          ['ano_min', 'Ano mín.'],
          ['ano_max', 'Ano máx.'],
        ] as const).map(([chave, rotulo]) => (
          <div key={chave} className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{rotulo}</label>
            <Input
              type="number"
              inputMode="numeric"
              value={filtros[chave] ?? ''}
              onChange={(e) => setFiltro(chave, e.target.value)}
              placeholder="—"
            />
          </div>
        ))}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Ordenar por</label>
          <Select
            value={`${filtros.order ?? 'score'}:${filtros.dir ?? 'desc'}`}
            onValueChange={(v) => {
              const [order, dir] = v.split(':');
              setFiltros({ ...filtros, order, dir, page: '' });
            }}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="score:desc">Maior score</SelectItem>
              <SelectItem value="preco:asc">Menor preço</SelectItem>
              <SelectItem value="preco:desc">Maior preço</SelectItem>
              <SelectItem value="ano:desc">Mais novo</SelectItem>
              <SelectItem value="ano:asc">Mais antigo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Prazo para dar lance. Sem isto não dava para saber se um lote
            fecha amanhã ou já fechou — era a informação que mais faltava.
            Leilão sem data publicada fica de fora quando o filtro está
            ligado, em vez de aparecer como se tivesse prazo. */}
        {[
          { dias: 3, rotulo: '3 dias' },
          { dias: 7, rotulo: '7 dias' },
          { dias: 30, rotulo: '30 dias' },
        ].map(({ dias, rotulo }) => (
          <Button
            key={dias}
            size="sm"
            variant={filtros.encerra_em === String(dias) ? 'default' : 'outline'}
            onClick={() =>
              setFiltro('encerra_em', filtros.encerra_em === String(dias) ? '' : String(dias))
            }
            title={`Leilões que encerram nos próximos ${dias} dias`}
          >
            <CalendarClock className="mr-1 h-4 w-4" />
            {rotulo}
          </Button>
        ))}

        <Button
          size="sm"
          variant={filtros.parcelamento === 'true' ? 'default' : 'outline'}
          onClick={() => setFiltro('parcelamento', filtros.parcelamento === 'true' ? '' : 'true')}
          title="Leilão judicial que aceita proposta de pagamento parcelado (art. 895 do CPC): sinal + parcelas mensais, sem financiamento bancário"
        >
          <Scale className="mr-1 h-4 w-4" />
          Parcelável (25% + 30x)
          {stats ? ` (${stats.parcelaveis})` : ''}
        </Button>
        <Button
          size="sm"
          variant={filtros.financiavel === 'true' ? 'default' : 'outline'}
          onClick={() =>
            aoAlternarFinanciavel(filtros.financiavel === 'true' ? '' : 'true')
          }
        >
          <BadgeCheck className="mr-1 h-4 w-4" />
          Só financiáveis
          {stats ? ` (${stats.financiaveis})` : ''}
        </Button>
      </div>

      {algumFiltro && (
        <Button variant="ghost" size="sm" onClick={() => { setBusca(''); setFiltros({}); }}>
          <X className="mr-1 h-4 w-4" /> Limpar filtros
        </Button>
      )}
    </div>
  );
}
