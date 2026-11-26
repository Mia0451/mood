/**
 * `/account` — signed-in only (the (protected) layout gates it).
 * Tab 1: the user's own generations. Tab 2: their private chats.
 */

import { EmptyState, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui'

export default function AccountPage() {
  return (
    <div data-testid="account-page" className="mx-auto w-full max-w-5xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Your account</h1>
      <Tabs defaultValue="generations">
        <TabsList>
          <TabsTrigger value="generations">Generations</TabsTrigger>
          <TabsTrigger value="chats">Chats</TabsTrigger>
        </TabsList>
        <TabsContent value="generations">
          <EmptyState title="No generations yet" description="Images you create appear here, newest first." />
        </TabsContent>
        <TabsContent value="chats">
          <EmptyState title="No chats yet" description="Open a chat from someone's image in the public room." />
        </TabsContent>
      </Tabs>
    </div>
  )
}
