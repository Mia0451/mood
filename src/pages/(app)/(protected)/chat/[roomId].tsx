/**
 * `/chat/:roomId` — a 1:1 private room. Signed-in only, and the room's rows
 * only ever reach its two participants (server-enforced read policy).
 *
 * Send text, record a voice note, or paint a mood privately (counts toward
 * the daily cap; never appears in the public room).
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuthStatus, useQuery, useUserLookup } from 'deepspace'
import { ArrowLeft, Loader2, Mic, Palette, Send, Square, X } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage, Button, EmptyState, Input, useToast } from '@/components/ui'
import { ChatMessage } from '../../../../components/ChatMessage'
import { VoiceComposer, type InputMode } from '../../../../components/VoiceComposer'
import { blobToBase64, useVoiceRecorder, type Recording } from '../../../../hooks/useVoiceRecorder'
import { runAction } from '../../../../lib/actions-client'
import { TEXT_MAX_LENGTH, type PrivateMessage, type PrivateRoom } from '../../../../schemas/chat-schema'

export default function ChatRoomPage() {
  const { roomId = '' } = useParams()
  const { userId } = useAuthStatus()
  const { getUser } = useUserLookup()
  const toast = useToast()

  const { records: rooms, status: roomsStatus } = useQuery<PrivateRoom>('private_rooms')
  const room = rooms.find((r) => r.recordId === roomId)
  const { records: messages } = useQuery<PrivateMessage>('private_messages', {
    where: { roomId },
    orderBy: 'createdAt',
    orderDir: 'asc',
    limit: 500,
  })

  const peerId = room?.data.participants.find((p) => p !== userId) ?? ''
  const peer = peerId ? getUser(peerId) : null
  const nameOf = (id: string) => getUser(id)?.name ?? 'Someone'

  // Clear my unread badge whenever this room has unread messages for me.
  const myUnread = (userId && room?.data.unread?.[userId]) || 0
  useEffect(() => {
    if (myUnread > 0) void runAction('markRead', { roomId })
  }, [myUnread, roomId])

  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [painting, setPainting] = useState(false)

  async function sendText(e: FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    const r = await runAction('sendMessage', { roomId, text: body })
    setSending(false)
    if (r.success) setText('')
    else toast.error('Message not sent', r.error)
  }

  async function sendVoice(rec: Recording) {
    setSending(true)
    const r = await runAction('sendVoice', {
      roomId,
      audioBase64: await blobToBase64(rec.blob),
      mimeType: rec.mimeType,
      durationMs: rec.durationMs,
    })
    setSending(false)
    if (!r.success) toast.error('Voice note not sent', r.error)
  }
  const recorder = useVoiceRecorder((rec) => void sendVoice(rec))

  async function paint(transcript: string, inputMode: InputMode) {
    const r = await runAction('generateInChat', { roomId, transcript, inputMode })
    if (r.success) setPainting(false)
    else if (r.code === 'daily_limit') toast.warning('Daily limit reached', r.error)
    else toast.error('Could not paint that mood', r.error)
  }

  if (roomsStatus !== 'ready' && !room) {
    return (
      <div className="flex justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" />
      </div>
    )
  }
  if (!room) {
    return (
      <div data-testid="chat-not-found" className="mx-auto max-w-xl px-4 py-10">
        <EmptyState title="Chat not found" description="This chat doesn't exist or isn't yours." />
      </div>
    )
  }

  return (
    <div data-testid="chat-page" data-room-id={roomId} className="mx-auto flex h-full w-full max-w-2xl flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link to="/account?tab=chats" aria-label="Back to chats" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Avatar className="h-8 w-8">
          <AvatarImage src={peer?.imageUrl} referrerPolicy="no-referrer" />
          <AvatarFallback>{peer?.name?.[0]?.toUpperCase() ?? '?'}</AvatarFallback>
        </Avatar>
        <h1 data-testid="chat-peer-name" className="truncate font-medium">
          {peer?.name ?? 'Private chat'}
        </h1>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m) => (
          <ChatMessage key={m.recordId} record={m} mine={m.data.senderId === userId} viewerId={userId} nameOf={nameOf} />
        ))}
        <div ref={bottom} />
      </div>

      <div className="border-t border-border bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        {painting ? (
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <VoiceComposer onSubmit={paint} placeholder="Paint a mood for this chat…" />
            </div>
            <Button variant="ghost" size="icon" aria-label="Close painter" onClick={() => setPainting(false)} className="mt-7">
              <X />
            </Button>
          </div>
        ) : (
          <form onSubmit={sendText} className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              data-testid="chat-paint"
              aria-label="Paint a mood"
              onClick={() => setPainting(true)}
              disabled={sending || recorder.recording}
            >
              <Palette />
            </Button>
            {recorder.recording ? (
              <div data-testid="chat-recording" className="flex h-11 flex-1 items-center gap-2 rounded-full border border-destructive/50 px-4 text-sm">
                <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" aria-hidden />
                Recording… {Math.floor(recorder.elapsedMs / 1000)}s
              </div>
            ) : (
              <Input
                data-testid="chat-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Message"
                maxLength={TEXT_MAX_LENGTH}
                className="h-11 flex-1 rounded-full px-4"
                aria-label="Message"
              />
            )}
            {text.trim() && !recorder.recording ? (
              <Button type="submit" size="icon" data-testid="chat-send" aria-label="Send" disabled={sending} className="rounded-full">
                {sending ? <Loader2 className="animate-spin" /> : <Send />}
              </Button>
            ) : recorder.supported ? (
              <Button
                type="button"
                size="icon"
                data-testid="chat-record"
                aria-label={recorder.recording ? 'Stop and send voice note' : 'Record a voice note'}
                disabled={sending}
                onClick={recorder.recording ? recorder.stop : () => void recorder.start()}
                className="rounded-full"
              >
                {sending ? <Loader2 className="animate-spin" /> : recorder.recording ? <Square /> : <Mic />}
              </Button>
            ) : null}
          </form>
        )}
        {recorder.error && <p className="mt-2 text-xs text-destructive">{recorder.error}</p>}
      </div>
    </div>
  )
}
