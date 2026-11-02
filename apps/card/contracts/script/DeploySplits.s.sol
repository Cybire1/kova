// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {KovaSplits, ISplitDollar} from "../src/KovaSplits.sol";

/// Splits on their own: KovaSplits (which makes each shop's KovaSplitter) for AUSD, with no owner
/// or admin key. For a new version of the splitter without redeploying KovaRepeat.
///
///   AUSD=0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a forge script script/DeploySplits.s.sol \
///     --rpc-url https://rpc.monad.xyz --account kova-deployer --broadcast
contract DeploySplits is Script {
    function run() external {
        address ausd = vm.envAddress("AUSD");
        vm.startBroadcast();
        KovaSplits splits = new KovaSplits(ISplitDollar(ausd));
        vm.stopBroadcast();
        console2.log("KOVA_SPLITS", address(splits));
        console2.log("implementation", splits.implementation());
    }
}
