import { admin, adminWallet, dashboardReady, type Overview, type People } from '@/lib/admin'
import { ApiError } from '@/lib/api'
import { CardFunnel, Failed, Gate, Kpis, NeedsALook, PeopleTable, Signups, TopBar } from './parts'

/**
 * Kova's dashboard: totals, new people a day, who's stuck, the ID check and card, and everyone,
 * searchable. Drawn on this server for a signed-in team wallet only (lib/admin.ts).
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const me = await adminWallet()
  if (!me) return <Gate ready={dashboardReady()} />
  const { q: rawQ, page: rawPage } = await searchParams
  const q = (rawQ ?? '').trim().slice(0, 80)
  const page = Math.max(1, Number(rawPage) || 1)
  let overview: Overview | null = null
  let people: People | null = null
  let problem: string | null = null
  try {
    ;[overview, people] = await Promise.all([
      admin<Overview>('/overview'),
      admin<People>(`/people?${new URLSearchParams({ q, page: String(page) })}`),
    ])
  } catch (error) {
    problem =
      error instanceof ApiError && error.status === 404
        ? 'The API doesn’t know this dashboard’s secret. Set the same KOVA_ADMIN_SECRET on the API and the web service.'
        : error instanceof Error
          ? error.message
          : 'Kova didn’t answer.'
  }

  return (
    <>
      <TopBar me={me} net={overview?.network ?? 'mainnet'} />
      <main className="adm-main">
        {problem || !overview || !people ? (
          <Failed message={problem ?? 'Kova didn’t answer.'} />
        ) : (
          <>
            <div className="adm-title">
              <h1>Everyone on Kova</h1>
              <span className="adm-muted">
                Live from the API ·{' '}
                {new Date(overview.generated_at).toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: 'Africa/Lagos',
                })}{' '}
                Lagos time
              </span>
            </div>
            <Kpis o={overview} />
            <div className="adm-split">
              <div className="adm-stack">
                <Signups daily={overview.people.daily} />
                <CardFunnel o={overview} />
              </div>
              <NeedsALook items={overview.attention} />
            </div>
            <PeopleTable
              rows={people.data}
              q={q}
              page={people.page}
              pages={people.pages}
              total={people.total}
            />
          </>
        )}
      </main>
    </>
  )
}
