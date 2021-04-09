pragma solidity =0.6.2;

import '@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol';
import '@openzeppelin/contracts-ethereum-package/contracts/Initializable.sol';
import '@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol';
import './ERC20UpgradeSafe.sol';

interface ILockLiquidity {
    function addFeeAndUpdatePrice(uint256 _amount) external;
}

contract TWOK is Initializable, OwnableUpgradeSafe, ERC20UpgradeSafe {
    using SafeMath for uint256;

    mapping (address => bool) public isFrozen;
    uint256 public transferFee;
    address public lockLiquidityContract;
    address public devTreasury;
    uint256 public devTreasuryPercentage;

    event Fee(address sender, uint256 amount);
    
    function initialize(address _devTreasury) public initializer {
        __ERC20_init('TWOK', 'TWOK');
        __Ownable_init();
        // Decimals are set to 18 by default
        // Total supply is 2000 * 1e18; // 2k tokens
        _mint(msg.sender, 2000 * 1e18);
        transferFee = 1e16; // 1% out of 100% which is 1e16 out of 1e18
        devTreasury = _devTreasury;
        devTreasuryPercentage = 90e18; // 90% with 18 decimals
    }

    function setDevTreasury(address _devTreasury) public onlyOwner {
        devTreasury = _devTreasury;
    }

    function setDevTreasuryPercentage(uint256 _devTreasuryPercentage) public onlyOwner {
        devTreasuryPercentage = _devTreasuryPercentage;
    }

    function setLockLiquidityContract(address _lockLiquidityContract) public onlyOwner {
        lockLiquidityContract = _lockLiquidityContract;
    }

    /// @notice A 1% fee is applied to every transaction where 90% goes to the dev wallet
    /// to distribute to locked liquidity providers while the remaining 10% goes to the lock liquidity contract
    // If not defined, this is burnt.
    function _transfer(address sender, address recipient, uint256 amount) internal override {
        require(!isFrozen[msg.sender], 'TWOK: Your transfers are frozen');
        require(sender != address(0), "TWOK: ERC20: transfer from the zero address");

        _beforeTokenTransfer(sender, recipient, amount);

        // TWOK
        (uint256 fee, uint256 remaining) = calculateFee(amount);
        // fee * 10 / 100
        uint256 devTreasuryFee = fee.mul(devTreasuryPercentage).div(100e18);
        fee = fee.sub(devTreasuryFee);

        _balances[sender] = _balances[sender].sub(amount, "TWOK: ERC20: transfer amount exceeds balance");
        // Remaining transfer
        _balances[recipient] = _balances[recipient].add(remaining);
        // Fee transfer
        _balances[devTreasury] = _balances[devTreasury].add(devTreasuryFee);
        _balances[lockLiquidityContract] = _balances[lockLiquidityContract].add(fee);

        if (lockLiquidityContract != address(0)) {
            ILockLiquidity(lockLiquidityContract).addFeeAndUpdatePrice(fee);
        }

        emit Transfer(sender, recipient, remaining);
        emit Fee(sender, fee);
    }

    function burn(address _account, uint256 _amount) public onlyOwner returns (bool) {
        _burn(_account, _amount);
        return true;
    }

    function extractETHIfStuck() public onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    function extractTokenIfStuck(address _token, uint256 _amount) public onlyOwner {
        ERC20UpgradeSafe(_token).transfer(owner(), _amount);
    }

    function freezeTokens(address _of) public onlyOwner {
        isFrozen[_of] = true;
    }
    
    function unFreezeTokens(address _of) public onlyOwner {
        isFrozen[_of] = false;
    }

    function changeFee(uint256 _fee) public onlyOwner {
        transferFee = _fee;
    }

    function calculateFee(uint256 _amount) internal view returns(uint256 fee, uint256 remaining) {
        fee = _amount.mul(transferFee).div(1e18);
        remaining = _amount.sub(fee);
    }
}