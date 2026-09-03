import type { ActivityComponentType } from '@stackflow/react'
import type { TxSubmitForm } from '../components/TxSubmitCard'
import { TxSubmitCard } from '../components/TxSubmitCard'
import { AppLayout } from '../layouts/Layouts'

export interface TxSubmitPageProps {
    data?: Partial<TxSubmitForm>
}

export const TxSubmitPage: ActivityComponentType<'TxSubmitPage'> = ({ params }) => {
    const { data } = params

    return (
        <AppLayout title="Transaction Submit" centered>
            {/* Main Content */}
            <TxSubmitCard initialData={data} />
        </AppLayout>
    )
}
