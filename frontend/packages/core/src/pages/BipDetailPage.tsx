import { createApprovalVote, createDisapprovalVote } from '@goldenera/cryptoj'
import { useGetAuthorityStatusHook, useGetBipHook } from '@project/api'
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, Spinner } from '@project/ui'
import type { ActivityComponentType } from '@stackflow/react'
import { Check, RefreshCw, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DataRow } from '../components/DataRow'
import { AppLayout } from '../layouts/Layouts'
import { confirmGovernanceTransaction, prepareGovernanceTransaction, type GovernanceReview } from '../services/GovernanceSubmission'
import { useWalletStore } from '../store/WalletStore'
import { bipStatusLabels, bipTypeLabels, displayPayloadKey, displayPayloadValue } from '../utils/GovernanceUtil'

export interface BipDetailPageProps { hash: string }

export const BipDetailPage: ActivityComponentType<'BipDetailPage'> = ({ params }) => {
  const address = useWalletStore(state => state.address)
  const bip = useGetBipHook(
    { query: { hash: params.hash } },
    { query: { refetchInterval: 5_000 } },
  )
  const authority = useGetAuthorityStatusHook(
    { query: { address: address ?? '' } },
    { query: { enabled: !!address, staleTime: 15_000 } },
  )
  const [review, setReview] = useState<GovernanceReview | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submittedHash, setSubmittedHash] = useState<string | null>(null)
  const hasVoted = useMemo(() => {
    if (!address) return false
    const normalized = address.toLowerCase()
    return [...(bip.data?.approvers ?? []), ...(bip.data?.disapprovers ?? [])]
      .some(voter => voter.toLowerCase() === normalized)
  }, [address, bip.data])

  const prepareVote = async (approved: boolean) => {
    setError(null)
    try {
      setReview(await prepareGovernanceTransaction(approved ? createApprovalVote() : createDisapprovalVote(), params.hash))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The vote could not be prepared.')
    }
  }

  const confirmVote = async () => {
    if (!review || pending) return
    setPending(true)
    setError(null)
    try {
      const result = await confirmGovernanceTransaction(review)
      setSubmittedHash(result.hash)
      setReview(null)
      await bip.refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The vote could not be submitted.')
    } finally {
      setPending(false)
    }
  }

  return (
    <AppLayout title="BIP Detail" actionButton={
      <Button variant="ghost" size="icon" aria-label="Refresh BIP" disabled={bip.isFetching}
        onClick={() => void bip.refetch()}>
        <RefreshCw className={`h-5 w-5 ${bip.isFetching ? 'animate-spin' : ''}`} />
      </Button>
    }>
      <div className="space-y-4">
        {bip.isLoading && <div className="flex justify-center py-10"><Spinner /></div>}
        {bip.isError && <Alert variant="destructive"><AlertDescription>The BIP could not be loaded.</AlertDescription></Alert>}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {submittedHash && <Alert><Check className="h-4 w-4" /><AlertDescription>Vote submitted: <span className="font-mono break-all">{submittedHash}</span></AlertDescription></Alert>}
        {bip.data && (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <CardTitle>{bipTypeLabels[bip.data.type ?? ''] ?? bip.data.type}</CardTitle>
                  <Badge>{bipStatusLabels[bip.data.status ?? ''] ?? bip.data.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-1">
                <DataRow label="BIP hash" value={bip.data.bipHash ?? 'Unavailable'} />
                <DataRow label="Approvals" value={`${bip.data.approvers?.length ?? 0} / ${bip.data.numberOfRequiredVotes ?? '?'}`} />
                <DataRow label="Disapprovals" value={String(bip.data.disapprovers?.length ?? 0)} />
                <DataRow label="Action executed" value={bip.data.actionExecuted ? 'Yes' : 'No'} />
                <DataRow label="Created" value={bip.data.createdAtTimestamp ? new Date(bip.data.createdAtTimestamp).toLocaleString() : 'Unavailable'} />
                <DataRow label="Expires" value={bip.data.expirationTimestamp ? new Date(bip.data.expirationTimestamp).toLocaleString() : 'Unavailable'} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Proposal payload</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {Object.entries(bip.data.metadata?.txPayload ?? {})
                  .filter(([key]) => key !== 'payloadType' && key !== 'payloadVersion')
                  .map(([key, value]) => <DataRow key={key} label={displayPayloadKey(key)} value={displayPayloadValue(value, key)} />)}
                {bip.data.metadata?.derivedTokenAddress && <DataRow label="Derived token address" value={bip.data.metadata.derivedTokenAddress} />}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Authority votes</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-emerald-600">Approvals ({bip.data.approvers.length})</p>
                  {bip.data.approvers.length === 0
                    ? <p className="text-sm text-muted-foreground">No authority approvals yet.</p>
                    : bip.data.approvers.map(voter => <p key={voter} className="break-all font-mono text-xs">{voter}</p>)}
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-destructive">Disapprovals ({bip.data.disapprovers.length})</p>
                  {bip.data.disapprovers.length === 0
                    ? <p className="text-sm text-muted-foreground">No authority disapprovals yet.</p>
                    : bip.data.disapprovers.map(voter => <p key={voter} className="break-all font-mono text-xs">{voter}</p>)}
                </div>
              </CardContent>
            </Card>
            {authority.data?.authority && bip.data.status === 'PENDING' && !hasVoted && !review && !submittedHash && (
              <div className="grid grid-cols-2 gap-3">
                <Button onClick={() => void prepareVote(true)}><ThumbsUp className="h-4 w-4" /> Approve</Button>
                <Button variant="destructive" onClick={() => void prepareVote(false)}><ThumbsDown className="h-4 w-4" /> Disapprove</Button>
              </div>
            )}
            {hasVoted && <Alert><AlertDescription>This authority has already voted on this BIP.</AlertDescription></Alert>}
            {review && (
              <Card className="border-primary/40">
                <CardHeader><CardTitle className="text-base">Review vote transaction</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <DataRow label="Vote" value={(review.payload as { voteType?: number }).voteType === 1 ? 'Approve' : 'Disapprove'} />
                  <DataRow label="Fee (base units)" value={review.fee.toString()} />
                  <DataRow label="Nonce" value={review.nonce.toString()} />
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <Button variant="outline" disabled={pending} onClick={() => setReview(null)}><X className="h-4 w-4" /> Cancel</Button>
                    <Button disabled={pending} onClick={() => void confirmVote()}>{pending ? <Spinner /> : <Check className="h-4 w-4" />} Confirm</Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  )
}
