import { App as CapacitorApp } from '@capacitor/app'
import { useEffect, useRef } from 'react'
import { reconcileTransfers, type TransferReconciliationTrigger } from '../services/TransferCoordinatorService'
import { subscribeTransferJournal } from '../services/TransferJournalService'
import { useWalletStore } from '../store/WalletStore'

function requestReconciliation(trigger: TransferReconciliationTrigger) {
  void reconcileTransfers(trigger).catch(() => undefined)
}

export const TransferReconciliationLifecycle = () => {
  const status = useWalletStore(state => state.status)
  const previousStatus = useRef<typeof status | null>(null)

  useEffect(() => {
    const enteredUnlocked = status === 'unlocked' && previousStatus.current !== 'unlocked'
    previousStatus.current = status
    if (enteredUnlocked) requestReconciliation('unlock')
  }, [status])

  useEffect(() => {
    requestReconciliation('startup')
    let disposed = false
    let nativeListener: Awaited<ReturnType<typeof CapacitorApp.addListener>> | null = null
    const onFocus = () => requestReconciliation('focus')
    const onVisibility = () => {
      if (document.visibilityState === 'visible') onFocus()
    }
    const onOnline = () => requestReconciliation('online')
    const onJournalHint = () => {
      if (!disposed && document.visibilityState === 'visible' && document.hasFocus() && navigator.onLine) {
        requestReconciliation('journal')
      }
    }
    const unsubscribeJournal = subscribeTransferJournal(onJournalHint)

    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibility)
    void CapacitorApp.addListener('appStateChange', event => {
      if (!disposed && event.isActive) onFocus()
    }).then(listener => {
      if (disposed) void listener.remove()
      else nativeListener = listener
    }).catch(() => undefined)

    return () => {
      disposed = true
      unsubscribeJournal()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibility)
      if (nativeListener) void nativeListener.remove()
    }
  }, [])

  return null
}
