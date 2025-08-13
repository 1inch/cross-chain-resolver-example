#!/usr/bin/env ts-node

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

interface NearTestnetConfig {
  network: string;
  rpcUrl: string;
  explorerUrl: string;
  contracts: {
    crossChainSolver: string;
    escrowContract: string;
  };
  testAccounts: {
    deployer: string;
    user1: string;
    user2: string;
  };
}

class NearTestnetDeployer {
  private config: NearTestnetConfig;
  private configPath: string;

  constructor() {
    this.configPath = path.join(__dirname, '../testnet-config.json');
    const testnetConfig = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    
    this.config = {
      network: 'testnet',
      rpcUrl: testnetConfig.networks['near-testnet'].rpcUrl,
      explorerUrl: testnetConfig.networks['near-testnet'].explorerUrl,
      contracts: {
        crossChainSolver: '',
        escrowContract: ''
      },
      testAccounts: {
        deployer: '',
        user1: '',
        user2: ''
      }
    };
  }

  async deployContracts(): Promise<void> {
    console.log('🚀 Starting NEAR testnet deployment...');
    console.log(`Network: NEAR Testnet`);
    console.log(`RPC URL: ${this.config.rpcUrl}`);

    // Check if near-cli is installed
    try {
      execSync('near --version', { stdio: 'pipe' });
    } catch (error) {
      throw new Error('near-cli is not installed. Please install it with: npm install -g near-cli');
    }

    // Login to NEAR testnet (if not already logged in)
    await this.ensureNearLogin();

    // Create test accounts
    await this.createTestAccounts();

    // Deploy contracts
    await this.deployCrossChainSolver();
    await this.deployEscrowContract();

    // Initialize contracts
    await this.initializeContracts();

    // Update configuration
    await this.updateConfig();

    console.log('✅ NEAR contracts deployed successfully!');
  }

  private async ensureNearLogin(): Promise<void> {
    console.log('\n🔐 Checking NEAR CLI login status...');
    
    try {
      const result = execSync('near state testnet', { encoding: 'utf8', stdio: 'pipe' });
      console.log('✅ Already logged in to NEAR testnet');
    } catch (error) {
      console.log('❌ Not logged in to NEAR testnet');
      console.log('Please run: near login');
      console.log('Then run this script again');
      throw new Error('NEAR CLI login required');
    }
  }

  private async createTestAccounts(): Promise<void> {
    console.log('\n👥 Creating NEAR test accounts...');

    const timestamp = Date.now();
    const accounts = [
      `deployer-${timestamp}.testnet`,
      `user1-${timestamp}.testnet`,
      `user2-${timestamp}.testnet`
    ];

    for (const [index, accountId] of accounts.entries()) {
      try {
        console.log(`Creating account: ${accountId}`);
        
        // Create account with 10 NEAR initial balance
        execSync(`near create-account ${accountId} --masterAccount testnet --initialBalance 10`, {
          stdio: 'inherit'
        });

        // Store account ID
        if (index === 0) this.config.testAccounts.deployer = accountId;
        else if (index === 1) this.config.testAccounts.user1 = accountId;
        else if (index === 2) this.config.testAccounts.user2 = accountId;

        console.log(`✅ Created account: ${accountId}`);
      } catch (error) {
        console.log(`⚠️  Account ${accountId} might already exist or creation failed`);
      }
    }
  }

  private async deployCrossChainSolver(): Promise<void> {
    console.log('\n📦 Deploying EscrowContract contract...');
    
    const contractPath = path.join(__dirname, '../../near-contracts/escrow/target/wasm32-unknown-unknown/release/escrow.wasm');
    
    // Check if contract is built
    if (!fs.existsSync(contractPath)) {
      console.log('Building NEAR escrow contract...');
      const escrowDir = path.join(__dirname, '../../near-contracts/escrow');
      execSync('cargo build --target wasm32-unknown-unknown --release', {
        cwd: escrowDir,
        stdio: 'inherit'
      });
    }

    const timestamp = Date.now();
    const contractAccount = `solver-${timestamp}.testnet`;
    
    try {
      // Create contract account
      execSync(`near create-account ${contractAccount} --masterAccount ${this.config.testAccounts.deployer} --initialBalance 5`, {
        stdio: 'inherit'
      });

      // Deploy contract
      execSync(`near deploy --accountId ${contractAccount} --wasmFile ${contractPath}`, {
        stdio: 'inherit'
      });

      this.config.contracts.crossChainSolver = contractAccount;
      console.log(`✅ CrossChainSolver deployed to: ${contractAccount}`);
    } catch (error) {
      console.error('❌ Failed to deploy CrossChainSolver:', error);
      throw error;
    }
  }

  private async deployEscrowContract(): Promise<void> {
    console.log('\n📦 Deploying Escrow contract...');

    const contractPath = path.join(__dirname, '../../near-contracts/escrow/target/wasm32-unknown-unknown/release/escrow.wasm');
    
    // Check if contract is built
    if (!fs.existsSync(contractPath)) {
      console.log('Building NEAR escrow contract...');
      const escrowDir = path.join(__dirname, '../../near-contracts/escrow');
      execSync('cargo build --target wasm32-unknown-unknown --release', {
        cwd: escrowDir,
        stdio: 'inherit'
      });
    }

    const timestamp = Date.now();
    const contractAccount = `escrow-${timestamp}.testnet`;
    
    try {
      // Create contract account
      execSync(`near create-account ${contractAccount} --masterAccount ${this.config.testAccounts.deployer} --initialBalance 5`, {
        stdio: 'inherit'
      });

      // Deploy contract with initialization
      const deployResult = execSync(
        `near contract deploy ${contractAccount} use-file ${contractPath} with-init-call new json-args '{"owner_id":"${contractAccount}","tee_registry_id":"tee-registry.testnet"}' prepaid-gas '300.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send`,
        { encoding: 'utf8', cwd: process.cwd() }
      );

      this.config.contracts.escrowContract = contractAccount;
      console.log(`✅ Escrow contract deployed to: ${contractAccount}`);
    } catch (error) {
      console.error('❌ Failed to deploy Escrow contract:', error);
      throw error;
    }
  }

  private async initializeContracts(): Promise<void> {
    console.log('\n⚙️  Initializing NEAR contracts...');

    // Initialize CrossChainSolver
    try {
      const initArgs = JSON.stringify({
        owner_id: this.config.testAccounts.deployer
      });

      execSync(`near call ${this.config.contracts.crossChainSolver} new '${initArgs}' --accountId ${this.config.testAccounts.deployer}`, {
        stdio: 'inherit'
      });

      console.log('✅ CrossChainSolver initialized');
    } catch (error) {
      console.log('⚠️  CrossChainSolver initialization failed or already initialized');
    }

    // Initialize Escrow contract
    try {
      const initArgs = JSON.stringify({
        owner_id: this.config.testAccounts.deployer,
        tee_registry_id: this.config.contracts.crossChainSolver
      });

      execSync(`near call ${this.config.contracts.escrowContract} new '${initArgs}' --accountId ${this.config.testAccounts.deployer}`, {
        stdio: 'inherit'
      });

      console.log('✅ Escrow contract initialized');
    } catch (error) {
      console.log('⚠️  Escrow contract initialization failed or already initialized');
    }
  }

  private async updateConfig(): Promise<void> {
    console.log('\n💾 Updating configuration...');

    // Load existing config
    const testnetConfig = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));

    // Update NEAR contract addresses
    testnetConfig.contracts['near-testnet'] = {
      CrossChainSolver: {
        accountId: this.config.contracts.crossChainSolver,
        deployedAt: new Date().toISOString(),
        txHash: ''
      },
      EscrowContract: {
        accountId: this.config.contracts.escrowContract,
        deployedAt: new Date().toISOString(),
        txHash: ''
      }
    };

    // Update NEAR test accounts
    testnetConfig.testWallets.near = {
      deployer: {
        accountId: this.config.testAccounts.deployer,
        privateKey: '',
        balance: '10'
      },
      user1: {
        accountId: this.config.testAccounts.user1,
        privateKey: '',
        balance: '10'
      },
      user2: {
        accountId: this.config.testAccounts.user2,
        privateKey: '',
        balance: '10'
      }
    };

    // Save updated config
    fs.writeFileSync(this.configPath, JSON.stringify(testnetConfig, null, 2));
    console.log(`✅ Configuration updated: ${this.configPath}`);
  }

  async generateNearDeploymentReport(): Promise<void> {
    console.log('\n📊 Generating NEAR deployment report...');

    const report = {
      deployment: {
        network: 'NEAR Testnet',
        deployer: this.config.testAccounts.deployer,
        timestamp: new Date().toISOString()
      },
      contracts: {
        crossChainSolver: this.config.contracts.crossChainSolver,
        escrowContract: this.config.contracts.escrowContract
      },
      testAccounts: this.config.testAccounts,
      explorerLinks: {
        crossChainSolver: `${this.config.explorerUrl}/accounts/${this.config.contracts.crossChainSolver}`,
        escrowContract: `${this.config.explorerUrl}/accounts/${this.config.contracts.escrowContract}`,
        deployer: `${this.config.explorerUrl}/accounts/${this.config.testAccounts.deployer}`
      },
      nextSteps: [
        'Configure relayer with NEAR contract addresses',
        'Fund test accounts with tokens',
        'Test cross-chain swap scenarios',
        'Verify contract interactions'
      ]
    };

    const reportPath = path.join(__dirname, '../near-deployment-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`✅ NEAR deployment report saved to: ${reportPath}`);

    // Print summary
    console.log('\n🎉 NEAR Deployment Summary:');
    console.log('='.repeat(60));
    console.log(`Network: ${report.deployment.network}`);
    console.log(`Deployer: ${report.deployment.deployer}`);
    console.log(`CrossChainSolver: ${this.config.contracts.crossChainSolver}`);
    console.log(`EscrowContract: ${this.config.contracts.escrowContract}`);
    console.log('='.repeat(60));
  }
}

// Main execution
async function main() {
  try {
    const deployer = new NearTestnetDeployer();
    
    // Deploy NEAR contracts
    await deployer.deployContracts();
    
    // Generate deployment report
    await deployer.generateNearDeploymentReport();
    
    console.log('\n🎉 NEAR testnet deployment completed successfully!');
    console.log('Next: Start relayer service and run cross-chain demo');
    
  } catch (error) {
    console.error('❌ NEAR deployment failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { NearTestnetDeployer };
