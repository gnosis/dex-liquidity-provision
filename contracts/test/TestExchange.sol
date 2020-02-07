pragma solidity >=0.4.21 <0.6.0;

import "@gnosis.pm/util-contracts/contracts/GnosisStandardToken.sol";

contract TestExchange {
    mapping(address => uint256) public deposits;
    GnosisStandardToken public baseToken;
    constructor(GnosisStandardToken _baseToken) public {
        baseToken = _baseToken;
    }

    function deposit(uint256 amount) public {
        uint currentDeposit = deposits[msg.sender];
        uint newDeposit = currentDeposit + amount;
        require(newDeposit > currentDeposit, "Overflow");
        deposits[msg.sender] = newDeposit;
        require(baseToken.transferFrom(msg.sender, address(this), amount), "Insufficient allowance");
    }
}