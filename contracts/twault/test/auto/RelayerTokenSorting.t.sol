pragma solidity ^0.7.6;

pragma experimental ABIEncoderV2;

import { Test } from "forge-std/Test.sol";

import { IERC20 } from "../../balancer-core-v2/lib/openzeppelin/IERC20.sol";
import { IVault } from "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import { IAsset } from "@balancer-labs/v2-interfaces/contracts/vault/IAsset.sol";

import { Vault } from "../../balancer-core-v2/vault/Vault.sol";
import { Authorizer } from "../../balancer-core-v2/vault/Authorizer.sol";
import { IAuthorizer } from "../../balancer-core-v2/vault/interfaces/IAuthorizer.sol";
import { IWETH } from "../../balancer-core-v2/vault/interfaces/IWETH.sol";
import { WETH } from "../../balancer-core-v2/test/WETH.sol";

import { TestToken2 } from "../../helpers/TestToken2.sol";
import { ICronV1Pool } from "../../interfaces/ICronV1Pool.sol";
import { ICronV1PoolEnums } from "../../interfaces/pool/ICronV1PoolEnums.sol";
import { ICronV1PoolFactory } from "../../interfaces/ICronV1PoolFactory.sol";
import { CronV1PoolFactory } from "../../factories/CronV1PoolFactory.sol";

import { CronV1Actions } from "../../periphery/CronV1Actions.sol";
import { CronV1Relayer } from "../../periphery/CronV1Relayer.sol";
import { ICronV1Relayer } from "../../interfaces/ICronV1Relayer.sol";

/*
// How to run this
// forge clean;
// forge build;
// forge test -vvvv --match-test testAuto
*/

contract JoinTokenSortingTest is Test {
  Authorizer public authorizer;
  ICronV1Relayer public relayer;
  CronV1Actions public relayerLib;

  address public owner;
  Vault public vault;
  WETH public weth;
  CronV1PoolFactory public factory;
  TestToken2 public tokenA;
  TestToken2 public tokenB;
  address public pool;

  function setUp() public {
    owner = address(this);
    weth = new WETH(owner);
    // create Balancer Vault
    authorizer = new Authorizer(owner);
    vault = new Vault(authorizer, IWETH(weth), 0, 0);
    vm.label(address(vault), "vault");
    // create TWAMM pool factory
    factory = new CronV1PoolFactory(vault);
    // create Cron-Fi Relayer & Actions:
    relayerLib = new CronV1Actions(IVault(address(vault)), ICronV1PoolFactory(address(factory)));
    relayer = ICronV1Relayer(address(relayerLib.getEntrypoint()));
    // create two mock tokens
    uint256 mintAmount = 2**112;
    tokenA = new TestToken2("TA", "TA", mintAmount, 2);
    tokenB = new TestToken2("TB", "TB", mintAmount, 18);
    // create a TWAMM pool
    pool = factory.create(
      address(tokenA),
      address(tokenB),
      "T0-T1-Liquid",
      "T0-T1-L",
      uint256(ICronV1PoolEnums.PoolType.Liquid)
    );
    bytes32[] memory roles = generateActionIds(address(vault));
    authorizer.grantRoles(roles, address(relayer));
    bytes32 poolId = ICronV1Pool(pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    if (address(tokenA) == address(tokens[0])) {
      _join(
        pool,
        owner,
        owner,
        5e8,
        1e24,
        uint256(ICronV1PoolEnums.JoinType.Join)
      );
    }
    else {
      _join(
        pool,
        owner,
        owner,
        1e24,
        5e8,
        uint256(ICronV1PoolEnums.JoinType.Join)
      );
    }
  }

  function testAutoRelayerSortingJoin1() public {
    vault.setRelayerApproval(owner, address(relayer), true);
    bool relayerApproved = vault.hasApprovedRelayer(owner, address(relayer));
    assertEq(relayerApproved, true);
    tokenA.approve(address(vault), 5e7);
    tokenB.approve(address(vault), 1e23);
    relayer.join(
      address(tokenA),
      address(tokenB),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      5e7,                             // Token 0
      1e23,                            // Token 1
      49999999,                        // Min Token 0
      99999999999999999999999,         // Min Token 1
      owner
    );
    (
      ,
      uint256 token0ReserveU112,
      uint256 token1ReserveU112,
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      
    ) = ICronV1Pool(pool).getVirtualReserves(block.number, false);
    assertEq(token0ReserveU112, 55e7, "token0");
    assertEq(token1ReserveU112, 11e23, "token1");
  }

  function testAutoRelayerSortingJoin2() public {
    vault.setRelayerApproval(owner, address(relayer), true);
    bool relayerApproved = vault.hasApprovedRelayer(owner, address(relayer));
    assertEq(relayerApproved, true);
    tokenA.approve(address(vault), 5e7);
    tokenB.approve(address(vault), 1e23);
    relayer.join(
      address(tokenB),
      address(tokenA),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      1e23,                            // Token 0
      5e7,                             // Token 1
      99999999999999999999999,         // Min Token 0
      49999999,                        // Min Token 1
      owner
    );
    (
      ,
      uint256 token0ReserveU112,
      uint256 token1ReserveU112,
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      
    ) = ICronV1Pool(pool).getVirtualReserves(block.number, false);
    assertEq(token0ReserveU112, 55e7, "token0");
    assertEq(token1ReserveU112, 11e23, "token1");
  }

  // Exit Token Sorting Test 1                                                                                                                               
  // 1. Create a pool with 5M Token 0 (2 decimals) and 1M Token 1 (18 decimals)
  // 2. Exit the pool with 1/10th total LP token supply with Token A (address of 
  //   Token 0) and Token B (address of Token 1), _minAmountOutA 499,999.99 and 
  //   _minAmountB 99,999.999,999,999,999,999,999
  // 3. Expect pass and reserves of ~ 4.5M Token 0 and .9M Token 1
  function testAutoRelayerSortingExit1() public {
    vault.setRelayerApproval(owner, address(relayer), true);
    bool relayerApproved = vault.hasApprovedRelayer(owner, address(relayer));
    assertEq(relayerApproved, true);
    uint256 lpTokens = ICronV1Pool(pool).totalSupply();
    uint256 fraction = lpTokens / 10;
    relayer.exit(
      address(tokenA),
      address(tokenB),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      fraction,                        // num of LP tokens
      49999999,                        // Min Token A
      99999999999999973167184,         // Min Token B
      owner                            // Receiver address
    );
    (
      ,
      uint256 token0ReserveU112,
      uint256 token1ReserveU112,
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      
    ) = ICronV1Pool(pool).getVirtualReserves(block.number, false);
    assertEq(token0ReserveU112, 450000001, "token0");
    assertEq(token1ReserveU112, 900000000000000026832816, "token1");
  }

  // Exit Token Sorting Test 2
  // 1. Create a pool with 5M Token 0 (2 decimals) and 1M Token 1 (18 decimals)
  // 2. Exit the pool with 1/10th total LP token supply with Token A (address of 
  //   Token 0) and Token B (address of Token 1), _minAmountOutB 499,999.99 and 
  //   _minAmountA 99,999.999,999,999,999,999,999
  // 3. Expect fail
  function testAutoRelayerSortingExit2() public {
    vault.setRelayerApproval(owner, address(relayer), true);
    bool relayerApproved = vault.hasApprovedRelayer(owner, address(relayer));
    assertEq(relayerApproved, true);
    uint256 lpTokens = ICronV1Pool(pool).totalSupply();
    uint256 fraction = lpTokens / 10;
    vm.expectRevert("BAL#505");
    relayer.exit(
      address(tokenA),
      address(tokenB),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      fraction,                        // num of LP tokens
      99999999999999973167184,         // Min Token A (incorrect, should fail)
      49999999,                        // Min Token B (incorrect, should fail)
      owner                            // Receiver address
    );
  }

  // Exit Token Sorting Test 3  (P1)
  // 1. Create a pool with 5M Token 0 (2 decimals) and 1M Token 1 (18 decimals)
  // 2. Exit the pool with 1/10th total LP token supply with Token A (address of 
  //   Token 1) and Token B (address of Token 0), _minAmountOutB 499,999.99 and 
  //   _minAmountA 99,999.999,999,999,999,999,999
  // 3. Expect pass and reserves of ~ 4.5M Token 0 and .9M Token 1
  function testAutoRelayerSortingExit3() public {
    vault.setRelayerApproval(owner, address(relayer), true);
    bool relayerApproved = vault.hasApprovedRelayer(owner, address(relayer));
    assertEq(relayerApproved, true);
    uint256 lpTokens = ICronV1Pool(pool).totalSupply();
    uint256 fraction = lpTokens / 10;
    relayer.exit(
      address(tokenB),
      address(tokenA),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      fraction,                        // num of LP tokens
      99999999999999973167184,         // Min Token A (switched example; test author should have named differently)
      49999999,                        // Min Token B (switched example; test author should have named differently)
      owner                            // Receiver address
    );
    (
      ,
      uint256 token0ReserveU112,
      uint256 token1ReserveU112,
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      
    ) = ICronV1Pool(pool).getVirtualReserves(block.number, false);
    assertEq(token0ReserveU112, 450000001, "token0");
    assertEq(token1ReserveU112, 900000000000000026832816, "token1");
  }

  function _join(
    address _pool,
    address _from,
    address _to,
    uint256 _liquidity0,
    uint256 _liquidity1,
    uint256 _joinKind
  ) public {
    // setup parameters for joinPool
    bytes memory userData = _getJoinUserData(_joinKind, _liquidity0, _liquidity1);
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
    // TODO: call vault.joinPool direct w/o IVault
    IVault(address(vault)).joinPool(
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

  function generateActionId(address _vault, string memory fn) public pure returns (bytes32) {
    bytes32 disambiguator = bytes32(uint256(address(_vault)));
    bytes4 selector = bytes4(keccak256(bytes(fn)));
    return keccak256(abi.encodePacked(disambiguator, selector));
  }

  function generateActionIds(address _vault) public pure returns (bytes32[] memory) {
    string[] memory fns = new string[](3);
    fns[0] = "swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)";
    fns[1] = "joinPool(bytes32,address,address,(address[],uint256[],bytes,bool))";
    fns[2] = "exitPool(bytes32,address,address,(address[],uint256[],bytes,bool))";

    bytes32[] memory roles = new bytes32[](fns.length);
    for (uint256 i = 0; i < fns.length; i++) {
      bytes32 role = generateActionId(_vault, fns[i]);
      roles[i] = role;
    }
    return roles;
  }

  function _getJoinUserData(
    uint256 _joinKind,
    uint256 _liquidity0,
    uint256 _liquidity1
  ) internal pure returns (bytes memory userData) {
    userData = _getJoinUserDataWithMin(_joinKind, _liquidity0, _liquidity1, 0, 0);
  }

  function _swap(
    uint256 _amountIn,
    uint256 _argument,
    ICronV1Pool.SwapType _swapType,
    bool _zeroToOne,
    address _pool,
    address _trader
  ) internal returns (uint256 amountOut) {
    // build userData field
    bytes memory userData = abi.encode(
      _swapType, // swap type
      _argument
    );
    bytes32 poolId = ICronV1Pool(_pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);

    // approve tokens to spend from this contract in the vault
    IERC20 token = _zeroToOne ? tokens[0] : tokens[1];
    token.approve(address(vault), _amountIn);

    // swap amounts with vault
    // TODO: call vault.swap direct w/o IVault
    amountOut = IVault(address(vault)).swap(
      IVault.SingleSwap(
        ICronV1Pool(_pool).POOL_ID(),
        IVault.SwapKind.GIVEN_IN,
        _zeroToOne ? assets[0] : assets[1],
        _zeroToOne ? assets[1] : assets[0],
        _amountIn,
        userData
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
  }
  
  function _getJoinUserDataWithMin(
    uint256 _joinKind,
    uint256 _liquidity0,
    uint256 _liquidity1,
    uint256 _minLiquidity0,
    uint256 _minLiquidity1
  ) internal pure returns (bytes memory userData) {
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
