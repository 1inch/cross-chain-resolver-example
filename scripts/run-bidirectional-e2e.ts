#!/usr/bin/env -S tsx
/* eslint-disable no-console */
/**
 * Bidirectional Cross-Chain E2E Test Runner
 *
 * Runs all E2E tests in both directions:
 * - NEAR → EVM (happy path, multi-fill, failure modes)
 * - EVM → NEAR (happy path, multi-fill, failure modes)
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
        console.log('   ' + '='.repeat(60))

        const child = spawn('pnpm', ['tsx', testPath], {
            stdio: 'inherit',
            shell: true
        })

        child.on('close', (code) => {
            const duration = Date.now() - startTime
            const success = code === 0

            console.log('   ' + '='.repeat(60))
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
            console.log('   ' + '='.repeat(60))
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
    console.log('🌉 Bidirectional Cross-Chain E2E Test Suite')
    console.log('==========================================\n')

    const tests = [
        // NEAR → EVM Direction
        {
            path: 'tests/e2e/near-to-evm-happy.spec.ts',
            name: '🔵 NEAR→EVM Happy Path'
        },
        {
            path: 'tests/e2e/near-to-evm-multi-fill.spec.ts',
            name: '🔵 NEAR→EVM Multi-Fill'
        },
        {
            path: 'tests/e2e/near-to-evm-failure-modes.spec.ts',
            name: '🔵 NEAR→EVM Failure Modes'
        },
        // EVM → NEAR Direction
        {
            path: 'tests/e2e/evm-to-near-happy.spec.ts',
            name: '🟡 EVM→NEAR Happy Path'
        },
        {
            path: 'tests/e2e/evm-to-near-multi-fill.spec.ts',
            name: '🟡 EVM→NEAR Multi-Fill'
        },
        {
            path: 'tests/e2e/evm-to-near-failure-modes.spec.ts',
            name: '🟡 EVM→NEAR Failure Modes'
        }
    ]

    const results: TestResult[] = []

    // Run each test sequentially with delays
    for (let i = 0; i < tests.length; i++) {
        const test = tests[i]
        const result = await runTest(test.path, test.name)
        results.push(result)

        // Add delay between tests to avoid conflicts
        if (i < tests.length - 1) {
            console.log('\n⏳ Waiting 5s before next test...')
            await new Promise((resolve) => setTimeout(resolve, 5000))
        }
    }

    // Print comprehensive summary
    console.log('\n📊 BIDIRECTIONAL TEST SUMMARY')
    console.log('=============================')

    let nearToEvmPassed = 0
    let evmToNearPassed = 0
    let totalDuration = 0

    results.forEach((result, index) => {
        const status = result.success ? '✅ PASS' : '❌ FAIL'
        const duration = `${result.duration}ms`
        console.log(`${status} ${result.name.padEnd(35)} ${duration}`)

        if (result.error) {
            console.log(`     Error: ${result.error}`)
        }

        if (index < 3) {
            // NEAR → EVM tests
            if (result.success) nearToEvmPassed++
        } else {
            // EVM → NEAR tests
            if (result.success) evmToNearPassed++
        }

        totalDuration += result.duration
    })

    console.log('=============================')
    console.log(`🔵 NEAR→EVM: ${nearToEvmPassed}/3 passed`)
    console.log(`🟡 EVM→NEAR: ${evmToNearPassed}/3 passed`)
    console.log(`📈 Overall: ${nearToEvmPassed + evmToNearPassed}/${results.length} passed`)
    console.log(`⏱️  Total time: ${totalDuration}ms`)

    if (nearToEvmPassed === 3 && evmToNearPassed === 3) {
        console.log('\n🎉 All bidirectional tests PASSED! Cross-chain system works in both directions.')
        process.exit(0)
    } else {
        const failedDirections = []

        if (nearToEvmPassed < 3) failedDirections.push('NEAR→EVM')

        if (evmToNearPassed < 3) failedDirections.push('EVM→NEAR')

        console.log(`\n❌ Some tests FAILED in: ${failedDirections.join(', ')}`)
        console.log('Please check the logs above for details.')
        process.exit(1)
    }
}

main().catch((e) => {
    console.error('❌ Bidirectional test runner failed:', e)
    process.exit(1)
})
