#!/bin/bash

# Update Solidity version in all .sol files to 0.8.23
find . -name "*.sol" -type f -exec sed -i '' -E 's/pragma solidity [0-9]+\.[0-9]+\.[0-9]+;/pragma solidity 0.8.23;/g' {} \;

echo "Updated Solidity version to 0.8.23 in all .sol files"
