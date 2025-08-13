import { ethers } from 'ethers';
import { getConfig, getProvider, getSigner } from './config';
import { readFileSync } from 'fs';
import path from 'path';

// Configuration
const config = getConfig();

// Contract ABIs and bytecode
const ESCROW_FACTORY_ABI = JSON.parse(
  readFileSync(
    path.join(__dirname, '../../contracts/out/TestEscrowFactory.sol/TestEscrowFactory.json'),
    'utf-8'
  )
).abi;

// Deployment parameters
const INITIAL_OWNER = process.env.INITIAL_OWNER || ''; // Address that will own the escrow factory

async function main() {
  console.log('Starting Escrow Factory deployment...');
  
  // Set up provider and signer
  const provider = getProvider(config.rpcUrl);
  const signer = getSigner(config.privateKey, provider);
  
  console.log(`Connected to network: ${config.chainId}`);
  console.log(`Deployer address: ${await signer.getAddress()}`);
  console.log(`Balance: ${ethers.formatEther(await provider.getBalance(signer.address))} ETH`);
  
  // Deploy EscrowFactory contract
  console.log('\nDeploying TestEscrowFactory contract...');
  
  const EscrowFactory = new ethers.ContractFactory(
    ESCROW_FACTORY_ABI,
    '0x', // Bytecode will be filled by Foundry
    signer
  );
  
  // Deploy the contract
  const escrowFactory = await EscrowFactory.deploy(
    INITIAL_OWNER || await signer.getAddress(),
    { gasLimit: 5_000_000 } // Adjust gas limit as needed
  );
  
  console.log(`Transaction hash: ${escrowFactory.deploymentTransaction()?.hash}`);
  console.log('Waiting for deployment confirmation...');
  
  await escrowFactory.waitForDeployment();
  
  const contractAddress = await escrowFactory.getAddress();
  console.log(`\n✅ TestEscrowFactory deployed to: ${contractAddress}`);
  
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
  console.log(`TestEscrowFactory address: ${contractAddress}`);
  
  // Example of creating a new escrow
  if (process.env.CREATE_SAMPLE_ESCROW === 'true') {
    console.log('\nCreating a sample escrow...');
    try {
      const tx = await escrowFactory.createEscrow(
        '0x0000000000000000000000000000000000000000', // tokenA
        '0x0000000000000000000000000000000000000000', // tokenB
        0, // amountA
        0, // amountB
        '0x', // extraData
        { gasLimit: 1_000_000 }
      );
      
      const receipt = await tx.wait();
      console.log(`Sample escrow created in tx: ${receipt.hash}`);
      
      // Parse the EscrowCreated event
      const event = receipt.logs.find(
        (log: any) => log.fragment?.name === 'EscrowCreated'
      );
      
      if (event) {
        const escrowAddress = event.args[0];
        console.log(`New escrow deployed at: ${escrowAddress}`);
      }
    } catch (error) {
      console.error('Failed to create sample escrow:', error);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Deployment failed!');
    console.error(error);
    process.exit(1);
  });
