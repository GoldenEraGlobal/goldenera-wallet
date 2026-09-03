import { CheckCircle2, CircleAlert, Copy } from 'lucide-react'
import { useCopy } from '../hooks/useCopy'

export const DataRow = ({ label, value, valueToCopy, copyable }: { label: string; value: string | number | undefined; valueToCopy?: string | number; copyable?: boolean }) => {
    const { copy, copied, copyFailed } = useCopy()
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
                        onClick={() => { void copy(String(copyValue)) }}
                        className="p-1 rounded hover:bg-muted transition-colors shrink-0"
                        type="button"
                        aria-label={copyFailed ? `Copy ${label} failed` : copied ? `${label} copied` : `Copy ${label}`}
                    >
                        {copyFailed ? (
                            <CircleAlert className="size-3.5 text-destructive" />
                        ) : copied ? (
                            <CheckCircle2 className="size-3.5 text-green-500" />
                        ) : (
                            <Copy className="size-3.5 text-muted-foreground" />
                        )}
                        {(copied || copyFailed) && (
                            <span className="sr-only" role="status">
                                {copyFailed ? 'Copy failed' : 'Copied'}
                            </span>
                        )}
                    </button>
                )}
            </div>
        </div>
    )
}