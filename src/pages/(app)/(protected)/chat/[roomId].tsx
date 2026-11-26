/**
 * `/chat/:roomId` — a 1:1 private room. Signed-in only.
 */

import { useParams } from 'react-router-dom'
import { EmptyState } from '@/components/ui'

export default function ChatRoomPage() {
  const { roomId } = useParams()
  return (
    <div data-testid="chat-page" data-room-id={roomId} className="mx-auto w-full max-w-2xl px-4 py-6">
      <EmptyState title="Private chat" description="Messages will appear here." />
    </div>
  )
}
