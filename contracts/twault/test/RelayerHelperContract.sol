pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import { Test } from "forge-std/Test.sol";
import { console } from "forge-std/console.sol";

import { IERC20 } from "../balancer-core-v2/lib/openzeppelin/IERC20.sol";
import { IVault } from "@balancer-labs/v2-interfaces/contracts/vault/IVault.sol";
import { IAsset } from "@balancer-labs/v2-interfaces/contracts/vault/IAsset.sol";

import { Vault } from "../balancer-core-v2/vault/Vault.sol";
import { Authorizer } from "../balancer-core-v2/vault/Authorizer.sol";
import { IWETH } from "../balancer-core-v2/vault/interfaces/IWETH.sol";
import { WETH } from "../balancer-core-v2/test/WETH.sol";

import { TestToken } from "../helpers/TestToken.sol";
import { ICronV1Pool } from "../interfaces/ICronV1Pool.sol";
import { ICronV1PoolEnums } from "../interfaces/pool/ICronV1PoolEnums.sol";
import { ICronV1PoolFactory } from "../interfaces/ICronV1PoolFactory.sol";
import { CronV1PoolFactory } from "../factories/CronV1PoolFactory.sol";

import { CronV1Actions } from "../periphery/CronV1Actions.sol";
import { CronV1Relayer } from "../periphery/CronV1Relayer.sol";
import { ICronV1Relayer } from "../interfaces/ICronV1Relayer.sol";

abstract contract RelayerHelperContract is Test {
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

  constructor () {
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
      "TA-TB-Liquid",
      "TA-TB-L",
      1
    );
    ICronV1Pool(pool).setAdminStatus(address(this), true);
    bytes32[] memory roles = generateActionIds(address(vault));
    authorizer.grantRoles(roles, address(relayer));
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
    uint256 secondsPerBlock = 12;
    vm.roll(block.number + _numBlocks);
    vm.warp(block.timestamp + secondsPerBlock);
    // console.log("block time", block.timestamp);
    // emit log_uint(block.number);
  }

  function mineBlocks() public {
    mineBlocks(1);
  }
  
  function getMaxAmountsIn(IERC20[] memory tokens)
           public pure
           returns(uint256[] memory maxAmountsIn)
  {
    maxAmountsIn = new uint256[](tokens.length);
    for (uint256 i; i < tokens.length; i++) {
      maxAmountsIn[i] = type(uint256).max;
    }
  }

  function addLiquidity(
    address _pool,
    address _from,
    address _to,
    uint256 _liquidity0,
    uint256 _liquidity1,
    uint256 _poolType,
    string memory revertStr
  ) public {
    _approveRelayer(_from);
    vm.startPrank(_from);
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(ICronV1Pool(_pool).POOL_ID());
    // call joinPool function on TWAMMs
    bytes memory revertStrTest = bytes(revertStr); // Uses memory
    if (revertStrTest.length > 0) {
      vm.expectRevert(bytes(revertStr));
    }
    tokens[0].approve(address(vault), _liquidity0);
    tokens[1].approve(address(vault), _liquidity1);
    relayer.join(
      address(tokens[0]),
      address(tokens[1]),
      _poolType,
      _liquidity0,
      _liquidity1,
      (_liquidity0 * 9)/10,
      (_liquidity1 * 9)/10,
      _to
    );
    vm.stopPrank();
  }

  function addLiquidity(uint256 _liquidity0, uint256 _liquidity1, uint256 _poolType) public {
    addLiquidity(pool, owner, owner, _liquidity0, _liquidity1, _poolType);
  }

  function addLiquidity(
    address _pool,
    address _from,
    address _to,
    uint256 _liquidity0,
    uint256 _liquidity1,
    uint256 _poolType
  ) public {
    addLiquidity(_pool, _from, _to, _liquidity0, _liquidity1, _poolType, "");
  }

  function swap(
    uint256 _amountIn,
    uint256 _argument,
    ICronV1Pool.SwapType _swapType,
    address _tokenIn
  ) public returns (uint256 amountOut) {
    amountOut = swap (_amountIn, _argument, _swapType, _tokenIn, pool, address(this));
  }

  function swap(
    uint256 _amountIn,
    uint256 _argument,
    ICronV1Pool.SwapType _swapType,
    address _tokenIn,
    address _pool,
    address _trader
  ) public returns (uint256 amountOut) {
    _approveRelayer(_trader);
    vm.startPrank(_trader);
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(ICronV1Pool(_pool).POOL_ID());
    IERC20(_tokenIn).approve(address(vault), _amountIn);
    if (_swapType == ICronV1PoolEnums.SwapType.RegularSwap) {
      relayer.swap(
        (_tokenIn == address(tokens[0])) ? address(tokens[0]) : address(tokens[1]),
        (_tokenIn == address(tokens[0])) ? address(tokens[1]) : address(tokens[0]),
        uint256(ICronV1PoolEnums.PoolType.Liquid),
        _amountIn,
        0,
        _trader
      );
    } else if (_swapType == ICronV1PoolEnums.SwapType.LongTermSwap) {
      relayer.longTermSwap(
        (_tokenIn == address(tokens[0])) ? address(tokens[0]) : address(tokens[1]),
        (_tokenIn == address(tokens[0])) ? address(tokens[1]) : address(tokens[0]),
        uint256(ICronV1PoolEnums.PoolType.Liquid),
        _amountIn,
        _argument,
        _trader
      );
    }
    vm.stopPrank();
  }
  
  function getMinAmountsOut(uint256 minToken0, uint256 minToken1)
           public pure
           returns(uint256[] memory minAmountsOut)
  {
    minAmountsOut = new uint256[](2);
    minAmountsOut[0] = minToken0;
    minAmountsOut[1] = minToken1;
  }

  function exit(
    uint _argument,
    ICronV1Pool.ExitType _exitType
  ) public {
    exit(_argument, _exitType, pool, owner);
  }

  function exit(
    uint _argument,
    ICronV1Pool.ExitType _exitType,
    address _pool,
    address _trader
  ) public {
    exit(_argument, _exitType, _pool, _trader, "");
  }

  function exit(
    uint _argument,
    ICronV1Pool.ExitType _exitType,
    address _pool,
    address _trader,
    string memory revertStr
  ) public {
    vm.startPrank(_trader);    
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(ICronV1Pool(_pool).POOL_ID());
    if (_exitType == ICronV1PoolEnums.ExitType.Exit) {
      relayer.exit(
        address(tokens[0]),
        address(tokens[1]),
        uint256(ICronV1PoolEnums.PoolType.Liquid),
        _argument,
        0,
        0,
        _trader
      );
    } else if (_exitType == ICronV1PoolEnums.ExitType.Withdraw) {
      relayer.withdraw(
        address(tokens[0]),
        address(tokens[1]),
        uint256(ICronV1PoolEnums.PoolType.Liquid),
        _argument,
        _trader
      );
    } else if (_exitType == ICronV1PoolEnums.ExitType.Cancel) {
      relayer.cancel(
        address(tokens[0]),
        address(tokens[1]),
        uint256(ICronV1PoolEnums.PoolType.Liquid),
        _argument,
        _trader
      );
    }
    vm.stopPrank();
  }
  
  function _approveRelayer (address _from) public {
    bool relayerApproved = vault.hasApprovedRelayer(_from, address(relayer));
    if (!relayerApproved) {
      vm.startPrank(_from);
      vault.setRelayerApproval(_from, address(relayer), true);
      vm.stopPrank();
      relayerApproved = vault.hasApprovedRelayer(_from, address(relayer));
    }
    assertEq(relayerApproved, true);
  }

  function _addFuzzInitialLiquidity(uint256 _liquidity0, uint256 _liquidity1) internal {
    uint poolType = 1;
    addLiquidity(_liquidity0, _liquidity1, poolType);
  }

  function _addInitialLiquidity() internal {
    uint liquidity0 = 100e18;
    uint liquidity1 = 100e18;
    uint poolType = 1;
    addLiquidity(liquidity0, liquidity1, poolType);
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

  function _convertERC20sToAssets(IERC20[] memory tokens) internal pure returns (IAsset[] memory assets) {
    // solhint-disable-next-line no-inline-assembly
    assembly {
      assets := tokens
    }
  }
}
