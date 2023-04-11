pragma solidity ^0.7.0;

pragma experimental ABIEncoderV2;

import "forge-std/Test.sol";

import "../HelperContract.sol";

contract AdminTests is HelperContract {

  function setUp() public {
  }

  // factory owner priveleges

  function testAutoSetFactoryOwner() public {
    // directly
    factory.transferOwnership(vm.addr(100), true, false);
    assertEq(vm.addr(100), factory.owner());
    // indirectly
    vm.startPrank(vm.addr(100));
    factory.transferOwnership(address(this), false, false);
    // claim with wrong address
    vm.expectRevert(bytes("CFI#504"));
    factory.claimOwnership();
    vm.stopPrank();
    factory.claimOwnership();
    // transfer from non-owner
    vm.startPrank(vm.addr(101));
    vm.expectRevert(bytes("CFI#503"));
    factory.transferOwnership(vm.addr(101), true, false);
    vm.stopPrank();
    // renounce ownership
    factory.transferOwnership(address(0), true, true);
    assertEq(address(0), factory.owner());
  }

  function testAutoSetAdminStatus() public {
    ICronV1Pool(pool).setAdminStatus(vm.addr(1), true);
    vm.startPrank(vm.addr(1));
    vm.expectRevert(bytes("CFI#001"));
    ICronV1Pool(pool).setAdminStatus(vm.addr(2), false);
    vm.stopPrank();
    ICronV1Pool(pool).setAdminStatus(vm.addr(1), false);
  }

  function testAutoSetFeeAddress() public {
    ICronV1Pool(pool).setFeeAddress(vm.addr(1));
    vm.startPrank(vm.addr(1));
    vm.expectRevert(bytes("CFI#001"));
    ICronV1Pool(pool).setFeeAddress(vm.addr(2));
    vm.stopPrank();
  }

  // function testAutoSetCollectCronFiFees() public {
  //   ICronV1Pool(pool).setCollectCronFiFees(true);
  //   ICronV1Pool(pool).setCollectCronFiFees(false);
  //   vm.startPrank(vm.addr(1));
  //   vm.expectRevert(bytes("CFI#001"));
  //   ICronV1Pool(pool).setCollectCronFiFees(true);
  //   vm.stopPrank();
  // }

  function testAutoSetCollectBalancerFees() public {
    ICronV1Pool(pool).setCollectBalancerFees(true);
    ICronV1Pool(pool).setCollectBalancerFees(false);
    vm.startPrank(vm.addr(1));
    vm.expectRevert(bytes("CFI#001"));
    ICronV1Pool(pool).setCollectBalancerFees(true);
    vm.stopPrank();
  }

  // admin priveleges

  function testAutoSetPause() public {
    ICronV1Pool(pool).setAdminStatus(address(this), false);
    vm.expectRevert(bytes("CFI#002"));
    ICronV1Pool(pool).setPause(true);
    ICronV1Pool(pool).setAdminStatus(vm.addr(1), true);
    vm.startPrank(vm.addr(1));
    ICronV1Pool(pool).setPause(false);
    ICronV1Pool(pool).setPause(true);
    vm.stopPrank();
    ICronV1Pool(pool).setAdminStatus(vm.addr(1), false);
    ICronV1Pool(pool).setAdminStatus(address(this), true);
    ICronV1Pool(pool).setPause(false);
  }

  function testAutoSetArbitragePartner() public {
    ICronV1Pool(pool).setAdminStatus(address(this), false);
    ICronV1Pool(pool).setAdminStatus(vm.addr(1), true);
    vm.startPrank(vm.addr(1));
    ICronV1Pool(pool).setArbitragePartner(vm.addr(2), address(arbPartners));
    vm.stopPrank();
    ICronV1Pool(pool).setAdminStatus(vm.addr(1), false);
    ICronV1Pool(pool).setAdminStatus(address(this), true);
    ICronV1Pool(pool).setArbitragePartner(vm.addr(3), address(arbPartners));
  }

  function testAutoSetParameter() public {
    ICronV1Pool(pool).setAdminStatus(address(this), false);
    vm.expectRevert(bytes("CFI#002"));
    ICronV1Pool(pool).setParameter(0, 100);
    ICronV1Pool(pool).setAdminStatus(address(this), true);
    // test bad params first
    // vm.expectRevert(bytes("CFI#303"));
    // ICronV1Pool(pool).setParameter(4, 100);
    // vm.expectRevert(bytes("CFI#403"));
    // ICronV1Pool(pool).setParameter(3, 10000);
    vm.expectRevert(bytes("CFI#403"));
    ICronV1Pool(pool).setParameter(2, 3000);
    // valid params
    ICronV1Pool(pool).setParameter(0, 100);
    ICronV1Pool(pool).setParameter(1, 1000);
    ICronV1Pool(pool).setParameter(2, 300);
  }

  function testAutoUpdateArbitrageList() public {
    ICronV1Pool(pool).setAdminStatus(address(this), false);
    vm.expectRevert(bytes("CFI#003"));
    ICronV1Pool(pool).updateArbitrageList();
    ICronV1Pool(pool).setAdminStatus(vm.addr(1), true);
    vm.startPrank(vm.addr(1));
    ICronV1Pool(pool).setArbitragePartner(vm.addr(1), address(arbPartners));
    ICronV1Pool(pool).updateArbitrageList();
    vm.stopPrank();
    vm.startPrank(vm.addr(2));
    vm.expectRevert(bytes("CFI#003"));
    ICronV1Pool(pool).updateArbitrageList();
    vm.stopPrank();
  }
  
}
