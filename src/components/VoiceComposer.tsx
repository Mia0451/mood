/**
 * Click-to-speak composer with a typed fallback.
 *
 * Voice: one click starts listening; when the speaker pauses, the transcript
 * is submitted as-is (not editable, by product decision).
 * Typed: a short text field for browsers without speech recognition, or for
 * anyone who prefers typing.
 *
 * `onSubmit` does the work (public room or private chat) and resolves when done.
 */

import { useState, type FormEvent } from 'react'
import { Keyboard, Loader2, Mic, Send, Square } from 'lucide-react'
import { useSpeechToText } from '../hooks/useSpeechToText'
import { PROMPT_MAX_LENGTH } from '../schemas/images-schema'
import { Button, Input } from './ui'
import { cn } from '@/lib/utils'

export type InputMode = 'voice' | 'typed'

interface Props {
  onSubmit: (transcript: string, inputMode: InputMode) => Promise<void>
  placeholder?: string
  disabled?: boolean
}

export function VoiceComposer({ onSubmit, placeholder = 'Type how you feel…', disabled }: Props) {
  const [busy, setBusy] = useState(false)
  const [heard, setHeard] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [typing, setTyping] = useState(false)

  async function submit(text: string, mode: InputMode) {
    setBusy(true)
    setHeard(text)
    try {
      await onSubmit(text, mode)
      if (mode === 'typed') setTyped('')
    } finally {
      setBusy(false)
      setHeard(null)
    }
  }

  const speech = useSpeechToText((text) => void submit(text, 'voice'))
  const showTyped = typing || !speech.supported
  const locked = busy || !!disabled

  function onTypedSubmit(e: FormEvent) {
    e.preventDefault()
    const text = typed.trim()
    if (text && !locked) void submit(text, 'typed')
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="min-h-5 text-center text-sm" aria-live="polite">
        {busy ? (
          <span data-testid="composer-status" className="text-muted-foreground">
            Painting “{heard}”…
          </span>
        ) : speech.listening ? (
          <span className="text-foreground">{speech.interim || 'Listening…'}</span>
        ) : speech.error ? (
          <span className="text-destructive">{speech.error}</span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        {speech.supported && (
          <Button
            type="button"
            size="icon"
            data-testid="composer-mic"
            aria-label={speech.listening ? 'Stop listening' : 'Speak your mood'}
            disabled={locked}
            onClick={speech.listening ? speech.stop : speech.start}
            className={cn(
              'h-12 w-12 shrink-0 rounded-full',
              speech.listening && 'animate-pulse ring-4 ring-primary/30',
            )}
          >
            {busy ? <Loader2 className="animate-spin" /> : speech.listening ? <Square /> : <Mic />}
          </Button>
        )}

        {showTyped ? (
          <form onSubmit={onTypedSubmit} className="flex flex-1 items-center gap-2">
            <Input
              data-testid="composer-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={placeholder}
              maxLength={PROMPT_MAX_LENGTH}
              disabled={locked}
              aria-label="Describe your mood"
              className="h-12 flex-1 rounded-full px-5"
            />
            <Button
              type="submit"
              size="icon"
              data-testid="composer-send"
              aria-label="Generate"
              disabled={locked || !typed.trim()}
              className="h-12 w-12 shrink-0 rounded-full"
            >
              {busy ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          </form>
        ) : (
          <button
            type="button"
            data-testid="composer-type-toggle"
            onClick={() => setTyping(true)}
            className="flex flex-1 items-center gap-2 rounded-full border border-border px-5 py-3 text-left text-sm text-muted-foreground hover:bg-card"
          >
            <Keyboard className="h-4 w-4" aria-hidden />
            Tap the mic and say how you feel — or type it instead
          </button>
        )}
      </div>
    </div>
  )
}
