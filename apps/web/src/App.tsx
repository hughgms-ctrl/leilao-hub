import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import Dashboard from '@/pages/Dashboard';
import LoteDetalhe from '@/pages/LoteDetalhe';

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
            <p className="text-xs text-muted-foreground">Fonte: Sodré Santoro</p>
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
