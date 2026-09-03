import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import Dashboard from '@/pages/Dashboard';
import LoteDetalhe from '@/pages/LoteDetalhe';
import { buscarStats } from '@/api';

/**
 * A lista de fontes era escrita à mão no cabeçalho e ficou mentindo:
 * dizia "Sodré Santoro · Freitas Leiloeiro" enquanto o banco já tinha
 * seis leiloeiros. Agora sai do próprio /api/stats.
 */
function Fontes() {
  const [nomes, setNomes] = useState<string[] | null>(null);

  useEffect(() => {
    let vivo = true;
    buscarStats()
      .then((s) => vivo && setNomes(s.por_leiloeiro.map((l) => l.nome).filter(Boolean)))
      .catch(() => {}); // cabeçalho não é lugar de mostrar erro de rede
    return () => {
      vivo = false;
    };
  }, []);

  if (!nomes?.length) return null;
  return <p className="text-xs text-muted-foreground">Fontes: {nomes.join(' · ')}</p>;
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-background">
        <header className="border-b">
          <div className="container flex flex-wrap items-baseline justify-between gap-2 py-6">
            <div>
              <Link to="/" className="text-2xl font-semibold tracking-tight hover:underline">
                Leilão Hub
              </Link>
              <p className="text-sm text-muted-foreground">
                Oportunidades de veículos em leilão, comparadas com a tabela FIPE
              </p>
            </div>
            <Fontes />
          </div>
        </header>

        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/lote/:id" element={<LoteDetalhe />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
