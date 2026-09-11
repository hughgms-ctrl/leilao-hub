import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { titulo, brl, cn } from '@/lib/utils';
import type { Stats } from '@/types';
import type { Filtros as FiltrosMap } from '@/hooks';
import {
  Search, X, BadgeCheck, Scale, CalendarClock, SlidersHorizontal, ChevronDown,
} from 'lucide-react';

const TODOS = '__todos__';

/**
 * Estado "limpo" NÃO é o objeto vazio.
 *
 * `setFiltros({})` tirava `score_tipo` da querystring, e sem essa chave a
 * API devolve confirmados + especulativos — mas o controle na tela continuava
 * marcando "confirmado", porque lia `filtros.score_tipo ?? 'confirmado'`.
 * Ou seja: limpar os filtros ligava os scores especulativos em silêncio.
 */
export const FILTROS_LIMPOS: FiltrosMap = { score_tipo: 'confirmado' };

/**
 * Chaves que moram dentro do painel recolhido. Ficam fora daqui as que têm
 * controle próprio sempre visível (busca, ordenação, prazo, parcelável,
 * financiável) e as de navegação (page/order/dir).
 */
const CHAVES_PAINEL = [
  'leiloeiro', 'tipo', 'uf', 'condicao', 'origem',
  'preco_min', 'preco_max', 'ano_min', 'ano_max', 'score_tipo',
] as const;

const ROTULO_PAINEL: Record<string, string> = {
  leiloeiro: 'Leiloeiro',
  tipo: 'Tipo',
  uf: 'UF',
  condicao: 'Condição',
  origem: 'Origem',
  preco_min: 'Preço',
  preco_max: 'Preço',
  ano_min: 'Ano',
  ano_max: 'Ano',
  score_tipo: 'Score',
};

/** Um filtro do painel só "conta" se estiver diferente do padrão. */
function ativo(chave: string, valor: string | undefined) {
  if (!valor) return false;
  if (chave === 'score_tipo') return valor !== 'confirmado';
  return true;
}

/** Texto curto do chip: "Sodré Santoro", "até R$ 30.000", "de 2015". */
function textoChip(chave: string, valor: string, stats: Stats | null) {
  if (chave === 'leiloeiro') {
    const l = stats?.por_leiloeiro.find((x) => x.valor === valor);
    return l?.nome ?? titulo(valor);
  }
  if (chave === 'preco_min') return `a partir de ${brl(valor)}`;
  if (chave === 'preco_max') return `até ${brl(valor)}`;
  if (chave === 'ano_min') return `de ${valor}`;
  if (chave === 'ano_max') return `até ${valor}`;
  if (chave === 'score_tipo') return valor;
  return titulo(valor);
}

type Opcao = { valor: string; total: number; rotulo?: string };

function Combo({
  rotulo, chave, valores, filtros, aoMudar,
}: {
  rotulo: string;
  chave: string;
  valores: Opcao[];
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
              {v.rotulo ?? titulo(v.valor)} ({v.total})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Par de campos numéricos (mín./máx.) numa única célula do painel. */
function Faixa({
  rotulo, chaveMin, chaveMax, placeholderMin, placeholderMax, filtros, aoMudar,
}: {
  rotulo: string;
  chaveMin: string;
  chaveMax: string;
  placeholderMin: string;
  placeholderMax: string;
  filtros: FiltrosMap;
  aoMudar: (chave: string, valor: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{rotulo}</label>
      <div className="flex items-center gap-2">
        <Input
          type="number" inputMode="numeric" placeholder={placeholderMin}
          value={filtros[chaveMin] ?? ''}
          onChange={(e) => aoMudar(chaveMin, e.target.value)}
        />
        <span className="shrink-0 text-sm text-muted-foreground">até</span>
        <Input
          type="number" inputMode="numeric" placeholder={placeholderMax}
          value={filtros[chaveMax] ?? ''}
          onChange={(e) => aoMudar(chaveMax, e.target.value)}
        />
      </div>
    </div>
  );
}

/**
 * Barra de filtros.
 *
 * Antes eram 5 selects + 4 campos numéricos + ordenação + 5 botões, todos
 * abertos ao mesmo tempo: um paredão de ~250px que empurrava os lotes para
 * baixo da dobra. Quem chega aqui quer ver carro, não preencher formulário.
 *
 * Agora fica visível só o que decide compra: busca, prazo de encerramento,
 * parcelável (art. 895 — é a tese do produto) e ordenação. O resto vai para
 * um painel recolhido.
 *
 * Recolher filtro é perigoso: o sujeito esquece que filtrou e conclui que o
 * acervo é pequeno. Por isso todo filtro do painel também vira chip removível
 * abaixo da barra — fica escondido só enquanto não está em uso.
 */
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
  const [aberto, setAberto] = useState(false);

  const chipsAtivos = CHAVES_PAINEL.filter((k) => ativo(k, filtros[k]));
  const algumFiltro =
    chipsAtivos.length > 0 || !!busca ||
    !!filtros.encerra_em || !!filtros.parcelamento || !!filtros.financiavel;

  const limpar = () => { setBusca(''); setFiltros(FILTROS_LIMPOS); };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 rounded-lg border bg-card p-2 sm:flex-row sm:items-center">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por marca, modelo ou descrição…"
            className="border-0 pl-9 shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Prazo: os três botões de horizonte viraram um controle só.
              Leilão sem data publicada fica de fora quando o filtro está
              ligado, em vez de aparecer como se tivesse prazo. */}
          <Select
            value={filtros.encerra_em ?? TODOS}
            onValueChange={(v) => setFiltro('encerra_em', v === TODOS ? '' : v)}
          >
            <SelectTrigger
              className={cn(
                'h-9 w-auto gap-1.5 rounded-full text-sm',
                filtros.encerra_em && 'border-primary bg-primary text-primary-foreground',
              )}
            >
              <CalendarClock className="h-4 w-4 shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Qualquer prazo</SelectItem>
              <SelectItem value="3">Encerra em 3 dias</SelectItem>
              <SelectItem value="7">Encerra em 7 dias</SelectItem>
              <SelectItem value="15">Encerra em 15 dias</SelectItem>
              <SelectItem value="30">Encerra em 30 dias</SelectItem>
            </SelectContent>
          </Select>

          <Button
            size="sm"
            className="rounded-full"
            variant={filtros.parcelamento === 'true' ? 'default' : 'outline'}
            onClick={() => setFiltro('parcelamento', filtros.parcelamento === 'true' ? '' : 'true')}
            title="Leilão judicial que aceita proposta de pagamento parcelado (art. 895 do CPC): sinal + parcelas mensais, sem financiamento bancário"
          >
            <Scale className="mr-1.5 h-4 w-4" />
            Parcelável
            {stats ? <span className="ml-1.5 opacity-70">{stats.parcelaveis}</span> : null}
          </Button>

          <Button
            size="sm"
            className="rounded-full"
            variant={filtros.financiavel === 'true' ? 'default' : 'outline'}
            onClick={() => setFiltro('financiavel', filtros.financiavel === 'true' ? '' : 'true')}
          >
            <BadgeCheck className="mr-1.5 h-4 w-4" />
            Financiável
            {stats ? <span className="ml-1.5 opacity-70">{stats.financiaveis}</span> : null}
          </Button>

          <Select
            value={`${filtros.order ?? 'score'}:${filtros.dir ?? 'desc'}`}
            onValueChange={(v) => {
              const [order, dir] = v.split(':');
              setFiltros({ ...filtros, order, dir, page: '' });
            }}
          >
            <SelectTrigger className="h-9 w-auto gap-1.5 rounded-full text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="score:desc">Maior score</SelectItem>
              <SelectItem value="preco:asc">Menor preço</SelectItem>
              <SelectItem value="preco:desc">Maior preço</SelectItem>
              <SelectItem value="ano:desc">Mais novo</SelectItem>
              <SelectItem value="ano:asc">Mais antigo</SelectItem>
            </SelectContent>
          </Select>

          <Button
            size="sm"
            className="rounded-full"
            variant={aberto ? 'secondary' : 'outline'}
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
            aria-controls="painel-filtros"
          >
            <SlidersHorizontal className="mr-1.5 h-4 w-4" />
            Filtros
            {chipsAtivos.length > 0 && (
              <span className="ml-1.5 rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
                {chipsAtivos.length}
              </span>
            )}
            <ChevronDown className={cn('ml-1 h-4 w-4 transition-transform', aberto && 'rotate-180')} />
          </Button>
        </div>
      </div>

      {aberto && (
        <div
          id="painel-filtros"
          className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <Combo
            rotulo="Leiloeiro" chave="leiloeiro" filtros={filtros} aoMudar={setFiltro}
            valores={(stats?.por_leiloeiro ?? []).map((l) => ({
              valor: l.valor, total: l.total, rotulo: l.nome,
            }))}
          />
          <Combo rotulo="Tipo" chave="tipo" valores={stats?.por_tipo ?? []} filtros={filtros} aoMudar={setFiltro} />
          <Combo rotulo="UF" chave="uf" valores={stats?.por_uf ?? []} filtros={filtros} aoMudar={setFiltro} />
          <Combo rotulo="Condição" chave="condicao" valores={stats?.por_condicao ?? []} filtros={filtros} aoMudar={setFiltro} />
          <Combo rotulo="Origem" chave="origem" valores={stats?.por_origem ?? []} filtros={filtros} aoMudar={setFiltro} />

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Tipo de score</label>
            <Select
              value={filtros.score_tipo ?? 'confirmado'}
              onValueChange={(v) => setFiltro('score_tipo', v)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="confirmado">
                  Confirmado{stats ? ` (${stats.confirmados})` : ''}
                </SelectItem>
                <SelectItem value="especulativo">
                  Especulativo{stats ? ` (${stats.especulativos})` : ''}
                </SelectItem>
                <SelectItem value="todos">Todos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Faixa
            rotulo="Preço (R$)" chaveMin="preco_min" chaveMax="preco_max"
            placeholderMin="mín." placeholderMax="máx."
            filtros={filtros} aoMudar={setFiltro}
          />
          <Faixa
            rotulo="Ano" chaveMin="ano_min" chaveMax="ano_max"
            placeholderMin="1990" placeholderMax="2026"
            filtros={filtros} aoMudar={setFiltro}
          />
        </div>
      )}

      {/* Chips: o preço de recolher o painel é deixar rastro do que está
          filtrando, senão o acervo parece vazio sem motivo aparente. */}
      {algumFiltro && (
        <div className="flex flex-wrap items-center gap-2">
          {chipsAtivos.map((chave) => (
            <button
              key={chave}
              onClick={() => setFiltro(chave, chave === 'score_tipo' ? 'confirmado' : '')}
              className="inline-flex items-center gap-1 rounded-full border bg-secondary py-1 pl-3 pr-2 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title={`Remover filtro de ${ROTULO_PAINEL[chave]}`}
            >
              <span className="text-muted-foreground">{ROTULO_PAINEL[chave]}:</span>
              {textoChip(chave, filtros[chave]!, stats)}
              <X className="h-3.5 w-3.5" />
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={limpar}>
            <X className="mr-1 h-4 w-4" /> Limpar tudo
          </Button>
        </div>
      )}
    </div>
  );
}
