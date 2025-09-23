#!/usr/bin/env -S tsx
/* eslint-disable no-console */
/**
 * E2E Test Runner
 *
 * Runs all E2E tests in sequence:
 * 1. Single fill (happy path)
 * 2. Multi-fill with Merkle proofs
 * 3. Failure modes (expiry, missing secret, early cancellation)
 */

import 'dotenv/config'
import {spawn} from 'node:child_process'

interface TestResult {
    name: string
    success: boolean
    duration: number
    error?: string
}

async function runTest(testPath: string, testName: string): Promise<TestResult> {
    return new Promise((resolve) => {
        const startTime = Date.now()
        console.log(`\n🚀 Running ${testName}...`)
        console.log(`   Script: ${testPath}`)
        console.log('   ' + '='.repeat(50))

        const child = spawn('pnpm', ['tsx', testPath], {
            stdio: 'inherit',
            shell: true
        })

        child.on('close', (code) => {
            const duration = Date.now() - startTime
            const success = code === 0

            console.log('   ' + '='.repeat(50))
            console.log(`   ${success ? '✅' : '❌'} ${testName} ${success ? 'PASSED' : 'FAILED'} (${duration}ms)`)

            resolve({
                name: testName,
                success,
                duration,
                error: success ? undefined : `Exit code: ${code}`
            })
        })

        child.on('error', (error) => {
            const duration = Date.now() - startTime
            console.log('   ' + '='.repeat(50))
            console.log(`   ❌ ${testName} FAILED (${duration}ms)`)

            resolve({
                name: testName,
                success: false,
                duration,
                error: error.message
            })
        })
    })
}

async function main(): Promise<void> {
    console.log('🧪 NEAR ↔ EVM Cross-Chain E2E Test Suite')
    console.log('=====================================\n')

    const tests = [
        // NEAR to EVM tests
        {
            path: 'tests/e2e/near-to-evm-happy.spec.ts',
            name: 'NEAR→EVM Single Fill (Happy Path)'
        },
        {
            path: 'tests/e2e/near-to-evm-multi-fill.spec.ts',
            name: 'NEAR→EVM Multi-Fill with Merkle Proofs'
        },
        {
            path: 'tests/e2e/near-to-evm-failure-modes.spec.ts',
            name: 'NEAR→EVM Failure Modes'
        },
        // EVM to NEAR tests
        {
            path: 'tests/e2e/evm-to-near-happy.spec.ts',
            name: 'EVM→NEAR Single Fill (Happy Path)'
        },
        {
            path: 'tests/e2e/evm-to-near-multi-fill.spec.ts',
            name: 'EVM→NEAR Multi-Fill with Merkle Proofs'
        },
        {
            path: 'tests/e2e/evm-to-near-failure-modes.spec.ts',
            name: 'EVM→NEAR Failure Modes'
        }
    ]

    const results: TestResult[] = []

    // Run each test sequentially
    for (const test of tests) {
        const result = await runTest(test.path, test.name)
        results.push(result)

        // Add delay between tests to avoid conflicts
        if (result !== results[results.length - 1]) {
            console.log('\n⏳ Waiting 5s before next test...')
            await new Promise((resolve) => setTimeout(resolve, 5000))
        }
    }

    // Print summary
    console.log('\n📊 TEST SUMMARY')
    console.log('===============')

    let totalPassed = 0
    let totalDuration = 0

    for (const result of results) {
        const status = result.success ? '✅ PASS' : '❌ FAIL'
        const duration = `${result.duration}ms`
        console.log(`${status} ${result.name.padEnd(40)} ${duration}`)

        if (result.error) {
            console.log(`     Error: ${result.error}`)
        }

        if (result.success) totalPassed++

        totalDuration += result.duration
    }

    console.log('===============')
    console.log(`📈 Results: ${totalPassed}/${results.length} passed`)
    console.log(`⏱️  Total time: ${totalDuration}ms`)

    if (totalPassed === results.length) {
        console.log('\n🎉 All E2E tests passed! Cross-chain system is working correctly.')
        process.exit(0)
    } else {
        console.log(`\n❌ ${results.length - totalPassed} test(s) failed. Please check the logs above.`)
        process.exit(1)
    }
}

main().catch((e) => {
    console.error('❌ Test runner failed:', e)
    process.exit(1)
})
