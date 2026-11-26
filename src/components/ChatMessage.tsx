import type { RecordData } from 'deepspace'
import type { PrivateMessage } from '../schemas/chat-schema'
import { relativeTime } from '../lib/dates'
import { cn } from '@/lib/utils'

interface Props {
  record: RecordData<PrivateMessage>
  mine: boolean
  viewerId: string | null
  /** Display name for another user's id. */
  nameOf: (userId: string) => string
}

function ownerPhrase(ownerId: string | undefined, viewerId: string | null, nameOf: (id: string) => string): string {
  if (!ownerId) return 'a'
  if (ownerId === viewerId) return 'your'
  return `${nameOf(ownerId)}'s`
}

export function ChatMessage({ record, mine, viewerId, nameOf }: Props) {
  const m = record.data
  const mediaUrl = `/api/media/dm/${encodeURIComponent(record.recordId)}`

  if (m.type === 'system') {
    return (
      <div data-testid="chat-message" data-type="system" className="mx-auto flex w-full max-w-sm flex-col items-center gap-2 py-2 text-center">
        {m.imageRefUrl && (
          <img
            src={m.imageRefUrl}
            alt={`Mood: ${m.imageRefTranscript ?? ''}`}
            className="aspect-square w-40 rounded-xl border border-border object-cover"
          />
        )}
        <p className="text-xs text-muted-foreground">
          {mine ? 'You' : nameOf(m.senderId)} started a chat from {ownerPhrase(m.imageRefOwnerId, viewerId, nameOf)} mood
          {m.imageRefTranscript ? ` “${m.imageRefTranscript}”` : ''}
        </p>
      </div>
    )
  }

  return (
    <div data-testid="chat-message" data-type={m.type} className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[80%] overflow-hidden rounded-2xl text-sm',
          m.type === 'text' && 'px-4 py-2',
          mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-card text-card-foreground border border-border',
        )}
      >
        {m.type === 'text' && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
        {m.type === 'voice' && (
          <div className="p-2">
            <audio controls preload="none" src={mediaUrl} className="h-10 max-w-full" />
          </div>
        )}
        {m.type === 'image' && (
          <figure>
            <img src={mediaUrl} alt={`Mood: ${m.transcript ?? ''}`} className="aspect-square w-64 max-w-full object-cover" loading="lazy" />
            {m.transcript && <figcaption className="px-3 py-2 text-xs opacity-90">“{m.transcript}”</figcaption>}
          </figure>
        )}
      </div>
      <time className="px-1 text-[11px] text-muted-foreground" dateTime={record.createdAt}>
        {relativeTime(record.createdAt)}
      </time>
    </div>
  )
}
