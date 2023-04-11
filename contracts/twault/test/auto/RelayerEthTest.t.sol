pragma solidity ^0.7.0;

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

import { TestToken } from "../../helpers/TestToken.sol";
import { ICronV1Pool } from "../../interfaces/ICronV1Pool.sol";
import { ICronV1PoolEnums } from "../../interfaces/pool/ICronV1PoolEnums.sol";
import { ICronV1PoolFactory } from "../../interfaces/ICronV1PoolFactory.sol";
import { CronV1PoolFactory } from "../../factories/CronV1PoolFactory.sol";

import { CronV1Actions } from "../../periphery/CronV1Actions.sol";
import { CronV1Relayer } from "../../periphery/CronV1Relayer.sol";
import { ICronV1Relayer } from "../../interfaces/ICronV1Relayer.sol";

import { Order } from "../../interfaces/Structs.sol";

import { C } from "../../miscellany/Constants.sol";

contract RelayerEthTest is Test {
  address public owner;
  address public delegate;
  Authorizer public authorizer;
  ICronV1Relayer public relayer;
  CronV1Actions public relayerLib;
  Vault public vault;
  WETH public weth;
  CronV1PoolFactory public factory;
  TestToken public token1;
  TestToken public token2;
  TestToken public token3;
  address public stablePool;
  address public liquidPool;
  address public volatilePool;

  function setUp() public {
    owner = address(this);
    weth = new WETH(owner);
    // create Balancer Vault
    authorizer = new Authorizer(owner);
    vault = new Vault(authorizer, IWETH(weth), 0, 0);
    vm.label(address(vault), "vault");
    vm.label(owner, "owner");
    vm.label(delegate, "delegate");
    // create TWAMM pool factory
    factory = new CronV1PoolFactory(vault);
    // create Cron-Fi Relayer & Actions:
    relayerLib = new CronV1Actions(IVault(address(vault)), ICronV1PoolFactory(address(factory)));
    relayer = ICronV1Relayer(address(relayerLib.getEntrypoint()));
    // create two mock tokens
    uint256 mintAmount = 2**112;
    weth.mint(owner, mintAmount);
    token1 = new TestToken("T1", "T1", mintAmount);
    token2 = new TestToken("T2", "T2", mintAmount);
    token3 = new TestToken("T3", "T3", mintAmount);
    delegate = vm.addr(1337);
    bytes32[] memory roles = generateActionIds(address(vault));
    authorizer.grantRoles(roles, address(relayer));
    liquidPool = factory.create(
      address(weth),
      address(token2),
      "WETH-T2",
      "WETH-T2",
      uint256(ICronV1PoolEnums.PoolType.Liquid)
    );
    addLiquidity(liquidPool, owner, owner, 1e23, 1e23, 0);
  }

  // Ethereum Out Test 1  (P2)
  // I think a user can receive their swap proceeds or other tokens from the vault in
  // RAW Eth by specifying the null addrss--we need to see if this is possible as 
  // we have code that refunds it to users in the relayer.
  // 1. Create a pool with Eth : X if possible?  If not possible than use WETH : X
  //   (where X is any token you like)
  // 2. Try to swap by passing in Token X, expect to get WETH. Confirm pass.
  // 3. Try to swap by passing in Token X again, is there a way to tell the 
  //   contract to return RAW Eth (by specifying the null/sentinel address? I think
  //   this will actually trip up our factory and prevent it from finding the pool)
  function testAutoRelayerEth() public {
    // cannot trade native eth through relayer
    vm.deal(owner, 1000 ether);
    // check native eth balance for owner
    assertEq(1000e18, owner.balance);
    vault.setRelayerApproval(owner, address(relayer), true);
    bool relayerApproved = vault.hasApprovedRelayer(owner, address(relayer));
    assertEq(relayerApproved, true);
    // NOTE: In this test Token0 of the pool is TokenB and Token1 of the pool is TokenA
    weth.transfer(owner, 1000e18);
    weth.approve(address(vault), 1000e18);
    relayer.longTermSwap(
      address(weth),                           // Token In
      address(token2),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Liquid), // Pool type
      1000e18,                                   // Swap Amount
      100,                                       // Number of intervals
      owner                               // Destination
    );
    assertEq(1000e18, owner.balance);
    vm.expectRevert("CFI#614");
    relayer.longTermSwap(
      address(0),                           // Token In
      address(token2),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Liquid), // Pool type
      1000e18,                                   // Swap Amount
      100,                                       // Number of intervals
      owner                               // Destination
    );
    assertEq(1000e18, owner.balance);
    token2.transfer(owner, 1000e18);
    token2.approve(address(vault), 1000e18);
    relayer.swap(
      address(token2),
      address(weth),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      1000e18,
      100,
      owner
    );
    uint lpBalance = ICronV1Pool(liquidPool).balanceOf(owner);
    // exit with native ETH
    vm.expectRevert("CFI#614");
    relayer.exit(
      address(0),
      address(token2),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      lpBalance,
      1,
      1,
      owner
    );
    assertEq(1000e18, owner.balance);
    vm.expectRevert("CFI#615");
    relayer.exit(
      address(token2),
      address(0),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      lpBalance,
      1,
      1,
      owner
    );
    assertEq(1000e18, owner.balance);
  }

  function addLiquidity(
    address _pool,
    address _from,
    address _to,
    uint256 _liquidity0,
    uint256 _liquidity1,
    uint256 _joinKind
  ) public {
    // setup parameters for joinPool
    bytes memory userData = getJoinUserData(_joinKind, _liquidity0, _liquidity1);
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

  function mineBlocks(uint256 _numBlocks) public {
    // emit log_uint(block.number);
    for (uint256 i = 0; i < _numBlocks; ++i) {
      string[] memory inputs = new string[](3);
      inputs[0] = "cast";
      inputs[1] = "rpc";
      inputs[2] = "anvil_mine";
      vm.ffi(inputs);
    }
    uint256 secondsPerBlock = 12;
    vm.roll(block.number + _numBlocks);
    vm.warp(block.timestamp + secondsPerBlock);
    // console.log("block time", block.timestamp);
    // emit log_uint(block.number);
  }

  function mineBlocks() public {
    mineBlocks(1);
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

  function _convertERC20sToAssets(IERC20[] memory tokens) internal pure returns (IAsset[] memory assets) {
    // solhint-disable-next-line no-inline-assembly
    assembly {
      assets := tokens
    }
  }
}
