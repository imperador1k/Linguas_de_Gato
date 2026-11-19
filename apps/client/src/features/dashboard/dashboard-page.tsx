import { ArrowRight, Server } from 'lucide-react';
import { Link } from 'react-router';
import { MODULES, getModule, type LearningModule } from '@/app/modules';
import { PageHeader, SectionHeading } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCapabilities } from '@/hooks/use-capabilities';
import { cn } from '@/lib/utils';

const C1_FOCUS_AREAS = [
  { title: 'Inversion and emphasis', example: 'Not until later did I realise…' },
  { title: 'Hedging and stance', example: 'It would appear that…, arguably…' },
  { title: 'Collocation and register', example: 'reach a consensus, a sharp decline' },
  { title: 'Natural connected speech', example: 'weak forms, elision, linking' },
];

function formatToday(): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
}

function ModuleCard({ learningModule }: { learningModule: LearningModule }) {
  const Icon = learningModule.icon;
  const available = learningModule.status === 'available';

  return (
    <li>
      <Link
        to={learningModule.path}
        className="group flex h-full flex-col gap-4 rounded-lg border bg-card p-5 transition-colors duration-150 hover:border-border-strong"
      >
        <div className="flex items-start justify-between gap-3">
          <span className="inline-flex size-9 items-center justify-center rounded-md bg-muted text-foreground">
            <Icon aria-hidden="true" className="size-[1.125rem]" strokeWidth={1.75} />
          </span>
          {available ? <Badge variant="success">Available</Badge> : <Badge variant="outline">Planned · {learningModule.milestone}</Badge>}
        </div>
        <div>
          <h3 className="font-medium">{learningModule.label}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{learningModule.summary}</p>
        </div>
      </Link>
    </li>
  );
}

function WorkspaceStatus() {
  const capabilities = useCapabilities();

  let serverText: string;
  let transcriptionText: string;
  if (capabilities.status === 'loading') {
    serverText = 'Checking…';
    transcriptionText = 'Checking…';
  } else if (capabilities.status === 'error') {
    serverText = 'Not reachable';
    transcriptionText = 'Unknown';
  } else {
    serverText = 'Connected';
    const { transcription } = capabilities.data;
    transcriptionText = transcription.available
      ? 'Available'
      : transcription.configured
        ? 'Key configured · ships in M2'
        : 'Not configured';
  }

  return (
    <Card aria-labelledby="workspace-status-title">
      <CardHeader>
        <CardTitle id="workspace-status-title" className="flex items-center gap-2">
          <Server aria-hidden="true" className="size-4 text-muted-foreground" />
          Workspace
        </CardTitle>
        <CardDescription>Everything runs on this computer. Your practice data never leaves the browser.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
          <dt className="text-muted-foreground">Local server</dt>
          <dd className="text-right font-medium" aria-live="polite">
            {serverText}
          </dd>
          <dt className="text-muted-foreground">Transcription</dt>
          <dd className="text-right font-medium" aria-live="polite">
            {transcriptionText}
          </dd>
          <dt className="text-muted-foreground">Target language</dt>
          <dd className="text-right font-medium">English</dd>
        </dl>
        {capabilities.status === 'error' ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Start the API with <code className="font-mono text-[0.8125rem]">npm run dev</code>, then{' '}
            <button type="button" className="underline underline-offset-4 hover:text-foreground" onClick={capabilities.retry}>
              try again
            </button>
            .
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const listening = getModule('listening');

  return (
    <>
      <PageHeader
        eyebrow={formatToday()}
        title="Deliberate practice, one skill at a time."
        description="Your path from B2 towards C1. Start with listening: bring in audio, video or a YouTube lesson, add its transcript, and work through it at your own pace."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card aria-labelledby="continue-title">
          <div className="p-6 sm:p-8">
              <p className="text-xs font-medium tracking-[0.08em] text-brand uppercase">Start here</p>
              <h2 id="continue-title" className="mt-3 font-serif text-[1.75rem] leading-tight tracking-[-0.01em]">
                Listening workspace
              </h2>
              <p className="mt-3 max-w-prose text-[0.9375rem] leading-relaxed text-muted-foreground">{listening.summary}</p>
              <ul className="mt-5 flex flex-col gap-1.5 text-sm text-muted-foreground">
                {listening.highlights.map((highlight) => (
                  <li key={highlight} className="flex items-center gap-2.5">
                    <span aria-hidden="true" className="size-1 rounded-full bg-brand" />
                    {highlight}
                  </li>
                ))}
              </ul>
              <Link to={listening.path} className={cn(buttonVariants({ size: 'lg' }), 'mt-7')}>
                Open Listening
                <ArrowRight aria-hidden="true" />
              </Link>
          </div>
        </Card>

        <WorkspaceStatus />
      </div>

      <section aria-labelledby="focus-heading" className="mt-14">
        <SectionHeading id="focus-heading">At the B2 → C1 boundary</SectionHeading>
        <ul className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {C1_FOCUS_AREAS.map((area) => (
            <li key={area.title} className="bg-card p-5">
              <p className="text-sm font-medium">{area.title}</p>
              <p className="mt-1.5 font-serif text-[0.9375rem] text-muted-foreground italic">{area.example}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="modules-heading" className="mt-14">
        <SectionHeading id="modules-heading">Modules</SectionHeading>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {MODULES.map((learningModule) => (
            <ModuleCard key={learningModule.id} learningModule={learningModule} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="progress-heading" className="mt-14">
        <SectionHeading id="progress-heading">Recent practice</SectionHeading>
        <div className="rounded-lg border border-dashed px-6 py-10 text-center">
          <p className="font-medium">Nothing recorded yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Practice history arrives with the Progress module: time per skill and recurring mistakes, without streaks or points.
          </p>
        </div>
      </section>
    </>
  );
}
