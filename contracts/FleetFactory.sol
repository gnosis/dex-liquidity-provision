pragma solidity >= 0.5.0 < 0.7.0;

import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol";
import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxy.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";

contract FleetFactory {
  GnosisSafeProxyFactory public proxyFactory;

  event FleetDeployed(address indexed owner, address[] fleet);

  constructor(GnosisSafeProxyFactory _proxyFactory) public {
    proxyFactory = _proxyFactory;
  }

  function deployFleet(address owner, uint256 size) public returns (address[] memory) {
    IProxy ownerProxyReader = IProxy(owner);
    return deployFleetFromTemplate(owner, size, ownerProxyReader.masterCopy());
  }

  function deployFleetFromTemplate(address owner, uint256 size, address template) public returns (address[] memory) {
    address[] memory fleet = new address[](size);
    address[] memory ownerList = new address[](1);
    ownerList[0] = owner;
    for (uint i = 0; i < size; i++) {
      address payable proxy = address(proxyFactory.createProxy(template, ""));
      fleet[i] = proxy;
      GnosisSafe safe = GnosisSafe(proxy);
      safe.setup(
        ownerList,
        1,
        address(0),
        "",
        address(0),
        address(0),
        0,
        address(0)
      );
    }
    emit FleetDeployed(owner, fleet);
    return fleet;
  }
}
