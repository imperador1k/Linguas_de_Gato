import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { getModule, type ModuleId } from '@/app/modules';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Honest placeholder for modules on the roadmap. No mock data or fake controls. */
export function PlannedModulePage({ moduleId }: { moduleId: ModuleId }) {
  const learningModule = getModule(moduleId);
  const Icon = learningModule.icon;

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <Icon aria-hidden="true" className="size-3.5" />
            {learningModule.label}
          </span>
        }
        title={learningModule.summary}
      />

      <div className="max-w-2xl rounded-lg border bg-card p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline">Planned · milestone {learningModule.milestone}</Badge>
          <p className="text-sm text-muted-foreground">This module isn't built yet.</p>
        </div>
        <h2 className="mt-6 text-sm font-medium">What it will include</h2>
        <ul className="mt-3 flex flex-col gap-2 text-[0.9375rem] text-muted-foreground">
          {learningModule.highlights.map((highlight) => (
            <li key={highlight} className="flex items-center gap-3">
              <span aria-hidden="true" className="size-1 rounded-full bg-brand" />
              {highlight}
            </li>
          ))}
        </ul>
        <div className="mt-8 border-t pt-6">
          <Link to="/listening" className={cn(buttonVariants({ variant: 'secondary' }))}>
            Practise listening meanwhile
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </div>
    </>
  );
}
