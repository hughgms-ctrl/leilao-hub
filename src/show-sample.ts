import { readFileSync } from 'node:fs';
import { SodreSantoroApiAdapter } from './adapters/sodre-santoro-api';

/** Mostra lotes mapeados a partir de sample-response.json (offline). */
const sample = JSON.parse(readFileSync('sample-response.json', 'utf-8'));
const adapter = new SodreSantoroApiAdapter();
const docs: Record<string, any>[] = sample.results ?? [];

// prioriza lotes "de verdade" (com foto e lance) para inspeção visual
const interessantes = docs.filter(
  (d) => d.lot_pictures?.length && Number(d.bid_initial) > 0,
);
const escolhidos = [...interessantes, ...docs].slice(0, 3);

for (const d of escolhidos) {
  console.log(`--- lote ${d.lot_id} (status: ${d.lot_status}) ---`);
  console.log(JSON.stringify(adapter.mapLot(d), null, 2));
}
