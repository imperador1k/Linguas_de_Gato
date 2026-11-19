import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { buttonVariants } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <>
      <PageHeader eyebrow="404" title="This page doesn't exist." description="The link may be outdated, or the address mistyped." />
      <Link to="/" className={buttonVariants({ variant: 'secondary' })}>
        Back to overview
      </Link>
    </>
  );
}

/** Rendered by the router when a route throws while rendering or loading. */
export function RouteErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : 'Something went wrong while displaying this page.';

  return (
    <div className="mx-auto max-w-xl px-4 py-24">
      <PageHeader eyebrow="Error" title="We couldn't show this page." description={message} />
      <a href="/" className={buttonVariants({ variant: 'secondary' })}>
        Reload the app
      </a>
    </div>
  );
}
