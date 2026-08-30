import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Carrossel de fotos do card. Setas + swipe, sem abrir nada.
 *
 * As setas chamam preventDefault/stopPropagation porque o card inteiro é
 * um link para o detalhe — sem isso, trocar de foto navegaria.
 */
export function CarrosselFotos({
  fotos, alt, className,
}: { fotos: string[]; alt: string; className?: string }) {
  const [i, setI] = useState(0);
  const [quebradas, setQuebradas] = useState<Set<number>>(new Set());
  const toqueX = useRef<number | null>(null);

  const validas = fotos.filter((_, idx) => !quebradas.has(idx));
  const total = fotos.length;

  if (total === 0) {
    return (
      <div className={cn('flex items-center justify-center bg-muted text-muted-foreground', className)}>
        <ImageOff className="h-8 w-8" />
      </div>
    );
  }

  const ir = (delta: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setI((atual) => (atual + delta + total) % total);
  };

  const aoTocarInicio = (e: React.TouchEvent) => { toqueX.current = e.touches[0].clientX; };
  const aoTocarFim = (e: React.TouchEvent) => {
    if (toqueX.current === null) return;
    const dx = e.changedTouches[0].clientX - toqueX.current;
    if (Math.abs(dx) > 40) setI((a) => (a + (dx < 0 ? 1 : -1) + total) % total);
    toqueX.current = null;
  };

  return (
    <div
      className={cn('group relative overflow-hidden bg-muted', className)}
      onTouchStart={aoTocarInicio}
      onTouchEnd={aoTocarFim}
    >
      {fotos.map((src, idx) => (
        <img
          key={src}
          src={src}
          alt={`${alt} — foto ${idx + 1}`}
          // só a foto visível e a próxima saem do lazy: evita 8 requests por card
          loading={idx <= i + 1 ? 'eager' : 'lazy'}
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-200',
            idx === i ? 'opacity-100' : 'opacity-0',
          )}
          onError={() => setQuebradas((s) => new Set(s).add(idx))}
        />
      ))}

      {total > 1 && (
        <>
          <button
            type="button"
            aria-label="Foto anterior"
            onClick={ir(-1)}
            className="absolute left-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/45 p-1 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100 md:p-1.5"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Próxima foto"
            onClick={ir(1)}
            className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/45 p-1 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100 md:p-1.5"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 gap-1">
            {fotos.slice(0, 8).map((_, idx) => (
              <span
                key={idx}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  idx === i ? 'w-3 bg-white' : 'w-1.5 bg-white/55',
                )}
              />
            ))}
          </div>
        </>
      )}

      {validas.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground">
          <ImageOff className="h-8 w-8" />
        </div>
      )}
    </div>
  );
}
