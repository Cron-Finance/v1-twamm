pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../balancer-core-v2/vault/Vault.sol";
import "../balancer-core-v2/vault/interfaces/IAsset.sol";
import "../balancer-core-v2/test/WETH.sol";

import "../helpers/TestToken.sol";
import "../interfaces/ICronV1Pool.sol";
import "../interfaces/pool/ICronV1PoolEnums.sol";
import "../factories/CronV1PoolFactory.sol";
import "../exposed/CronV1PoolFactoryExposed.sol";
import "../partners/ArbitrageurListExample.sol";

abstract contract HelperContract is Test {
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
  address[] public arbitrageurs;
  ArbitrageurListExample public arbPartners;

  // setup event expectations to match
  event PoolJoin( address indexed sender,
                address indexed token0, 
                uint256 token0In,
                address indexed token1, 
                uint256 token1In,
                uint256 poolTokenAmt );
  event Donate( address indexed sender,
                address indexed token0,
                uint256 token0In,
                address indexed token1,
                uint256 token1In );

  constructor () {
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
    arbitrageurs = [owner, vm.addr(10), vm.addr(11), vm.addr(12)];
    arbPartners = new ArbitrageurListExample(arbitrageurs);
    ICronV1Pool(pool).setAdminStatus(address(this), true);
  }

  function batchMineBlocks(uint256 _numBlocks) public {
    emit log_uint(block.number);
    vm.roll(block.number + _numBlocks);
    string[] memory inputs = new string[](3);
    inputs[0] = "cast";
    inputs[1] = "rpc";
    inputs[2] = _toString(_numBlocks);
    bytes memory res = vm.ffi(inputs);
    emit log_uint(block.number);
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
  
  function getMaxAmountsIn(IERC20[] memory tokens)
           public pure
           returns(uint256[] memory maxAmountsIn)
  {
    maxAmountsIn = new uint256[](tokens.length);
    for (uint256 i; i < tokens.length; i++) {
      maxAmountsIn[i] = type(uint256).max;
    }
  }

  function addLiquidityRevert(
    address _pool,
    address _from,
    address _to,
    uint256 _liquidity0,
    uint256 _liquidity1,
    uint256 _joinKind,
    string memory revertStr
  ) public {
    vm.startPrank(_from);
    // setup parameters for joinPool
    bytes memory userData = getJoinUserData(_joinKind, _liquidity0, _liquidity1);
    bytes32 poolId = ICronV1Pool(_pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    uint256[] memory maxAmountsIn = new uint256[](tokens.length);
    for (uint256 i; i < tokens.length; i++) {
      maxAmountsIn[i] = type(uint256).max;
    }
    // bool fromInternalBalance = false;
    // approve tokens to be used by vault
    IERC20(tokens[0]).approve(address(vault), _liquidity0);
    IERC20(tokens[1]).approve(address(vault), _liquidity1);
    // call joinPool function on TWAMMs
    bytes memory revertStrTest = bytes(revertStr); // Uses memory
    if (revertStrTest.length > 0) {
      vm.expectRevert(bytes(revertStr));
    }
    IVault(vault).joinPool(
      poolId,
      _from,
      payable (_to),
      IVault.JoinPoolRequest(
        assets,
        maxAmountsIn,
        userData,
        false
      )
    );
    vm.stopPrank();
  }
  
  function addLiquidityWithMin(
    address _pool,
    address _from,
    address _to,
    uint256 _liquidity0,
    uint256 _liquidity1,
    uint256 _minLiquidity0,
    uint256 _minLiquidity1,
    uint256 _joinKind,
    string memory revertStr
  ) public {
    vm.startPrank(_from);
    // setup parameters for joinPool
    (bytes memory userData) = getJoinUserDataWithMin(_joinKind,
                                                     _liquidity0,
                                                     _liquidity1,
                                                     _minLiquidity0,
                                                     _minLiquidity1);
    bytes32 poolId = ICronV1Pool(_pool).POOL_ID();
    (IERC20[] memory tokens, , ) = vault.getPoolTokens(poolId);
    IAsset[] memory assets = _convertERC20sToAssets(tokens);
    // approve tokens to be used by vault
    IERC20(tokens[0]).approve(address(vault), _liquidity0);
    IERC20(tokens[1]).approve(address(vault), _liquidity1);
    // If revertStr defined, expect revert
    bytes memory revertStrTest = bytes(revertStr); // Uses memory
    if (revertStrTest.length > 0) {
      vm.expectRevert(bytes(revertStr));
    }
    // call joinPool function on TWAMMs
    IVault(vault).joinPool(
      poolId,
      _from,
      payable (_to),
      IVault.JoinPoolRequest(
        assets,
        getMaxAmountsIn(tokens),
        userData,
        false       // fromInternalBalance
      )
    );
    vm.stopPrank();
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

  function addLiquidity(uint256 _liquidity0, uint256 _liquidity1, uint256 _joinKind) public {
    addLiquidity(pool, owner, owner, _liquidity0, _liquidity1, _joinKind);
  }

  function swap(
    uint256 _amountIn,
    uint256 _argument,
    ICronV1Pool.SwapType _swapType,
    bool _zeroToOne,
    address _pool,
    address _trader
  ) public returns (uint256 amountOut) {
    vm.startPrank(_trader);
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
    amountOut = IVault(vault).swap(
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
    vm.stopPrank();
  }

  function swapPoolAddr(
    uint256 _amountIn,
    uint256 _argument,
    ICronV1Pool.SwapType _swapType,
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

  function swap(
    uint256 _amountIn,
    uint256 _argument,
    ICronV1Pool.SwapType _swapType,
    bool _zeroToOne
  ) public returns (uint256 amountOut) {
    amountOut = swap (_amountIn, _argument, _swapType, _zeroToOne, pool, address(this));
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
    ICronV1Pool.ExitType _exitType,
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
    uint256[] memory minAmountOut = getMinAmountsOut(0, 0);
    // swap amounts with vault
    IVault(vault).exitPool(
      ICronV1Pool(_pool).POOL_ID(),
      _trader,
      payable (_trader),
      IVault.ExitPoolRequest(
        assets,
        minAmountOut,
        userData,
        false
      )
    );
    vm.stopPrank();
  }

  function exitRevert(
    uint _argument,
    ICronV1Pool.ExitType _exitType,
    address _pool,
    address _trader,
    string memory revertStr
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
    uint256[] memory minAmountOut = getMinAmountsOut(0, 0);
    // swap amounts with vault
    bytes memory revertStrTest = bytes(revertStr); // Uses memory
    if (revertStrTest.length > 0) {
      vm.expectRevert(bytes(revertStr));
    }
    IVault(vault).exitPool(
      poolId,
      _trader,
      payable (_trader),
      IVault.ExitPoolRequest(
        assets,
        minAmountOut,
        userData,
        false
      )
    );
    vm.stopPrank();
  }
  
  function exitRevertWithMin(
    uint _argument,
    uint256 _minToken0,
    uint256 _minToken1,
    ICronV1Pool.ExitType _exitType,
    address _pool,
    address _trader,
    string memory revertStr
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
    uint256[] memory minAmountOut = getMinAmountsOut(_minToken0, _minToken1);
    // swap amounts with vault
    bytes memory revertStrTest = bytes(revertStr); // Uses memory
    if (revertStrTest.length > 0) {
      vm.expectRevert(bytes(revertStr));
    }
    IVault(vault).exitPool(
      poolId,
      _trader,
      payable (_trader),
      IVault.ExitPoolRequest(
        assets,
        minAmountOut,
        userData,
        false
      )
    );
    vm.stopPrank();
  }

  function exit(
    uint _argument,
    ICronV1Pool.ExitType _exitType
  ) public {
    exit(_argument, _exitType, pool, owner);
  }

  function _convertERC20sToAssets(IERC20[] memory tokens) internal pure returns (IAsset[] memory assets) {
    // solhint-disable-next-line no-inline-assembly
    assembly {
      assets := tokens
    }
  }

  // TESTING ONLY
  // Source: https://stackoverflow.com/questions/47129173/how-to-convert-uint-to-string-in-solidity
  function _toString(uint _i) internal pure returns (string memory _uintAsString) {
    if (_i == 0) {
        return "0";
    }
    uint j = _i;
    uint len;
    while (j != 0) {
      len++;
      j /= 10;
    }
    bytes memory bstr = new bytes(len);
    uint k = len;
    while (_i != 0) {
      k = k-1;
      uint8 temp = (48 + uint8(_i - _i / 10 * 10));
      bytes1 b1 = bytes1(temp);
      bstr[k] = b1;
      _i /= 10;
    }
    return string(bstr);
  }

  function _addFuzzInitialLiquidity(uint256 _liquidity0, uint256 _liquidity1) internal {
    uint joinKind = 0;
    addLiquidity(_liquidity0, _liquidity1, joinKind);
  }

  function _addInitialLiquidity() internal {
    uint liquidity0 = 100e18;
    uint liquidity1 = 100e18;
    uint joinKind = 0;
    addLiquidity(liquidity0, liquidity1, joinKind);
  }
}
