import type { Metadata } from 'next'
import { EventsCard, KeysCard, Quickstart, WebhooksCard } from '@/components/developers'
import { PageHead } from '@/components/shell'
import { type ApiKey, type KovaEvent, kova, type WebhookEndpoint } from '@/lib/api'

export const metadata: Metadata = { title: 'Developers' }

export default async function DevelopersPage() {
  const [keys, endpoints, events] = await Promise.all([
    kova<{ data: ApiKey[] }>('/v1/api_keys'),
    kova<{ data: WebhookEndpoint[] }>('/v1/webhook_endpoints'),
    kova<{ data: KovaEvent[] }>('/v1/events?limit=15'),
  ])
  const apiUrl =
    process.env.KOVA_PUBLIC_API_URL ?? process.env.KOVA_API_URL ?? 'http://localhost:4000'
  return (
    <>
      <PageHead
        title="Developers"
        sub="Take Kova payments from your own website, app or till software"
      />
      <div className="dev">
        <div className="stack">
          <Quickstart apiUrl={apiUrl} />
          <KeysCard keys={keys.data} />
          <WebhooksCard endpoints={endpoints.data} />
        </div>
        <div className="stack">
          <EventsCard initial={events.data} />
        </div>
      </div>
    </>
  )
}
