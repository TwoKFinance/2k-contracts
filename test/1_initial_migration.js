const { deployProxy } = require('@openzeppelin/truffle-upgrades')
const LockLiquidity = artifacts.require('LockLiquidity')
const TWOK = artifacts.require('TWOK')
const BigNumber = require('bignumber.js')

module.exports = async (deployer, network, accs) => {
  console.log('ACCS', accs)
  TWOK
  const twok = await deployProxy(TWOK, [accs[0]], { deployer, initializer: 'initialize' })
  console.log('twok is', twok.address)

  // LockLiquidity
  const lockLiquidity = await deployProxy(LockLiquidity, [
    accs[0],
    twok.address,
  ], { deployer, initializer: 'initialize' })
  console.log('LockLiquidity is', lockLiquidity.address)

  // Config
  await twok.setLockLiquidityContract(lockLiquidity.address)
}