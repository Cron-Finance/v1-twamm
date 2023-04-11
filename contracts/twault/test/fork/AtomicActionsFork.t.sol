pragma solidity ^0.7.6;

pragma experimental ABIEncoderV2;

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";

// import { IERC20 } from "../../balancer-core-v2/lib/openzeppelin/IERC20.sol";
import { IERC20 } from "@balancer-labs/v2-interfaces/contracts/solidity-utils/openzeppelin/IERC20.sol";

// import { Vault } from "../../balancer-core-v2/vault/Vault.sol";
import { Authorizer } from "../../balancer-core-v2/vault/LocalAuthorizer.sol";
import { IAuthorizer } from "../../balancer-core-v2/vault/interfaces/ILocalAuthorizer.sol";
import { IVault } from "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import { IVault as ILocalVault } from "../../balancer-core-v2/vault/interfaces/IVault.sol";
import { IAsset } from "@balancer-labs/v2-interfaces/contracts/vault/IAsset.sol";
// import { IAsset } from "../../balancer-core-v2/vault/interfaces/IAsset.sol";
// import { IWETH } from "../../balancer-core-v2/vault/interfaces/IWETH.sol";
import { IWETH } from "@balancer-labs/v2-interfaces/contracts/solidity-utils/misc/IWETH.sol";

import { WETH } from "../../balancer-core-v2/test/WETH.sol";

import { TestToken } from "../../helpers/TestToken.sol";
import { ICronV1Pool } from "../../interfaces/ICronV1Pool.sol";
import { ICronV1PoolEnums } from "../../interfaces/pool/ICronV1PoolEnums.sol";
import { ICronV1PoolFactory } from "../../interfaces/ICronV1PoolFactory.sol";
import { CronV1PoolFactory } from "../../factories/CronV1PoolFactory.sol";

import { CronV1Actions } from "../../periphery/CronV1Actions.sol";
import { CronV1Relayer } from "../../periphery/CronV1Relayer.sol";
import { ICronV1Relayer } from "../../interfaces/ICronV1Relayer.sol";

contract AtomicActionsForkTest is Test {
  Authorizer public authorizer;
  ICronV1Relayer public relayer;
  CronV1Actions public relayerLib;

  address constant AUTHORIZER = 0xA331D84eC860Bf466b4CdCcFb4aC09a1B43F3aE6;
  address constant ADMIN = 0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f;
  // Vault public vault;
  address constant VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
  // WETH public weth;
//  address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
  CronV1PoolFactory public factory;
  TestToken public tokenA;
  TestToken public tokenB;
  TestToken public tokenC;
  address public pool;

  IVault public vault = IVault(VAULT);
  ILocalVault public vault2 = ILocalVault(VAULT);

  function setUp() public {
    // owner = address(this);
    // weth = new WETH(owner);
    // create Balancer Vault
    // authorizer = new Authorizer(owner);
    // vault = new Vault(authorizer, IWETH(weth), 0, 0);
    vm.label(VAULT, "vault");
    // create TWAMM pool factory
    factory = new CronV1PoolFactory(vault2);
    // create Cron-Fi Relayer & Actions:
    relayerLib = new CronV1Actions(vault, ICronV1PoolFactory(address(factory)));
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
      // Production Vault Action IDs
      bytes32[] memory roles = generateActionIds(VAULT);
      vm.startPrank(ADMIN);
      IAuthorizer(AUTHORIZER).grantRoles(roles, address(relayer));
      vm.stopPrank();
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

  // function testForkRegularSwap() public {
  //   address retailTrader = vm.addr(99);

  //   // NOTE: In this test Token0 of the pool is TokenB and Token1 of the pool is TokenA
  //   tokenB.transfer(retailTrader, 1000e18);

  //   vm.startPrank(retailTrader);
  //   _swap(
  //     100e18,                                      // Swap Amount
  //     0,                                           // Argument - ignored,
  //     ICronV1PoolEnums.SwapType.RegularSwap,
  //     true,                                        // Direction (0 -> 1, true)
  //     pool,
  //     retailTrader);
  //   vm.stopPrank();
  // }

  // function testForkSetCronRelayer() public {
  //   address retailTrader = vm.addr(99);
  //   vm.startPrank(retailTrader);
  //   // 1. Confirm that we have not yet authorized the relayer:
  //   bool relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
  //   // 2. Authorize the relayer:
  //   if (!relayerApproved) {
  //     relayer.setCronRelayerApproval(retailTrader, address(relayer), true);
  //   }
  //   // 3. Confirm relayer authorization:
  //   relayerApproved = vault.hasApprovedRelayer(retailTrader, address(relayer));
  //   assertEq(relayerApproved, true);
  //   // 4. Unauthorize the relayer:
  //   if (relayerApproved) {
  //     relayer.setCronRelayerApproval(retailTrader, address(relayer), false);
  //   }
  //   assertEq(relayerApproved, false);
  //   vm.stopPrank();
  // }

  function testForkRelayerShortSwap() public {
    address retailTrader = vm.addr(99);
    
    uint256 slippageBP = 500;
    uint256 swapAmt = 1000e18;
    uint256 minSwapAmt = (swapAmt * (10000-slippageBP)) / 10000; 

    // NOTE: In this test Token0 of the pool is TokenB and Token1 of the pool is TokenA
    tokenB.transfer(retailTrader, swapAmt);
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
    tokenB.approve(VAULT, swapAmt);
    relayer.swap(
      address(tokenB),                           // Token In
      address(tokenA),                           // Token Out
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      swapAmt,                                   // Swap Amount
      minSwapAmt,
      retailTrader                               // Destination
    );
    vm.stopPrank();
  }

  function testForkRelayerLongSwap() public {
    _relayerLongSwap();
  }

  function testForkRelayerLongSwapCancel() public {
    _relayerLongSwap();
    address retailLP = vm.addr(99);
    vm.startPrank(retailLP);
    relayer.cancel(
      address(tokenA),
      address(tokenB),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      0,                               // orderId
      retailLP                         // Receiver address
    );
    vm.stopPrank();
  }

  function testForkRelayerJoin() public {
    _relayerJoin();
  }

  function testForkRelayerExit() public {
    _relayerJoin();
    address retailLP = vm.addr(99);
    vm.startPrank(retailLP);
    uint256 lpTokens = ICronV1Pool(pool).balanceOf(retailLP);
    relayer.exit(
      address(tokenA),
      address(tokenB),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      lpTokens,                        // num of LP tokens
      9e18,                            // Min Token 0
      9e18,                            // Min Token 1
      retailLP                         // Receiver address
    );
    vm.stopPrank();
  }

  function _relayerLongSwap() public {
    address retailTrader = vm.addr(99);
    // NOTE: In this test Token0 of the pool is TokenB and Token1 of the pool is TokenA
    tokenB.transfer(retailTrader, 1000e18);
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
    tokenB.approve(VAULT, 1000e18);
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

  function _relayerJoin() public {
    address retailLP = vm.addr(99);
    // NOTE: In this test Token0 of the pool is TokenB and Token1 of the pool is TokenA
    tokenA.transfer(retailLP, 1000e18);
    tokenB.transfer(retailLP, 1000e18);
    {
      // 1. Confirm that we have not yet authorized the relayer:
      bool relayerApproved = vault.hasApprovedRelayer(retailLP, address(relayer));
      // 2. Authorize the relayer:
      vm.startPrank(retailLP);
      vault.setRelayerApproval(retailLP, address(relayer), true);
      vm.stopPrank();
      // 3. Confirm relayer authorization:
      relayerApproved = vault.hasApprovedRelayer(retailLP, address(relayer));
    }
    vm.startPrank(retailLP);
    tokenA.approve(VAULT, 10e18);
    tokenB.approve(VAULT, 10e18);
    relayer.join(
      address(tokenA),
      address(tokenB),
      uint256(ICronV1PoolEnums.PoolType.Liquid),
      10e18,                           // Token 0
      10e18,                           // Token 1
      9e18,                            // Min Token 0
      9e18,                            // Min Token 1
      retailLP                         // Receiver address
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
    IERC20(tokens[0]).approve(VAULT, _liquidity0);
    IERC20(tokens[1]).approve(VAULT, _liquidity1);
    // call joinPool function on TWAMMs
    // TODO: call vault.joinPool direct w/o IVault
    vault.joinPool(
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
    token.approve(VAULT, _amountIn);

    // swap amounts with vault
    // TODO: call vault.swap direct w/o IVault
    amountOut = vault.swap(
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
