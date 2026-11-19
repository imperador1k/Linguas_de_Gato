import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-medium select-none',
    'transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50',
    'aria-disabled:pointer-events-none aria-disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/88',
        secondary: 'border border-border-strong bg-card text-foreground hover:bg-accent',
        ghost: 'text-foreground hover:bg-accent',
        brand: 'bg-brand text-brand-foreground hover:bg-brand/90',
        link: 'h-auto px-0 text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-brand',
      },
      size: {
        sm: 'h-9 rounded-md px-3 text-sm [&_svg]:size-4',
        md: 'h-10 rounded-md px-4 text-sm [&_svg]:size-4',
        lg: 'h-11 rounded-lg px-5 text-[0.9375rem] [&_svg]:size-[1.125rem]',
        icon: 'size-10 rounded-full [&_svg]:size-[1.125rem]',
        'icon-sm': 'size-9 rounded-full [&_svg]:size-4',
        'icon-lg': 'size-12 rounded-full [&_svg]:size-5',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
