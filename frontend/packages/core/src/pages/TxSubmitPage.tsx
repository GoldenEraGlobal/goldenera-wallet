import { ActivityComponentType } from "@stackflow/react"
import { TxSubmitCard, TxSubmitForm } from '../components/TxSubmitCard'
import { AppLayout } from '../layouts/Layouts'

export interface TxSubmitPageProps {
    data?: Partial<TxSubmitForm>
}

export const TxSubmitPage: ActivityComponentType<TxSubmitPageProps> = ({ params }) => {
    const { data } = params

    return (
        <AppLayout title="Transaction Submit" centered>
            {/* Main Content */}
            <TxSubmitCard initialData={data} />
        </AppLayout>
    )
}
