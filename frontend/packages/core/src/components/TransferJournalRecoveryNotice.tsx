import { Alert, AlertDescription, Button } from '@project/ui'
import { TriangleAlertIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  getTransferJournalRecoveryState,
  recoverTransferJournal,
} from '../services/TransferCoordinatorService'
import type { TransferJournalRecoveryState } from '../services/TransferJournalService'
import { subscribeTransferJournal } from '../services/TransferJournalService'

function needsRecovery(state: TransferJournalRecoveryState | null): boolean {
  return state?.status === 'action-required' || state?.status === 'blocked'
}

/**
 * Recovery deliberately names no malformed payload and does not offer a send or
 * retry path. The journal remains authoritative; this is only the user's
 * explicit decision to replace unreadable entries with public blocked markers.
 */
export const TransferJournalRecoveryNotice = () => {
  const [recovery, setRecovery] = useState<TransferJournalRecoveryState | null>(null)
  const [isRecovering, setIsRecovering] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const refresh = useCallback(() => {
    void getTransferJournalRecoveryState().then(setRecovery).catch(() => {
      setRecovery({
        status: 'action-required',
        issues: [],
        detectedAt: null,
        recoveredAt: null,
        globalBlocked: true,
        blockedSenders: [],
      })
    })
  }, [])

  useEffect(() => {
    refresh()
    return subscribeTransferJournal(refresh)
  }, [refresh])

  const acknowledge = async () => {
    if (isRecovering) return
    setIsRecovering(true)
    setFailure(null)
    try {
      setRecovery(await recoverTransferJournal())
    } catch {
      setFailure('Transaction recovery could not be completed. Sending remains blocked.')
    } finally {
      setIsRecovering(false)
    }
  }

  if (!needsRecovery(recovery)) return null
  if (recovery?.status === 'blocked') {
    return (
      <div className="fixed inset-x-0 top-0 z-50 p-3" role="status">
        <Alert variant="destructive" className="mx-auto max-w-2xl">
          <TriangleAlertIcon />
          <AlertDescription>
            Transaction state remains ambiguous. Sending is blocked for the affected transaction state, and no nonce is treated as reusable.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="fixed inset-x-0 top-0 z-50 p-3" role="alert">
      <Alert variant="destructive" className="mx-auto max-w-2xl">
        <TriangleAlertIcon />
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>
            Transaction state is unreadable. Do not send or retry a transaction. Acknowledge recovery to preserve readable records and replace unreadable state with a durable blocked marker where its sender is known.
          </span>
          {failure && <span>{failure}</span>}
          <Button type="button" variant="outline" onClick={() => void acknowledge()} disabled={isRecovering}>
            {isRecovering ? 'Recovering transaction state...' : 'Acknowledge transaction recovery'}
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  )
}
