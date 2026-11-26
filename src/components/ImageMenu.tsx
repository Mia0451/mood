/**
 * Hover/click menu over an image in the public room (signed-in viewers).
 *
 * Other people's images: Like, Dislike, Chat. Own images: no menu (by design).
 * Admins additionally get Take down on any image.
 * Desktop shows it on hover/focus; touch devices toggle it by tapping the image.
 */

import { useState } from 'react'
import { Flag, MessageCircle, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { ReactionType } from '../schemas/reactions-schema'
import { ConfirmModal } from './ui'
import { cn } from '@/lib/utils'

interface Props {
  isOwn: boolean
  isAdmin: boolean
  myReaction: ReactionType | null
  pending: boolean
  onReact: (type: ReactionType) => void
  onChat?: () => void
  onTakedown: () => Promise<void>
}

export function ImageMenu({ isOwn, isAdmin, myReaction, pending, onReact, onChat, onTakedown }: Props) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [takingDown, setTakingDown] = useState(false)
  if (isOwn && !isAdmin) return null

  const btn =
    'flex items-center gap-1.5 rounded-full bg-background/80 px-3 py-1.5 text-xs font-medium text-foreground backdrop-blur transition-colors hover:bg-background disabled:opacity-50'

  return (
    <>
      {/* Tap target for touch: toggles the menu without covering it. */}
      <button
        type="button"
        aria-label="Show image actions"
        className="absolute inset-0 cursor-pointer md:cursor-default"
        onClick={() => setOpen((v) => !v)}
      />
      <div
        data-testid="image-menu"
        className={cn(
          'absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 bg-gradient-to-t from-black/60 to-transparent p-3 pt-10 transition-opacity',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
          'group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
        )}
      >
        {!isOwn && (
          <>
            <button
              type="button"
              data-testid="react-like"
              aria-pressed={myReaction === 'like'}
              disabled={pending}
              onClick={() => onReact('like')}
              className={cn(btn, myReaction === 'like' && 'bg-primary text-primary-foreground hover:bg-primary')}
            >
              <ThumbsUp className="h-3.5 w-3.5" aria-hidden /> Like
            </button>
            <button
              type="button"
              data-testid="react-dislike"
              aria-pressed={myReaction === 'dislike'}
              disabled={pending}
              onClick={() => onReact('dislike')}
              className={cn(btn, myReaction === 'dislike' && 'bg-primary text-primary-foreground hover:bg-primary')}
            >
              <ThumbsDown className="h-3.5 w-3.5" aria-hidden /> Dislike
            </button>
            {onChat && (
              <button type="button" data-testid="image-chat" onClick={onChat} className={btn}>
                <MessageCircle className="h-3.5 w-3.5" aria-hidden /> Chat
              </button>
            )}
          </>
        )}
        {isAdmin && (
          <button
            type="button"
            data-testid="image-takedown"
            onClick={() => setConfirming(true)}
            className={cn(btn, 'ml-auto text-destructive')}
          >
            <Flag className="h-3.5 w-3.5" aria-hidden /> Take down
          </button>
        )}
      </div>

      <ConfirmModal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Take this image down?"
        description="It disappears from the room for everyone and its file is deleted. This can't be undone."
        confirmText="Take down"
        loading={takingDown}
        onConfirm={async () => {
          setTakingDown(true)
          try {
            await onTakedown()
          } finally {
            setTakingDown(false)
            setConfirming(false)
          }
        }}
      />
    </>
  )
}
