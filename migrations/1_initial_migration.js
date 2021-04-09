const { deployProxy } = require('@openzeppelin/truffle-upgrades')
const LockLiquidity = artifacts.require('LockLiquidity')
const TWOK = artifacts.require('TWOK')
const Vault = artifacts.require('Vault')
const BigNumber = require('bignumber.js')

module.exports = async (deployer, network, accs) => {
//   console.log('ACCS', accs)
//   TWOK
//   const twok = await deployProxy(TWOK, [accs[0]], { deployer, initializer: 'initialize' })
//   console.log('twok is', twok.address)

//   LockLiquidity
//   const lockLiquidity = await deployProxy(LockLiquidity, [
//     accs[0],
//     "0xae1e69BBd3DC0c470ce4Ba28794753cdfdeC7452",
//   ], { deployer, initializer: 'initialize' })
//   console.log('LockLiquidity is', lockLiquidity.address)

  // LockLiquidity
  const vault = await deployProxy(Vault, [
    "0xa08012c42afbc07f043308c08be8e51626aa1687",
    "0xae1e69bbd3dc0c470ce4ba28794753cdfdec7452",
    "0x0Ff81c7de6eF077e7f7c7d266C159437985A6faB",
  ], { deployer, initializer: 'initialize' })
  console.log('Vault is', vault.address)

  // Config
//   await twok.setLockLiquidityContract(lockLiquidity.address)
}