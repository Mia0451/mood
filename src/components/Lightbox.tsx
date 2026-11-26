/**
 * Full-screen image viewer with zoom in / zoom out / reset. Esc or the close
 * button dismisses; +/- keys zoom. No delete actions, by design.
 */

import { useEffect, useState } from 'react'
import { RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react'

const MIN = 1
const MAX = 4
const STEP = 0.5

interface Props {
  src: string
  alt: string
  caption?: string
  onClose: () => void
}

export function Lightbox({ src, alt, caption, onClose }: Props) {
  const [zoom, setZoom] = useState(1)
  const zoomIn = () => setZoom((z) => Math.min(MAX, z + STEP))
  const zoomOut = () => setZoom((z) => Math.max(MIN, z - STEP))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === '+' || e.key === '=') zoomIn()
      if (e.key === '-') zoomOut()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const ctl =
    'flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-40'

  return (
    <div
      data-testid="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
    >
      <div className="flex items-center justify-between gap-2 p-3">
        <span data-testid="lightbox-zoom" className="px-2 text-sm text-white/70">
          {Math.round(zoom * 100)}%
        </span>
        <div className="flex items-center gap-2">
          <button type="button" className={ctl} aria-label="Zoom out" data-testid="lightbox-zoom-out" onClick={zoomOut} disabled={zoom <= MIN}>
            <ZoomOut className="h-5 w-5" />
          </button>
          <button type="button" className={ctl} aria-label="Zoom in" data-testid="lightbox-zoom-in" onClick={zoomIn} disabled={zoom >= MAX}>
            <ZoomIn className="h-5 w-5" />
          </button>
          <button type="button" className={ctl} aria-label="Reset zoom" onClick={() => setZoom(1)} disabled={zoom === 1}>
            <RotateCcw className="h-5 w-5" />
          </button>
          <button type="button" className={ctl} aria-label="Close" data-testid="lightbox-close" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <img
          src={src}
          alt={alt}
          style={{ transform: `scale(${zoom})` }}
          className="max-h-full max-w-full origin-center object-contain transition-transform duration-150"
        />
      </div>
      {caption && <p className="px-4 pb-6 text-center text-sm text-white/80">“{caption}”</p>}
    </div>
  )
}
