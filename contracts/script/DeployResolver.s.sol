// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "forge-std/Script.sol";
import {Resolver} from "../src/Resolver.sol";
import {IEscrowFactory} from "../lib/cross-chain-swap/contracts/interfaces/IEscrowFactory.sol";
import {IOrderMixin} from "../lib/cross-chain-swap/lib/limit-order-protocol/contracts/interfaces/IOrderMixin.sol";

contract DeployResolver is Script {
    function run() external {
        address factory = vm.envAddress("SEPOLIA_FACTORY");
        address lop = vm.envAddress("SEPOLIA_LOP");
        address owner = vm.envAddress("SEPOLIA_OWNER");

        vm.startBroadcast();
        Resolver resolver = new Resolver(IEscrowFactory(factory), IOrderMixin(lop), owner);
        vm.stopBroadcast();

        console2.log("Resolver deployed at:", address(resolver));
        console2.log("Factory:", factory);
        console2.log("LOP:", lop);
        console2.log("Owner:", owner);
    }
}
