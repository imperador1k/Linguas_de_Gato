import { useCallback, useEffect, useLayoutEffect, useRef, type ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * A textarea that grows with its content, so long text is never clipped
 * behind an inner scrollbar (a real problem on narrow phones).
 */
export function AutoGrowTextarea({ className, value, rows = 2, ...props }: ComponentProps<'textarea'> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight + 2}px`;
  }, []);
  useLayoutEffect(resize, [value, resize]);
  useEffect(() => {
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  return <textarea ref={ref} value={value} rows={rows} className={cn('resize-none overflow-hidden', className)} {...props} />;
}
