import { useGetAuthorityStatusHook, useGetBipsHook } from '@project/api'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@project/ui'
import type { ActivityComponentType } from '@stackflow/react'
import { FilePlus2, RefreshCw, Vote } from 'lucide-react'
import { useState } from 'react'
import { AppLayout } from '../layouts/Layouts'
import { useFlow } from '../router/useFlow'
import { useWalletStore } from '../store/WalletStore'
import { bipStatusLabels, bipTypeLabels, shortenHash } from '../utils/GovernanceUtil'

const statusOptions = ['ALL', 'PENDING', 'APPROVED', 'DISAPPROVED', 'EXPIRED', 'INVALID'] as const

export const GovernancePage: ActivityComponentType<'GovernancePage'> = () => {
  const address = useWalletStore(state => state.address)
  const { push } = useFlow()
  const [pageNumber, setPageNumber] = useState(0)
  const [status, setStatus] = useState<(typeof statusOptions)[number]>('ALL')
  const authority = useGetAuthorityStatusHook(
    { query: { address: address ?? '' } },
    { query: { enabled: !!address, staleTime: 15_000 } },
  )
  const bips = useGetBipsHook(
    { query: { pageNumber, pageSize: 20, status: status === 'ALL' ? undefined : status } },
    { query: { enabled: authority.data?.authority === true, refetchInterval: 5_000 } },
  )

  return (
    <AppLayout title="Governance" actionButton={
      <Button variant="ghost" size="icon" aria-label="Refresh BIPs" disabled={bips.isFetching}
        onClick={() => void bips.refetch()}>
        <RefreshCw className={`h-5 w-5 ${bips.isFetching ? 'animate-spin' : ''}`} />
      </Button>
    }>
      <div className="space-y-4">
        {authority.isLoading && <div className="flex justify-center py-10"><Spinner /></div>}
        {authority.isError && (
          <Alert variant="destructive"><AlertDescription>Authority status could not be loaded.</AlertDescription></Alert>
        )}
        {authority.data && !authority.data.authority && (
          <Alert><AlertDescription>This address is not a current network authority.</AlertDescription></Alert>
        )}
        {authority.data?.authority && (
          <>
            <div className="flex gap-3">
              <Button className="flex-1" onClick={() => push('BipCreatePage', {})}>
                <FilePlus2 className="h-4 w-4" /> Create BIP
              </Button>
              <Select value={status} onValueChange={value => { setStatus(value as typeof status); setPageNumber(0) }}>
                <SelectTrigger className="h-9 flex-1 px-2.5 text-sm" size="lg"><SelectValue>{status === 'ALL' ? 'All statuses' : bipStatusLabels[status]}</SelectValue></SelectTrigger>
                <SelectContent>
                  {statusOptions.map(option => (
                    <SelectItem key={option} value={option}>{option === 'ALL' ? 'All statuses' : bipStatusLabels[option]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {bips.isLoading && <div className="flex justify-center py-10"><Spinner /></div>}
            {bips.isError && (
              <Alert variant="destructive"><AlertDescription>The BIP overview could not be loaded.</AlertDescription></Alert>
            )}
            {bips.data?.content?.length === 0 && (
              <Card><CardContent className="py-8 text-center text-muted-foreground">No BIPs match this filter.</CardContent></Card>
            )}
            {bips.data?.content?.map(bip => (
              <Card key={bip.bipHash} className="cursor-pointer" onClick={() => bip.bipHash && push('BipDetailPage', { hash: bip.bipHash })}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base">{bipTypeLabels[bip.type ?? ''] ?? bip.type ?? 'Unknown BIP'}</CardTitle>
                    <Badge variant={bip.status === 'APPROVED' ? 'default' : 'secondary'}>{bipStatusLabels[bip.status ?? ''] ?? bip.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p className="font-mono text-muted-foreground">{shortenHash(bip.bipHash)}</p>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Vote className="h-4 w-4" />
                    <span>{bip.approvers?.length ?? 0} approvals / {bip.numberOfRequiredVotes ?? '?'} required</span>
                  </div>
                  {bip.expirationTimestamp && <p className="text-muted-foreground">Expires {new Date(bip.expirationTimestamp).toLocaleString()}</p>}
                </CardContent>
              </Card>
            ))}
            {bips.data && bips.data.totalPages !== undefined && bips.data.totalPages > 1 && (
              <div className="flex items-center justify-between">
                <Button variant="outline" disabled={pageNumber === 0} onClick={() => setPageNumber(value => value - 1)}>Previous</Button>
                <span className="text-sm text-muted-foreground">Page {pageNumber + 1} of {bips.data.totalPages}</span>
                <Button variant="outline" disabled={bips.data.last} onClick={() => setPageNumber(value => value + 1)}>Next</Button>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  )
}
