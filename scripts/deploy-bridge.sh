#!/bin/bash

# Exit on error
set -e

# Load environment variables
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
else
    echo ".env file not found. Please create one based on .env.example"
    exit 1
fi

# Check if required environment variables are set
if [ -z "$SEPOLIA_RPC_URL" ] || [ -z "$PRIVATE_KEY" ] || [ -z "$FEE_COLLECTOR" ]; then
    echo "Required environment variables not set. Please check your .env file."
    exit 1
fi

# Create a temporary .env file for Foundry
cat > .env.deploy <<EOL
PRIVATE_KEY=$PRIVATE_KEY
FEE_COLLECTOR=$FEE_COLLECTOR
EOL

# Deploy the contract
echo "Deploying NearBridge to Sepolia..."
forge script script/DeployNearBridge.s.sol:DeployNearBridge \
    --rpc-url $SEPOLIA_RPC_URL \
    --broadcast \
    --verify \
    --verifier etherscan \
    --etherscan-api-key $ETHERSCAN_API_KEY \
    -vvvv \
    --slow

# Clean up
rm -f .env.deploy

echo "\nDeployment complete!"
echo "Please save the contract address and update your environment variables."
