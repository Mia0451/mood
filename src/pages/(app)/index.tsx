/**
 * `/` — the public room. Dynamic (under (app)/): everyone sees the live feed;
 * only signed-in users get the composer.
 */

import { useAuthStatus } from 'deepspace'
import { EmptyState } from '@/components/ui'
import { Sparkles } from 'lucide-react'

export default function PublicRoom() {
  const { isSignedIn } = useAuthStatus()

  return (
    <div className="flex min-h-full flex-col">
      <section data-testid="public-feed" className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        <EmptyState
          icon={<Sparkles className="h-6 w-6 text-primary" aria-hidden />}
          title="The room is quiet"
          description="No moods yet. When someone speaks one, it shows up here live."
        />
      </section>

      {isSignedIn && (
        <div
          data-testid="composer"
          className="sticky bottom-0 border-t border-border bg-background/90 px-4 py-3 backdrop-blur"
        >
          <div className="mx-auto max-w-2xl text-center text-sm text-muted-foreground">
            The voice composer arrives in the next milestone.
          </div>
        </div>
      )}
    </div>
  )
}
