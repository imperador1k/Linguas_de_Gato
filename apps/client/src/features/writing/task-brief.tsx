import type { WritingTask } from '@ldg/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { REGISTER_LABELS, WRITING_DISCLAIMER, WRITING_FORMAT_LABELS } from './writing-labels';

const HEADING = 'mb-1.5 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase';

function List({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/** The task as the learner reads it while writing (and later next to the feedback). */
export function TaskBrief({ task, compact = false }: { task: WritingTask; compact?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{task.level}</Badge>
          <Badge variant="neutral">{WRITING_FORMAT_LABELS[task.format]}</Badge>
          <Badge variant="neutral">{REGISTER_LABELS[task.register].label}</Badge>
        </div>
        <CardTitle className="mt-2 font-serif text-xl font-normal leading-snug">{task.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-1">
        <p className="text-[0.9375rem] leading-relaxed">{task.instructions}</p>
        <div>
          <h3 className={HEADING}>Context</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{task.context}</p>
        </div>
        {task.sourceText ? (
          <div>
            <h3 className={HEADING}>Source text</h3>
            <blockquote className="max-h-80 overflow-y-auto rounded-md border-l-2 border-brand bg-muted/50 px-3.5 py-2.5 font-serif text-[0.9375rem] leading-relaxed whitespace-pre-wrap">
              {task.sourceText}
            </blockquote>
          </div>
        ) : null}
        <div>
          <h3 className={HEADING}>Length</h3>
          <p className="text-sm">
            <span className="font-mono tabular-nums">
              {task.wordCount.min}–{task.wordCount.max}
            </span>{' '}
            words (aim for about {task.wordCount.target})
          </p>
        </div>
        <div>
          <h3 className={HEADING}>Include</h3>
          <List items={task.requiredElements} />
        </div>
        {!compact ? (
          <>
            <div>
              <h3 className={HEADING}>You will be assessed on</h3>
              <List items={task.evaluationCriteria} />
            </div>
            <div>
              <h3 className={HEADING}>Learning objectives</h3>
              <List items={task.objectives} />
            </div>
            {task.languageFeatures.length > 0 ? (
              <details className="rounded-md border px-3.5 py-2.5">
                <summary className="cursor-pointer text-sm font-medium">Useful language ({task.languageFeatures.length})</summary>
                <div className="mt-2">
                  <List items={task.languageFeatures} />
                </div>
              </details>
            ) : null}
            <p className="text-xs text-muted-foreground">{WRITING_DISCLAIMER}</p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
