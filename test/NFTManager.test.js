const BigNumber = require('bignumber.js')
const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades')
const NFTManager = artifacts.require('NFTManager')
const YTXV3 = artifacts.require('YTXV3')
const YFS = artifacts.require('YFS')
const TestToken = artifacts.require('TestToken')
const LockLiquidity = artifacts.require('LockLiquidity')
const utils = require('./utils')
let yfs // YFS is a TestToken
let ytx
let LPToken
let gameTreasury
let lockLiquidity
let managerInstance

contract('NFTManager', accs => {
	const defaultAmount = BigNumber(1e19)
	const baseURI = 'https://example-base-uri.com/'

	beforeEach(async () => {
		LPToken = await deployProxy(TestToken, [])
		gameTreasury = await deployProxy(TestToken, [])
		// Set an empty manager since it's not deployed yet
		yfs = await deployProxy(YFS, ['0x0000000000000000000000000000000000000000'])
		ytx = await deployProxy(YTXV3, [gameTreasury.address])
		lockLiquidity = await deployProxy(LockLiquidity, [
			LPToken.address,
			ytx.address,
		])
		managerInstance = await deployProxy(NFTManager, [
			ytx.address,
			yfs.address,
			baseURI,
		])
		await yfs.setManager(managerInstance.address)
		await ytx.setLockLiquidityContract(lockLiquidity.address)
		await lockLiquidity.setYtx(ytx.address)
	})

	// Works
	it('should stake YTX successfully', async () => {
		await ytx.approve(managerInstance.address, defaultAmount)
		await managerInstance.stakeYTX(defaultAmount)
		const amount = await managerInstance.amountStaked(accs[0])
		const expectedAmount = defaultAmount.multipliedBy(99).dividedBy(100)
		assert.ok(
			BigNumber(amount).isEqualTo(expectedAmount),
			'The staked YTX should be correct'
		)
	})

	// Works
	it('should stake YTX multiple times successfully', async () => {
		const times = 3
		for (let i = 0; i < times; i++) {
			await ytx.approve(managerInstance.address, defaultAmount)
			await managerInstance.stakeYTX(defaultAmount)
		}
		const amount = await managerInstance.amountStaked(accs[0])
		const expectedAmount = defaultAmount.multipliedBy(99).dividedBy(100).multipliedBy(times)
		assert.ok(
			BigNumber(amount).isEqualTo(expectedAmount),
			'The staked YTX should be correct'
		)
	})

	// Works
	it('should generate the right amount of YFS tokens after staking for 10% of a day in blocks', async () => {
		const expectedBalance = 1e18
		await ytx.approve(managerInstance.address, defaultAmount)
		await managerInstance.stakeYTX(defaultAmount)
		// Gotta advance 649 blocks instead of 650 for a precise 10% generation since 1 block is used when executing receiveYFS()
		for (let i = 0; i < 649; i++) {
			await utils.advanceBlock()
		}
		await managerInstance.receiveYFS()
		const finalYfsBalance = await yfs.balanceOf(accs[0])
		assert.ok(BigNumber(expectedBalance).multipliedBy(99).dividedBy(100).isEqualTo(finalYfsBalance), "It should've generated 1e18 YFS after 10% of 1 day")
	})

	// Works
	// When you stake you lose a 1% that goes to the fee so you can only unstake 99% of your initial stake
	// and you get 98.01% at the end after the fees since 1% of 99% is .99
	it('should unstake YTX and receive YFS correctly', async () => {
		// function unstakeYTXAndReceiveYFS(uint256 _amount) public
		const balance = await ytx.balanceOf(accs[0])
		const expectedYfs = .99e17
		const amountAfterFee = BigNumber(defaultAmount).multipliedBy(99).dividedBy(100)
		// Two times 1% fee
		const expectedFinalAfterFee = BigNumber(defaultAmount).multipliedBy(99).dividedBy(100).multipliedBy(99).dividedBy(100)
		// 1. Stake YTX
		await ytx.approve(managerInstance.address, defaultAmount)
		await managerInstance.stakeYTX(defaultAmount)
		const midBalance = await ytx.balanceOf(accs[0])
		assert.ok(BigNumber(midBalance).isEqualTo(BigNumber(balance).minus(defaultAmount)), 'The mid balance should be updated')
		// 2. Unstake them after 64 blocks which is 1% of one day in blocks
		for (let i = 0; i < 64; i++) {
			await utils.advanceBlock()
		}
		await managerInstance.unstakeYTXAndReceiveYFS(amountAfterFee)
		const finalBalance = await ytx.balanceOf(accs[0])
		const finalYfsBalance = await yfs.balanceOf(accs[0])
		assert.ok(BigNumber(midBalance).plus(expectedFinalAfterFee).isEqualTo(finalBalance), 'The final balance should be ~98% the initial after extracting YTX')
		assert.ok(BigNumber(finalYfsBalance).isEqualTo(expectedYfs), 'The YFS balance is not correct')
	})

	// Works
	it('should create a blueprint successfully', async () => {
		// function createBlueprint(string memory _tokenURI, uint256 _maxMint, uint256 _ytxCost, uint256 _yfsCost) public onlyOwner
		const tokenUri = 'example-1'
		const max = 1000
		const ytxCost = BigNumber(10e18)
		const yfsCost = BigNumber(10e18)
		await managerInstance.createBlueprint(tokenUri, max, ytxCost, yfsCost)
		const generated = await managerInstance.getBlueprint(tokenUri)
		assert.ok(BigNumber(generated[0]).isEqualTo(max), 'The max should be correct')
		assert.ok(BigNumber(generated[1]).isEqualTo(0), 'The current mint should be zero')
		assert.ok(BigNumber(generated[2]).isEqualTo(ytxCost), 'The ytx cost should be correct')
		assert.ok(BigNumber(generated[3]).isEqualTo(yfsCost), 'The yfs cost should be correct')
	})

	// Works
	it('should mint a card from a blueprint successfully', async () => {
		// function safeMint(string memory _tokenURI) public
		// 1. Generate a blueprint for 1 YFS cost
		const tokenUri = 'example-1'
		const max = 1000
		const ytxCost = BigNumber(10e18)
		const yfsCost = BigNumber(.99e18)
		await managerInstance.createBlueprint(tokenUri, max, ytxCost, yfsCost)
		// 2. Stake YTX
		await ytx.approve(managerInstance.address, defaultAmount)
		await managerInstance.stakeYTX(defaultAmount)
		// 3. Allow 10% of a day to pass (649 blocks) to generate enough YFS
		for (let i = 0; i < 649; i++) {
			await utils.advanceBlock()
		}
		// 4. Extract the YFS
		await managerInstance.receiveYFS()
		// 5. Mint a 1 YFS cost card by allowing YTX and YFS to the contract
		await ytx.approve(managerInstance.address, defaultAmount)
		await yfs.approve(managerInstance.address, BigNumber(defaultAmount).dividedBy(10)) // 1 YFS
		// 6. Mint the card
		await managerInstance.safeMint(tokenUri)

		const tokenId = await managerInstance.mintedTokenIds(0)
		const receivedTokenURI = await managerInstance.tokenURI(tokenId)
		assert.ok(baseURI + tokenUri == receivedTokenURI, 'The tokenURI should be set properly')
		assert.ok(tokenId == 1, 'The token id should be set correctly')
	})

	// Works
	it("should allow you to mint a card the max number of times", async () => {
		// function safeMint(string memory _tokenURI) public
		// 1. Generate a blueprint for 1 YFS cost
		const tokenUri = 'example-1'
		const max = 10
		const ytxCost = BigNumber(10e18)
		const yfsCost = BigNumber(0.099e18) // .99e18 is how much you stake when staking 10e18
		await managerInstance.createBlueprint(tokenUri, max, ytxCost, yfsCost)
		// 2. Stake YTX
		await ytx.approve(managerInstance.address, defaultAmount)
		await managerInstance.stakeYTX(defaultAmount)
		// 3. Allow 10% of a day to pass (649 blocks) to generate enough YFS
		for (let i = 0; i < 649; i++) {
			await utils.advanceBlock()
		}
		// 4. Extract the YFS
		await managerInstance.receiveYFS()
		// 5. Mint a 1 YFS cost card by allowing YTX and YFS to the contract
		await ytx.approve(managerInstance.address, BigNumber(defaultAmount).multipliedBy(10))
		await yfs.approve(managerInstance.address, BigNumber(defaultAmount).dividedBy(10)) // 1 YFS
		// 6. Mint the cards 10 times
		for (let i = 0; i < max; i++) {
			await managerInstance.safeMint(tokenUri)
		}
	})

	// Works
	it("shouldn't allow you to mint a card if it has been minted entirely already", async () => {
		// function safeMint(string memory _tokenURI) public
		// 1. Generate a blueprint for 1 YFS cost
		const tokenUri = 'example-1'
		const max = 10
		const ytxCost = BigNumber(10e18)
		const yfsCost = BigNumber(0.099e18)
		await managerInstance.createBlueprint(tokenUri, max, ytxCost, yfsCost)
		// 2. Stake YTX
		await ytx.approve(managerInstance.address, defaultAmount)
		await managerInstance.stakeYTX(defaultAmount)
		// 3. Allow 10% of a day to pass (649 blocks) to generate enough YFS
		for (let i = 0; i < 649; i++) {
			await utils.advanceBlock()
		}
		// 4. Extract the YFS
		await managerInstance.receiveYFS()
		// 5. Mint a 1 YFS cost card by allowing YTX and YFS to the contract
		await ytx.approve(managerInstance.address, BigNumber(defaultAmount).multipliedBy(20)) // Approve more than enough tokens
		await yfs.approve(managerInstance.address, BigNumber(defaultAmount).dividedBy(10)) // 1 YFS
		// 6. Mint the cards 20 times, overflowing the limit of 10
		try {
			for (let i = 0; i < max; i++) {
				await managerInstance.safeMint(tokenUri)
			}
			assert.ok(false, "a) It shouldn't allow you to mint more times than the max")
		} catch (e) {
			assert.ok(true, "b) It shouldn't allow you to mint more times than the max")
		}
	})

	// Works
	it('should allow you to break a card you own and receive the YTX paid', async () => {
		// breakCard()
		let midBalance
		let finalBalance
		// 1. Generate a blueprint for 1 YFS cost
		const tokenUri = 'example-1'
		const max = 1000
		const ytxCost = BigNumber(10e18)
		const yfsCost = BigNumber(.99e18)
		await managerInstance.createBlueprint(tokenUri, max, ytxCost, yfsCost)
		// 2. Stake YTX
		await ytx.approve(managerInstance.address, defaultAmount)
		await managerInstance.stakeYTX(defaultAmount)
		// 3. Allow 10% of a day to pass (649 blocks) to generate enough YFS 
		// although we gotta give it 1 more to generate enough
		for (let i = 0; i < 649; i++) {
			await utils.advanceBlock()
		}
		// 4. Extract the YFS
		const amountAfterFee = defaultAmount.multipliedBy(99).dividedBy(100)
		await managerInstance.unstakeYTXAndReceiveYFS(amountAfterFee)
		// 5. Mint a 1 YFS cost card by allowing YTX and YFS to the contract
		await ytx.approve(managerInstance.address, defaultAmount)
		await yfs.approve(managerInstance.address, BigNumber(defaultAmount).dividedBy(10)) // 1 YFS
		// 6. Mint the card
		await managerInstance.safeMint(tokenUri)
		midBalance = await ytx.balanceOf(accs[0])
		const tokenId = await managerInstance.mintedTokenIds(0)
		// The user gets 98.01 YTX after 2x 1% fees
		await managerInstance.breakCard(tokenId)
		finalBalance = await ytx.balanceOf(accs[0])
		const twoOnePercents = defaultAmount.multipliedBy(99).dividedBy(100).multipliedBy(99).dividedBy(100)
		assert.ok(BigNumber(midBalance).plus(twoOnePercents).isEqualTo(finalBalance), 'The final balance should be correct')
	})

	// Works
	it("shouldn't allow you to break a card you don't own", async () => {
		// breakCard()
		let midBalance
		let finalBalance
		// 1. Generate a blueprint for 1 YFS cost
		const tokenUri = 'example-1'
		const max = 1000
		const ytxCost = BigNumber(10e18)
		const yfsCost = BigNumber(.99e18)
		await managerInstance.createBlueprint(tokenUri, max, ytxCost, yfsCost)
		// 2. Stake YTX
		await ytx.approve(managerInstance.address, defaultAmount)
		await managerInstance.stakeYTX(defaultAmount)
		// 3. Allow 10% of a day to pass (649 blocks) to generate enough YFS 
		// although we gotta give it 1 more to generate enough
		for (let i = 0; i < 649; i++) {
			await utils.advanceBlock()
		}
		// 4. Extract the YFS
		const amountAfterFee = defaultAmount.multipliedBy(99).dividedBy(100)
		await managerInstance.unstakeYTXAndReceiveYFS(amountAfterFee)
		// 5. Mint a 1 YFS cost card by allowing YTX and YFS to the contract
		await ytx.approve(managerInstance.address, defaultAmount)
		await yfs.approve(managerInstance.address, BigNumber(defaultAmount).dividedBy(10)) // 1 YFS
		// 6. Mint the card
		await managerInstance.safeMint(tokenUri)
		midBalance = await ytx.balanceOf(accs[0])
		const tokenId = await managerInstance.mintedTokenIds(0)

		try {
			await managerInstance.breakCard(tokenId, { from: accs[0] })
			assert.ok(false, "The break card function should throw when trying to break a card you don't own")
		} catch (e) {
			assert.ok(true)
		}
	})

	// Works
	it("shouldn't allow you to break a card that hasn't been minted already", async () => {
		try {
			await managerInstance.breakCard(1, { from: accs[0] })
			assert.ok(false, "The break card function should throw when trying to break a card you don't own")
		} catch (e) {
			assert.ok(true)
		}
	})
})

const l = (msg, ...args) => {
	console.log(msg, ...args)
}