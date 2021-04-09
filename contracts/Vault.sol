pragma solidity =0.6.2;

import '@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol';
import '@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts-ethereum-package/contracts/Initializable.sol';
import '@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol';

// People lock their `lockToken` and get rewarded `rewardToken`
// SETUP: First add the rewardToken into the contract, say 400 TWOK and then set the rewardPerBlock to decide how many are given in a day
/// @notice This contract allows you to lock lockToken tokens and receive earnings
/// It also allows you to extract those earnings
contract Vault is Initializable, OwnableUpgradeSafe {
    using SafeMath for uint256;

    // How many lockToken tokens each user has
    mapping (address => uint256) public amountLocked;
    // The price when you extracted your earnings so we can whether you got new earnings or not
    mapping (address => uint256) public lastPriceEarningsExtracted;
    // When the user started locking his lockToken tokens
    mapping (address => uint256) public depositStarts;
    mapping (address => uint256) public lockingTime;
    // The uniswap lockToken token contract
    address public lockToken;
    // The reward token that people receive based on the staking time
    address public rewardToken;
    // How many lockToken tokens are locked
    uint256 public totalLiquidityLocked;
    // The total lockTokenFee generated
    uint256 public totalLockTokenFeeMined;
    uint256 public lockTokenFeePrice;
    uint256 public accomulatedRewards;
    uint256 public pricePadding;
    address payable public devTreasury;
    uint256 public minTimeLock;
    uint256 public maxTimeLock;
    uint256 public minDevTreasuryPercentage;
    uint256 public maxDevTreasuryPercentage;
    // The last block number when fee was updated
    uint256 public lastBlockFee;
    uint256 public rewardPerBlock;

    // increase the lockTokenFeePrice
    receive() external payable {
        addFeeAndUpdatePrice(msg.value);
    }

    function initialize(address _lockToken, address _rewardToken, address payable _devTreasury) public initializer {
        __Ownable_init();
        lockToken = _lockToken;
        pricePadding = 1e18;
        devTreasury = _devTreasury;
        minTimeLock = 30 days;
        maxTimeLock = 365 days;
        minDevTreasuryPercentage = 50e18;
        maxDevTreasuryPercentage = 10e18;
        lastBlockFee = 0;
        rewardToken = _rewardToken;
        // The average block time is 3 seconds, therefore 1 day is 28800 blocks
        // 1e18 / 28800 is 1 twok per 28800 blocks (a day on average in BSC)
        rewardPerBlock = 35e12;
    }

    function setLockToken(address _lockToken) external onlyOwner {
        lockToken = _lockToken;
    }

    // Must be in 1e18 since it's using the pricePadding
    function setRewardPerBlock(uint256 _rewardPerBlock) external onlyOwner {
      rewardPerBlock = _rewardPerBlock;
    }

    function setDevTreasury(address payable _devTreasury) external onlyOwner {
        devTreasury = _devTreasury;
    }

    function setRewardToken(address _rewardToken) external onlyOwner {
        rewardToken = _rewardToken;
    }

    // Must be in seconds
    function setTimeLocks(uint256 _minTimeLock, uint256 _maxTimeLock) external onlyOwner {
        minTimeLock = _minTimeLock;
        maxTimeLock = _maxTimeLock;
    }

    function setDevPercentages(uint256 _minDevTreasuryPercentage, uint256 _maxDevTreasuryPercentage) external onlyOwner {
        require(minDevTreasuryPercentage > maxDevTreasuryPercentage, 'Vault: The min % must be larger');
        minDevTreasuryPercentage = _minDevTreasuryPercentage;
        maxDevTreasuryPercentage = _maxDevTreasuryPercentage;
    }

    /// @notice When ETH is added, the price is increased
    /// Price is = (feeIn / totalLockTokenFeeDistributed) + currentPrice
    /// padded with 18 zeroes that get removed after the calculations
    /// if there are no locked lockTokens, the price is 0
    function addFeeAndUpdatePrice(uint256 _feeIn) internal {
        accomulatedRewards = accomulatedRewards.add(_feeIn);
        if (totalLiquidityLocked == 0) {
          lockTokenFeePrice = 0;
        } else {
          lockTokenFeePrice = (_feeIn.mul(pricePadding).div(totalLiquidityLocked)).add(lockTokenFeePrice);
        }
    }

    /// @notice To calculate how much fee should be added based on time
    function updateFeeIn() internal {
        // setup the intial block instead of getting rewards right away
        if (lastBlockFee != 0) {
            // Use it
            uint256 blocksPassed = block.number - lastBlockFee;
            // We don't need to divide by the padding since we want the result padded since the TWOK token has 18 decimals
            uint256 feeIn = blocksPassed.mul(rewardPerBlock);
            if (feeIn > 0) addFeeAndUpdatePrice(feeIn);
            // Update it
        }
        lastBlockFee = block.number;
    }

    // The time lock is reset every new deposit
    function lockLiquidity(uint256 _amount, uint256 _timeLock) public {
        updateFeeIn();
        require(_amount > 0, 'Vault: Amount must be larger than zero');
        require(_timeLock >= minTimeLock && _timeLock <= maxTimeLock, 'Vault: You must setup a locking time between the ranges');
        // Transfer lockToken tokens inside here while earning fees from every transfer
        uint256 approval = IERC20(lockToken).allowance(msg.sender, address(this));
        require(approval >= _amount, 'Vault: You must approve the desired amount of lockToken tokens to this contract first');
        IERC20(lockToken).transferFrom(msg.sender, address(this), _amount);
        totalLiquidityLocked = totalLiquidityLocked.add(_amount);
        // Extract earnings in case the user is not a new Locked lockToken
        if (lastPriceEarningsExtracted[msg.sender] != 0 && lastPriceEarningsExtracted[msg.sender] != lockTokenFeePrice) {
            extractEarnings();
        }
        // Set the initial price
        if (lockTokenFeePrice == 0) {
            lockTokenFeePrice = accomulatedRewards.mul(pricePadding).div(_amount).add(1e18);
            lastPriceEarningsExtracted[msg.sender] = 1e18;
        } else {
            lastPriceEarningsExtracted[msg.sender] = lockTokenFeePrice;
        }
        // The price doesn't change when locking lockToken. It changes when fees are generated from transfers
        amountLocked[msg.sender] = amountLocked[msg.sender].add(_amount);
        // Notice that the locking time is reset when new lockToken is added
        depositStarts[msg.sender] = now;
        lockingTime[msg.sender] = _timeLock;
    }

    // We check for new earnings by seeing if the price the user last extracted his earnings
    // is the same or not to determine whether he can extract new earnings or not
    function extractEarnings() public {
      updateFeeIn();
      require(amountLocked[msg.sender] > 0, 'Vault: You must have locked lockToken provider tokens to extract your earnings');
      require(lockTokenFeePrice != lastPriceEarningsExtracted[msg.sender], 'Vault: You have already extracted your earnings');
      // The amountLocked price minus the last price extracted
      uint256 myPrice = lockTokenFeePrice.sub(lastPriceEarningsExtracted[msg.sender]);
      uint256 earnings = amountLocked[msg.sender].mul(myPrice).div(pricePadding);
      lastPriceEarningsExtracted[msg.sender] = lockTokenFeePrice;
      accomulatedRewards = accomulatedRewards.sub(earnings);
      uint256 devTreasuryPercentage = calcDevTreasuryPercentage(lockingTime[msg.sender]);
      uint256 devTreasuryEarnings = earnings.mul(devTreasuryPercentage).div(1e20);
      uint256 remaining = earnings.sub(devTreasuryEarnings);

      // Transfer the earnings
      IERC20(rewardToken).transfer(devTreasury, devTreasuryEarnings);
      IERC20(rewardToken).transfer(msg.sender, remaining);
    }

    // The user must lock the lockToken for 1 year and only then can extract his Locked lockToken tokens
    // he must extract all the lockTokens for simplicity and security purposes
    function extractLiquidity() public {
      updateFeeIn();
      require(amountLocked[msg.sender] > 0, 'Vault: You must have locked lockTokens to extract them');
      require(now.sub(depositStarts[msg.sender]) >= lockingTime[msg.sender], 'Vault: You must wait the specified locking time to extract your lockToken provider tokens');
      // Extract earnings in case there are some
      if (lastPriceEarningsExtracted[msg.sender] != 0 && lastPriceEarningsExtracted[msg.sender] != lockTokenFeePrice) {
          extractEarnings();
      }
      uint256 locked = amountLocked[msg.sender];
      amountLocked[msg.sender] = 0;
      depositStarts[msg.sender] = now;
      lastPriceEarningsExtracted[msg.sender] = 0;
      totalLiquidityLocked = totalLiquidityLocked.sub(locked);
      IERC20(lockToken).transfer(msg.sender, locked);
    }

    /// Returns the treasury percentage padded with 18 zeroes
    function calcDevTreasuryPercentage(uint256 _lockingTime) public view returns(uint256) {
        require(_lockingTime >= minTimeLock && _lockingTime <= maxTimeLock, 'Vault: You must setup a locking time between the ranges');
        if (_lockingTime == maxTimeLock) {
            return maxDevTreasuryPercentage;
        }
        if (_lockingTime == minTimeLock) {
            return minDevTreasuryPercentage;
        }
        uint256 padding = 1e18;
        uint256 combinedDays = maxTimeLock.sub(minTimeLock);
        uint256 combinedFee = minDevTreasuryPercentage.sub(maxDevTreasuryPercentage);
        // There's no risk of a ratio == 0 since we return the right percentage when lockTime == minLockTime
        uint256 ratio = (_lockingTime.sub(minTimeLock)).mul(padding).div(combinedDays);
        return minDevTreasuryPercentage.sub(ratio.mul(combinedFee).div(padding));
    }

    function getAmountLocked(address _user) external view returns(uint256) {
        return amountLocked[_user];
    }

    function extractTokensIfStuck(address _token, uint256 _amount) external onlyOwner {
        IERC20(_token).transfer(owner(), _amount);
    }

    function extractETHIfStruck() external onlyOwner {
        payable(address(owner())).transfer(address(this).balance);
    }
}