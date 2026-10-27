// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {KovaCashOut, IAuthorizedDollar, IPayoutToken} from "../src/KovaCashOut.sol";

/// Cashing out to naira on Monad mainnet: AUSD in, USDC out through KyberSwap's router, paid to the
/// cash-out partner's one-time address. RELAYER is Kova's relayer, the one account that carries
/// cash-outs out.
///
///   AUSD=0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a USDC=0x754704Bc059F8C67012fEd69BC8A327a5aafb603 \
///   ROUTER=0x6131B5fae19EA4f9D964eAc0408E4408b66337b5 RELAYER=0x67d185427d896aaf1d8781E094f1Bad16f7fa967 \
///   forge script script/DeployCashOut.s.sol --rpc-url monad --private-key $KEY --broadcast
contract DeployCashOut is Script {
    function run() external {
        vm.startBroadcast();
        KovaCashOut cashOut = new KovaCashOut(
            IAuthorizedDollar(vm.envAddress("AUSD")),
            IPayoutToken(vm.envAddress("USDC")),
            vm.envAddress("ROUTER"),
            vm.envAddress("RELAYER")
        );
        vm.stopBroadcast();
        console2.log("KOVA_CASH_OUT", address(cashOut));
    }
}
