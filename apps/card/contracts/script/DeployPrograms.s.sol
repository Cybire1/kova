// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {KovaSplits, ISplitDollar} from "../src/KovaSplits.sol";
import {KovaRepeat, IRepeatDollar} from "../src/KovaRepeat.sol";

/// Programmable payments: splits for shops (KovaSplits, which makes each shop's KovaSplitter) and
/// repeat payments (KovaRepeat), both for AUSD. Neither has an owner or any admin key.
///
///   AUSD=0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a forge script script/DeployPrograms.s.sol \
///     --rpc-url <monad rpc> --account kova-deployer --broadcast
contract DeployPrograms is Script {
    function run() external {
        address ausd = vm.envAddress("AUSD");
        vm.startBroadcast();
        KovaSplits splits = new KovaSplits(ISplitDollar(ausd));
        KovaRepeat repeat = new KovaRepeat(IRepeatDollar(ausd));
        vm.stopBroadcast();
        console2.log("KOVA_SPLITS", address(splits));
        console2.log("KOVA_REPEAT", address(repeat));
    }
}
