/**
 * `/account` — signed-in only.
 *  Tab 1 (Generations): sticky DD/MM/YYYY date rail (newest first) beside a
 *    grid of the user's public images; click to open the zoomable lightbox.
 *    No delete actions.
 *  Tab 2 (Chats): private rooms by most recent message, with unread badges.
 * `?tab=chats` selects the second tab.
 */

import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuthStatus, useQuery, useUserLookup, type RecordData } from 'deepspace'
import { EmptyState, Avatar, AvatarFallback, AvatarImage, Badge, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui'
import { Lightbox } from '../../../components/Lightbox'
import { formatDayLabel, localDayKey, relativeTime } from '../../../lib/dates'
import type { PublicImage } from '../../../schemas/images-schema'
import type { PrivateRoom } from '../../../schemas/chat-schema'
import { cn } from '@/lib/utils'

export default function AccountPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'chats' ? 'chats' : 'generations'

  return (
    <div data-testid="account-page" className="mx-auto w-full max-w-5xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Your account</h1>
      <Tabs
        value={tab}
        onValueChange={(v) => setParams(v === 'chats' ? { tab: 'chats' } : {}, { replace: true })}
      >
        <TabsList>
          <TabsTrigger value="generations" data-testid="tab-generations">Generations</TabsTrigger>
          <TabsTrigger value="chats" data-testid="tab-chats">Chats</TabsTrigger>
        </TabsList>
        <TabsContent value="generations" className="pt-4">
          <GenerationFeed />
        </TabsContent>
        <TabsContent value="chats" className="pt-4">
          <ChatHistory />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function GenerationFeed() {
  const { userId } = useAuthStatus()
  const { records, status } = useQuery<PublicImage>('public_images', {
    where: { ownerId: userId ?? '__none__' },
    orderBy: 'createdAt',
    orderDir: 'desc',
    limit: 1000,
  })
  const [open, setOpen] = useState<RecordData<PublicImage> | null>(null)

  // Newest day first; images within a day newest first (query order).
  const days = useMemo(() => {
    const groups = new Map<string, RecordData<PublicImage>[]>()
    for (const r of records) {
      const key = localDayKey(r.createdAt)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(r)
    }
    return [...groups.entries()].map(([key, items]) => ({ key, label: formatDayLabel(items[0].createdAt), items }))
  }, [records])

  if (status === 'ready' && records.length === 0) {
    return (
      <EmptyState
        title="No generations yet"
        description="Moods you create in the public room appear here, newest first."
        action={{ label: 'Go to the room', onClick: () => (window.location.href = '/') }}
      />
    )
  }

  return (
    <div data-testid="generation-feed" className="flex gap-6">
      <nav aria-label="Dates" className="hidden w-32 shrink-0 sm:block">
        <ol className="sticky top-20 space-y-1 text-sm">
          {days.map((d) => (
            <li key={d.key}>
              <a
                href={`#day-${d.key}`}
                data-testid="date-rail-item"
                className="block rounded-md px-2 py-1 tabular-nums text-muted-foreground hover:bg-card hover:text-foreground"
              >
                {d.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="min-w-0 flex-1 space-y-8">
        {days.map((d) => (
          <section key={d.key} id={`day-${d.key}`} className="scroll-mt-20">
            <h2 className="mb-3 text-sm font-medium tabular-nums text-muted-foreground sm:hidden">{d.label}</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {d.items.map((r) => {
                const removed = r.data.status === 'removed'
                return (
                  <button
                    key={r.recordId}
                    type="button"
                    data-testid="generation-tile"
                    disabled={removed}
                    onClick={() => setOpen(r)}
                    className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-muted text-left disabled:cursor-not-allowed"
                  >
                    {removed ? (
                      <div className="flex h-full items-center justify-center p-3 text-center text-xs text-muted-foreground">
                        Taken down by a moderator
                      </div>
                    ) : (
                      <img
                        src={r.data.imageUrl}
                        alt={`Mood: ${r.data.promptTranscript}`}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                      />
                    )}
                    <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6 text-xs text-white">
                      “{r.data.promptTranscript}”
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      {open && (
        <Lightbox
          src={open.data.imageUrl}
          alt={`Mood: ${open.data.promptTranscript}`}
          caption={open.data.promptTranscript}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}

function ChatHistory() {
  const { userId } = useAuthStatus()
  const { getUser } = useUserLookup()
  const { records, status } = useQuery<PrivateRoom>('private_rooms', {
    orderBy: 'lastMessageAt',
    orderDir: 'desc',
  })
  const rooms = [...records].sort((a, b) => (b.data.lastMessageAt ?? '').localeCompare(a.data.lastMessageAt ?? ''))

  if (status === 'ready' && rooms.length === 0) {
    return <EmptyState title="No chats yet" description="Open a chat from someone's image in the public room." />
  }

  return (
    <ul data-testid="chat-history" className="divide-y divide-border overflow-hidden rounded-xl border border-border">
      {rooms.map((r) => {
        const peerId = r.data.participants.find((p) => p !== userId) ?? ''
        const peer = getUser(peerId)
        const unread = (userId && r.data.unread?.[userId]) || 0
        return (
          <li key={r.recordId}>
            <Link
              to={`/chat/${encodeURIComponent(r.recordId)}`}
              data-testid="chat-row"
              className="flex items-center gap-3 bg-card px-4 py-3 transition-colors hover:bg-accent"
            >
              <Avatar className="h-10 w-10">
                <AvatarImage src={peer?.imageUrl} referrerPolicy="no-referrer" />
                <AvatarFallback>{peer?.name?.[0]?.toUpperCase() ?? '?'}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className={cn('truncate text-sm', unread ? 'font-semibold' : 'font-medium')}>{peer?.name ?? 'Someone'}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.data.lastSenderId === userId ? 'You: ' : ''}
                  {r.data.lastMessagePreview}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-[11px] text-muted-foreground">{r.data.lastMessageAt ? relativeTime(r.data.lastMessageAt) : ''}</span>
                {unread > 0 && <Badge data-testid="chat-unread">{unread}</Badge>}
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
