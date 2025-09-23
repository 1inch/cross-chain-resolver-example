import crypto from 'node:crypto'

export function randomHex(bytes: number): string {
    return '0x' + crypto.randomBytes(bytes).toString('hex')
}

export function keccak256(hexData: string): string {
    const data = Buffer.from(hexData.replace(/^0x/, ''), 'hex')
    const hash = crypto.createHash('sha3-256')
    hash.update(data)

    return '0x' + hash.digest('hex')
}
