pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;


import "forge-std/Test.sol";

import "../../balancer-core-v2/vault/Vault.sol";
import "../../balancer-core-v2/vault/interfaces/IAsset.sol";
import "../../balancer-core-v2/test/WETH.sol";

import "../../helpers/TestToken.sol";
import "../../interfaces/ICronV1Pool.sol";
import "../../interfaces/pool/ICronV1PoolEnums.sol";
import "../../factories/CronV1PoolFactory.sol";
import "../../exposed/CronV1PoolFactoryExposed.sol";

import { C } from "../../miscellany/Constants.sol";
import "../../interfaces/ICronV1PoolExposed.sol";

uint256 constant EQ = 1;
uint256 constant LT = 2;
uint256 constant GT = 3;
uint256 constant LTE = 4;

contract ClampingTest is Test {

  address public owner;
  Vault public vault;
  WETH public weth;
  CronV1PoolFactory public factory;
  CronV1PoolFactoryExposed public exposedFactory;
  TestToken public token0;
  TestToken public token1;
  TestToken public token2;
  address public pool;
  address public exposedPool;

  function setUp() public {
    owner = address(this);
    weth = new WETH(owner);
    // create Balancer Vault
    vault = new Vault(IAuthorizer(owner), IWETH(weth), 0, 0);
    vm.label(address(vault), "vault");
    // create TWAMM pool factory
    factory = new CronV1PoolFactory(vault);
    exposedFactory = new CronV1PoolFactoryExposed(vault);
    // create two mock tokens
    uint256 mintAmount = 2**112;
    token0 = new TestToken("T0", "T0", mintAmount);
    token1 = new TestToken("T1", "T1", mintAmount);
    token2 = new TestToken("T2", "T2", mintAmount);
    // create a TWAMM pool
    pool = factory.create(
      address(token0),
      address(token1),
      "T0-T1-Liquid",
      "T0-T1-L",
      1
    );
    // create a exposed TWAMM pool
    exposedPool = exposedFactory.createExposed(
      address(token0),
      address(token1),
      "T0-T1-Liquid",
      "T0-T1-L",
      1,
      address(owner)
    );
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

  function getTradeBlocks(uint _obi) public view returns (uint256 tradeBlocks) {
    uint swapInterval = 10;
    uint lastExpiryBlock = block.number - (block.number % _obi);
    uint orderExpiry = _obi * (swapInterval + 1) + lastExpiryBlock;
    tradeBlocks = orderExpiry - block.number;
  }

//  function dumpBalFees(address _pool) public {
//    bool collecting = ICronV1PoolExposed(_pool).isCollectingBalancerFees();
//    uint256 feeRate = ICronV1PoolExposed(_pool).getBalancerFee();
//    (uint256 balFee0U96, uint256 balFee1U96) = ICronV1PoolExposed(_pool).getBalancerFeeAmounts();
//    console.log("Collect Bal Fees = ", collecting ? 1 : 0);
//    console.log("Bal Fee Rate     = ", feeRate);
//    console.log("Bal Fees 0       = ", balFee0U96);
//    console.log("Bal Fees 1       = ", balFee1U96);
//  }

  function checkCronFees(address _pool, uint _val, uint256 _compareType) public {
    (uint256 cronFee0U96, uint256 cronFee1U96) = ICronV1PoolExposed(_pool).getCronFeeAmounts();
    if (_compareType == LT) {
      assertLt(cronFee0U96, _val);
      assertLt(cronFee1U96, _val);
    } else if (_compareType == EQ) {
      assertEq(cronFee0U96, _val);
      assertEq(cronFee1U96, _val);
    } else if (_compareType == LTE) {
      assertLe(cronFee0U96, _val);
      assertLe(cronFee1U96, _val);
    }
  }

  function checkBalFees(address _pool, uint _val, uint256 _compareType) public {
    (uint256 balFee0U96, uint256 balFee1U96) = ICronV1PoolExposed(_pool).getBalancerFeeAmounts();
    if (_compareType == LT) {
      assertLt(balFee0U96, _val);
      assertLt(balFee1U96, _val);
    } else if (_compareType == EQ) {
      assertEq(balFee0U96, _val);
      assertEq(balFee1U96, _val);
    } else if (_compareType == LTE) {
      assertLe(balFee0U96, _val);
      assertLe(balFee1U96, _val);
    }
  }

  // Clamping Test - Foundry then Hardhat
  // ================================================================================

  // Notes:
  //   * This should be done in Hardhat.
  //   * This fixes coverage for Bitpacking.sol 161 & 170
  //   * This requires you to muck with the initial state--specifically
  //     setting 96-bit values in the slots.

  // Description:
  //   This test checks to make sure that we indeed stop collecting fees
  //   at 96-bits. It also makes sure they reset to 0 properly when
  //   collected.

  // Test Procedure:
  //   // Setup:
  //   //
  //   1. Get pool initialized with (2 ** 96) - 100 in:
  //         slot4 = BitPackingLib.incrementPairWithClampU96(
  //         localSlot4,
  //         evoMem.token0BalancerFeesU96,
  //         evoMem.token1BalancerFeesU96
  //       );
  //     * token0 and token1 balancer fees
  //         slot3 = BitPackingLib.incrementPairWithClampU96(slot3, evoMem.token0CronFiFeesU96, evoMem.token1CronFiFeesU96);
  //     * token0 and token1 cron-fi fees
  //   2. Enable Cron-Fi Fees
  //   3. Set the Fee Shift to 1
  //   4. User mints initial liquidity
  //   5. User issues LT trades from token0-->token1 and vice versa for a lot
  //     - mine 2 blocks
  //     - run execute virtual orders
  //     * expect cron and balancer fees < 2**96-1
  //   6. Enact clamping 
  //     - mine until enough fees are collected to clamp balancer and cron fees
  //     - run execute virtual orders
  //     * expect cron and balancer fees == 2**96-1
  //   7. Collect CronFi Fees
  //     * expect cron fees == 0
  //   8. Mint more liquidity
  //     * expect balancer fees == 0

  function testManualClamping() public {
    address userA = address(this);
    uint maxU96 = (2 ** 96) - 1;
    uint maxFees = maxU96 - 100;

    ICronV1PoolExposed(exposedPool).setFeeAddress(userA);
    ICronV1PoolExposed(exposedPool).setFeeShift(1);
    mineBlocks();

    addLiquidity(exposedPool, userA, userA, 100e18, 100e18, 0);
    mineBlocks();
    
    // Must add balancer fee max here or the mint will take it away
//    console.log('Before setting fee counters ...');
//    dumpBalFees(exposedPool);

    addLiquidity(exposedPool, userA, userA, maxFees, maxFees, 1);
    ICronV1PoolExposed(exposedPool).iSetCronFeesMax(maxFees);
    addLiquidity(exposedPool, userA, userA, maxFees, maxFees, 1);
    ICronV1PoolExposed(exposedPool).iSetBalFeesMax(maxFees);

//    console.log('After setting fee counters ...');
//    dumpBalFees(exposedPool);

    swapPoolAddr(100e18, 10, ICronV1PoolEnums.SwapType.LongTermSwap, address(token0), exposedPool, userA);
    swapPoolAddr(100e18, 10, ICronV1PoolEnums.SwapType.LongTermSwap, address(token1), exposedPool, userA);
    mineBlocks(2);
    ICronV1PoolExposed(exposedPool).executeVirtualOrdersToBlock(block.number);
//    console.log('After mine 2 blocks and EVO ...');
//    dumpBalFees(exposedPool);

    // expect cron and balancer fees <= 2**96-1
//    console.log('First Check');
//    checkCronFees(exposedPool, maxU96, LTE);
    checkBalFees(exposedPool, maxU96, LTE);

    mineBlocks(2 * C.LIQUID_OBI);
    ICronV1PoolExposed(exposedPool).executeVirtualOrdersToBlock(block.number);
//    console.log('After mine 2 * Liquid OBI blocks and EVO ...');
//    dumpBalFees(exposedPool);

    // expect cron and balancer fees = 2**96-1
//    console.log('Second Check, Cron...');
    checkCronFees(exposedPool, maxU96, EQ);
//    console.log('Second Check, Bal...');
//  TODO: PB get Balancer Fee set in vault so that balancer fee collection works.
//        Then uncomment this line:
//    checkBalFees(exposedPool, maxU96, EQ);

    // collect cron fi fees
//    console.log('Third Check');
    exit(0, ICronV1PoolEnums.ExitType.FeeWithdraw, exposedPool, userA);
    mineBlocks();
//    console.log('After exit ...');
//    dumpBalFees(exposedPool);
    // expect cron fees == 0
    checkCronFees(exposedPool, 0, EQ);
    // expect bal fees == 0
    checkBalFees(exposedPool, 0, EQ);
  }

  function mineBlocks(uint256 _numBlocks) public {
    // emit log_uint(block.number);
    for (uint256 i = 0; i < _numBlocks; ++i) {
      string[] memory inputs = new string[](3);
      inputs[0] = "cast";
      inputs[1] = "rpc";
      inputs[2] = "anvil_mine";
      bytes memory res = vm.ffi(inputs);
    }
    vm.roll(block.number + _numBlocks);
    // emit log_uint(block.number);
  }

  function mineBlocks() public {
    mineBlocks(1);
  }

  function addLiquidity(
    address _pool,
    address _from,
    address _to,
    uint256 _liquidity0,
    uint256 _liquidity1,
    uint256 _joinKind
  ) public {
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

  function swapPoolAddr(
    uint256 _amountIn,
    uint256 _argument,
    ICronV1PoolEnums.SwapType _swapType,
    address _tokenIn,
    address _pool,
    address _trader
  ) internal returns (uint256 amountOut) {
    vm.startPrank(_trader);
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
        _trader,
        false,
        payable (_trader),
        false
      ),
      0,
      block.timestamp + 1000
    );
    vm.stopPrank();
  }

  function exit(
    uint _argument,
    ICronV1PoolEnums.ExitType _exitType,
    address _pool,
    address _trader
  ) public {
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
