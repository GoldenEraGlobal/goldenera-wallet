import { createContext, useContext } from "react";

export interface RootContextValue {
    isNotIos: boolean
    useWebRenderer: boolean
    theme: string
}

export const RootCtx = createContext<RootContextValue | null>(null);

export const useRootContext = (): RootContextValue => {
    const context = useContext(RootCtx);
    if (!context) {
        throw new Error('useRootContext must be used within a RootContext.Provider');
    }
    return context;
};