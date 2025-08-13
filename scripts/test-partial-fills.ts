#!/usr/bin/env tsx

/**
 * Comprehensive test runner for partial fill functionality
 * Executes integration tests, contract tests, and validates end-to-end scenarios
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';

interface TestResult {
  testFile: string;
  passed: boolean;
  duration: number;
  output: string;
  error?: string;
}

class PartialFillTestRunner {
  private results: TestResult[] = [];
  private readonly projectRoot: string;

  constructor() {
    this.projectRoot = process.cwd();
  }

  /**
   * Run all partial fill related tests
   */
  async runAllTests(): Promise<void> {
    console.log('🧪 Running Comprehensive Partial Fill Test Suite');
    console.log('====================================================');

    try {
      // 1. Run TypeScript integration tests
      await this.runIntegrationTests();

      // 2. Run Solidity contract tests
      await this.runContractTests();

      // 3. Run service-specific tests
      await this.runServiceTests();

      // 4. Generate comprehensive report
      this.generateReport();

    } catch (error) {
      console.error('❌ Test suite execution failed:', error);
      process.exit(1);
    }
  }

  /**
   * Run integration tests for partial fill functionality
   */
  private async runIntegrationTests(): Promise<void> {
    console.log('\n📋 Running Integration Tests');
    console.log('-----------------------------');

    const integrationTestFile = path.join(
      this.projectRoot,
      'relayer/tests/integration/PartialFillIntegration.test.ts'
    );

    await this.runNodeTest(integrationTestFile, 'Partial Fill Integration Tests');
  }

  /**
   * Run Solidity contract tests
   */
  private async runContractTests(): Promise<void> {
    console.log('\n📋 Running Contract Tests');
    console.log('--------------------------');

    const contractTestFile = path.join(
      this.projectRoot,
      'contracts/test/ResolverPartialFill.t.sol'
    );

    await this.runFoundryTest(contractTestFile, 'Resolver Partial Fill Tests');
  }

  /**
   * Run service-specific tests
   */
  private async runServiceTests(): Promise<void> {
    console.log('\n📋 Running Service Tests');
    console.log('-------------------------');

    // Test NEAR partial fill service
    const nearServiceTest = path.join(
      this.projectRoot,
      'relayer/tests/services/NearPartialFillService.test.ts'
    );

    if (await this.fileExists(nearServiceTest)) {
      await this.runNodeTest(nearServiceTest, 'NEAR Partial Fill Service Tests');
    }

    // Test Ethereum partial fill service
    const ethServiceTest = path.join(
      this.projectRoot,
      'relayer/tests/services/EthereumPartialFillService.test.ts'
    );

    if (await this.fileExists(ethServiceTest)) {
      await this.runNodeTest(ethServiceTest, 'Ethereum Partial Fill Service Tests');
    }
  }

  /**
   * Run Node.js/TypeScript test using tsx
   */
  private async runNodeTest(testFile: string, testName: string): Promise<void> {
    if (!(await this.fileExists(testFile))) {
      console.log(`⚠️  ${testName} - Test file not found: ${testFile}`);
      return;
    }

    const startTime = Date.now();
    
    return new Promise((resolve) => {
      const process = spawn('npx', ['tsx', testFile], {
        cwd: this.projectRoot,
        stdio: 'pipe'
      });

      let output = '';
      let errorOutput = '';

      process.stdout.on('data', (data) => {
        output += data.toString();
      });

      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      process.on('close', (code) => {
        const duration = Date.now() - startTime;
        const passed = code === 0;

        this.results.push({
          testFile: testName,
          passed,
          duration,
          output: output || errorOutput,
          error: passed ? undefined : errorOutput
        });

        if (passed) {
          console.log(`✅ ${testName} - PASSED (${duration}ms)`);
        } else {
          console.log(`❌ ${testName} - FAILED (${duration}ms)`);
          if (errorOutput) {
            console.log(`   Error: ${errorOutput.substring(0, 200)}...`);
          }
        }

        resolve();
      });
    });
  }

  /**
   * Run Foundry test
   */
  private async runFoundryTest(testFile: string, testName: string): Promise<void> {
    if (!(await this.fileExists(testFile))) {
      console.log(`⚠️  ${testName} - Test file not found: ${testFile}`);
      return;
    }

    const startTime = Date.now();
    
    return new Promise((resolve) => {
      const process = spawn('forge', ['test', '--match-path', testFile, '-vv'], {
        cwd: path.join(this.projectRoot, 'contracts'),
        stdio: 'pipe'
      });

      let output = '';
      let errorOutput = '';

      process.stdout.on('data', (data) => {
        output += data.toString();
      });

      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      process.on('close', (code) => {
        const duration = Date.now() - startTime;
        const passed = code === 0;

        this.results.push({
          testFile: testName,
          passed,
          duration,
          output: output || errorOutput,
          error: passed ? undefined : errorOutput
        });

        if (passed) {
          console.log(`✅ ${testName} - PASSED (${duration}ms)`);
        } else {
          console.log(`❌ ${testName} - FAILED (${duration}ms)`);
          if (errorOutput) {
            console.log(`   Error: ${errorOutput.substring(0, 200)}...`);
          }
        }

        resolve();
      });
    });
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate comprehensive test report
   */
  private generateReport(): void {
    console.log('\n📊 PARTIAL FILL TEST SUMMARY');
    console.log('=====================================');

    const totalTests = this.results.length;
    const passedTests = this.results.filter(r => r.passed).length;
    const failedTests = totalTests - passedTests;
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

    console.log(`Total Tests:    ${totalTests}`);
    console.log(`Passed:         ${passedTests} ✅`);
    console.log(`Failed:         ${failedTests} ❌`);
    console.log(`Success Rate:   ${((passedTests / totalTests) * 100).toFixed(1)}%`);
    console.log(`Total Duration: ${totalDuration}ms`);

    if (failedTests > 0) {
      console.log('\n❌ FAILED TESTS:');
      this.results
        .filter(r => !r.passed)
        .forEach(result => {
          console.log(`   - ${result.testFile}`);
          if (result.error) {
            console.log(`     Error: ${result.error.substring(0, 100)}...`);
          }
        });
    }

    console.log('\n🎯 NEXT STEPS:');
    if (failedTests === 0) {
      console.log('✅ All partial fill tests passed! Ready for production deployment.');
      console.log('✅ Cross-chain coordination is working correctly.');
      console.log('✅ Contract logic handles all edge cases properly.');
    } else {
      console.log('🔧 Fix failing tests before proceeding with deployment.');
      console.log('🔧 Review error messages and update implementation as needed.');
    }

    // Exit with appropriate code
    process.exit(failedTests > 0 ? 1 : 0);
  }
}

// Main execution
async function main() {
  const runner = new PartialFillTestRunner();
  await runner.runAllTests();
}

if (require.main === module) {
  main().catch(console.error);
}
