pragma solidity >=0.5.0;
import "./BatchExchangeInterface.sol";
contract ContractExample {
    BatchExchangeInterface public batchExchange;
    uint256 public initialBatchId;
    constructor(BatchExchangeInterface _batchExchange) public {
        batchExchange = _batchExchange;
        initialBatchId = batchExchange.getCurrentBatchId();
    }
}
