import { useCallback, useEffect, useState } from 'react';

export type Filtros = Record<string, string>;

/**
 * Estado dos filtros na querystring: o link da página sempre reflete o que
 * está na tela, então é compartilhável e sobrevive a refresh/voltar.
 */
export function useFiltrosUrl(iniciais: Filtros = {}) {
  const ler = useCallback((): Filtros => {
    const p = new URLSearchParams(window.location.search);
    const out: Filtros = { ...iniciais };
    p.forEach((v, k) => {
      if (v !== '') out[k] = v;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [filtros, setFiltrosState] = useState<Filtros>(ler);

  useEffect(() => {
    const aoVoltar = () => setFiltrosState(ler());
    window.addEventListener('popstate', aoVoltar);
    return () => window.removeEventListener('popstate', aoVoltar);
  }, [ler]);

  const setFiltros = useCallback((novos: Filtros) => {
    const limpos: Filtros = {};
    for (const [k, v] of Object.entries(novos)) {
      if (v !== undefined && v !== null && v !== '') limpos[k] = v;
    }
    const qs = new URLSearchParams(limpos).toString();
    window.history.pushState({}, '', qs ? `?${qs}` : window.location.pathname);
    setFiltrosState(limpos);
  }, []);

  /** altera uma chave e volta para a página 1 (menos quando é a própria página) */
  const setFiltro = useCallback(
    (chave: string, valor: string) => {
      setFiltrosState((atual) => {
        const proximo = { ...atual, [chave]: valor };
        if (chave !== 'page') delete proximo.page;
        const limpos: Filtros = {};
        for (const [k, v] of Object.entries(proximo)) {
          if (v !== undefined && v !== null && v !== '') limpos[k] = v;
        }
        const qs = new URLSearchParams(limpos).toString();
        window.history.pushState({}, '', qs ? `?${qs}` : window.location.pathname);
        return limpos;
      });
    },
    [],
  );

  return { filtros, setFiltros, setFiltro };
}

/** debounce simples para a busca livre não disparar request a cada tecla */
export function useDebounce<T>(valor: T, ms = 400): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}
