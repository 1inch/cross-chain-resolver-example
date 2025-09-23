// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "forge-std/Script.sol";
import {EscrowFactory} from "../lib/cross-chain-swap/contracts/EscrowFactory.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

contract DeployEscrowFactory is Script {
    function run() external {
        address lop = vm.envAddress("SEPOLIA_LOP");
        address feeToken = vm.envAddress("SEPOLIA_FEE_TOKEN");
        address accessToken = vm.envAddress("SEPOLIA_ACCESS_TOKEN");
        address owner = vm.envAddress("SEPOLIA_OWNER");
        uint32 rescueDelaySrc = uint32(vm.envUint("SEPOLIA_RESCUE_DELAY_SRC"));
        uint32 rescueDelayDst = uint32(vm.envUint("SEPOLIA_RESCUE_DELAY_DST"));

        vm.startBroadcast();
        EscrowFactory factory = new EscrowFactory(
            lop,
            IERC20(feeToken),
            IERC20(accessToken),
            owner,
            rescueDelaySrc,
            rescueDelayDst
        );
        vm.stopBroadcast();

        console2.log("EscrowFactory deployed at:", address(factory));
        console2.log("LOP:", lop);
        console2.log("feeToken:", feeToken);
        console2.log("accessToken:", accessToken);
        console2.log("owner:", owner);
        console2.log("rescueDelaySrc:", rescueDelaySrc);
        console2.log("rescueDelayDst:", rescueDelayDst);
    }
}
