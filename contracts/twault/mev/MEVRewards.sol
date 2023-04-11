// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

// import { console } from "forge-std/console.sol";

import { IERC20 } from "../balancer-core-v2/lib/openzeppelin/IERC20.sol";
import { IWETH } from "../balancer-core-v2/vault/interfaces/IWETH.sol";
import { IAsset } from "../balancer-core-v2/vault/interfaces/IAsset.sol";
import { IVault } from "../balancer-core-v2/vault/interfaces/IVault.sol";

import { ICronV1Pool } from "../interfaces/ICronV1Pool.sol";
import { IUniswapV3PoolState, OracleLibrary } from "./uniswap/OracleLibrary.sol";
import { ExecVirtualOrdersMem } from "../interfaces/Structs.sol";

address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
address constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
address constant VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;

interface IUniswapV3Router {
  struct ExactInputSingleParams {
    address tokenIn;
    address tokenOut;
    uint24 fee;
    address recipient;
    uint256 deadline;
    uint256 amountIn;
    uint256 amountOutMinimum;
    uint160 sqrtPriceLimitX96;
  }

  struct ExactInputParams {
    bytes path;
    address recipient;
    uint256 deadline;
    uint256 amountIn;
    uint256 amountOutMinimum;
  }

  /// @notice Swaps amountIn of one token for as much as possible of another token
  /// @param _params The parameters necessary for the swap, encoded as ExactInputSingleParams in calldata
  /// @return amountOut The amount of the received token
  function exactInputSingle(ExactInputSingleParams calldata _params) external payable returns (uint256 amountOut);

  /// @notice Swaps amountIn of one token for as much as possible of another along the specified path
  /// @param _params The parameters necessary for the multi-hop swap, encoded as ExactInputParams in calldata
  /// @return amountOut The amount of the received token
  function exactInput(ExactInputParams calldata _params) external payable returns (uint256 amountOut);
}

interface IUniswapV3Factory {
  /// @notice Returns the pool address for a given pair of tokens and a fee, or address 0 if it does not exist
  /// @dev tokenA and tokenB may be passed in either token0/token1 or token1/token0 order
  /// @param _tokenA The contract address of either token0 or token1
  /// @param _tokenB The contract address of the other token
  /// @param _fee The fee collected upon every swap in the pool, denominated in hundredths of a bip
  /// @return pool The pool address
  function getPool(
    address _tokenA,
    address _tokenB,
    uint24 _fee
  ) external view returns (address pool);
}

contract MEVRewards {
  IUniswapV3Router internal constant ROUTER = IUniswapV3Router(0xE592427A0AEce92De3Edee1F18E0157C05861564);
  IUniswapV3Factory internal constant FACTORY = IUniswapV3Factory(0x1F98431c8aD98523631AE4a59f267346ea31F984);

  function swapExactInputSingleHop(
    address _tokenIn,
    address _tokenOut,
    uint24 _poolFee,
    uint256 _amountIn,
    address _from,
    address _to
  ) public returns (uint256 amountOut) {
    IERC20(_tokenIn).transferFrom(_from, address(this), _amountIn);
    IERC20(_tokenIn).approve(address(ROUTER), _amountIn);

    IUniswapV3Router.ExactInputSingleParams memory params = IUniswapV3Router.ExactInputSingleParams({
      tokenIn: _tokenIn,
      tokenOut: _tokenOut,
      fee: _poolFee,
      recipient: _to,
      deadline: block.timestamp,
      amountIn: _amountIn,
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0
    });

    amountOut = ROUTER.exactInputSingle(params);
  }

  function swapExactInputMultiHop(
    bytes calldata _path,
    address _tokenIn,
    uint256 _amountIn
  ) public returns (uint256 amountOut) {
    IERC20(_tokenIn).transferFrom(msg.sender, address(this), _amountIn);
    IERC20(_tokenIn).approve(address(ROUTER), _amountIn);

    IUniswapV3Router.ExactInputParams memory params = IUniswapV3Router.ExactInputParams({
      path: _path,
      recipient: msg.sender,
      deadline: block.timestamp,
      amountIn: _amountIn,
      amountOutMinimum: 0
    });
    amountOut = ROUTER.exactInput(params);
  }

  function donateLiquidity(
    address _vault,
    address _pool,
    uint24 _feeTier,
    uint256 _mevEthAmount,
    address _token0,
    address _token1
  ) public {
    (uint256[] memory wethDeposits, uint256[] memory wethToSwapForTokens) = calculateRewards(
      _pool,
      _mevEthAmount,
      _token0,
      _token1
    );
    for (uint256 i = 0; i < wethDeposits.length; ++i) {
      uint256 tokenDeposit = swapExactInputSingleHop(
        _token0,
        _token1,
        _feeTier,
        wethToSwapForTokens[i],
        address(this),
        address(this)
      );
      _addLiquidity(_vault, _pool, address(this), msg.sender, tokenDeposit, wethDeposits[i], 1);
    }
  }

  function calculateRewards(
    address _pool,
    uint256 _amountEth,
    address _token0,
    address _token1
  ) public returns (uint256[] memory, uint256[] memory) {
    uint256[] memory wethDeposits;
    uint256[] memory wethToSwapForTokens;
    if ((_token0 == WETH) || (_token1 == WETH)) {
      // 1. Handle the case where the TWAMM pool has WETH & Token:
      wethDeposits = new uint256[](1);
      wethToSwapForTokens = new uint256[](1);
      address tokenIn = (_token0 == WETH) ? _token1 : _token0;
      (wethDeposits[0], wethToSwapForTokens[0]) = calculateRewards(_pool, _amountEth, tokenIn);
    } else {
      // 2. Handle the case where the TWAMM pool has Token 1 & Token 2:
      wethDeposits = new uint256[](2);
      wethToSwapForTokens = new uint256[](2);
      (wethDeposits[0], wethToSwapForTokens[0]) = calculateRewards(_pool, _amountEth / 2, _token0);
      (wethDeposits[1], wethToSwapForTokens[1]) = calculateRewards(_pool, _amountEth / 2, _token1);
    }
    return (wethDeposits, wethToSwapForTokens);
  }

  function calculateRewards(
    address _pool,
    uint256 _amountEth,
    address _tokenOut
  ) public returns (uint256 wethDeposit, uint256 wethToSwapForToken) {
    (address tokenIn, address tokenOut) = _getTokenInOrder(_tokenOut, WETH);
    uint24 fee = getDeepestPool(_tokenOut, WETH);
    address uniPool = getPoolAddress(_tokenOut, WETH, fee);
    (int24 arithmeticMeanTick, ) = consult(uniPool, 300);
    (wethDeposit, wethToSwapForToken) = _calculateDeposit(arithmeticMeanTick, _amountEth, _pool, tokenIn, tokenOut);
  }

  function getTokenPoolBalance(address _token, address _pool) public view returns (uint256) {
    (bool success, bytes memory data) = _token.staticcall(
      abi.encodeWithSelector(IERC20.balanceOf.selector, address(_pool))
    );
    require(success && data.length >= 32, "Incorrect data");
    return abi.decode(data, (uint256));
  }

  function getPoolAddress(
    address _tokenA,
    address _tokenB,
    uint24 _fee
  ) public view returns (address pool) {
    pool = FACTORY.getPool(_tokenA, _tokenB, _fee);
  }

  function getPoolLiquidity(address _pool) public view returns (uint128 liquidity) {
    liquidity = IUniswapV3PoolState(_pool).liquidity();
  }

  function observePool(address _pool, uint32[] memory _secondsAgos)
    public
    view
    returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
  {
    (tickCumulatives, secondsPerLiquidityCumulativeX128s) = IUniswapV3PoolState(_pool).observe(_secondsAgos);
  }

  function getDeepestPool(address _tokenA, address _tokenB) public view returns (uint24 fee) {
    address smlPool = getPoolAddress(address(_tokenA), address(_tokenB), uint24(100));
    uint128 smlLiquidity = (smlPool != address(0)) ? getPoolLiquidity(smlPool) : 0;
    address medPool = getPoolAddress(address(_tokenA), address(_tokenB), uint24(500));
    uint128 medLiquidity = (medPool != address(0)) ? getPoolLiquidity(medPool) : 0;
    address lrgPool = getPoolAddress(address(_tokenA), address(_tokenB), uint24(3000));
    uint128 lrgLiquidity = (lrgPool != address(0)) ? getPoolLiquidity(lrgPool) : 0;
    if (lrgLiquidity > medLiquidity && lrgLiquidity > smlLiquidity) {
      fee = 3000;
    } else if (medLiquidity > lrgLiquidity && medLiquidity > smlLiquidity) {
      fee = 500;
    } else if (smlLiquidity > lrgLiquidity && smlLiquidity > medLiquidity) {
      fee = 100;
    }
  }

  function consult(address _pool, uint32 _secondsAgo)
    public
    view
    returns (int24 arithmeticMeanTick, uint128 harmonicMeanLiquidity)
  {
    return OracleLibrary.consult(_pool, _secondsAgo);
  }

  function logBalances(
    address _token0,
    address _token1,
    address[] memory _users
  ) public view {
    // for (uint256 i; i < _users.length; i++) {
    // if (i == 0) {
    //   console.log("TestContract: ", _users[i]);
    // } else {
    //   console.log("MEVRewards: ", _users[i]);
    // }
    // // console.log("Address", _users[i]);
    // console.log("_token0", IERC20(_token0).balanceOf(_users[i]));
    // console.log("_token1", IERC20(_token1).balanceOf(_users[i]));
    // }
  }

  function getQuoteAtTick(
    int24 _tick,
    uint128 _baseAmount,
    address _baseToken,
    address _quoteToken
  ) public pure returns (uint256 quoteAmount) {
    quoteAmount = OracleLibrary.getQuoteAtTick(_tick, _baseAmount, _baseToken, _quoteToken);
  }

  function _addLiquidity(
    address _vault,
    address _pool,
    address _from,
    address _to,
    uint256 _liquidity0,
    uint256 _liquidity1,
    uint256 _joinKind
  ) internal {
    // setup parameters for joinPool
    bytes32 poolId = ICronV1Pool(_pool).POOL_ID();
    (IERC20[] memory tokens, , ) = IVault(_vault).getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    uint256[] memory maxAmountsIn = new uint256[](tokens.length);
    for (uint256 i; i < tokens.length; i++) {
      maxAmountsIn[i] = type(uint256).max;
    }
    bool fromInternalBalance = false;
    uint256[] memory balances = new uint256[](2);
    balances[0] = _liquidity0;
    balances[1] = _liquidity1;
    bytes memory userData = abi.encode(_joinKind, balances);
    // approve tokens to be used by vault
    IERC20(tokens[0]).approve(_vault, _liquidity0);
    IERC20(tokens[1]).approve(_vault, _liquidity1);
    // call joinPool function on TWAMMs
    IVault(_vault).joinPool(
      poolId,
      _from,
      payable(_to),
      IVault.JoinPoolRequest(assets, maxAmountsIn, userData, fromInternalBalance)
    );
  }

  function _calculateDeposit(
    int24 _arithmeticMeanTick,
    uint256 _amountEth,
    address _twammPool,
    address _tokenIn,
    address _tokenOut
  ) internal returns (uint256 wethDeposit, uint256 wethToSwapForToken) {
    uint256 localRes0;
    uint256 localRes1;
    {
      (, uint256 token0ReserveU112, uint256 token1ReserveU112, , , , , , , , ) = ICronV1Pool(_twammPool)
        .getVirtualReserves(block.number, false);
      localRes0 = token0ReserveU112;
      localRes1 = token1ReserveU112;
    }
    uint112 localWethRes = (_tokenIn == WETH) ? uint112(localRes0) : uint112(localRes1);
    uint112 localTokenRes = (_tokenIn == WETH) ? uint112(localRes1) : uint112(localRes0);
    // Next line fetches a quote of 1 WETH:X USDC, X = quoteAmount.
    // If you had .4 WETH, then quoteAmount = X USDC / (.4e18) WETH.
    // If there is no slippage, getting a price quote for a pair using the reserveA/reserveB TokensA per TokenB
    // is accurate.  quoteAtTick largely does this if there is no slippage for the amount provided in uniWethRes.
    uint256 uniWethRes = _amountEth;
    uint256 uniTokenRes = getQuoteAtTick(_arithmeticMeanTick, uint128(uniWethRes), _tokenIn, _tokenOut);
    // I think the following is right, but I haven't confirmed--you can test it by making sure that the ratio
    // of WETH:Tn stays the same or close before and after the deposit:
    uint256 commonTerm = localWethRes * uniTokenRes; // max u224
    uint256 denominator = (localTokenRes * uniWethRes) + commonTerm; // max u225
    if (denominator == 0) {
      revert("DIV0 err");
    }
    uint256 numerator = _amountEth * commonTerm;
    if (numerator > commonTerm) {
      // Didn't overflow
      wethDeposit = numerator / denominator;
    } else {
      revert("Outta contract scope/ability"); // Ignore this scenario for now (large numbers).
    }
    wethToSwapForToken = _amountEth - wethDeposit;
  }

  function _getTokenInOrder(address _token0, address _token1)
    internal
    pure
    returns (address tokenIn, address tokenOut)
  {
    bool isWethToken0 = (_token0 == WETH) ? true : false;
    tokenIn = isWethToken0 ? _token0 : _token1;
    tokenOut = isWethToken0 ? _token1 : _token0;
  }

  function _convertERC20sToAssets(IERC20[] memory _tokens) internal pure returns (IAsset[] memory assets) {
    // solhint-disable-next-line no-inline-assembly
    assembly {
      assets := _tokens
    }
  }
}
