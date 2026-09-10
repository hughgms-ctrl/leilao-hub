/**
 * Símbolo da marca: um hub — nós periféricos convergindo para um centro.
 *
 * É literalmente o produto: 13 leiloeiros reunidos num lugar só. Preferi
 * isso a um martelo de leilão, que é o clichê do setor e não diz o que
 * nos diferencia (qualquer leiloeiro pode usar um martelo; agregar, não).
 *
 * `currentColor` no traço e laranja da marca no núcleo: assim o símbolo
 * funciona sobre grafite (cabeçalho) e sobre claro (favicon, impressão)
 * sem precisar de duas versões.
 */
export function Marca({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      role="img"
      aria-label="Leilão Hub"
    >
      {/* raios: periferia -> centro */}
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.55">
        <path d="M16 16 L16 5" />
        <path d="M16 16 L25.5 10.5" />
        <path d="M16 16 L25.5 21.5" />
        <path d="M16 16 L16 27" />
        <path d="M16 16 L6.5 21.5" />
        <path d="M16 16 L6.5 10.5" />
      </g>

      {/* nós periféricos = os leiloeiros */}
      <g fill="currentColor" opacity="0.75">
        <circle cx="16" cy="4.6" r="2.1" />
        <circle cx="26.2" cy="10.5" r="2.1" />
        <circle cx="26.2" cy="21.5" r="2.1" />
        <circle cx="16" cy="27.4" r="2.1" />
        <circle cx="5.8" cy="21.5" r="2.1" />
        <circle cx="5.8" cy="10.5" r="2.1" />
      </g>

      {/* núcleo = o hub, sempre na cor da marca */}
      <circle cx="16" cy="16" r="4.6" fill="hsl(var(--primary))" />
    </svg>
  );
}

/** Assinatura completa: símbolo + nome. */
export function Assinatura({ compacta = false }: { compacta?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Marca className={compacta ? 'h-6 w-6' : 'h-8 w-8'} />
      <span
        className={
          compacta
            ? 'text-lg font-semibold tracking-tight'
            : 'text-xl font-semibold tracking-tight'
        }
      >
        Leilão<span className="text-primary">Hub</span>
      </span>
    </span>
  );
}
