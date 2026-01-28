import { defineCustomElements } from '@ionic/pwa-elements/loader';
import { ThemeProvider } from "@project/ui";
import "@stackflow/plugin-basic-ui/index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "barcode-detector/polyfill";
import { PwaInstallDialog } from './components/pwa-install-dialog/PwaInstallDialog';
import { Stack } from './router/stackflow';
import { StorageService } from "./services/StorageService";
import { useWalletStore } from './store/WalletStore';
import { definePlatform } from './utils/PlatformUtil';

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30 * 1000, // 30 seconds
            retry: 3,
        },
    },
})

export type AppReturn = {
    App: React.FC
}

export type CreateAppOptions = {
    isExtension?: boolean
}

export const createApp = async ({ isExtension = false }: CreateAppOptions = {}): Promise<AppReturn> => {
    definePlatform(isExtension);
    defineCustomElements(window);
    await useWalletStore.getState().initialize();

    const App = () => {
        return (
            <QueryClientProvider client={queryClient}>
                <ThemeProvider
                    defaultTheme="dark"
                    storageKey="ui-theme"
                    storage={StorageService.basic}
                >
                    <Stack />
                    <PwaInstallDialog />
                </ThemeProvider>
            </QueryClientProvider>
        )
    }

    return {
        App
    }
}