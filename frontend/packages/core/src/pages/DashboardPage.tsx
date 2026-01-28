import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardContent,
  Separator,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@project/ui'
import { ActivityComponentType } from "@stackflow/react"
import {
  ArrowUpRight,
  CopyIcon,
  Lock,
  QrCode,
  Settings
} from 'lucide-react'
import { TokenList } from '../components/TokenList'
import { useBarcodeIsSupported } from '../hooks/useBarcodeIsSupported'
import { useCopy } from '../hooks/useCopy'
import { AppLayout } from '../layouts/Layouts'
import { useFlow } from '../router/useFlow'
import { useWalletStore } from '../store/WalletStore'

export const DashboardPage: ActivityComponentType = () => {
  const { copy, copied } = useCopy()
  const { push } = useFlow()
  const address = useWalletStore((state) => state.address)
  const lockWallet = useWalletStore((state) => state.lockWallet)
  const supportedScan = useBarcodeIsSupported()

  const handleLock = () => {
    lockWallet()
  }

  const copyAddress = async () => {
    if (address) {
      copy(address)
    }
  }

  const shortenAddress = (addr: string | null) => {
    if (!addr) return ''
    return `${addr.slice(0, 8)}...${addr.slice(-6)}`
  }

  // Calculate placeholder USD value
  const totalUsdValue = '$0.00'

  return (
    <AppLayout
      title="GoldenEra"
      leftContent={
        <Avatar className="h-8 w-8">
          <AvatarImage src="pwa-192x192.png" />
          <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
            GE
          </AvatarFallback>
        </Avatar>
      }
      actionButton={
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" onClick={() => push('SettingsPage', {})}>
            <Settings className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleLock}>
            <Lock className="h-5 w-5" />
          </Button>
        </div>
      }
    >
      {/* Main Content */}
      <div className="flex-1 space-y-6">
        {/* Total Value Card */}
        <Card className="bg-gradient-to-br from-primary/10 via-primary/5 to-background border-primary/20">
          <CardContent className="text-center space-y-4 py-6">
            <div className="space-y-1">
              <p className="text-muted-foreground text-sm font-medium">Total Value</p>
              <h2 className="text-2xl font-bold tracking-tight">
                {totalUsdValue}
                <span className="text-lg text-muted-foreground ml-2">USD</span>
              </h2>
            </div>

            <div className="flex items-center justify-center gap-2">
              <Tooltip open={copied}>
                <TooltipTrigger onClick={copyAddress} render={(props) => (
                  <Badge className="font-mono" {...props}>
                    {shortenAddress(address)}
                    <CopyIcon />
                  </Badge>
                )} />
                <TooltipContent>
                  <p>{copied ? 'Copied!' : 'Copy'}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex items-center w-full gap-3">
          <Button size="lg" className="flex-col h-auto py-2.5 gap-1 flex-1 min-w-0" onClick={() => push('TxSubmitPage', {})}>
            <ArrowUpRight className="h-5 w-5" />
            <span className="text-xs">Send</span>
          </Button>
          {supportedScan && (
            <Button size="lg" variant="outline" className="flex-col h-auto py-2.5 gap-1 flex-1 min-w-0" onClick={() => push('ScanQrCodePage', {})}>
              <QrCode className="h-5 w-5" />
              <span className="text-xs">Scan</span>
            </Button>
          )}
        </div>

        <Separator />

        {/* Token List */}
        <TokenList />
      </div>
    </AppLayout>
  )
}
