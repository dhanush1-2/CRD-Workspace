import { redirect } from 'next/navigation'
import { safeNext } from '@/lib/safe-next'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

// With provider sign-in, signing up and signing in are the same action: the
// first sign-in creates the account. Kept as a redirect so old links and
// bookmarks to /signup still land somewhere useful.
export default async function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  const { next } = await searchParams
  const destination = safeNext(typeof next === 'string' ? next : undefined)
  redirect(`/login?next=${encodeURIComponent(destination)}`)
}
