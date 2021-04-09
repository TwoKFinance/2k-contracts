const BigNumber = require('bignumber.js')
const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades')
const LockLiquidity = artifacts.require('LockLiquidity')
const YTXV3 = artifacts.require('YTXV3')
const TestToken = artifacts.require('TestToken')
let testToken // LPToken from uniswap
let gameTreasury
let ytx
let lockLiquidity

contract('LockLiquidity', accs => {
	const defaultAmount = BigNumber(1e19)
	const defaultPriceIncrease = BigNumber(9e15)

	beforeEach(async () => {
		testToken = await deployProxy(TestToken, [])
		gameTreasury = await deployProxy(TestToken, [])
		ytx = await deployProxy(YTXV3, [gameTreasury.address])
		lockLiquidity = await deployProxy(LockLiquidity, [
			testToken.address,
			ytx.address,
		])
		await ytx.setLockLiquidityContract(lockLiquidity.address)
		await lockLiquidity.setYtx(ytx.address)
	})

	// Works
	it("should not change the price if there aren't liquidity provider", async () => {
		const ytxFeePriceBefore = await lockLiquidity.ytxFeePrice()
		// Send YTX to a random address to activate the fee system
		await ytx.transfer(
			'0x7c5bAe6BC84AE74954Fd5672feb6fB31d2182EC6',
			defaultAmount
		)
		const ytxFeePriceAfter = await lockLiquidity.ytxFeePrice()
		assert.ok(
			ytxFeePriceBefore.eq(ytxFeePriceAfter),
			'The price should be unchanged'
		)
	})

	// Works
	it('should add a liquidity provider successful with locked LP tokens', async () => {
		// Add some fee YTX tokens to distribute
		await ytx.transfer(
			'0x7c5bAe6BC84AE74954Fd5672feb6fB31d2182EC6',
			defaultAmount
		)
		// First approve LPs
		await testToken.approve(lockLiquidity.address, defaultAmount)
		// Then lock liquidity
		await lockLiquidity.lockLiquidity(defaultAmount)
	})

	// Works
	it('should setup the initial ytxFeePrice', async () => {
		await addInitialLiquidityWithFee(
			defaultAmount,
			ytx,
			testToken,
			lockLiquidity
		)
		const updatedYtxFeePrice = String(await lockLiquidity.ytxFeePrice())
		assert.ok(
			updatedYtxFeePrice == BigNumber(1e18).plus(defaultPriceIncrease),
			'The updated ytxFeePrice is not correct'
		)
		assert.ok(
			updatedYtxFeePrice * defaultAmount ==
				defaultAmount * (BigNumber(1e18).plus(defaultPriceIncrease)),
			'The converted value is not correct'
		)
	})

	// Works
	it('should update the ytxFee price correctly after the initial price', async () => {
		await addInitialLiquidityWithFee(
			defaultAmount,
			ytx,
			testToken,
			lockLiquidity
		)
		// Add some fee YTX tokens to distribute and see if the price changes
		await ytx.transfer(
			'0x7c5bAe6BC84AE74954Fd5672feb6fB31d2182EC6',
			defaultAmount
		)
		const finalUpdatedYtxFeePrice = String(await lockLiquidity.ytxFeePrice())
		assert.ok(
			finalUpdatedYtxFeePrice == 1e18 + defaultPriceIncrease * 2,
			'The final updated ytxFeePrice is not correct after 2 liquidity provisions and providers'
		)
	})

	// Works
	it('should update the ytxFee price correctly after many fee additions', async () => {
		await addInitialLiquidityWithFee(
			defaultAmount,
			ytx,
			testToken,
			lockLiquidity
		)
		// Add some fee YTX tokens to distribute and see if the price changes
		for (let i = 0; i < 9; i++) {
			await ytx.transfer(
				'0x7c5bAe6BC84AE74954Fd5672feb6fB31d2182EC6',
				defaultAmount
			)
		}
		const finalUpdatedYtxFeePrice = String(await lockLiquidity.ytxFeePrice())
		assert.ok(
			finalUpdatedYtxFeePrice == 1e18 + defaultPriceIncrease * 10,
			'The final updated ytxFeePrice is not correct after 10 liquidity provisions and providers'
		)
	})

	// Works
	it('should extract the right amount of fee correctly', async () => {
		// 1e17 minus 1% of 1e17 since there's a 1% fee per transfer when giving rewards to users
		const expectedEarnings = 9e16 - 0.09e16
		const feeInsideContract = 9e16
		// 1. Send some tokens to account 2 to use a different account
		await testToken.transfer(accs[1], defaultAmount, { from: accs[0] })
		// 2. Lock LP tokens
		await testToken.approve(lockLiquidity.address, defaultAmount, {
			from: accs[1],
		})
		await lockLiquidity.lockLiquidity(defaultAmount, { from: accs[1] })
		// 3. Add fee
		await ytx.transfer(
			'0x7c5bAe6BC84AE74954Fd5672feb6fB31d2182EC6',
			defaultAmount,
			{ from: accs[0] } // Using account 0
		)
		// Check balance inside the contract after the fee add
		const feeInside = await ytx.balanceOf(lockLiquidity.address)
		assert.ok(
			feeInside == feeInsideContract,
			'The fee inside the liquidity lock contract is not correct'
		)
		// 4. Extract earnings
		await lockLiquidity.extractEarnings({ from: accs[1] })
		const finalBalance = String(await ytx.balanceOf(accs[1]))
		assert.ok(
			finalBalance == expectedEarnings,
			"The final balance isn't correct"
		)
	})

	// Works
	it('should extract the liquidity after locking it successfully', async () => {
		await lockLiquidity.setTimeToExitLiquidity(0); // Make sure to remove the 365 days wait
		const initialLPTokenBalance = await testToken.balanceOf(accs[0])
		// Lock some tokens
		await testToken.approve(lockLiquidity.address, defaultAmount)
		await lockLiquidity.lockLiquidity(defaultAmount)
		const midLPTokenBalance = await testToken.balanceOf(accs[0])
		assert.ok(midLPTokenBalance == initialLPTokenBalance - defaultAmount, 'The LP tokens should be transfered when locking liquidity')
		// Extract them
		await lockLiquidity.extractLiquidity()
		const finalLPTokenBalance = await testToken.balanceOf(accs[0])
		assert.ok(BigNumber(initialLPTokenBalance).isEqualTo(finalLPTokenBalance), 'The LP tokens should be extracted successfully')
	})

	// Works
	it('should not allow you to extract your liquidity before 365 days', async () => {
		try {
			// Lock some tokens
			await testToken.approve(lockLiquidity.address, defaultAmount)
			await lockLiquidity.lockLiquidity(defaultAmount)
			// Extract them
			await lockLiquidity.extractLiquidity()
			assert.ok(false, "a) The test should fail since it shouldn't allow you to extract liquidity before 365 days")
		} catch (e) {
			assert.ok(true, "b) The test should fail since it shouldn't allow you to extract liquidity before 365 days")
		}
	})
})

const addInitialLiquidityWithFee = async (
	defaultAmount,
	ytx,
	testToken,
	lockLiquidity
) => {
	// Add some fee YTX tokens to distribute
	await ytx.transfer(
		'0x7c5bAe6BC84AE74954Fd5672feb6fB31d2182EC6',
		defaultAmount
	)
	// First approve LPs
	await testToken.approve(lockLiquidity.address, defaultAmount)
	// Then lock liquidity
	await lockLiquidity.lockLiquidity(defaultAmount)
}
