pragma solidity ^0.5.0;

interface BatchExchangeInterface {
    // View Methods
    function getCurrentBatchId() external view returns (uint32);
    function tokenAddressToIdMap(address addr) external view returns (uint16);
    function tokenIdToAddressMap(uint16 id) external view returns (address);

    // EpochTokenLocker Methods
    function deposit(address token, uint256 amount) external;
    function requestWithdraw(address token, uint256 amount) external;
    function withdraw(address user, address token) external;

    // BatchExchange Methods
    function addToken(address token) external;
    function placeOrder(
        uint16 buyToken,
        uint16 sellToken,
        uint32 validUntil,
        uint128 buyAmount,
        uint128 sellAmount
    ) external returns (uint256);
    function placeValidFromOrders(
        uint16[] calldata buyTokens,
        uint16[] calldata sellTokens,
        uint32[] calldata validFroms,
        uint32[] calldata validUntils,
        uint128[] calldata buyAmounts,
        uint128[] calldata sellAmounts
    ) external returns (uint16[] memory orderIds);
    function cancelOrders(uint16[] calldata orderIds) external;
}
