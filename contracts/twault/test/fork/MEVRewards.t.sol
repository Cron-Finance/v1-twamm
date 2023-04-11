// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";
import "forge-std/console.sol";

import "../../mev/MEVRewards.sol";
import "../../factories/CronV1PoolFactory.sol";
import "../../interfaces/ICronV1Pool.sol";
import "../../balancer-core-v2/vault/interfaces/IVault.sol";
import { ExecVirtualOrdersMem } from "../../interfaces/Structs.sol";

contract MEVRewardsTest is Test {
  IWETH private weth = IWETH(WETH);
  IERC20 private dai = IERC20(DAI);
  IERC20 private usdc = IERC20(USDC);
  IVault private vault = IVault(VAULT);

  MEVRewards private mev = new MEVRewards();

  function setUp() public {}

  function testSingleHop() public {
    weth.deposit{value: 1e18}();
    weth.approve(address(mev), 1e18);

    uint24 feeTier = mev.getDeepestPool(WETH, USDC);
    uint amountOut = mev.swapExactInputSingleHop(WETH, USDC, feeTier, 1e18, address(this), address(this));

    console.log("USDC @ Fee Tier:", feeTier, amountOut);
  }

  function testMEVSingleRewards() public {
    uint256 stdAmount = 100e18;
    (address pool, uint24 feeTier) = _createAndFundPool(stdAmount);
    // add new LPs
    _swapAndAddLiquidity(pool, feeTier, stdAmount, vm.addr(1));
    _swapAndAddLiquidity(pool, feeTier, stdAmount, vm.addr(2));
    _swapAndAddLiquidity(pool, feeTier, stdAmount, vm.addr(3));
    // check to see if reserves updated
    (, uint256 preReserve0, uint256 preReserve1, , , , , , , , ) = ICronV1Pool(pool).getVirtualReserves(block.number,
                                                                                                       false);
    uint256 preReserveRatio = preReserve0/preReserve1;
    // swap half rewards for usdc and send to mev contract
    weth.deposit{value: stdAmount}();
    weth.transferFrom(address(this), address(mev), stdAmount);
    // donate liquidity
    mev.donateLiquidity(VAULT, pool, feeTier, stdAmount, WETH, USDC);
    // check to see if reserves updated
    (, uint256 postReserve0, uint256 postReserve1, , , , , , , , ) = ICronV1Pool(pool).getVirtualReserves(block.number,
                                                                                                       false);
    // review with AC why this is 0 from rounding
    console.log("0", postReserve0);
    console.log("1", postReserve1);
    uint256 postReserveRatio = postReserve0/postReserve1;
    // ensure reserves close to same ratio
    uint256 deviation = 100 * ((postReserveRatio - preReserveRatio)/preReserveRatio);
    assertLt(deviation, 1);
  }

  function testGetTokenBalance () public view {
    address medPool = mev.getPoolAddress(WETH, USDC, uint24(500));
    uint256 wethLiquidity = mev.getTokenPoolBalance(WETH, medPool);
    uint256 usdcLiquidity = mev.getTokenPoolBalance(USDC, medPool);
    console.log("WETH Liquidity", wethLiquidity); 
    console.log("USDC Liquidity", usdcLiquidity);
  }

  function testPoolLiquidity() public view {
    address smlPool = mev.getPoolAddress(WETH, USDC, uint24(100));
    uint128 smlLiquidity = (smlPool != address(0)) ? mev.getPoolLiquidity(smlPool) : 0;
    address medPool = mev.getPoolAddress(WETH, USDC, uint24(500));
    uint128 medLiquidity = (medPool != address(0)) ? mev.getPoolLiquidity(medPool) : 0;
    address lrgPool = mev.getPoolAddress(WETH, USDC, uint24(3000));
    uint128 lrgLiquidity = (lrgPool != address(0)) ? mev.getPoolLiquidity(lrgPool) : 0;

    console.log("Pool addresses & liquidity");
    console.log("0.01 Liquidity, Address", smlLiquidity, smlPool);
    console.log("0.05 Liquidity, Address", medLiquidity, medPool);
    console.log(" 0.3 Liquidity, Address", lrgLiquidity, lrgPool);
  }

  function testDeepestPool() public view {
    uint24 fee = mev.getDeepestPool(WETH, USDC);
    console.log("Deepest Pool", fee);
  }

  // function testObserveLiquidity() public view {
  //   uint32[] memory secondsAgos = new uint32[](2);
  //   secondsAgos[1] = uint32(60);
  //   secondsAgos[0] = uint32(0);
  //   address pool = mev.getPoolAddress(WETH, USDC, uint24(500));
  //   (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s) = mev.observePool(pool, secondsAgos);
  //   console.log("Tick Cumulatives", uint256(tickCumulatives[0]));
  //   console.log("Seconds Per Liquidity Cumulative", uint256(secondsPerLiquidityCumulativeX128s[0]));
  // }

  function testConsult() public view {
    address pool = mev.getPoolAddress(WETH, USDC, uint24(500));
    (int24 arithmeticMeanTick, uint128 harmonicMeanLiquidity) = mev.consult(pool, 300);
    console.log("arithmeticMeanTick", uint256(arithmeticMeanTick));
    console.log("harmonicMeanLiquidity", uint256(harmonicMeanLiquidity));
  }

  function testQuoteAtTick() public view {
    address pool = mev.getPoolAddress(WETH, USDC, uint24(500));
    (int24 arithmeticMeanTick, ) = mev.consult(pool, 300);
    uint256 quoteAmount = mev.getQuoteAtTick(arithmeticMeanTick, 1e18, WETH, USDC);
    console.log("Quote for 1 ETH <> USDC", quoteAmount);
  }

  function _createAndFundPool(uint256 _stdAmount) internal returns (address pool, uint24 feeTier) {
    weth.deposit{value: 2 * _stdAmount}();
    weth.approve(address(mev), _stdAmount);
    feeTier = mev.getDeepestPool(WETH, USDC);
    // swap for usdc
    uint amountOut = mev.swapExactInputSingleHop(WETH, USDC, feeTier, _stdAmount, address(this), address(this));
    // create cron factory
    CronV1PoolFactory factory = new CronV1PoolFactory(vault);
    // create cron pool
    pool = factory.create(
      WETH,
      USDC,
      "WETH<>USDC<>Liquid",
      "WETH/USDC/1",
      1
    );
    // add liquidity to twamm pool
    uint joinKind = 0;
    _addLiquidity(pool, address(this), address(this), amountOut, _stdAmount, joinKind);
  }

  function _swapAndAddLiquidity(address _pool, uint24 _feeTier, uint256 _amountIn, address _user) internal {
    weth.deposit{value: 2 * _amountIn}();
    weth.transferFrom(address(this), _user, 2 * _amountIn);
    vm.startPrank(_user);
    weth.approve(address(mev), _amountIn);
    uint amountOut = mev.swapExactInputSingleHop(WETH, USDC, _feeTier, _amountIn, _user, _user);
    uint joinKind = 0;
    _addLiquidity(_pool, _user, _user, amountOut, _amountIn, joinKind);
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
  

  function _convertERC20sToAssets(IERC20[] memory tokens) internal pure returns (IAsset[] memory assets) {
    // solhint-disable-next-line no-inline-assembly
    assembly {
      assets := tokens
    }
  }
}
