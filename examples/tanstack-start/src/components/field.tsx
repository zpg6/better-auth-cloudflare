import type { InputHTMLAttributes } from 'react'

type FieldProps = {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  hint?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'value' | 'onChange'>

export function Field({ id, label, value, onChange, hint, type = 'text', ...rest }: FieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="label-meta">
          {label}
        </label>
        {hint && (
          <span className="label-meta" style={{ color: 'var(--color-ink-soft)' }}>
            {hint}
          </span>
        )}
      </div>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field-input"
        {...rest}
      />
    </div>
  )
}
