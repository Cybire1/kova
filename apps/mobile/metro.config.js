// The app installs with npm on its own, outside the pnpm workspace, and reaches
// @kova/monad through a `file:` symlink. Metro needs to watch the repo root so it can follow
// that link, and must keep normal node_modules lookup so npm's nested packages resolve.
const { getDefaultConfig } = require('expo/metro-config')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)
config.watchFolders = [workspaceRoot]

// @kova/monad imports viem. Resolve them from the app, not from the package's own
// pnpm copy, so the bundle carries one viem and values cross the boundary cleanly.
const shared = ['viem', 'ox']
const appPackage = path.join(projectRoot, 'package.json')

// @kova/monad is bundled from its TypeScript source, not its built dist/: a clean checkout (an EAS
// build) has no dist/, and the app should never run against a stale one. Its sources import
// siblings as './x.js' (Node ESM style), which Metro resolves to the './x.ts' next to them.
const monadSource = path.join(workspaceRoot, 'packages/monad/src')

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Privy's Expo SDK needs the browser build of jose, and these packages' legacy RN entries.
  if (moduleName === 'jose')
    return context.resolveRequest({ ...context, unstable_conditionNames: ['browser'] }, moduleName, platform)
  if (moduleName === 'isows' || moduleName.startsWith('zustand'))
    return context.resolveRequest({ ...context, unstable_enablePackageExports: false }, moduleName, platform)
  if (moduleName === '@kova/monad') return { type: 'sourceFile', filePath: path.join(monadSource, 'index.ts') }
  if (context.originModulePath.startsWith(monadSource) && moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const ts = path.resolve(path.dirname(context.originModulePath), moduleName.replace(/\.js$/, '.ts'))
    if (fs.existsSync(ts)) return { type: 'sourceFile', filePath: ts }
  }
  const root = moduleName.split('/')[0]
  if (shared.includes(root) || context.originModulePath.startsWith(monadSource))
    return context.resolveRequest({ ...context, originModulePath: appPackage }, moduleName, platform)
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
