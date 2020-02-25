const Contract = require("@truffle/contract")
const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))

const assert = require("assert")
const BN = require("bn.js")
const { deploySafe, encodeMultiSend, execTransactionData, toETH } = require("../test/utils")

const ADDRESS_0 = "0x0000000000000000000000000000000000000000"
const CALL = 0
const DELEGATECALL = 1
const maxU32 = 2 ** 32 - 1
const max128 = new BN(2).pow(new BN(128)).subn(1)
const maxUINT = new BN(2).pow(new BN(256)).sub(new BN(1))

/**
 * Ethereum addresses are composed of the prefix "0x", a common identifier for hexadecimal,
 * concatenated with the rightmost 20 bytes of the Keccak-256 hash (big endian) of the ECDSA public key
 * (cf. https://en.wikipedia.org/wiki/Ethereum#Addresses)
 * @typedef EthereumAddress
 */

/**
 * Smart contracts are high-level programming abstractions that are compiled down
 * to EVM bytecode and deployed to the Ethereum blockchain for execution.
 * This particular type is that of a JS object representing the Smart contract ABI.
 * (cf. https://en.wikipedia.org/wiki/Ethereum#Smart_contracts)
 * @typedef SmartContract
 */

/**
 * @typedef Transaction
 *  * Example:
 *  {
 *    operation: CALL,
 *    to: "0x0000..000",
 *    value: "10",
 *    data: "0x00",
 *  }
 * @type {object}
 * @property {int} operation Either CALL or DELEGATECALL
 * @property {EthereumAddress} to Ethereum address receiving the transaction
 * @property {string} value Amount of ETH transferred
 * @property {string} data Data sent along with the transaction
 */

/**
 * @typedef TokenObject
 *  * Example:
 * {
 *   id: 0,
 *   address: 0x0000000000000000000000000000000000000000,
 *   symbol: "OWL",
 *   decimals: 18,
 * }
 * @type {object}
 * @property {integer} id integer denoting the id of the token on BatchExchange
 * @property {EthereumAddress} address Hex string denoting the ethereum address of token
 * @property {string} symbol short, usually abbreviated, token name
 * @property {integer} decimals number of decmial places token uses for a Unit
 */

/**
 * Example:
 * {
 *   amount: 100,
 *   tokenAddress: 0x0000000000000000000000000000000000000000,
 *   userAddress: 0x0000000000000000000000000000000000000001
 * }
 * @typedef Deposit
 * @type {object}
 * @property {integer} amount integer denoting amount to be deposited
 * @property {EthereumAddress} tokenAddress {@link EthereumAddress} of token to be deposited
 * @property {EthereumAddress} userAddress address of user depositing
 */

/**
 * @typedef Withdrawal
 *  * Example:
 * {
 *   amount: "100",
 *   traderAddress: "0x0000000000000000000000000000000000000000",
 *   tokenAddress: "0x0000000000000000000000000000000000000000",
 * }
 * @type {object}
 * @property {integer} amount Integer denoting amount to be deposited
 * @property {EthereumAddress} traderAddress Ethereum address of the trader performing the withdrawal
 * @property {EthereumAddress} tokenAddresses List of tokens that the traded wishes to withdraw
 */

/**
 * Example:
 * {
 *   to: 0xAE9e5E0f8c28264ef9808D9F10f28D9DaE09f089,
 *   data: 0x8d80ff0a...00808d9f10f
 * }
 * @typedef BatchedTransactionData
 * @type {object}
 * @property {EthereumAddress} to EthereumAddress of a MultiSend contract to be sent to
 * @property {string} data Hex string representing encoded batched transaction data
 */

const formatAmount = function(amount, token) {
  return new BN(10).pow(new BN(token.decimals)).muln(amount)
}

/**
 * Queries EVM for ERC20 token details by address
 * and returns a list of detailed token information.
 * @param {SmartContract} exchange BatchExchange, contract, or any contract implementing `tokenIdToAddressMap`
 * @param {integer[]} tokenIds list of token ids whose data is to be fetch from EVM
 * @return {TokenObject[]} list of detailed/relevant token information
 */
const fetchTokenInfo = async function(exchange, tokenIds, artifacts, debug = false) {
  const log = debug ? () => console.log.apply(arguments) : () => {}
  const ERC20 = artifacts.require("ERC20Detailed")

  log("Fetching token data from EVM")
  const tokenObjects = {}
  for (const id of tokenIds) {
    const tokenAddress = await exchange.tokenIdToAddressMap(id)
    const tokenInstance = await ERC20.at(tokenAddress)
    const tokenInfo = {
      id: id,
      address: tokenAddress,
      symbol: await tokenInstance.symbol.call(),
      decimals: (await tokenInstance.decimals.call()).toNumber(),
    }
    tokenObjects[id] = tokenInfo
    log(`Found Token ${tokenInfo.symbol} at ID ${tokenInfo.id} with ${tokenInfo.decimals} decimals`)
  }
  return tokenObjects
}

/**
 * Given a collection of transactions, creates a single transaction that bundles all of them
 * @param {Transaction[]} transactions List of {@link Transaction} that are to be bundled together
 * @return {Transaction} Multisend transaction bundling all input transactions
 */
const getBundledTransaction = async function(transactions, web3, artifacts) {
  const MultiSend = artifacts.require("MultiSend")
  BatchExchange.setProvider(web3.currentProvider)
  BatchExchange.setNetwork(web3.network_id)
  const multiSend = await MultiSend.deployed()
  const transactionData = await encodeMultiSend(multiSend, transactions, web3)
  const bundledTransaction = {
    operation: DELEGATECALL,
    to: multiSend.address,
    value: 0,
    data: transactionData,
  }
  return bundledTransaction
}

/**
 * Creates a transaction that makes a master Safe execute a transaction on behalf of a (single-owner) owned trader using execTransaction
 * TODO: we can probably merge this function with execTransactionData.
 * @param {EthereumAddress} masterAddress Address of a controlled Safe
 * @param {EthereumAddress} traderAddress Address of a Safe, owned only by master, target of execTransaction
 * @param {Transaction} transaction The transaction to be executed by execTransaction
 * @return {Transaction} Transaction calling execTransaction; should be executed by master
 */
const getExecTransactionTransaction = async function(masterAddress, traderAddress, transaction, web3, artifacts) {
  const GnosisSafe = artifacts.require("GnosisSafe")
  const gnosisSafeMasterCopy = await GnosisSafe.deployed()

  const execData = await execTransactionData(
    gnosisSafeMasterCopy,
    masterAddress,
    transaction.to,
    transaction.value,
    transaction.data,
    transaction.operation
  )
  const execTransactionTransaction = {
    operation: CALL,
    to: traderAddress,
    value: 0,
    data: execData,
  }
  return execTransactionTransaction
}

/**
 * Deploys specified number singler-owner Gnosis Safes having specified ownership
 * @param {string} fleetOwner {@link EthereumAddress} of Gnosis Safe (Multi-Sig)
 * @param {integer} fleetSize number of sub-Safes to be created with fleetOwner as owner
 * @return {EthereumAddress[]} list of Ethereum Addresses for the subsafes that were deployed
 */
const deployFleetOfSafes = async function(fleetOwner, fleetSize, artifacts, debug=false) {
  const log = debug ? (...a) => console.log(...a) : () => {}
  const GnosisSafe = artifacts.require("GnosisSafe")
  const ProxyFactory = artifacts.require("GnosisSafeProxyFactory.sol")

  const proxyFactory = await ProxyFactory.deployed()
  const gnosisSafeMasterCopy = await GnosisSafe.deployed()

  // TODO - Batch all of this in a single transaction
  const slaveSafes = []
  for (let i = 0; i < fleetSize; i++) {
    const newSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [fleetOwner], 1, artifacts)
    log("New Safe Created", newSafe.address)
    slaveSafes.push(newSafe.address)
  }
  return slaveSafes
}

/**
 * Batches together a collection of order placements on BatchExchange
 * on behalf of a fleet of safes owned by a single "Master Safe"
 * @param {string} fleetOwnerAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
 * @param {string[]} subSafeAddresses List of {@link EthereumAddress} for the subsafes acting as Trader Accounts
 * @param {integer} targetTokenId ID of token (on BatchExchange) whose target price is to be specified (i.e. ETH)
 * @param {integer} stableTokenId ID of "Stable Token" for which trade with target token (i.e. DAI)
 * @param {number} targetPrice Price at which the order brackets will be centered (e.g. current price of ETH in USD)
 * @param {number} [priceRangePercentage=20] Percentage above and below the target price for which orders are to be placed
 * @param {integer} [validFrom=3] Number of batches (from current) until orders become valid
 * @param {integer} [expiry=maxU32] Maximum auction batch for which these orders are valid (e.g. maxU32)
 * @return {BatchedTransactionData} all the relevant transaction data to be used when submitting to the Gnosis Safe Multi-Sig
 */
const buildOrderTransactionData = async function(
  fleetOwnerAddress,
  subSafeAddresses,
  targetTokenId,
  stableTokenId,
  targetPrice,
  web3,
  artifacts,
  debug = false,
  priceRangePercentage = 20,
  validFrom = 3,
  expiry = maxU32
) {
  const log = debug ? (...a) => console.log(...a) : () => {}
  const GnosisSafe = artifacts.require("GnosisSafe")
  const MultiSend = artifacts.require("MultiSend")

  await BatchExchange.setProvider(web3.currentProvider)
  await BatchExchange.setNetwork(web3.network_id)
  const exchange = await BatchExchange.deployed()
  const multiSend = await MultiSend.deployed()
  const gnosisSafeMasterCopy = await GnosisSafe.deployed()
  log("Batch Exchange", exchange.address)

  const batch_index = (await exchange.getCurrentBatchId.call()).toNumber()
  const tokenInfo = await fetchTokenInfo(exchange, [targetTokenId, stableTokenId], artifacts)

  const targetToken = tokenInfo[targetTokenId]
  const stableToken = tokenInfo[stableTokenId]
  // TODO - handle other cases later.
  assert(stableToken.decimals === 18, "Target token must have 18 decimals")
  assert(targetToken.decimals === 18, "Stable tokens must have 18 decimals")

  // Number of brackets is determined by subsafeAddresses.length
  const lowestLimit = targetPrice * (1 - priceRangePercentage / 100)
  const highestLimit = targetPrice * (1 + priceRangePercentage / 100)
  log(`Lowest-Highest Limit ${lowestLimit}-${highestLimit}`)

  const stepSize = (highestLimit - lowestLimit) / subSafeAddresses.length

  // let safeIndex = 0
  const transactions = []
  log(
    `Constructing bracket trading strategy order data based on valuation ${targetPrice} ${stableToken.symbol} per ${targetToken.symbol}`
  )
  for (let safeIndex = 0; safeIndex < subSafeAddresses.length; safeIndex++) {
    const traderAddress = subSafeAddresses[safeIndex]
    const traderSafe = await GnosisSafe.at(traderAddress)
    const slaveOwners = await traderSafe.getOwners()
    assert.equal(slaveOwners[0], fleetOwnerAddress, "All depositors must be owned by master safe")
    assert.equal(slaveOwners.length, 1, "Can only submit transactions on behalf of singly owned safes")

    const lowerLimit = lowestLimit + safeIndex * stepSize
    const upperLimit = lowestLimit + (safeIndex + 1) * stepSize

    // Sell targetToken for stableToken at targetTokenPrice = upperLimit
    // Sell 1 ETH at for 102 DAI (unlimited)
    // Sell x ETH for max256 DAI
    // x = max256 / 102
    const sellPrice = formatAmount(upperLimit, targetToken)
    // sellPrice = 102000000000000000000
    const upperSellAmount = max128
      .div(sellPrice)
      .mul(toETH(1))
      .toString()
    const upperBuyAmount = max128.toString()

    // Buy ETH at 101 for DAI (unlimited)
    // Sell stableToken for targetToken in at targetTokenPrice = lowerLimit
    // Sell 101 DAI for 1 ETH
    // Sell max256 DAI for x ETH
    // x = max256 / 101
    const buyPrice = formatAmount(lowerLimit, targetToken)
    const lowerSellAmount = max128.toString()
    const lowerBuyAmount = max128
      .div(buyPrice)
      .mul(toETH(1))
      .toString()

    log(`Safe ${safeIndex} - ${traderAddress}:\n  Buy  ${targetToken.symbol} with ${stableToken.symbol} at ${lowerLimit}`)
    log(`  Sell ${targetToken.symbol} for  ${stableToken.symbol} at ${upperLimit}`)
    const buyTokens = [targetTokenId, stableTokenId]
    const sellTokens = [stableTokenId, targetTokenId]
    const validFroms = [batch_index + validFrom, batch_index + validFrom]
    const validTos = [expiry, expiry]
    const buyAmounts = [lowerBuyAmount, upperBuyAmount]
    const sellAmounts = [lowerSellAmount, upperSellAmount]

    const orderData = await exchange.contract.methods
      .placeValidFromOrders(buyTokens, sellTokens, validFroms, validTos, buyAmounts, sellAmounts)
      .encodeABI()
    const multiSendData = await encodeMultiSend(
      multiSend,
      [{ operation: CALL, to: exchange.address, value: 0, data: orderData }],
      web3
    )

    const execData = await execTransactionData(
      gnosisSafeMasterCopy,
      fleetOwnerAddress,
      multiSend.address,
      0,
      multiSendData,
      DELEGATECALL
    )
    transactions.push({
      operation: CALL,
      to: traderAddress,
      value: 0,
      data: execData,
    })
  }
  log("Transaction bundle size", transactions.length)
  const finalData = await encodeMultiSend(multiSend, transactions, web3)
  return {
    to: multiSend.address,
    data: finalData,
  }
}

/**
 * Batches together a collection of operations (either withdraw or requestWithdraw) on BatchExchange
 * on behalf of a fleet of safes owned by a single "Master Safe"
 * @param {EthereumAddress} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
 * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
 * @param {string} functionName Name of the function that is to be executed (can be "requestWithdraw" or "withdraw")
 * @return {Transaction} Multisend transaction that has to be sent from the master address to either request
withdrawal of or to withdraw the desired funds
*/
const getGenericFundMovementTransaction = async function(masterAddress, withdrawals, functionName, web3, artifacts) {
  BatchExchange.setProvider(web3.currentProvider)
  BatchExchange.setNetwork(web3.network_id)
  const exchange = await BatchExchange.deployed()
  const masterTransactions = []

  // it's not necessary to avoid overlapping withdraws, since the full amount is withdrawn for each entry
  for (const withdrawal of withdrawals) {
    // create transaction for the token
    let transactionData
    switch (functionName) {
    /* eslint-disable indent */
      case "requestWithdraw":
        transactionData = await exchange.contract.methods["requestWithdraw"](
          withdrawal.tokenAddress,
          withdrawal.amount.toString()
        ).encodeABI()
        break
      case "withdraw":
        transactionData = await exchange.contract.methods["withdraw"](
          withdrawal.traderAddress,
          withdrawal.tokenAddress
        ).encodeABI()
        break
      default:
        assert(false, "Function " + functionName + "is not implemented")
    /* eslint-enable indent */
    }

    // prepare trader transaction
    const transactionToExecute = {
      operation: CALL,
      to: exchange.address,
      value: 0,
      data: transactionData,
    }
    // build transaction to execute previous transaction through master
    const execTransactionTransaction = await getExecTransactionTransaction(
      masterAddress,
      withdrawal.traderAddress,
      transactionToExecute,
      web3,
      artifacts
    )
    masterTransactions.push(execTransactionTransaction)
  }
  return getBundledTransaction(masterTransactions, web3, artifacts)
}

/**
 * Batches together a collection of transfer-related transaction data.
 * Particularily, the resulting transaction data is that of transfering all sufficient funds from fleetOwner
 * to its subSafes, then approving and depositing those same tokens into BatchExchange on behalf of each subSafe.
 * @param {string} fleetOwner Ethereum address of Master Gnosis Safe (Multi-Sig)
 * @param {Deposits[]} depositList List of {@link EthereumAddress} for the subsafes acting as Trader Accounts
 * @return {BatchedTransactionData} all the relevant transaction data to be used when submitting to the Gnosis Safe Multi-Sig
 */
const transferApproveDeposit = async function(fleetOwner, depositList, web3, artifacts, debug=false) {
  const log = debug ? (...a) => console.log(...a) : () => {}
  const ERC20 = artifacts.require("ERC20Detailed")
  const GnosisSafe = artifacts.require("GnosisSafe")
  const MultiSend = artifacts.require("MultiSend")

  BatchExchange.setProvider(web3.currentProvider)
  BatchExchange.setNetwork(web3.network_id)
  const exchange = await BatchExchange.deployed()
  log("Aquired Batch Exchange", exchange.address)
  const multiSend = await MultiSend.deployed()
  const gnosisSafeMasterCopy = await GnosisSafe.deployed()
  const transactions = []
  // TODO - make cumulative sum of deposits by token and assert that masterSafe has enough for the tranfer
  // TODO - make deposit list easier so that we dont' have to query the token every time.
  for (const deposit of depositList) {
    // const slaveSafe = await GnosisSafe.at(deposit.userAddress)
    // const slaveOwners = await slaveSafe.getOwners()
    // assert.equal(slaveOwners[0], fleetOwner.address, "All depositors must be owned by master safe")
    
    // No need to assert exchange has token since deposits and withdraws are not limited to registered tokens.
    // assert(await exchange.hasToken(deposit.tokenAddress), "Requested deposit token not listed on the exchange")

    const depositToken = await ERC20.at(deposit.tokenAddress)
    const tokenDecimals = (await depositToken.decimals.call()).toNumber()
    const tokenSymbol = await depositToken.symbol.call()
    // log(`Deposit Token at ${depositToken.address}: ${tokenSymbol}`)
    assert.equal(tokenDecimals, 18, "These scripts currently only support tokens with 18 decimals.")

    const unitAmount = web3.utils.fromWei(deposit.amount.toString(), "ether")
    log(`Safe ${deposit.userAddress} receiving (from ${fleetOwner.address.slice(0,6)}...${fleetOwner.address.slice(-2)}) and depositing ${unitAmount} ${tokenSymbol} into BatchExchange`)
    // Get data to move funds from master to slave
    const transferData = await depositToken.contract.methods.transfer(deposit.userAddress, deposit.amount.toString()).encodeABI()
    transactions.push({
      operation: CALL,
      to: depositToken.address,
      value: 0,
      data: transferData,
    })
    // Get data to approve funds from slave to exchange
    const approveData = await depositToken.contract.methods.approve(exchange.address, deposit.amount.toString()).encodeABI()
    // Get data to deposit funds from slave to exchange
    const depositData = await exchange.contract.methods.deposit(deposit.tokenAddress, deposit.amount.toString()).encodeABI()
    // Get data for approve and deposit multisend on slave
    const multiSendData = await encodeMultiSend(
      multiSend,
      [
        { operation: CALL, to: deposit.tokenAddress, value: 0, data: approveData },
        { operation: CALL, to: exchange.address, value: 0, data: depositData },
      ],
      web3
    )
    // Get data to execute approve/deposit multisend via slave
    const execData = await execTransactionData(
      gnosisSafeMasterCopy,
      fleetOwner.address,
      multiSend.address,
      0,
      multiSendData,
      DELEGATECALL
    )
    transactions.push({
      operation: CALL,
      to: deposit.userAddress,
      value: 0,
      data: execData,
    })
  }
  // Get data to execute all fund/approve/deposit transactions at once
  const finalData = await encodeMultiSend(multiSend, transactions, web3)
  return {
    to: multiSend.address,
    data: finalData,
  }
}

/**
 * Batches together a collection of "requestWithdraw" calls on BatchExchange
 * on behalf of a fleet of safes owned by a single "Master Safe"
 * @param {EthereumAddress} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
 * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
 * @return {Transaction} Multisend transaction that has to be sent from the master address to request
withdrawal of the desired funds
*/
const getRequestWithdraw = async function(masterAddress, withdrawals, web3, artifacts) {
  return await getGenericFundMovementTransaction(masterAddress, withdrawals, "requestWithdraw", web3, artifacts)
}

/**
 * Batches together a collection of "withdraw" calls on BatchExchange
 * on behalf of a fleet of safes owned by a single "Master Safe"
 * Warning: if any bundled transaction fails, then no funds are withdrawn from the exchange.
 *   Ensure 1. to have executed requestWithdraw for every input before executing
 *          2. no trader orders have been executed on these tokens (a way to ensure this is to cancel the traders' standing orders)
 * @param {EthereumAddress} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
 * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
 * @return {Transaction} Multisend transaction that has to be sent from the master address to withdraw the desired funds
 */
const getWithdraw = async function(masterAddress, withdrawals, web3, artifacts) {
  return await getGenericFundMovementTransaction(masterAddress, withdrawals, "withdraw", web3, artifacts)
}

/**
 * Batches together a collection of transfers from each trader safe to the master safer
 * @param {EthereumAddress} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
 * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
 * @return {Transaction} Multisend transaction that has to be sent from the master address to transfer back all funds
 */
const getTransferFundsToMaster = async function(masterAddress, withdrawals, web3, artifacts) {
  const masterTransactions = []
  const ERC20 = artifacts.require("ERC20Mintable")
  // TODO: enforce that there are no overlapping withdrawals
  for (const withdrawal of withdrawals) {
    const token = await ERC20.at(withdrawal.tokenAddress)
    const amount = withdrawal.amount
    // create transaction for the token
    const transactionData = await token.contract.methods.transfer(masterAddress, amount.toString()).encodeABI()

    // prepare trader transaction
    const transactionToExecute = {
      operation: CALL,
      to: token.address,
      value: 0,
      data: transactionData,
    }
    // build transaction to execute previous transaction through master
    const execTransactionTransaction = await getExecTransactionTransaction(
      masterAddress,
      withdrawal.traderAddress,
      transactionToExecute,
      web3,
      artifacts
    )
    masterTransactions.push(execTransactionTransaction)
  }
  return await getBundledTransaction(masterTransactions, web3, artifacts)
}

/**
 * Batches together a collection of transfers from each trader safe to the master safer
 * @param {EthereumAddress} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
 * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
 * @return {string} Data describing the multisend transaction that has to be sent from the master address to transfer back all funds
 */
const getWithdrawAndTransferFundsToMaster = async function(masterAddress, withdrawals, web3, artifacts) {
  const withdrawalTransaction = await getWithdraw(masterAddress, withdrawals, web3, artifacts)
  const transferFundsToMasterTransaction = await getTransferFundsToMaster(masterAddress, withdrawals, web3, artifacts)

  return getBundledTransaction([withdrawalTransaction, transferFundsToMasterTransaction], web3, artifacts)
}

module.exports = {
  deployFleetOfSafes,
  buildOrderTransactionData,
  transferApproveDeposit,
  getRequestWithdraw,
  getWithdraw,
  getTransferFundsToMaster,
  getWithdrawAndTransferFundsToMaster,
  max128,
  maxU32,
  maxUINT,
  DELEGATECALL,
  CALL,
  ADDRESS_0,
}
