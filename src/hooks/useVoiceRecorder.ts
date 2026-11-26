/**
 * Record a short voice note with MediaRecorder. Click to start, click to stop;
 * auto-stops at maxMs. Resolves the recording through `onDone`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface Recording {
  blob: Blob
  mimeType: string
  durationMs: number
}

const PREFERRED = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return PREFERRED.find((m) => MediaRecorder.isTypeSupported?.(m))
}

export function useVoiceRecorder(onDone: (rec: Recording) => void, maxMs = 60_000) {
  const [supported] = useState(
    () => typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
  )
  const [recording, setRecording] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const timers = useRef<{ tick?: number; cap?: number }>({})
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  const cleanup = useCallback(() => {
    window.clearInterval(timers.current.tick)
    window.clearTimeout(timers.current.cap)
    recRef.current?.stream.getTracks().forEach((t) => t.stop())
    recRef.current = null
    setRecording(false)
  }, [])

  useEffect(() => () => {
    if (recRef.current?.state === 'recording') recRef.current.stop()
    cleanup()
  }, [cleanup])

  const start = useCallback(async () => {
    if (recRef.current) return
    setError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('Microphone access was blocked.')
      return
    }
    const mimeType = pickMime()
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const chunks: Blob[] = []
    const startedAt = Date.now()
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = () => {
      const type = rec.mimeType || mimeType || 'audio/webm'
      const durationMs = Date.now() - startedAt
      cleanup()
      if (chunks.length) onDoneRef.current({ blob: new Blob(chunks, { type }), mimeType: type, durationMs })
    }
    recRef.current = rec
    rec.start()
    setRecording(true)
    setElapsedMs(0)
    timers.current.tick = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 250)
    timers.current.cap = window.setTimeout(() => rec.state === 'recording' && rec.stop(), maxMs)
  }, [cleanup, maxMs])

  const stop = useCallback(() => {
    if (recRef.current?.state === 'recording') recRef.current.stop()
  }, [])

  return { supported, recording, elapsedMs, error, start, stop }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}
