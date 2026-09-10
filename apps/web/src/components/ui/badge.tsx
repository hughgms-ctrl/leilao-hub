import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-foreground',
        // Era ambar. Com o laranja virando cor de marca, o aviso deixava
        // de se distinguir do cabecalho e dos botoes. Zinco mantem o
        // recado legivel sem competir com a marca nem com o verde do
        // desconto.
        warning: 'border-transparent bg-zinc-200 text-zinc-700 dark:bg-zinc-500/20 dark:text-zinc-300',
        danger: 'border-transparent bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
