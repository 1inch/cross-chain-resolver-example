// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "forge-std/Script.sol";
import {LimitOrderProtocol} from "limit-order-protocol/contracts/LimitOrderProtocol.sol";
import {IWETH} from "solidity-utils/contracts/interfaces/IWETH.sol";

contract DeployLimitOrderProtocol is Script {
    function run() external {
        address weth = vm.envAddress("SEPOLIA_WETH");
        vm.startBroadcast();
        LimitOrderProtocol lop = new LimitOrderProtocol(IWETH(weth));
        vm.stopBroadcast();
        console2.log("LimitOrderProtocol deployed at:", address(lop));
        console2.log("WETH:", weth);
    }
}
