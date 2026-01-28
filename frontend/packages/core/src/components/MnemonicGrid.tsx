import { Button } from "@project/ui";
import { Eye } from "lucide-react";
import { useUncontrolledProp } from 'uncontrollable';

export interface MnemonicGridProps {
    mnemonic: string;
    defaultShow?: boolean
    show?: boolean
    onChangeShow?: (show: boolean) => void
}

export const MnemonicGrid = ({ mnemonic, defaultShow = false, show, onChangeShow }: MnemonicGridProps) => {
    const [showMnemonic, setShowMnemonic] = useUncontrolledProp(show, defaultShow, onChangeShow)
    const words = mnemonic.split(' ')
    return (
        <div className="relative">
            <div className={`grid grid-cols-2 gap-2 p-4 rounded-lg bg-muted/50 border ${!showMnemonic ? 'blur-md select-none' : ''}`}>
                {words.map((word, index) => (
                    <div
                        key={index}
                        className="flex items-center gap-2 bg-background rounded-md px-3 py-2 text-sm"
                    >
                        <span className="text-muted-foreground text-sm font-mono w-5">
                            {index + 1}.
                        </span>
                        <span className="font-medium text-sm">{word}</span>
                    </div>
                ))}
            </div>
            {!showMnemonic && (
                <div className="absolute inset-0 flex items-center justify-center">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setShowMnemonic(true)}
                    >
                        <Eye className="h-4 w-4" />
                        Reveal Words
                    </Button>
                </div>
            )}
        </div>
    )
}