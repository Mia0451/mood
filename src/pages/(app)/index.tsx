/**
 * `/` — the public room. Dynamic (under (app)/): everyone sees the live feed;
 * only signed-in users get the composer.
 *
 * Infinite scroll is best-effort: useQuery has `limit` but no cursor, so
 * reaching the bottom raises the limit by a page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthProfileReady, useAuthStatus, useQuery, type RecordData } from 'deepspace'
import { Loader2, Sparkles } from 'lucide-react'
import { EmptyState, useToast } from '@/components/ui'
import { ImageCard } from '../../components/ImageCard'
import { ImageMenu } from '../../components/ImageMenu'
import { VoiceComposer, type InputMode } from '../../components/VoiceComposer'
import { runAction } from '../../lib/actions-client'
import type { PublicImage } from '../../schemas/images-schema'
import type { ImageReaction, ReactionType } from '../../schemas/reactions-schema'

const PAGE = 20

export default function PublicRoom() {
  const { isSignedIn, userId } = useAuthStatus()
  const { user } = useAuthProfileReady()
  const isAdmin = user?.role === 'admin'
  const toast = useToast()
  const navigate = useNavigate()

  // Signed-in members can read only their own reaction rows.
  const { records: myReactionRows } = useQuery<ImageReaction>('image_reactions', {
    where: { actorId: userId ?? '__none__' },
  })
  const myReactions = useMemo(
    () => new Map(myReactionRows.map((r) => [r.data.imageId, r.data.type] as const)),
    [myReactionRows],
  )
  const [pending, setPending] = useState<Set<string>>(new Set())

  async function reactTo(imageId: string, type: ReactionType) {
    setPending((s) => new Set(s).add(imageId))
    const r = await runAction('react', { imageId, type })
    setPending((s) => {
      const next = new Set(s)
      next.delete(imageId)
      return next
    })
    if (!r.success) toast.error('Reaction not saved', r.error)
  }

  async function takedown(imageId: string) {
    const r = await runAction('takedownImage', { imageId })
    if (r.success) toast.success('Image taken down')
    else toast.error('Could not take it down', r.error)
  }

  async function openChat(imageId: string) {
    const r = await runAction<{ roomId: string }>('openChat', { imageId })
    if (r.success) navigate(`/chat/${encodeURIComponent(r.data.roomId)}`)
    else toast.error('Could not open the chat', r.error)
  }

  function menuFor(r: RecordData<PublicImage>) {
    if (!isSignedIn) return undefined
    return (
      <ImageMenu
        isOwn={r.data.ownerId === userId}
        isAdmin={isAdmin}
        myReaction={myReactions.get(r.recordId) ?? null}
        pending={pending.has(r.recordId)}
        onReact={(type) => void reactTo(r.recordId, type)}
        onChat={() => void openChat(r.recordId)}
        onTakedown={() => takedown(r.recordId)}
      />
    )
  }
  const [limit, setLimit] = useState(PAGE)
  const { records, status } = useQuery<PublicImage>('public_images', {
    orderBy: 'createdAt',
    orderDir: 'desc',
    limit,
  })
  // The owner can still read their own taken-down images; the room hides them.
  const live = records.filter((r) => r.data.status !== 'removed')
  const mayHaveMore = records.length >= limit

  const sentinel = useRef<HTMLDivElement>(null)
  const loadMore = useCallback(() => setLimit((l) => l + PAGE), [])
  useEffect(() => {
    const el = sentinel.current
    if (!el || !mayHaveMore) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore()
    }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [mayHaveMore, loadMore, records.length])

  async function generate(transcript: string, inputMode: InputMode) {
    const r = await runAction<{ imageId: string }>('generateMood', { transcript, inputMode })
    if (!r.success) {
      if (r.code === 'daily_limit') toast.warning('Daily limit reached', r.error)
      else toast.error('Could not create your mood', r.error)
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <section data-testid="public-feed" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-6">
        {status === 'loading' && live.length === 0 ? (
          <div className="flex justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" />
          </div>
        ) : live.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="h-6 w-6 text-primary" aria-hidden />}
            title="The room is quiet"
            description={
              isSignedIn
                ? 'Be the first: tap the mic below and say how you feel.'
                : 'No moods yet. When someone speaks one, it shows up here live.'
            }
          />
        ) : (
          live.map((r) => (
            <ImageCard key={r.recordId} record={r} signedIn={isSignedIn} actions={menuFor(r)} />
          ))
        )}
        {mayHaveMore && <div ref={sentinel} className="h-8" aria-hidden />}
      </section>

      {isSignedIn && (
        <div
          data-testid="composer"
          className="sticky bottom-0 border-t border-border bg-background/90 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur"
        >
          <div className="mx-auto max-w-xl">
            <VoiceComposer onSubmit={generate} />
          </div>
        </div>
      )}
    </div>
  )
}
