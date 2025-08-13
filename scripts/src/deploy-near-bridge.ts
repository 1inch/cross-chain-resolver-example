import { ethers } from 'ethers';
import { getConfig, getProvider, getSigner } from './config';
import { readFileSync } from 'fs';
import path from 'path';

// Configuration
const config = getConfig();

// Contract ABIs and bytecode
const NEAR_BRIDGE_ABI = JSON.parse(
  readFileSync(
    path.join(__dirname, '../../contracts/out/NearBridge.sol/NearBridge.json'),
    'utf-8'
  )
).abi;

// Deployment parameters
const MIN_DEPOSIT = ethers.parseEther('0.01'); // 0.01 ETH
const MAX_DEPOSIT = ethers.parseEther('100');  // 100 ETH
const DISPUTE_PERIOD = 7 * 24 * 60 * 60; // 7 days in seconds
const BRIDGE_FEE_BPS = 10; // 0.1% bridge fee (10 basis points)

async function main() {
  console.log('Starting NearBridge deployment...');
  
  // Set up provider and signer
  const provider = getProvider(config.rpcUrl);
  const signer = getSigner(config.privateKey, provider);
  
  console.log(`Connected to network: ${config.chainId}`);
  console.log(`Deployer address: ${await signer.getAddress()}`);
  console.log(`Balance: ${ethers.formatEther(await provider.getBalance(signer.address))} ETH`);
  
  // Deploy NearBridge contract
  console.log('\nDeploying NearBridge contract...');
  
  const NearBridgeFactory = new ethers.ContractFactory(
    NEAR_BRIDGE_ABI,
    '0x', // Bytecode will be filled by Foundry
    signer
  );
  
  // Deploy the contract
  // Get the deployer's address to use as the initial owner
  const deployerAddress = await signer.getAddress();
  
  // Deploy the contract with all required parameters
  const nearBridge = await NearBridgeFactory.deploy(
    deployerAddress, // feeCollector
    MIN_DEPOSIT,     // minDeposit
    MAX_DEPOSIT,     // maxDeposit
    DISPUTE_PERIOD,  // disputePeriod
    BRIDGE_FEE_BPS,  // bridgeFeeBps
    deployerAddress, // initialOwner
    { gasLimit: 5_000_000 } // Adjust gas limit as needed
  );
  
  console.log(`Transaction hash: ${nearBridge.deploymentTransaction()?.hash}`);
  console.log('Waiting for deployment confirmation...');
  
  await nearBridge.waitForDeployment();
  
  const contractAddress = await nearBridge.getAddress();
  console.log(`\n✅ NearBridge deployed to: ${contractAddress}`);
  
  // Verify contract on Etherscan if configured
  if (config.verifyContract && config.apiKey && config.explorerUrl) {
    console.log('\nVerifying contract on Etherscan...');
    try {
      // This would typically be done using the Etherscan plugin
      console.log('Verification would be done here with the Etherscan plugin');
      console.log(`Contract can be verified at: ${config.explorerUrl}/address/${contractAddress}#code`);
    } catch (error) {
      console.error('Failed to verify contract:', error);
    }
  }
  
  console.log('\nDeployment complete!');
  console.log(`NearBridge address: ${contractAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Deployment failed!');
    console.error(error);
    process.exit(1);
  });
