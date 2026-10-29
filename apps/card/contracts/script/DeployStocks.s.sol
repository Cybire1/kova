// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {KovaStocks, IAuthorizedDollar} from "../src/KovaStocks.sol";

/// Buying and selling stock tokens on Monad mainnet: AUSD in and out through KyberSwap's router.
/// RELAYER is Kova's relayer, the one account that carries trades out. AUSD and ROUTER default to
/// Monad mainnet's.
///
///   RELAYER=0x67d185427d896aaf1d8781E094f1Bad16f7fa967 \
///   forge script script/DeployStocks.s.sol --rpc-url https://rpc.monad.xyz --private-key $KEY --broadcast
contract DeployStocks is Script {
    function run() external {
        address ausd = vm.envOr("AUSD", address(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a));
        address router = vm.envOr("ROUTER", address(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5));
        address relayer = vm.envAddress("RELAYER");
        vm.startBroadcast();
        KovaStocks stocks = new KovaStocks(IAuthorizedDollar(ausd), router, relayer);
        vm.stopBroadcast();
        console2.log("KOVA_STOCKS_CONTRACT", address(stocks));
    }
}
