pragma solidity >=0.5.0 <0.7.0;

import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxy.sol";

contract EvilGnosisSafeProxy is GnosisSafeProxy {
    event Evil();

    constructor(address _masterCopy) public GnosisSafeProxy(_masterCopy) {}

    function doEvil() public {
        emit Evil();
    }
}
