/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import {connect, keyStores, KeyPair} from 'near-api-js'
import BN from 'bn.js'
import type {Env} from './env'

export async function nearAccount(env: Env) {
    const ks = new keyStores.InMemoryKeyStore()
    await ks.setKey(env.NEAR_NETWORK, env.NEAR_ACCOUNT_ID, KeyPair.fromString(env.NEAR_PRIVATE_KEY))
    const near = await connect({networkId: env.NEAR_NETWORK, nodeUrl: env.NEAR_NODE_URL, deps: {keyStore: ks}})

    return near.account(env.NEAR_ACCOUNT_ID)
}

export async function intakeIntent(env: Env, intent: unknown) {
    const account = await nearAccount(env)
    const res = await account.functionCall({
        contractId: env.NEAR_INTENTS_ACCOUNT_ID,
        methodName: 'intake_intent',
        args: {intent} as Record<string, unknown>,
        gas: new BN('100000000000000'),
        attachedDeposit: new BN('0')
    })
    // @ts-ignore
    const tx: string = res?.transaction_outcome?.id || res?.transaction_outcome?.outcome?.transaction_hash || ''

    return {tx, raw: res}
}
