import { KeyRound, MailCheck } from 'lucide-react'
import { cn } from '#/lib/utils'

export type AuthMethod = 'otp' | 'password'

const OPTIONS: { value: AuthMethod; label: string; icon: typeof MailCheck; hint: (cloud: boolean) => string }[] = [
  {
    value: 'otp',
    label: 'Email code',
    icon: MailCheck,
    hint: (cloud) => `A 6-digit code is emailed at each sign-in.${cloud ? ' Nothing to remember.' : ' Needs SMTP on your Appwrite instance.'}`,
  },
  {
    value: 'password',
    label: 'Password',
    icon: KeyRound,
    hint: () => 'Works without email. Admins set and reset teammates’ passwords.',
  },
]

// How everyone in the workspace signs in, picked at setup and in Settings → General.
export function AuthMethodSwitch({
  value,
  onChange,
  cloud,
  disabled,
}: {
  value: AuthMethod
  onChange: (value: AuthMethod) => void
  cloud: boolean
  disabled?: boolean
}) {
  return (
    <div role="radiogroup" aria-label="Sign-in method" className="grid gap-2 sm:grid-cols-2">
      {OPTIONS.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-start gap-3 rounded-lg border bg-background p-3 text-left transition outline-none hover:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60',
              selected && 'border-brand bg-brand/5 ring-1 ring-brand/40 hover:border-brand',
            )}
          >
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground',
                selected && 'border-brand/30 bg-brand/10 text-brand',
              )}
            >
              <option.icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{option.hint(cloud)}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

// Readable, without look-alike characters, for a password an admin hands to a teammate.
export function generatePassword(length = 16) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint32Array(length))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}
