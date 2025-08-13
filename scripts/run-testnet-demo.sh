#!/bin/bash

# Cross-Chain Resolver Testnet Demo Script
# This script orchestrates the complete testnet deployment and demo

set -e  # Exit on any error

echo "🚀 Cross-Chain Resolver Testnet Demo"
echo "===================================="

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    exit 1
fi

# Check TypeScript
if ! command -v ts-node &> /dev/null; then
    echo "❌ ts-node is not installed. Installing..."
    npm install -g ts-node
fi

# Check if in scripts directory
if [ ! -f "package.json" ]; then
    echo "📁 Changing to scripts directory..."
    cd scripts
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Check environment variables
if [ -z "$PRIVATE_KEY" ]; then
    echo "⚠️  PRIVATE_KEY not set in environment, using default from .env"
    if [ -f ".env" ]; then
        export $(cat .env | xargs)
    else
        echo "❌ No .env file found and PRIVATE_KEY not set"
        exit 1
    fi
fi

# Build contracts first
echo "🔨 Building Solidity contracts..."
cd ../contracts
forge build
cd ../scripts

# Check if NEAR CLI is available for NEAR deployment
if command -v near &> /dev/null; then
    echo "✅ NEAR CLI found - full demo available"
    NEAR_AVAILABLE=true
else
    echo "⚠️  NEAR CLI not found - Ethereum-only demo"
    echo "   Install with: npm install -g near-cli"
    NEAR_AVAILABLE=false
fi

# Run the demo
echo ""
echo "🎬 Starting testnet deployment and demo..."
echo ""

if [ "$NEAR_AVAILABLE" = true ]; then
    echo "Running full cross-chain demo..."
    ts-node src/demo-testnet.ts
else
    echo "Running Ethereum deployment only..."
    ts-node src/deploy-testnet.ts
fi

echo ""
echo "🎉 Demo completed!"
echo ""
echo "📋 Next steps:"
echo "1. Check the generated reports in the scripts directory"
echo "2. Verify contracts on block explorers"
echo "3. Test cross-chain swaps manually if needed"
echo "4. Prepare for hackathon presentation"
echo ""
echo "📁 Generated files:"
echo "- testnet-config.json (updated with deployed addresses)"
echo "- deployment-report.json (Ethereum deployment details)"
echo "- final-demo-report.json (complete demo summary)"
echo ""

if [ "$NEAR_AVAILABLE" = true ]; then
    echo "- near-deployment-report.json (NEAR deployment details)"
    echo "- relayer-config.json (cross-chain configuration)"
    echo "- demo-config.json (demo scenarios)"
fi

echo ""
echo "🔗 Useful commands:"
echo "- View Ethereum contracts: cat deployment-report.json | jq '.explorerLinks'"
echo "- View NEAR contracts: cat near-deployment-report.json | jq '.explorerLinks'"
echo "- Check test wallet balances: cat testnet-config.json | jq '.testWallets'"
echo ""
