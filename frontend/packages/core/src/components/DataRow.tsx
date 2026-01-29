import { CheckCircle2, Copy } from "lucide-react";
import { useCopy } from "../hooks/useCopy";

export const DataRow = ({ label, value, valueToCopy, copyable }: { label: string; value: string | number | undefined; valueToCopy?: string | number; copyable?: boolean }) => {
    const { copy, copied } = useCopy()
    if (value === undefined || value === null || value === '') return null
    const displayValue = String(value)
    const copyValue = valueToCopy ?? value

    return (
        <div className="flex justify-between items-start gap-4 py-3 border-b border-border/50 last:border-b-0">
            <span className="text-muted-foreground text-sm shrink-0">{label}</span>
            <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-right break-all">{displayValue}</span>
                {copyable && (
                    <button
                        onClick={() => copy(String(copyValue))}
                        className="p-1 rounded hover:bg-muted transition-colors shrink-0"
                        type="button"
                    >
                        {copied ? (
                            <CheckCircle2 className="size-3.5 text-green-500" />
                        ) : (
                            <Copy className="size-3.5 text-muted-foreground" />
                        )}
                    </button>
                )}
            </div>
        </div>
    )
}