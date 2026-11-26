/**
 * Click-to-speak transcription via the browser Web Speech API (no server
 * cost). One utterance per start(): recognition stops on silence and the final
 * transcript is handed to `onFinal`. `supported` is false on browsers without
 * the API (e.g. Firefox) — the composer then offers only the typed fallback.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface RecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}

type RecognitionCtor = new () => RecognitionLike

function getCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function useSpeechToText(onFinal: (transcript: string) => void) {
  const [supported] = useState(() => getCtor() !== null)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<RecognitionLike | null>(null)
  const finalRef = useRef('')
  const onFinalRef = useRef(onFinal)
  useEffect(() => {
    onFinalRef.current = onFinal
  }, [onFinal])

  useEffect(() => () => recRef.current?.abort(), [])

  const start = useCallback(() => {
    const Ctor = getCtor()
    if (!Ctor || recRef.current) return
    const rec = new Ctor()
    rec.lang = navigator.language || 'en-US'
    rec.interimResults = true
    rec.continuous = false
    rec.maxAlternatives = 1
    finalRef.current = ''
    setInterim('')
    setError(null)

    rec.onresult = (e) => {
      let text = ''
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalRef.current += r[0].transcript
        else text += r[0].transcript
      }
      setInterim((finalRef.current + text).trim())
    }
    rec.onerror = (e) => {
      setError(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'Microphone access was blocked. Allow it in your browser, or type your mood.'
          : e.error === 'no-speech'
            ? "Didn't catch that. Try again, or type your mood."
            : 'Voice input failed. Try again, or type your mood.',
      )
    }
    rec.onend = () => {
      recRef.current = null
      setListening(false)
      const text = finalRef.current.trim()
      setInterim('')
      if (text) onFinalRef.current(text)
    }
    recRef.current = rec
    setListening(true)
    rec.start()
  }, [])

  const stop = useCallback(() => recRef.current?.stop(), [])

  return { supported, listening, interim, error, start, stop }
}
