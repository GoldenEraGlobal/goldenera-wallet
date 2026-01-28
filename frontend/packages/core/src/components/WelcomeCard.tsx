import { Avatar, AvatarFallback, AvatarImage, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@project/ui"
import { Download, Plus, Wallet } from "lucide-react"
import { useFlow } from "../router/useFlow"

export const WelcomeCard = () => {
    const { push } = useFlow()

    return (
        <Card className="w-full max-w-sm">
            <CardHeader className="text-center pb-2">
                <a href="https://goldenera.global" target="_blank" rel="noopener noreferrer">
                    <Avatar className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                        <AvatarImage src="pwa-192x192.png" />
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                            <Wallet className="h-8 w-8 text-primary" />
                        </AvatarFallback>
                    </Avatar>
                </a>
                <CardTitle className="text-xl">GoldenEra Wallet</CardTitle>
                <CardDescription className="text-sm">Create or import a wallet to start using wallet</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
                <div className="space-y-3">
                    <Button
                        size="lg"
                        className="w-full gap-2"
                        onClick={() => push('CreateWalletPage', {})}
                    >
                        <Plus className="h-5 w-5" />
                        Create New Wallet
                    </Button>
                    <Button
                        variant="outline"
                        size="lg"
                        className="w-full gap-2"
                        onClick={() => push('ImportWalletPage', {})}
                    >
                        <Download className="h-5 w-5" />
                        Import Wallet
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}