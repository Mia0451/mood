/**
 * App bar — brand on the left; `Log In` (signed out) or `Account` + `Log Out`
 * (signed in) on the right.
 *
 * Keeps the scaffold's test hooks: `app-navigation`, `nav-sign-in-button`,
 * `nav-user-name`, `nav-user-email`.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthOverlay, signOut, useAuthProfileReady, useQuery } from 'deepspace'
import { LogOut } from 'lucide-react'
import type { PrivateRoom } from '../schemas/chat-schema'
import { Avatar, AvatarFallback, AvatarImage, Button } from './ui'

export default function TopBar() {
  const { isLoaded, isSignedIn, user, userLoading } = useAuthProfileReady({ requireUser: true })
  const [showAuth, setShowAuth] = useState(false)
  const profileReady = !isSignedIn || (!userLoading && !!user)

  return (
    <>
      <nav
        data-testid="app-navigation"
        className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur"
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Link to="/" className="flex items-center gap-2 text-foreground" aria-label="mood home">
            <span className="h-3 w-3 rounded-full bg-primary shadow-[0_0_12px_2px_var(--color-primary)]" aria-hidden />
            <span className="text-lg font-semibold tracking-tight">mood</span>
          </Link>

          <div className="flex-1" />

          {!isLoaded ? null : isSignedIn && !profileReady ? (
            <div className="h-8 w-40 animate-pulse rounded-full bg-muted" aria-busy="true" />
          ) : isSignedIn && user ? (
            <div className="flex items-center gap-2">
              <Link
                to="/account"
                data-testid="nav-account-link"
                className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3 text-sm text-foreground transition-colors hover:bg-card"
              >
                <Avatar className="h-6 w-6">
                  <AvatarImage src={user.imageUrl ?? undefined} referrerPolicy="no-referrer" />
                  <AvatarFallback className="text-[11px]">
                    {(user.name?.[0] ?? user.email?.[0] ?? '?').toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span data-testid="nav-user-name" className="hidden max-w-[140px] truncate sm:inline">
                  {user.name || user.email}
                </span>
                <span className="sm:hidden">Account</span>
                <UnreadBadge userId={user.id} />
                <span data-testid="nav-user-email" className="sr-only">
                  {user.email}
                </span>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                data-testid="nav-sign-out-button"
                onClick={() => signOut()}
              >
                <LogOut aria-hidden />
                <span className="hidden sm:inline">Log Out</span>
              </Button>
            </div>
          ) : (
            <Button size="sm" data-testid="nav-sign-in-button" onClick={() => setShowAuth(true)}>
              Log In
            </Button>
          )}
        </div>
      </nav>

      {showAuth && <AuthOverlay providers={['google']} onClose={() => setShowAuth(false)} />}
    </>
  )
}

/** Total unread private messages across the caller's rooms. */
function UnreadBadge({ userId }: { userId: string }) {
  const { records } = useQuery<PrivateRoom>('private_rooms')
  const total = records.reduce((n, r) => n + (r.data.unread?.[userId] ?? 0), 0)
  if (!total) return null
  return (
    <span
      data-testid="nav-unread"
      aria-label={`${total} unread messages`}
      className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground"
    >
      {total > 99 ? '99+' : total}
    </span>
  )
}
