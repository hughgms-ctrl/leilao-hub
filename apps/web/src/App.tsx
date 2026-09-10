import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import Dashboard from '@/pages/Dashboard';
import LoteDetalhe from '@/pages/LoteDetalhe';
import { buscarStats } from '@/api';
import { Assinatura } from '@/components/Marca';

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
        {/* Cabeçalho em grafite: dá âncora visual à marca e separa o
            "quem somos" do conteúdo, que fica todo em superfície clara. */}
        <header className="bg-brand text-brand-foreground">
          <div className="container flex flex-wrap items-center justify-between gap-3 py-4">
            <Link to="/" className="transition-opacity hover:opacity-90">
              <Assinatura />
            </Link>
            <p className="text-sm text-brand-foreground/70">
              Veículos em leilão, comparados com a tabela FIPE
            </p>
          </div>
        </header>

        {/* Faixa de fontes: informação de procedência, não de navegação */}
        <div className="border-b bg-muted/40">
          <div className="container py-2">
            <Fontes />
          </div>
        </div>

        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/lote/:id" element={<LoteDetalhe />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
