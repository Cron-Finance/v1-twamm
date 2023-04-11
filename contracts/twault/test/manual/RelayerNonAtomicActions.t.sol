pragma solidity ^0.7.6;

pragma experimental ABIEncoderV2;

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";

import { IERC20 } from "../../balancer-core-v2/lib/openzeppelin/IERC20.sol";
import { IVault } from "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import { IAsset } from "@balancer-labs/v2-interfaces/contracts/vault/IAsset.sol";

import { Vault } from "../../balancer-core-v2/vault/Vault.sol";
import { Authorizer } from "../../balancer-core-v2/vault/Authorizer.sol";
import { IAuthorizer } from "../../balancer-core-v2/vault/interfaces/IAuthorizer.sol";
import { IWETH } from "../../balancer-core-v2/vault/interfaces/IWETH.sol";
import { WETH } from "../../balancer-core-v2/test/WETH.sol";

import { C } from "../../miscellany/Constants.sol";

import { TestToken } from "../../helpers/TestToken.sol";
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
// forge test -vvvv --rpc-url="http://127.0.0.1:8545" --ffi --match-test testManual
*/

contract NonAtomicActionsTest is Test {
  Authorizer public authorizer;
  ICronV1Relayer public relayer;
  CronV1Actions public relayerLib;

  address public owner;
  Vault public vault;
  WETH public weth;
  CronV1PoolFactory public factory;
  TestToken public tokenA;
  TestToken public tokenB;
  TestToken public tokenC;
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
    tokenA = new TestToken("TA", "TA", mintAmount);
    tokenB = new TestToken("TB", "TB", mintAmount);
    tokenC = new TestToken("TC", "TC", mintAmount);
    // create a TWAMM pool
    pool = factory.create(
      address(tokenA),
      address(tokenB),
      "T0-T1-Liquid",
      "T0-T1-L",
      uint256(ICronV1PoolEnums.PoolType.Liquid)
    );
    
    // Give the relayer authorization on action ids:
    {
      // New actionIds below from:
      //   https://github.com/balancer/balancer-v2-monorepo/blob/master/pkg/deployments/action-ids/mainnet/action-ids.json
      //
      // Production Vault Action IDs
      // address vault = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
      bytes32[] memory roles = generateActionIds(address(vault));

      authorizer.grantRoles(roles, address(relayer));
    }

    // Add liquidity
    address retailLP = vm.addr(100);
    tokenA.transfer(retailLP, 1000000e18);
    tokenB.transfer(retailLP, 1000000e18);
    vm.startPrank(retailLP);
    _join(pool,
      retailLP,
      retailLP,
      1000000e18,
      1000000e18,
      uint256(ICronV1PoolEnums.JoinType.Join)
    );
    vm.stopPrank();
  }

  function testManualRelayerLongSwap() public {
    address retailTrader = vm.addr(99);
    // NOTE: In this test Token0 of the pool is TokenB and Token1 of the pool is TokenA
    tokenB.transfer(retailTrader, 1000e18);
    _relayerLongSwap();
  }

  function testManualRelayerLongSwapWithdraw() public {
    address retailTrader = vm.addr(99);
    // NOTE: In this test Token0 of the pool is TokenB and Token1 of the pool is TokenA
    tokenB.transfer(retailTrader, 1000e18);
    uint256 preTokenABalance = tokenA.balanceOf(retailTrader);
    // B -> A Swap
    _relayerLongSwap();
    _relayerWithdraw();
    uint256 postTokenABalance = tokenA.balanceOf(retailTrader);
    assertGt(postTokenABalance, preTokenABalance, "buy some A tokens");
  }

  function testManualRelayerLongSwapCancel() public {
    address retailTrader = vm.addr(99);
    // NOTE: In this test Token0 of the pool is TokenB and Token1 of the pool is TokenA
    tokenB.transfer(retailTrader, 1000e18);
    uint256 preTokenABalance = tokenA.balanceOf(retailTrader);
    uint256 preTokenBBalance = tokenB.balanceOf(retailTrader);
    // B -> A Swap
    _relayerLongSwap();
    _relayerWithdraw();
    _mineBlocks(C.LIQUID_OBI);
    vm.startPrank(retailTrader);
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(retailTrader, 0, 100);
    relayer.cancel(
      address(tokenA),
      address(tokenB),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      orderIds[0],                     // orderId
      retailTrader                     // Receiver address
    );
    uint256 postTokenABalance = tokenA.balanceOf(retailTrader);
    uint256 postTokenBBalance = tokenB.balanceOf(retailTrader);
    assertGt(postTokenABalance, preTokenABalance, "buy some A tokens");
    assertGt(preTokenBBalance, postTokenBBalance, "sell some B tokens");
    vm.stopPrank();
  }

  function _relayerWithdraw() public {
    _mineBlocks(C.LIQUID_OBI);
    address retailTrader = vm.addr(99);
    vm.startPrank(retailTrader);
    (uint[] memory orderIds,,) = ICronV1Pool(pool).getOrderIds(retailTrader, 0, 100);
    relayer.withdraw(
      address(tokenA),
      address(tokenB),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      orderIds[0],                     // orderId
      retailTrader                     // Receiver address
    );
    vm.stopPrank();
  }

  function _relayerLongSwap() public {
    address retailTrader = vm.addr(99);
    {
      // 1. Confirm that we have not yet authorized the relayer:
      bool relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
      // 2. Authorize the relayer:
      vm.startPrank(retailTrader);
      vault.setRelayerApproval(retailTrader, address(relayer), true);
      vm.stopPrank();
      // 3. Confirm relayer authorization:
      relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
    }
    vm.startPrank(retailTrader);
    tokenB.approve(address(vault), 1000e18);
    relayer.longTermSwap(
      address(tokenB),                           // Token In
      address(tokenA),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Liquid), // Pool type
      1000e18,                                   // Swap Amount
      100,                                       // Number of intervals
      retailTrader                               // Destination
    );
    vm.stopPrank();
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
    string[] memory fns = new string[](10);
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

  function _mineBlocks(uint256 _numBlocks) internal {
    // emit log_uint(block.number);
    for (uint256 i = 0; i < _numBlocks; ++i) {
      string[] memory inputs = new string[](3);
      inputs[0] = "cast";
      inputs[1] = "rpc";
      inputs[2] = "anvil_mine";
      bytes memory res = vm.ffi(inputs);
    }
    uint256 secondsPerBlock = 12;
    vm.roll(block.number + _numBlocks);
    vm.warp(block.timestamp + secondsPerBlock);
    // console.log("block time", block.timestamp);
    // emit log_uint(block.number);
  }

  function _getJoinUserData(
    uint256 _joinKind,
    uint256 _liquidity0,
    uint256 _liquidity1
  ) internal pure returns (bytes memory userData) {
    userData = _getJoinUserDataWithMin(_joinKind, _liquidity0, _liquidity1, 0, 0);
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
