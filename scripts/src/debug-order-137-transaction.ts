import { ethers } from 'ethers';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL || 'https://sepolia.infura.io/v3/your-key';
const FACTORY_ADDRESS = '0xedFf8aD3f18d912e0a40247e5a246CB76aCedDE7';

// Transaction hash from order_137 failure
const TX_HASH = '0x3e40081ae704183810a9e8e7c05986084802369126b4d5f159092bb9ccc0b138';

async function debugTransactionRevert() {
  console.log('🔍 Debugging transaction revert for order_137...');
  
  const provider = new ethers.JsonRpcProvider(ETHEREUM_RPC_URL);
  
  try {
    // Get transaction details
    const tx = await provider.getTransaction(TX_HASH);
    const receipt = await provider.getTransactionReceipt(TX_HASH);
    
    if (!tx || !receipt) {
      console.error('❌ Transaction or receipt not found');
      return;
    }
    
    console.log('\n📋 Transaction Details:');
    console.log(`Hash: ${tx.hash}`);
    console.log(`Block: ${receipt.blockNumber}`);
    console.log(`Gas Used: ${receipt.gasUsed.toString()} (0x${receipt.gasUsed.toString(16)})`);
    console.log(`Status: ${receipt.status} (${receipt.status === 1 ? 'Success' : 'Failed'})`);
    console.log(`To: ${tx.to}`);
    console.log(`Value: ${ethers.formatEther(tx.value)} ETH`);
    
    // Get block timestamp when transaction was mined
    const block = await provider.getBlock(receipt.blockNumber);
    if (!block) {
      console.error('❌ Block not found');
      return;
    }
    console.log(`Block Timestamp: ${block.timestamp} (${new Date(Number(block.timestamp) * 1000).toISOString()})`);
    
    // Decode transaction input
    const factoryABI = [
      'function createDstEscrow(tuple(bytes32 orderHash, bytes32 hashlock, address maker, address taker, address token, uint256 amount, uint256 safetyDeposit, uint256 timelocks) dstImmutables, uint256 srcCancellationTimestamp) external payable returns (address)'
    ];
    
    const iface = new ethers.Interface(factoryABI);
    const decoded = iface.parseTransaction({ data: tx.data, value: tx.value });
    
    if (!decoded) {
      console.error('❌ Could not decode transaction');
      return;
    }
    
    console.log('\n📝 Decoded Parameters:');
    console.log('Method:', decoded.name);
    console.log('dstImmutables:', {
      orderHash: decoded.args.dstImmutables.orderHash,
      hashlock: decoded.args.dstImmutables.hashlock,
      maker: decoded.args.dstImmutables.maker,
      taker: decoded.args.dstImmutables.taker,
      token: decoded.args.dstImmutables.token,
      amount: decoded.args.dstImmutables.amount.toString(),
      safetyDeposit: decoded.args.dstImmutables.safetyDeposit.toString(),
      timelocks: decoded.args.dstImmutables.timelocks.toString()
    });
    console.log('srcCancellationTimestamp:', decoded.args.srcCancellationTimestamp.toString());
    
    // Calculate timelock validation
    const timelockOffset = Number(decoded.args.dstImmutables.timelocks);
    const srcCancellationTimestamp = Number(decoded.args.srcCancellationTimestamp);
    const dstCancellation = Number(block.timestamp) + timelockOffset;
    
    console.log('\n⏰ Timelock Validation Analysis:');
    console.log(`Block Timestamp: ${block.timestamp}`);
    console.log(`Timelock Offset: ${timelockOffset}`);
    console.log(`DstCancellation (block.timestamp + offset): ${dstCancellation}`);
    console.log(`srcCancellationTimestamp: ${srcCancellationTimestamp}`);
    console.log(`Validation: DstCancellation (${dstCancellation}) <= srcCancellationTimestamp (${srcCancellationTimestamp}): ${dstCancellation <= srcCancellationTimestamp ? '✅ PASS' : '❌ FAIL'}`);
    
    // Calculate ETH value validation
    const amount = decoded.args.dstImmutables.amount;
    const safetyDeposit = decoded.args.dstImmutables.safetyDeposit;
    const expectedValue = amount + safetyDeposit;
    const actualValue = tx.value;
    
    console.log('\n💰 ETH Value Validation Analysis:');
    console.log(`Amount: ${amount.toString()} wei`);
    console.log(`Safety Deposit: ${safetyDeposit.toString()} wei`);
    console.log(`Expected Value (amount + safetyDeposit): ${expectedValue.toString()} wei`);
    console.log(`Actual Value (msg.value): ${actualValue.toString()} wei`);
    console.log(`Validation: msg.value == nativeAmount: ${actualValue === expectedValue ? '✅ PASS' : '❌ FAIL'}`);
    
    // Try to simulate the transaction to get revert reason
    console.log('\n🔄 Simulating transaction to get revert reason...');
    try {
      await provider.call({
        to: tx.to!,
        data: tx.data,
        value: tx.value,
        from: tx.from
      });
      console.log('✅ Simulation succeeded (unexpected)');
    } catch (error: any) {
      console.log('❌ Simulation failed with error:');
      console.log('Error message:', error.message);
      console.log('Error code:', error.code);
      console.log('Error data:', error.data);
      
      // Try to decode revert reason
      if (error.data) {
        try {
          const revertReason = ethers.toUtf8String('0x' + error.data.substr(138));
          console.log('Decoded revert reason:', revertReason);
        } catch (decodeError) {
          console.log('Could not decode revert reason');
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error debugging transaction:', error);
  }
}

debugTransactionRevert().catch(console.error);
