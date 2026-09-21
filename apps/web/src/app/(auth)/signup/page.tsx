import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/current-user'
import { safeNext } from '@/lib/safe-next'
import { SignupForm } from './SignupForm'
import styles from '../auth.module.css'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  // Validated once, here. SignupForm and the sign-in link both receive the
  // already-safe value, so there is exactly one place this check can be missed.
  const destination = safeNext(next)

  // redirect() signals by throwing — it is deliberately outside any try/catch.
  if (await getCurrentUser()) redirect(destination)

  return (
    <>
      <p className={styles.lede}>Create an account. You get a workspace of your own.</p>
      <SignupForm next={destination} />
      <p className={styles.alt}>
        Already have one?{' '}
        <Link href={`/login?next=${encodeURIComponent(destination)}`}>Sign in</Link>
      </p>
    </>
  )
}
