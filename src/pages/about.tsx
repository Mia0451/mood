/**
 * /about — a STATIC page (top level of src/pages/, no DeepSpace providers).
 *
 * Prerendered to static HTML at build (prerender.ts) so crawlers and link
 * previews read real content. Keep it renderable without a browser.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { seo } from '../seo'

export default function About() {
  return (
    <>
      <Seo {...seo} path="/about" />
      <div
        data-testid="static-landing"
        className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-20"
      >
        <p className="mb-4 text-sm font-medium uppercase tracking-[0.2em] text-primary">mood</p>
        <h1 className="mb-6 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Say how you feel. Watch it become a picture.
        </h1>
        <p className="mb-4 text-lg text-muted-foreground">
          mood turns a spoken sentence into an AI-generated image and drops it into one shared,
          live room. Anyone can watch the room. Sign in with Google to speak your own mood, react
          to other people&apos;s, and start a private one-to-one chat from any image.
        </p>
        <p className="mb-10 text-muted-foreground">
          Images stay in the room for good. Private chats are visible only to the two people in them.
        </p>
        <Link
          to="/"
          className="inline-flex w-fit items-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Enter the room
        </Link>
      </div>
    </>
  )
}
