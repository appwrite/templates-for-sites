import { useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { errorMessage } from '#/lib/utils'
import { Button } from './ui/button'
import { EmptyState } from './ui/primitives'

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <EmptyState
      className="flex-1"
      icon={<AlertTriangle />}
      title="Something went wrong"
      description={errorMessage(error)}
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            reset()
            void router.invalidate()
          }}
        >
          <RotateCw />
          Try again
        </Button>
      }
    />
  )
}
