// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import {MillionBaseToken} from "src/MillionBaseToken.sol";

/// @notice Forge script for deploying MillionBaseToken to any network
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.rememberKey(deployerKey);

        vm.startBroadcast(deployerKey);
        MillionBaseToken token = new MillionBaseToken();
        vm.stopBroadcast();

        console2.log("MillionBaseToken deployed to:", address(token));
    }
} 