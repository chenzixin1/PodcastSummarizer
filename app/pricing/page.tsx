import Link from 'next/link';
import AppFrame from '../../components/AppFrame';

const plans = [
  {
    name: 'Free',
    price: '$0',
    credits: '10 SRT credits',
    points: ['Public summaries', 'Bilingual summaries', 'Podcast assistant'],
  },
  {
    name: 'Creator',
    price: '$9',
    credits: '100 SRT credits',
    points: ['Private library', 'Credit ledger', 'Priority queue when enabled'],
  },
  {
    name: 'Team',
    price: 'Custom',
    credits: 'Shared credits',
    points: ['Admin controls', 'Usage review', 'Bulk migration support'],
  },
];

export default function PricingPage() {
  return (
    <AppFrame currentLabel="Pricing" showViewTabs={false}>
        <section className="dashboard-panel rounded-lg p-5 sm:p-6">
          <div className="mb-5 max-w-3xl">
            <h1 className="text-2xl font-semibold text-[var(--heading)]">PodSum.cc Pricing</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              Credits are used when a transcript is converted into a full AI summary package.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {plans.map((plan) => (
              <article key={plan.name} className="rounded-lg border border-[var(--border-soft)] bg-[var(--paper-base)] p-5">
                <div className="text-sm font-semibold uppercase text-[var(--text-muted)]">{plan.name}</div>
                <div className="mt-2 text-3xl font-semibold text-[var(--heading)]">{plan.price}</div>
                <div className="mt-1 text-sm text-[var(--text-secondary)]">{plan.credits}</div>
                <ul className="mt-5 space-y-2 text-sm text-[var(--text-secondary)]">
                  {plan.points.map((point) => (
                    <li key={point} className="flex gap-2">
                      <span className="text-[var(--heading)]">-</span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/upload" className="mt-5 inline-flex rounded-lg border border-[var(--border-soft)] bg-[var(--paper-muted)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--paper-subtle)]">
                  Continue
                </Link>
              </article>
            ))}
          </div>
        </section>
    </AppFrame>
  );
}
