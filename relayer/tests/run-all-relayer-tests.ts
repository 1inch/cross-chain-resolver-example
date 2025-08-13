#!/usr/bin/env tsx

/**
 * Comprehensive test runner for all relayer tests
 * Executes unit tests, integration tests, and provides detailed reporting
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';

interface TestResult {
  file: string;
  type: 'unit' | 'integration';
  passed: boolean;
  duration: number;
  error?: string;
  output?: string;
}

interface TestSummary {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  unitTests: TestResult[];
  integrationTests: TestResult[];
  totalDuration: number;
  successRate: number;
}

class RelayerTestRunner {
  private testResults: TestResult[] = [];
  private startTime: number = 0;

  async run(): Promise<void> {
    console.log('🧪 Running Comprehensive Relayer Test Suite');
    console.log('=' .repeat(60));
    
    this.startTime = Date.now();

    try {
      // Run unit tests
      await this.runUnitTests();
      
      // Run integration tests
      await this.runIntegrationTests();
      
      // Generate summary report
      this.generateSummaryReport();
      
    } catch (error) {
      console.error('❌ Test runner failed:', error);
      process.exit(1);
    }
  }

  private async runUnitTests(): Promise<void> {
    console.log('\n📋 Running Unit Tests');
    console.log('-'.repeat(40));

    const unitTestFiles = [
      'ValidationService.test.ts',
      'StorageService.test.ts',
      'NearContractService.test.ts',
      'EthereumContractService.test.ts',
      'NearEventListener.test.ts',
      'EthereumEventListener.test.ts'
    ];

    for (const testFile of unitTestFiles) {
      const result = await this.runTestFile(testFile, 'unit');
      this.testResults.push(result);
      this.printTestResult(result);
    }
  }

  private async runIntegrationTests(): Promise<void> {
    console.log('\n🔗 Running Integration Tests');
    console.log('-'.repeat(40));

    const integrationTestFiles = [
      'NearRelayer.integration.test.ts',
      'EthereumRelayer.integration.test.ts'
    ];

    for (const testFile of integrationTestFiles) {
      const result = await this.runTestFile(testFile, 'integration');
      this.testResults.push(result);
      this.printTestResult(result);
    }
  }

  private async runTestFile(fileName: string, type: 'unit' | 'integration'): Promise<TestResult> {
    const testPath = join(__dirname, type, fileName);
    const startTime = Date.now();

    try {
      // Check if test file exists
      await fs.access(testPath);
      
      const output = await this.executeTest(testPath);
      const duration = Date.now() - startTime;

      return {
        file: fileName,
        type,
        passed: true,
        duration,
        output
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      return {
        file: fileName,
        type,
        passed: false,
        duration,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async executeTest(testPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('node', ['--test', '--import', 'tsx', testPath], {
        stdio: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' }
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Test failed with code ${code}\nStdout: ${stdout}\nStderr: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });

      // Set timeout for long-running tests
      setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Test timeout after 60 seconds'));
      }, 60000);
    });
  }

  private printTestResult(result: TestResult): void {
    const status = result.passed ? '✅' : '❌';
    const duration = `(${result.duration}ms)`;
    
    console.log(`${status} ${result.file} - ${result.type.toUpperCase()} ${duration}`);
    
    if (!result.passed && result.error) {
      console.log(`   Error: ${result.error.substring(0, 200)}${result.error.length > 200 ? '...' : ''}`);
    }
  }

  private generateSummaryReport(): void {
    const totalDuration = Date.now() - this.startTime;
    const summary = this.calculateSummary(totalDuration);
    
    console.log('\n📊 TEST SUMMARY');
    console.log('=' .repeat(60));
    
    console.log(`Total Tests:    ${summary.totalTests}`);
    console.log(`Passed:         ${summary.passedTests} ✅`);
    console.log(`Failed:         ${summary.failedTests} ❌`);
    console.log(`Success Rate:   ${summary.successRate.toFixed(1)}%`);
    console.log(`Total Duration: ${summary.totalDuration}ms`);
    
    // Unit test breakdown
    console.log('\n📋 Unit Test Results:');
    summary.unitTests.forEach(test => {
      const status = test.passed ? '✅' : '❌';
      console.log(`  ${status} ${test.file} (${test.duration}ms)`);
    });
    
    // Integration test breakdown
    console.log('\n🔗 Integration Test Results:');
    summary.integrationTests.forEach(test => {
      const status = test.passed ? '✅' : '❌';
      console.log(`  ${status} ${test.file} (${test.duration}ms)`);
    });
    
    // Failed tests details
    const failedTests = this.testResults.filter(test => !test.passed);
    if (failedTests.length > 0) {
      console.log('\n❌ Failed Test Details:');
      failedTests.forEach(test => {
        console.log(`\n  ${test.file} (${test.type}):`);
        console.log(`    Error: ${test.error || 'Unknown error'}`);
      });
    }
    
    // Performance insights
    this.generatePerformanceInsights(summary);
    
    // Final status
    console.log('\n' + '=' .repeat(60));
    if (summary.failedTests === 0) {
      console.log('🎉 ALL TESTS PASSED! Relayer testing framework is comprehensive and operational.');
    } else {
      console.log(`⚠️  ${summary.failedTests} test(s) failed. Review errors above for details.`);
    }
    
    // Exit with appropriate code
    process.exit(summary.failedTests > 0 ? 1 : 0);
  }

  private calculateSummary(totalDuration: number): TestSummary {
    const unitTests = this.testResults.filter(test => test.type === 'unit');
    const integrationTests = this.testResults.filter(test => test.type === 'integration');
    const passedTests = this.testResults.filter(test => test.passed).length;
    const failedTests = this.testResults.filter(test => !test.passed).length;
    
    return {
      totalTests: this.testResults.length,
      passedTests,
      failedTests,
      unitTests,
      integrationTests,
      totalDuration,
      successRate: this.testResults.length > 0 ? (passedTests / this.testResults.length) * 100 : 0
    };
  }

  private generatePerformanceInsights(summary: TestSummary): void {
    console.log('\n⚡ Performance Insights:');
    
    // Fastest and slowest tests
    const sortedByDuration = [...this.testResults].sort((a, b) => b.duration - a.duration);
    const slowest = sortedByDuration[0];
    const fastest = sortedByDuration[sortedByDuration.length - 1];
    
    if (slowest && fastest) {
      console.log(`  Slowest: ${slowest.file} (${slowest.duration}ms)`);
      console.log(`  Fastest: ${fastest.file} (${fastest.duration}ms)`);
    }
    
    // Average durations by type
    const unitAvg = summary.unitTests.length > 0 
      ? summary.unitTests.reduce((sum, test) => sum + test.duration, 0) / summary.unitTests.length 
      : 0;
    const integrationAvg = summary.integrationTests.length > 0 
      ? summary.integrationTests.reduce((sum, test) => sum + test.duration, 0) / summary.integrationTests.length 
      : 0;
    
    console.log(`  Unit Test Average: ${unitAvg.toFixed(0)}ms`);
    console.log(`  Integration Test Average: ${integrationAvg.toFixed(0)}ms`);
    
    // Performance warnings
    const slowTests = this.testResults.filter(test => test.duration > 5000);
    if (slowTests.length > 0) {
      console.log(`  ⚠️  ${slowTests.length} test(s) took longer than 5 seconds`);
    }
  }
}

// Main execution
async function main(): Promise<void> {
  const runner = new RelayerTestRunner();
  await runner.run();
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection:', reason);
  process.exit(1);
});

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Test runner failed:', error);
    process.exit(1);
  });
}

export { RelayerTestRunner };
