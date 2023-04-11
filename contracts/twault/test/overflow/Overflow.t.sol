// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";
import "forge-std/console.sol";

import "../../balancer-core-v2/vault/Vault.sol";
import "../../balancer-core-v2/vault/interfaces/IAsset.sol";
import "../../balancer-core-v2/test/WETH.sol";

import "../../helpers/TestToken2.sol";
import "../../interfaces/ICronV1Pool.sol";
import "../../interfaces/pool/ICronV1PoolEnums.sol";
import "../../factories/CronV1PoolFactory.sol";
import { C } from "../../miscellany/Constants.sol";

contract OverflowTest is Test {
  address public owner;
  Vault public vault;
  WETH public weth;
  CronV1PoolFactory public factory;
  TestToken2 public token0;
  TestToken2 public token1;
  address public pool;

  address public lp1;
  address public lp2;
  address public trader;

  uint internal constant MINT_EVENTS = 50;

  function setUp() public {
    owner = address(this);
    weth = new WETH(owner);
    // create Balancer Vault
    vault = new Vault(IAuthorizer(owner), IWETH(weth), 0, 0);
    vm.label(address(vault), "vault");
    // create TWAMM pool factory
    factory = new CronV1PoolFactory(vault);
  }
  
  function getJoinUserData(
    uint256 _joinKind,
    uint256 _liquidity0,
    uint256 _liquidity1
  ) public pure returns (bytes memory userData) {
    userData = getJoinUserDataWithMin(_joinKind, _liquidity0, _liquidity1, 0, 0);
  }
  
  function getJoinUserDataWithMin(
    uint256 _joinKind,
    uint256 _liquidity0,
    uint256 _liquidity1,
    uint256 _minLiquidity0,
    uint256 _minLiquidity1
  ) public pure returns (bytes memory userData) {
    uint256[] memory balances = new uint256[](2);
    balances[0] = _liquidity0;
    balances[1] = _liquidity1;
    uint256[] memory minTokenAmt = new uint256[](2);
    minTokenAmt[0] = _minLiquidity0;
    minTokenAmt[1] = _minLiquidity1;
    userData = abi.encode(_joinKind, balances, minTokenAmt);
  }

  function createPool(uint _poolType, uint _t0Decimals, uint _t1Decimals) public{
    // create two mock tokens
    uint256 mintAmount = 2**112;
    token0 = new TestToken2("Lo", "LO", mintAmount, uint8(_t0Decimals));
    token1 = new TestToken2("Hi", "HI", mintAmount, uint8(_t1Decimals));
    // create a TWAMM pool
    pool = factory.create(
      address(token0),
      address(token1),
      "T0-T1-Pair",
      "T0-T1-P",
      _poolType
    );
    lp1 = vm.addr(1);
    lp2 = vm.addr(2);
    trader = vm.addr(3);
    token0.transfer(lp1, 100e25);
    token0.transfer(lp2, 100e25);
    token0.transfer(trader, 100000000000000);
    token1.transfer(lp1, 100e25);
    token1.transfer(lp2, 100e25);
    mineBlocks(1);
  }

  function testNoManualOverflowGUSD_DAI() public {
    // create stable pool with GUSD(2) <> DAI(18)
    createPool(0, 2, 18);
    // add 100M liquidity of each token
    if(address(token0) < address(token1)) {
      _addLiquidity(pool, owner, owner, 10000000000, 100000000000000000000000000, 0);
    } else {
      _addLiquidity(pool, owner, owner, 100000000000000000000000000, 10000000000, 0);
    }
    // create a 1M LT Swap for 2 weeks
    // uint fullIntervals = 1344;
    uint oflowIntervals = 67;
    uint preT0Balance = IERC20(token0).balanceOf(trader);
    uint preT1Balance = IERC20(token1).balanceOf(trader);
    // console.log("trade started");
    // console.log("T0 Balance", preT0Balance);
    // console.log("T1 Balance", preT1Balance);
    _swap(5000000, oflowIntervals, ICronV1PoolEnums.SwapType.LongTermSwap, address(token0), pool, trader, trader);
    mineBlocks(C.STABLE_OBI * oflowIntervals);
    // expect overflow during withdrawal
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(trader, 0, 100);
    _exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw, pool, trader);
    mineBlocks(1);
    uint postT0Balance = IERC20(token0).balanceOf(trader);
    uint postT1Balance = IERC20(token1).balanceOf(trader);
    // console.log("trade finished");
    // console.log("T0 Balance", postT0Balance);
    // console.log("T1 Balance", postT1Balance);
  }
  
  // #TODO AC Review
  function testNoManualOverflowWBTC_DAI() public {
    // create stable pool with WBTC(8) <> DAI(18)
    createPool(0, 8, 18);
    // add $100M DAI, 5000 WBTC @ 20k liquidity of each token
    if(address(token0) < address(token1)) {
      _addLiquidity(pool, owner, owner, 5000e8, 100e24, 0);
    } else {
      _addLiquidity(pool, owner, owner, 100e24, 5000e8, 0);
    }
    // create a 5 WBTC LT Swap for 2 weeks
    // uint fullIntervals = 1344;
    uint oflowIntervals = 134;
    uint preT0Balance = IERC20(token0).balanceOf(trader);
    uint preT1Balance = IERC20(token1).balanceOf(trader);
    // console.log("trade started");
    // console.log("T0 Balance", preT0Balance);
    // console.log("T1 Balance", preT1Balance);
    _swap(50e8, oflowIntervals, ICronV1PoolEnums.SwapType.LongTermSwap, address(token0), pool, trader, trader);
    mineBlocks(C.STABLE_OBI * oflowIntervals);
    // expect overflow during withdrawal
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(trader, 0, 100);
    _exit(orderIds[0], ICronV1PoolEnums.ExitType.Withdraw, pool, trader);
    mineBlocks(1);
    uint postT0Balance = IERC20(token0).balanceOf(trader);
    uint postT1Balance = IERC20(token1).balanceOf(trader);
    // console.log("trade finished");
    // console.log("T0 Balance", postT0Balance);
    // console.log("T1 Balance", postT1Balance);
  }

  function mineBlocks(uint256 _numBlocks) public {
    // emit log_uint(block.number);
    for (uint256 i = 0; i < _numBlocks; ++i) {
      string[] memory inputs = new string[](3);
      inputs[0] = "cast";
      inputs[1] = "rpc";
      inputs[2] = "anvil_mine";
      vm.ffi(inputs);
    }
    vm.roll(block.number + _numBlocks);
  }

  function _swap(
    uint256 _amountIn,
    uint256 _argument,
    ICronV1PoolEnums.SwapType _swapType,
    address _tokenIn,
    address _pool,
    address _from,
    address _to
  ) internal returns (uint256 amountOut) {
    vm.startPrank(_from);
    bytes32 poolId = ICronV1Pool(_pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    // approve tokens to spend from this contract in the vault
    IERC20 token = (_tokenIn == address(tokens[0])) ? tokens[0] : tokens[1];
    token.approve(address(vault), _amountIn);
    // swap amounts with vault
    amountOut = IVault(vault).swap(
      IVault.SingleSwap(
        ICronV1Pool(_pool).POOL_ID(),
        IVault.SwapKind.GIVEN_IN,
        (_tokenIn == address(tokens[0])) ? assets[0] : assets[1],
        (_tokenIn == address(tokens[0])) ? assets[1] : assets[0],
        _amountIn,
        abi.encode(
          _swapType,
          _argument
        )
      ),
      IVault.FundManagement(
        _from,
        false,
        payable (_to),
        false
      ),
      0,
      block.timestamp + 1000
    );
    vm.stopPrank();
  }

  function _addLiquidity(
    address _pool,
    address _from,
    address _to,
    uint256 _liquidity0,
    uint256 _liquidity1,
    uint256 _joinKind
  ) internal {
    vm.startPrank(_from);
    // setup parameters for joinPool
    uint256[] memory balances = new uint256[](2);
    balances[0] = _liquidity0;
    balances[1] = _liquidity1;
    bytes memory userData = getJoinUserData(_joinKind, balances[0], balances[1]);
    bytes32 poolId = ICronV1Pool(_pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    uint256[] memory maxAmountsIn = new uint256[](tokens.length);
    for (uint256 i; i < tokens.length; i++) {
      maxAmountsIn[i] = type(uint256).max;
    }
    bool fromInternalBalance = false;
    // approve tokens to be used by vault
    IERC20(tokens[0]).approve(address(vault), _liquidity0);
    IERC20(tokens[1]).approve(address(vault), _liquidity1);
    // call joinPool function on TWAMMs
    IVault(vault).joinPool(
      poolId,
      _from,
      payable (_to),
      IVault.JoinPoolRequest(
        assets,
        maxAmountsIn,
        userData,
        fromInternalBalance
      )
    );
    vm.stopPrank();
  }

  function _exit(
    uint _argument,
    ICronV1PoolEnums.ExitType _exitType,
    address _pool,
    address _trader
  ) internal {
    vm.startPrank(_trader);
    // build userData field
    bytes memory userData = abi.encode(
      _exitType, // exit type
      _argument
    );
    bytes32 poolId = ICronV1Pool(_pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    // approve tokens to spend from this contract in the vault
    uint256[] memory minAmountIn = new uint256[](tokens.length);
    for (uint256 i; i < tokens.length; i++) {
      minAmountIn[i] = type(uint256).min;
    }
    // swap amounts with vault
    IVault(vault).exitPool(
      ICronV1Pool(_pool).POOL_ID(),
      _trader,
      payable (_trader),
      IVault.ExitPoolRequest(
        assets,
        minAmountIn,
        userData,
        false
      )
    );
    vm.stopPrank();
  }

  function _convertERC20sToAssets(IERC20[] memory tokens) internal pure returns (IAsset[] memory assets) {
    // solhint-disable-next-line no-inline-assembly
    assembly {
      assets := tokens
    }
  }
}
