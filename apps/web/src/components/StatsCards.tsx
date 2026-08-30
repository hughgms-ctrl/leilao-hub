import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { pct } from '@/lib/utils';
import type { Stats } from '@/types';
import { Car, Target, Gauge, Database } from 'lucide-react';

const Item = ({
  icone, rotulo, valor, nota,
}: { icone: React.ReactNode; rotulo: string; valor: string; nota?: string }) => (
  <Card>
    <CardContent className="flex items-start gap-4 p-5">
      <div className="rounded-md bg-muted p-2 text-muted-foreground">{icone}</div>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{rotulo}</p>
        <p className="text-2xl font-semibold tabular-nums">{valor}</p>
        {nota && <p className="mt-0.5 text-xs text-muted-foreground">{nota}</p>}
      </div>
    </CardContent>
  </Card>
);

export function StatsCards({ stats }: { stats: Stats | null }) {
  if (!stats) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px]" />)}
      </div>
    );
  }
  const cobertura = stats.total_lotes ? stats.com_fipe / stats.total_lotes : 0;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Item icone={<Car className="h-5 w-5" />} rotulo="Lotes coletados" valor={String(stats.total_lotes)} />
      <Item
        icone={<Target className="h-5 w-5" />}
        rotulo="Oportunidades confirmadas"
        valor={String(stats.confirmados)}
        nota={`+${stats.especulativos} especulativas`}
      />
      <Item
        icone={<Gauge className="h-5 w-5" />}
        rotulo="Score médio"
        valor={pct(stats.score_medio)}
        nota={`${stats.com_score} lotes pontuados`}
      />
      <Item
        icone={<Database className="h-5 w-5" />}
        rotulo="Cobertura FIPE"
        valor={pct(cobertura)}
        nota={`${stats.com_fipe} de ${stats.total_lotes} lotes`}
      />
    </div>
  );
}
