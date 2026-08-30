import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const brl = (v: number | string | null | undefined) =>
  v === null || v === undefined
    ? '—'
    : Number(v).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        maximumFractionDigits: 0,
      });

export const pct = (v: number | string | null | undefined) =>
  v === null || v === undefined ? '—' : `${(Number(v) * 100).toFixed(1)}%`;

/**
 * Title Case — os dados do leiloeiro vêm todos em minúsculo.
 *
 * Não dá para usar \b aqui: em JS o word boundary é ASCII-only, então ele
 * enxerga fronteira ao redor de "ã"/"é" e "sertãozinho" virava "SertÃOzinho".
 * Maiusculiza só depois do início ou de um separador de verdade.
 */
export const titulo = (s: string | null | undefined) =>
  !s ? '' : s.replace(/(^|[\s/\-.])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase());
