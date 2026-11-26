/**
 * `/` — the public room. Dynamic (under (app)/): everyone sees the live feed;
 * only signed-in users get the composer.
 *
 * Infinite scroll is best-effort: useQuery has `limit` but no cursor, so
 * reaching the bottom raises the limit by a page.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStatus, useQuery } from 'deepspace'
import { Loader2, Sparkles } from 'lucide-react'
import { EmptyState, useToast } from '@/components/ui'
import { ImageCard } from '../../components/ImageCard'
import { VoiceComposer, type InputMode } from '../../components/VoiceComposer'
import { runAction } from '../../lib/actions-client'
import type { PublicImage } from '../../schemas/images-schema'

const PAGE = 20

export default function PublicRoom() {
  const { isSignedIn } = useAuthStatus()
  const toast = useToast()
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
          live.map((r) => <ImageCard key={r.recordId} record={r} signedIn={isSignedIn} />)
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
