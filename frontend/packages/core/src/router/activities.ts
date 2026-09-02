import type { TokenDetailPageProps } from '../pages/TokenDetailPage'
import type { TxSubmitPageProps } from '../pages/TxSubmitPage'
import type { BipDetailPageProps } from '../pages/BipDetailPage'

declare module '@stackflow/config' {
  interface Register {
    ShowPhrasePage: Record<string, never>
    DashboardPage: Record<string, never>
    SettingsPage: Record<string, never>
    ToggleBiometricPage: Record<string, never>
    DeleteWalletPage: Record<string, never>
    TokenDetailPage: TokenDetailPageProps
    ScanQrCodePage: Record<string, never>
    WelcomePage: Record<string, never>
    CreateWalletPage: Record<string, never>
    ImportWalletPage: Record<string, never>
    BackupPhrasePage: Record<string, never>
    TxSubmitPage: TxSubmitPageProps
    GovernancePage: Record<string, never>
    BipCreatePage: Record<string, never>
    BipDetailPage: BipDetailPageProps
  }
}
