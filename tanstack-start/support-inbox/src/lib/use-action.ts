import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { errorMessage } from './utils'

// Runs a server function, toasts the outcome and refreshes loaders on success.
export function useAction() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function run(action: () => Promise<unknown>, success?: string) {
    setPending(true)
    try {
      await action()
      if (success) toast.success(success)
      await router.invalidate()
      return true
    } catch (error) {
      toast.error(errorMessage(error))
      return false
    } finally {
      setPending(false)
    }
  }

  return { pending, run }
}
