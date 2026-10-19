// Polyfills first: viem's crypto reads globalThis.crypto when it loads, and expo-router loads
// route modules before the root layout runs.
import 'fast-text-encoding'
import 'react-native-get-random-values'
import '@ethersproject/shims'
import 'expo-router/entry'
