'use client'

import { useId, type InputHTMLAttributes } from 'react'
import styles from './ui.module.css'

export function TextField({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId()
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input {...props} id={id} className={[styles.input, className].filter(Boolean).join(' ')} />
    </div>
  )
}
