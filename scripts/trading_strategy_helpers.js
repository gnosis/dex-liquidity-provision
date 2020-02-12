const GnosisSafe = artifacts.require("./GnosisSafe.sol")
const ProxyFactory = artifacts.require("./GnosisSafeProxyFactory.sol")
const MultiSend = artifacts.require("./MultiSend.sol")

const ERC20 = artifacts.require("ERC20Detailed")

const Contract = require("@truffle/contract")
const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))

const BN = require("bn.js")
const { deploySafe, encodeMultiSend, execTransactionData } = require("../test/utils")

const CALL = 0
const maxU32 = 2 ** 32 - 1

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
const fetchTokenInfo = async function(exchange, tokenIds) {
  console.log("Fetching token data from EVM")
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
    console.log(`Found Token ${tokenInfo.symbol} at ID ${tokenInfo.id} with ${tokenInfo.decimals} decimals`)
  }
  return tokenObjects
}

/**
 * Deploys specified number singler-owner Gnosis Safes having specified ownership
 * @param {EthereumAddress} fleetOwner {@link EthereumAddress} of Gnosis Safe (Multi-Sig)
 * @param {integer} fleetSize number of sub-Safes to be created with fleetOwner as owner
 * @return {string[]} list of Ethereum Addresses for the subsafes that were deployed
 */
const deployFleetOfSafes = async function(fleetOwner, fleetSize) {
  const proxyFactory = await ProxyFactory.deployed()
  const gnosisSafeMasterCopy = await GnosisSafe.deployed()

  // TODO - Batch all of this in a single transaction
  const slaveSafes = []
  for (let i = 0; i < fleetSize; i++) {
    const newSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [fleetOwner], 1)
    slaveSafes.push(newSafe.address)
  }
  console.log("Safes deployed:", slaveSafes)
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
 * @return {string} all the relevant transaction data to be used when submitting to the Gnosis Safe Multi-Sig
 */
const buildOrderTransactionData = async function(
  fleetOwnerAddress,
  subSafeAddresses,
  targetTokenId,
  stableTokenId,
  targetPrice,
  priceRangePercentage = 20,
  validFrom = 3,
  expiry = maxU32
) {
  const exchange = await BatchExchange.deployed()
  const multiSend = MultiSend.deployed()
  const gnosisSafeMasterCopy = GnosisSafe.deployed()

  const batch_index = (await exchange.getCurrentBatchId.call()).toNumber()
  const tokenInfo = await fetchTokenInfo(exchange, [targetTokenId, stableTokenId])

  const targetToken = tokenInfo[targetTokenId]
  const stableToken = tokenInfo[stableTokenId]
  // TODO - handle other cases later.
  assert(stableToken.decimals === 18, "Target token must have 18 decimals")
  assert(targetToken.decimals === 18, "Stable tokens must have 18 decimals")

  // Number of brackets is determined by subsafeAddresses.length
  const lowestLimit = targetPrice * (1 - priceRangePercentage / 100)
  const highestLimit = targetPrice * (1 - priceRangePercentage / 100)
  const stepSize = (highestLimit - lowestLimit) / subSafeAddresses.length

  let safeIndex = 0
  const transactions = []
  for (let lowerLimit = lowestLimit; lowerLimit < highestLimit; lowerLimit += stepSize) {
    const traderAddress = subSafeAddresses[safeIndex]
    const upperLimit = lowerLimit + stepSize

    // Sell targetToken for stableToken at targetTokenPrice = upperLimit
    // Sell 1 ETH at for 102 DAI (unlimited)
    // Sell x ETH for maxU32 DAI
    // x = maxU32 / 102
    const sellPrice = formatAmount(upperLimit, targetToken)
    const upperSellAmount = maxU32.div(sellPrice)
    const upperBuyAmount = maxU32
    console.log(`Account ${traderAddress}: Sell ${targetToken.symbol} for ${stableToken.symbol} at ${sellPrice}`)

    // Buy ETH at 101 for DAI (unlimited)
    // Sell stableToken for targetToken in at targetTokenPrice = lowerLimit
    // Sell 101 DAI for 1 ETH
    // Sell maxU32 DAI for x ETH
    // x = maxU32 / 101
    const buyPrice = formatAmount(lowerLimit, targetToken)
    const lowerSellAmount = maxU32
    const lowerBuyAmount = maxU32.div(buyPrice)
    console.log(`Account ${traderAddress}: Buy ${targetToken.symbol} with ${stableToken.symbol} at ${buyPrice}`)

    const buyTokens = [targetTokenId, stableTokenId]
    const sellTokens = [stableTokenId, targetTokenId]
    const validFroms = [batch_index + validFrom, batch_index + validFrom]
    const validTos = [expiry, expiry]
    const buyAmounts = [lowerBuyAmount, upperBuyAmount]
    const sellAmounts = [lowerSellAmount, upperSellAmount]

    const orderData = await exchange.contract.methods
      .placeValidFromOrders(buyTokens, sellTokens, validFroms, validTos, buyAmounts, sellAmounts)
      .encodeABI()
    const multiSendData = await encodeMultiSend(multiSend, [
      { operation: CALL, to: exchange.address, value: 0, data: orderData },
    ])

    const execData = await execTransactionData(gnosisSafeMasterCopy, fleetOwnerAddress, multiSend.address, 0, multiSendData, 1)
    transactions.push({
      operation: CALL,
      to: traderAddress,
      value: 0,
      data: execData,
    })
    safeIndex += 1
  }
  const finalData = await encodeMultiSend(multiSend, transactions)
  console.log(`Transaction Data for Order Placement: \n    To: ${multiSend.address}\n    Hex: ${finalData}`)
}

/**
 * Batches together a collection of transfer-related transaction data.
 * Particularily, the resulting transaction data is that of transfering all sufficient funds from fleetOwner
 * to its subSafes, then approving and depositing those same tokens into BatchExchange on behalf of each subSafe.
 * @param {string} fleetOwner Ethereum address of Master Gnosis Safe (Multi-Sig)
 * @param {Deposits[]} depositList List of {@link EthereumAddress} for the subsafes acting as Trader Accounts
 * @return {string} all the relevant transaction data to be used when submitting to the Gnosis Safe Multi-Sig
 */
const transferApproveDeposit = async function(fleetOwner, depositList) {
  const exchange = await BatchExchange.deployed()
  const multiSend = MultiSend.deployed()
  const gnosisSafeMasterCopy = GnosisSafe.deployed()

  const transactions = []
  // TODO - since depositTokens are likely all the same. Could fetch them once.
  for (const deposit of depositList) {
    const slaveSafe = await GnosisSafe.at(deposit.userAddress)
    assert(slaveSafe.owner === fleetOwner, "All depositors must be owned by master safe")
    assert(await exchange.hasToken(deposit.tokenAddress, "Requested deposit token not listed on the exchange"))

    const depositToken = await ERC20.at(deposit.tokenAddress)

    // Get data to move funds from master to slave
    const transferData = await depositToken.contract.methods.transfer(slaveSafe, deposit.amount).encodeABI()
    transactions.push({
      operation: CALL,
      to: depositToken.address,
      value: 0,
      data: transferData,
    })
    // Get data to approve funds from slave to exchange
    const approveData = await depositToken.contract.methods.approve(exchange.address, deposit.amount).encodeABI()
    // Get data to deposit funds from slave to exchange
    const depositData = await exchange.contract.methods.deposit(depositToken.address, deposit.amount).encodeABI()
    // Get data for approve and deposit multisend on slave
    const multiSendData = await encodeMultiSend(multiSend, [
      { operation: CALL, to: depositToken.address, value: 0, data: approveData },
      { operation: CALL, to: exchange.address, value: 0, data: depositData },
    ])
    // Get data to execute approve/deposit multisend via slave
    const execData = await execTransactionData(gnosisSafeMasterCopy, fleetOwner, multiSend.address, 0, multiSendData, 1)
    transactions.push({
      operation: CALL,
      to: deposit.userAddress,
      value: 0,
      data: execData,
    })
  }
  // Get data to execute all fund/approve/deposit transactions at once
  const finalData = await encodeMultiSend(multiSend, transactions)
  console.log(`Transaction Data for Transfer-Approve-Deposit: \n    To: ${multiSend.address}\n    Hex: ${finalData}`)
}

module.exports = {
  deployFleetOfSafes,
  buildOrderTransactionData,
  transferApproveDeposit,
}
