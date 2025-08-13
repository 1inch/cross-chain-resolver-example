import dotenv from 'dotenv';
import path from 'path';
import fetch from 'node-fetch';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

// Helper function to make RPC calls
async function nearRpc(method: string, params: any): Promise<any> {
  const RPC_URL = process.env.NEAR_NODE_URL || 'https://rpc.testnet.near.org';
  
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'dontcare',
      method,
      params,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  const result = await response.json();
  
  if (result.error) {
    throw new Error(`RPC error: ${result.error.message}`);
  }
  
  return result.result;
}

// Helper function to call view methods
async function callViewMethod(contractId: string, methodName: string, args: any = {}): Promise<any> {
  const argsBase64 = Buffer.from(JSON.stringify(args)).toString('base64');
  
  const result = await nearRpc('query', {
    request_type: 'call_function',
    finality: 'final',
    account_id: contractId,
    method_name: methodName,
    args_base64: argsBase64,
  });
  
  if (result.result && result.result.length > 0) {
    return JSON.parse(Buffer.from(result.result).toString());
  }
  
  return null;
}

async function registerRelayer(): Promise<void> {
  try {
    // 1. Get configuration from environment
    const RELAYER_ACCOUNT_ID = process.env.NEAR_ACCOUNT_ID || 'fusionswap.testnet';
    const ESCROW_CONTRACT = process.env.NEAR_ESCROW_CONTRACT || 'escrow-v2.fusionswap.testnet';
    const PRIVATE_KEY = process.env.NEAR_PRIVATE_KEY;
    
    console.log('🔧 Relayer Registration');
    console.log('=======================');
    console.log(`Relayer Account: ${RELAYER_ACCOUNT_ID}`);
    console.log(`Escrow Contract: ${ESCROW_CONTRACT}\n`);

    if (!PRIVATE_KEY) {
      console.error('❌ NEAR_PRIVATE_KEY environment variable is required for registration');
      console.log('Please set NEAR_PRIVATE_KEY in your .env file with the private key for the relayer account.');
      process.exit(1);
    }

    // 2. Check current registration status
    console.log('📋 Checking current registration status...');
    try {
      const isRegistered = await callViewMethod(ESCROW_CONTRACT, 'is_registered_relayer', {
        account_id: RELAYER_ACCOUNT_ID
      });
      
      if (isRegistered) {
        console.log('✅ Relayer is already registered!');
        
        // Get relayer info
        try {
          const relayerInfo = await callViewMethod(ESCROW_CONTRACT, 'get_relayer', {
            account_id: RELAYER_ACCOUNT_ID
          });
          
          if (relayerInfo) {
            console.log('📄 Current Relayer Info:');
            console.log(JSON.stringify(relayerInfo, null, 2));
          }
        } catch (e) {
          console.log('Could not fetch relayer details');
        }
        
        return;
      }
      
      console.log('❌ Relayer is not registered. Proceeding with registration...\n');
      
    } catch (error: any) {
      console.error('❌ Error checking registration status:', error?.message || 'Unknown error');
      console.log('Proceeding with registration attempt...\n');
    }

    // 3. Check available registration methods
    console.log('🔍 Checking available registration methods...');
    
    // Try to get contract methods to understand the registration interface
    try {
      // Common registration method names to try
      const possibleMethods = [
        'register_relayer',
        'add_relayer', 
        'register_validator',
        'add_validator',
        'register',
        'whitelist_relayer'
      ];
      
      console.log('📝 Attempting registration with common method names...\n');
      
      // For now, let's use NEAR CLI approach since we need to sign transactions
      console.log('🚀 Registration requires transaction signing.');
      console.log('Please use one of the following methods:\n');
      
      console.log('Method 1: Using NEAR CLI');
      console.log('========================');
      console.log(`near call ${ESCROW_CONTRACT} register_relayer '{}' --accountId ${RELAYER_ACCOUNT_ID} --gas 300000000000000`);
      console.log('OR');
      console.log(`near call ${ESCROW_CONTRACT} add_relayer '{"account_id": "${RELAYER_ACCOUNT_ID}"}' --accountId ${RELAYER_ACCOUNT_ID} --gas 300000000000000`);
      
      console.log('\nMethod 2: Check contract source for exact method');
      console.log('===============================================');
      console.log('1. Check the escrow contract source code for the exact registration method');
      console.log('2. Look for methods like register_relayer, add_relayer, or whitelist_relayer');
      console.log('3. Check if registration requires admin privileges\n');
      
      // Let's also try to get the contract's method list
      console.log('🔍 Attempting to discover contract methods...');
      
      // This is a workaround - we'll try some common view methods to understand the contract
      const commonViewMethods = [
        'get_relayers',
        'get_all_relayers', 
        'list_relayers',
        'get_admin',
        'get_owner'
      ];
      
      for (const method of commonViewMethods) {
        try {
          const result = await callViewMethod(ESCROW_CONTRACT, method);
          console.log(`✅ ${method}:`, result);
        } catch (e) {
          // Method doesn't exist, continue
        }
      }
      
    } catch (error: any) {
      console.error('❌ Error during method discovery:', error?.message || 'Unknown error');
    }
    
    console.log('\n💡 Next Steps:');
    console.log('1. Use NEAR CLI to register the relayer (commands shown above)');
    console.log('2. Or check the escrow contract documentation for registration requirements');
    console.log('3. Run the relayer status check again after registration');
    
  } catch (error: any) {
    console.error('\n❌ Fatal error during relayer registration:', error?.message || 'Unknown error');
    if (error?.stack) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Run the registration
registerRelayer().catch(console.error);
