/**
 * One mood in the public feed.
 *
 * Signed-out viewers see a masked author (the users roster is empty for
 * anonymous connections, and the card never renders raw ids). Signed-in
 * viewers see the author's Google name and avatar.
 */

import type { ReactNode } from 'react'
import { useUserLookup, type RecordData } from 'deepspace'
import { ThumbsDown, ThumbsUp, UserRound } from 'lucide-react'
import type { PublicImage } from '../schemas/images-schema'
import { Avatar, AvatarFallback, AvatarImage } from './ui'
import { relativeTime } from '../lib/dates'

interface Props {
  record: RecordData<PublicImage>
  signedIn: boolean
  /** Reaction controls / menu, supplied by the feed (milestone 3). */
  actions?: ReactNode
}

export function ImageCard({ record, signedIn, actions }: Props) {
  const { getUser } = useUserLookup()
  const img = record.data
  const author = signedIn ? getUser(img.ownerId) : null

  return (
    <article
      data-testid="image-card"
      data-image-id={record.recordId}
      className="group overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]"
    >
      <header className="flex items-center gap-3 px-4 py-3">
        {author ? (
          <Avatar className="h-8 w-8">
            <AvatarImage src={author.imageUrl} referrerPolicy="no-referrer" />
            <AvatarFallback>{author.name?.[0]?.toUpperCase() ?? '?'}</AvatarFallback>
          </Avatar>
        ) : (
          <div
            data-testid="masked-author"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground blur-[0.5px]"
            aria-hidden
          >
            <UserRound className="h-4 w-4" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p data-testid="image-author" className="truncate text-sm font-medium">
            {author?.name ?? (signedIn ? 'Someone' : 'Someone in the room')}
          </p>
          <p className="text-xs text-muted-foreground">
            <time dateTime={record.createdAt}>{relativeTime(record.createdAt)}</time>
          </p>
        </div>
      </header>

      <div className="relative aspect-square bg-muted">
        <img
          src={img.imageUrl}
          alt={`Generated image for: ${img.promptTranscript}`}
          loading="lazy"
          className="h-full w-full object-cover"
        />
        {actions}
      </div>

      <footer className="flex items-start gap-3 px-4 py-3">
        <p data-testid="image-transcript" className="flex-1 text-sm text-foreground/90">
          “{img.promptTranscript}”
        </p>
        <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1" data-testid="like-count">
            <ThumbsUp className="h-3.5 w-3.5" aria-label="Likes" /> {img.likeCount ?? 0}
          </span>
          <span className="flex items-center gap-1" data-testid="dislike-count">
            <ThumbsDown className="h-3.5 w-3.5" aria-label="Dislikes" /> {img.dislikeCount ?? 0}
          </span>
        </div>
      </footer>
    </article>
  )
}
