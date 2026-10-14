// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {KovaSaver, ISavingsVault} from "../src/KovaSaver.sol";
import {KovaTestVault, IERC20Min} from "../src/KovaTestVault.sol";

/// Savings on Monad testnet: a labelled test vault for test AUSD and the KovaSaver in front of it.
/// On mainnet only KovaSaver is deployed, in front of a real ERC-4626 vault for AUSD (SAVINGS_VAULT).
///
///   AUSD=0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC forge script script/DeploySavings.s.sol \
///     --rpc-url monad_testnet --private-key $KEY --broadcast
contract DeploySavings is Script {
    function run() external {
        address existing = vm.envOr("SAVINGS_VAULT", address(0));
        vm.startBroadcast();
        address vault = existing;
        if (vault == address(0)) {
            require(block.chainid == 10143, "a test vault is for Monad testnet only");
            vault = address(new KovaTestVault(IERC20Min(vm.envAddress("AUSD"))));
        }
        KovaSaver saver = new KovaSaver(ISavingsVault(vault));
        vm.stopBroadcast();
        console2.log("KOVA_SAVINGS_VAULT", vault);
        console2.log("KOVA_SAVER", address(saver));
    }
}
