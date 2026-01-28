import { isValidChecksumAddress } from "@goldenera/cryptoj"

export type QrData = {
    address: string
    tokenAddress: string
    amount?: string
}

export const qrToString = (qrData: QrData) => {
    return `${qrData.tokenAddress}:${qrData.address}${qrData.amount ? `:${qrData.amount}` : ''}`
}

export const stringToQrData = (qrString: string) => {
    const parsed = qrString.split(':')
    if (parsed.length < 2 || parsed.length > 3) {
        throw new Error('Invalid QR code data')
    }
    const [tokenAddress, address, amount] = parsed
    if (!isValidChecksumAddress(address)) {
        throw new Error('Invalid address')
    }
    if (!isValidChecksumAddress(tokenAddress)) {
        throw new Error('Invalid token address')
    }
    return {
        tokenAddress,
        address,
        amount
    }
}