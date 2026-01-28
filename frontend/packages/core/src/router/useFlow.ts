import { useActions } from "@stackflow/react";
import { TypeActivities } from "./stackflow";

export const useFlow = () => {
    return useActions<TypeActivities>()
}