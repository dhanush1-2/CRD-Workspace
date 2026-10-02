'use client'

import { useId, type InputHTMLAttributes } from 'react'
import styles from './ui.module.css'

export function TextField({
  label,
  hideLabel = false,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hideLabel?: boolean }) {
  const id = useId()
  return (
    <div className={styles.field}>
      {/*
        When hidden the label is still in the DOM and still associated with the
        input, so screen readers and Playwright's getByLabel both keep working.
      */}
      <label className={hideLabel ? styles.labelHidden : styles.label} htmlFor={id}>
        {label}
      </label>
      <input {...props} id={id} className={[styles.pillInput, className].filter(Boolean).join(' ')} />
    </div>
  )
}
