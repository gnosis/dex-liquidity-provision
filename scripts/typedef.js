/**
 * @typedef {import('bn.js')} BN
 */

/**
 * Ethereum addresses are composed of the prefix "0x", a common identifier for hexadecimal,
 * concatenated with the rightmost 20 bytes of the Keccak-256 hash (big endian) of the ECDSA public key
 * (cf. https://en.wikipedia.org/wiki/Ethereum#Addresses)
 *
 * @typedef Address
 */

/**
 * Smart contracts are high-level programming abstractions that are compiled down
 * to EVM bytecode and deployed to the Ethereum blockchain for execution.
 * This particular type is that of a JS object representing the Smart contract ABI.
 * (cf. https://en.wikipedia.org/wiki/Ethereum#Smart_contracts)
 *
 * @typedef SmartContract
 */

/**
 * Example:
 * {
 *   amount: 100,
 *   tokenAddress: 0x0000000000000000000000000000000000000000,
 *   bracketAddress: 0x0000000000000000000000000000000000000001
 * }
 *
 * @typedef Deposit
 * @type {object}
 * @property {number|string|BN} amount integer denoting amount to be deposited
 * @property {Address} tokenAddress {@link Address} of token to be deposited
 * @property {Address} bracketAddress address of bracket into which to deposit
 */

/**
 * Example:
 * {
 *   amount: 100,
 *   tokenAddress: 0x0000000000000000000000000000000000000000,
 *   toAddress: 0x0000000000000000000000000000000000000001
 * }
 *
 * @typedef Transfer
 * @type {object}
 * @property {number|string|BN} amount value denoting amount to be transferred
 * @property {Address} tokenAddress {@link Address} of ERC20 token to be transfered
 * @property {Address} receiver {@link Address} of bracket into which to transfer
 */

/**
 * @typedef Withdrawal
 * Example:
 * {
 *   amount: "100",
 *   bracketAddress: "0x0000000000000000000000000000000000000000",
 *   tokenAddress: "0x0000000000000000000000000000000000000000",
 * }
 * @type {object}
 * @property {number|string|BN} amount Integer denoting amount to be deposited
 * @property {Address} bracketAddress Ethereum address of the bracket from which to withdraw
 * @property {Address} tokenAddresses List of tokens that the traded wishes to withdraw
 */

/**
 * @typedef TokenObject
 * Example:
 * {
 *   symbol: "WETH",
 *   decimals: 18,
 *   tokenAddress: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
 *   instance: [object Object],
 * }
 * @type {object}
 * @property {string} symbol symbol representing the token
 * @property {(number|BN)} decimals number of decimals of the token
 * @property {Address} address address of the token contract on the EVM
 * @property {object} instance an instance of the token contract
 */

/**
 * @typedef Transaction
 * Example:
 *  {
 *    operation: CALL,
 *    to: "0x0000..000",
 *    value: "10",
 *    data: "0x00",
 *  }
 * @type {object}
 * @property {number} operation Either CALL or DELEGATECALL
 * @property {Address} to Ethereum address receiving the transaction
 * @property {number|string|BN} value Amount of ETH transferred
 * @property {string} data Data sent along with the transaction
 */
