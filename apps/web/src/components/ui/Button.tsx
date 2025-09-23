"use client"
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react'
import { cn } from '../../utils/cn'

export function Button({ className, ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center rounded-md bg-black px-4 py-2 text-white shadow-sm transition-colors',
        'hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed',
        className
      )}
    />
  )
}
