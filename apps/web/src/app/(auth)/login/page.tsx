import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/current-user'
import { safeNext } from '@/lib/safe-next'
import { LoginForm } from './LoginForm'
import styles from '../auth.module.css'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  // Validated once, here. LoginForm and the signup link both receive the
  // already-safe value, so there is exactly one place this check can be missed.
  const destination = safeNext(next)

  // redirect() signals by throwing — it is deliberately outside any try/catch.
  if (await getCurrentUser()) redirect(destination)

  return (
    <>
      <p className={styles.lede}>Sign in to your workspaces.</p>
      <LoginForm next={destination} />
      <p className={styles.alt}>
        No account?{' '}
        <Link href={`/signup?next=${encodeURIComponent(destination)}`}>Create one</Link>
      </p>
    </>
  )
}
