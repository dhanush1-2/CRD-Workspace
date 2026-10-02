import { PaintSplatter } from './PaintSplatter'
import styles from './canvas-background.module.css'

/**
 * The painted canvas behind every screen: five slow blurred blobs under a woven
 * texture. Fixed and pointer-events:none, so it never scrolls with content and
 * never intercepts a click.
 *
 * The blob animation is CSS-only and gated on prefers-reduced-motion. This
 * component stays a server component: the one client island is PaintSplatter,
 * which sits between the last blob and the weave so the texture reads over it.
 */
export function CanvasBackground() {
  return (
    <div className={styles.canvas} aria-hidden="true">
      <div className={`${styles.blob} ${styles.b1}`} />
      <div className={`${styles.blob} ${styles.b2}`} />
      <div className={`${styles.blob} ${styles.b3}`} />
      <div className={`${styles.blob} ${styles.b4}`} />
      <div className={`${styles.blob} ${styles.b5}`} />
      <PaintSplatter />
      <div className={styles.weave} />
    </div>
  )
}
