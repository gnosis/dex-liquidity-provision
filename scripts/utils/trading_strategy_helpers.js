const Contract = require("@truffle/contract")
const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))

const assert = require("assert")
const BN = require("bn.js")
const fs = require("fs")
const { deploySafe, buildBundledTransaction, buildExecTransaction, CALL } = require("./internals")
const { shortenedAddress, fromErc20Units, toErc20Units } = require("./printing_tools")
const ADDRESS_0 = "0x0000000000000000000000000000000000000000"
const maxU32 = 2 ** 32 - 1
const max128 = new BN(2).pow(new BN(128)).subn(1)
const maxUINT = new BN(2).pow(new BN(256)).sub(new BN(1))

/**
 * Ethereum addresses are composed of the prefix "0x", a common identifier for hexadecimal,
 * concatenated with the rightmost 20 bytes of the Keccak-256 hash (big endian) of the ECDSA public key
 * (cf. https://en.wikipedia.org/wiki/Ethereum#Addresses)
 * @typedef Address
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
 * @property {Address} address Hex string denoting the ethereum address of token
 * @property {string} symbol short, usually abbreviated, token name
 * @property {integer} decimals number of decmial places token uses for a Unit
 */

/**
 * Example:
 * {
 *   amount: 100,
 *   tokenAddress: 0x0000000000000000000000000000000000000000,
 *   bracketAddress: 0x0000000000000000000000000000000000000001
 * }
 * @typedef Deposit
 * @type {object}
 * @property {integer} amount integer denoting amount to be deposited
 * @property {Address} tokenAddress {@link Address} of token to be deposited
 * @property {Address} bracketAddress address of bracket into which to deposit
 */

/**
 * @typedef Withdrawal
 *  * Example:
 * {
 *   amount: "100",
 *   bracketAddress: "0x0000000000000000000000000000000000000000",
 *   tokenAddress: "0x0000000000000000000000000000000000000000",
 * }
 * @type {object}
 * @property {integer} amount Integer denoting amount to be deposited
 * @property {Address} bracketAddress Ethereum address of the bracket from which to withdraw
 * @property {Address} tokenAddresses List of tokens that the traded wishes to withdraw
 */

/**
 * Checks that the first input address is the only owner of the first input address
 * @param {Address} masterAddress address that should be the only owner
 * @param {Address} ownedAddress address that is owned
 * @return {bool} whether ownedAddress is indeed owned only by masterAddress
 */
const isOnlySafeOwner = async function(masterAddress, ownedAddress, artifacts) {
  const GnosisSafe = artifacts.require("GnosisSafe")
  const owned = await GnosisSafe.at(ownedAddress)
  const ownerAddresses = await owned.getOwners()
  return ownerAddresses.length == 1 && ownerAddresses[0] == masterAddress
}

/**
 * Queries EVM for ERC20 token details by address
 * and returns a list of detailed token information.
 * @param {SmartContract} exchange BatchExchange, contract, or any contract implementing `tokenIdToAddressMap`
 * @param {integer[]} tokenIds list of token ids whose data is to be fetch from EVM
 * @return {TokenObject[]} list of detailed/relevant token information
 */
const globalTokenObjects = {}
const fetchTokenInfo = async function(exchange, tokenIds, artifacts, debug = false) {
  const log = debug ? () => console.log.apply(arguments) : () => {}
  const ERC20 = artifacts.require("ERC20Detailed")

  log("Fetching token data from EVM")
  await Promise.all(
    tokenIds.map(async id => {
      if (!(id in globalTokenObjects)) {
        const tokenAddress = await exchange.tokenIdToAddressMap(id)
        const tokenInstance = await ERC20.at(tokenAddress)
        const [tokenSymbol, tokenDecimals] = await Promise.all([tokenInstance.symbol.call(), tokenInstance.decimals.call()])
        const tokenInfo = {
          id: id,
          address: tokenAddress,
          symbol: tokenSymbol,
          decimals: tokenDecimals.toNumber(),
        }
        log(`Found Token ${tokenInfo.symbol} at ID ${tokenInfo.id} with ${tokenInfo.decimals} decimals`)
        globalTokenObjects[id] = tokenInfo
      }
    })
  )
  return globalTokenObjects
}

/**
 * Deploys specified number singler-owner Gnosis Safes having specified ownership
 * @param {Address} masterAddress address of Gnosis Safe (Multi-Sig) owning the newly created Safes
 * @param {integer} fleetSize number of safes to be created with masterAddress as owner
 * @return {Address[]} list of Ethereum Addresses for the brackets that were deployed
 */
const deployFleetOfSafes = async function(masterAddress, fleetSize, artifacts, debug = false) {
  const log = debug ? (...a) => console.log(...a) : () => {}
  const GnosisSafe = artifacts.require("GnosisSafe")
  const ProxyFactory = artifacts.require("GnosisSafeProxyFactory.sol")

  const proxyFactory = await ProxyFactory.deployed()
  const gnosisSafeMasterCopy = await GnosisSafe.deployed()

  // TODO - Batch all of this in a single transaction
  const createdSafes = []
  for (let i = 0; i < fleetSize; i++) {
    const newSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [masterAddress], 1, artifacts)
    log("New Safe Created", newSafe.address)
    createdSafes.push(newSafe.address)
  }
  return createdSafes
}

/**
 * Batches together a collection of order placements on BatchExchange
 * on behalf of a fleet of brackets owned by a single "Master Safe"
 * @param {Address} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig) owning all brackets
 * @param {Address[]} bracketAddresses List of addresses with the brackets sending the orders
 * @param {integer} targetTokenId ID of token (on BatchExchange) whose target price is to be specified (i.e. ETH)
 * @param {integer} stableTokenId ID of "Stable Token" for which trade with target token (i.e. DAI)
 * @param {number} targetPrice Price at which the order brackets will be centered (e.g. current price of ETH in USD)
 * @param {number} [priceRangePercentage=20] Percentage above and below the target price for which orders are to be placed
 * @param {integer} [validFrom=3] Number of batches (from current) until orders become valid
 * @param {integer} [expiry=maxU32] Maximum auction batch for which these orders are valid (e.g. maxU32)
 * @return {Transaction} all the relevant transaction information to be used when submitting to the Gnosis Safe Multi-Sig
 */
const buildOrders = async function(
  masterAddress,
  bracketAddresses,
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

  await BatchExchange.setProvider(web3.currentProvider)
  await BatchExchange.setNetwork(web3.network_id)
  const exchange = await BatchExchange.deployed()
  log("Batch Exchange", exchange.address)

  const batch_index = (await exchange.getCurrentBatchId.call()).toNumber()
  const tokenInfo = await fetchTokenInfo(exchange, [targetTokenId, stableTokenId], artifacts)

  const targetToken = tokenInfo[targetTokenId]
  const stableToken = tokenInfo[stableTokenId]
  // TODO - handle other cases later.
  assert(stableToken.decimals === 18, "Target token must have 18 decimals")
  assert(targetToken.decimals === 18, "Stable tokens must have 18 decimals")

  // Number of brackets is determined by bracketAddresses.length
  const lowestLimit = targetPrice * (1 - priceRangePercentage / 100)
  const highestLimit = targetPrice * (1 + priceRangePercentage / 100)
  log(`Lowest-Highest Limit ${lowestLimit}-${highestLimit}`)

  const stepSize = (highestLimit - lowestLimit) / bracketAddresses.length

  const transactions = []
  log(
    `Constructing bracket trading strategy order data based on valuation ${targetPrice} ${stableToken.symbol} per ${targetToken.symbol}`
  )
  for (let bracketIndex = 0; bracketIndex < bracketAddresses.length; bracketIndex++) {
    const bracketAddress = bracketAddresses[bracketIndex]
    assert(
      await isOnlySafeOwner(masterAddress, bracketAddress, artifacts),
      "each bracket should be owned only by the master Safe"
    )

    const lowerLimit = lowestLimit + bracketIndex * stepSize
    const upperLimit = lowestLimit + (bracketIndex + 1) * stepSize

    const [upperSellAmount, upperBuyAmount] = calculateBuyAndSellAmountsFromPrice(upperLimit, targetToken)
    // While the first bracket-order trades standard_token against target_token, the second bracket-order trades
    // target_token against standard_token. Hence the buyAmounts and sellAmounts are switched in the next line.
    const [lowerBuyAmount, lowerSellAmount] = calculateBuyAndSellAmountsFromPrice(lowerLimit, targetToken)

    log(`Safe ${bracketIndex} - ${bracketAddress}:\n  Buy  ${targetToken.symbol} with ${stableToken.symbol} at ${lowerLimit}`)
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
    const orderTransaction = {
      operation: CALL,
      to: exchange.address,
      value: 0,
      data: orderData,
    }

    transactions.push(await buildExecTransaction(masterAddress, bracketAddress, orderTransaction, artifacts))
  }
  log("Transaction bundle size", transactions.length)
  return await buildBundledTransaction(transactions, web3, artifacts)
}

const calculateBuyAndSellAmountsFromPrice = function(price, targetToken) {
  // Sell targetToken for stableToken at price with unlimited orders
  // Example:
  // Sell 1 ETH at for 102 DAI (unlimited)
  // Sell x ETH for max256 DAI
  // x = max256 / 102
  // priceFormatted = 102000000000000000000
  price = price.toFixed(18)
  const priceFormatted = toErc20Units(price, targetToken.decimals)
  let sellAmount
  let buyAmount
  if (priceFormatted.gt(toErc20Units(1, 18))) {
    sellAmount = max128
      .mul(toErc20Units(1, 18))
      .div(priceFormatted)
      .toString()
    buyAmount = max128.toString()
  } else {
    buyAmount = max128
      .mul(priceFormatted)
      .div(toErc20Units(1, 18))
      .toString()
    sellAmount = max128.toString()
  }
  return [sellAmount, buyAmount]
}
const checkSufficiencyOfBalance = async function(token, owner, amount) {
  const depositor_balance = await token.balanceOf.call(owner)
  return depositor_balance.gte(amount)
}

/**
 * Batches together a collection of operations (either withdraw or requestWithdraw) on BatchExchange
 * on behalf of a fleet of brackets owned by a single "Master Safe"
 * @param {Address} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
 * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
 * @param {string} functionName Name of the function that is to be executed (can be "requestWithdraw" or "withdraw")
 * @return {Transaction} Multisend transaction that has to be sent from the master address to either request
withdrawal of or to withdraw the desired funds
*/
const buildGenericFundMovement = async function(masterAddress, withdrawals, functionName, web3 = web3, artifacts = artifacts) {
  BatchExchange.setProvider(web3.currentProvider)
  BatchExchange.setNetwork(web3.network_id)
  const exchange = await BatchExchange.deployed()
  const masterTransactions = []

  // it's not necessary to avoid overlapping withdraws, since the full amount is withdrawn for each entry
  for (const withdrawal of withdrawals) {
    // create transaction for the token
    let transactionData
    switch (functionName) {
      case "requestWithdraw":
        transactionData = await exchange.contract.methods["requestWithdraw"](
          withdrawal.tokenAddress,
          withdrawal.amount.toString()
        ).encodeABI()
        break
      case "withdraw":
        transactionData = await exchange.contract.methods["withdraw"](
          withdrawal.bracketAddress,
          withdrawal.tokenAddress
        ).encodeABI()
        break
      default:
        assert(false, "Function " + functionName + "is not implemented")
    }

    // prepare bracket transaction
    const transactionToExecute = {
      operation: CALL,
      to: exchange.address,
      value: 0,
      data: transactionData,
    }
    // build transaction to execute previous transaction through master
    const execTransaction = await buildExecTransaction(masterAddress, withdrawal.bracketAddress, transactionToExecute, artifacts)
    masterTransactions.push(execTransaction)
  }
  return buildBundledTransaction(masterTransactions, web3, artifacts)
}

/**
 * Batches together a collection of transfer-related transaction information.
 * Particularily, the resulting transaction is that of transfering all sufficient funds from master
 * to its brackets, then approving and depositing those same tokens into BatchExchange on behalf of each bracket.
 * @param {string} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
 * @param {Deposit[]} depositList List of {@link Deposit} that are to be bundled together
 * @return {Transaction} all the relevant transaction information to be used when submitting to the Gnosis Safe Multi-Sig
 */
const buildTransferApproveDepositFromList = async function(masterAddress, depositList, web3, artifacts, debug = false) {
  const log = debug ? (...a) => console.log(...a) : () => {}
  const ERC20 = artifacts.require("ERC20Detailed")

  let transactions = []
  // TODO - make cumulative sum of deposits by token and assert that masterSafe has enough for the tranfer
  // TODO - make deposit list easier so that we dont' have to query the token every time.
  for (const deposit of depositList) {
    assert(
      await isOnlySafeOwner(masterAddress, deposit.bracketAddress, artifacts),
      "All depositors must be owned only by the master Safe"
    )
    const depositToken = await ERC20.at(deposit.tokenAddress)
    const tokenSymbol = await depositToken.symbol.call()
    const tokenDecimals = await depositToken.decimals.call()
    const unitAmount = fromErc20Units(deposit.amount, tokenDecimals)
    log(
      `Safe ${deposit.bracketAddress} receiving (from ${shortenedAddress(
        masterAddress
      )}) and depositing ${unitAmount} ${tokenSymbol} into BatchExchange`
    )

    transactions = transactions.concat(
      await buildBracketTransactionForTransferApproveDeposit(
        masterAddress,
        deposit.tokenAddress,
        deposit.bracketAddress,
        deposit.amount,
        artifacts,
        web3
      )
    )
  }
  return await buildBundledTransaction(transactions, web3, artifacts)
}

const formatDepositString = function(depositsAsJsonString) {
  let result
  result = depositsAsJsonString.replace(/{"/g, '{\n    "')
  result = result.replace(/,"/g, ',\n    "')
  result = result.replace(/{/g, "\n  {")
  result = result.replace(/},/g, "\n  },")
  result = result.replace(/"}/g, '"\n  }')
  result = result.replace(/]/g, "\n]")
  return result
}

/**
 * Batches together a collection of transfer-related transaction information.
 * Particularly, the resulting transaction is that of transfering all sufficient funds from master
 * to its brackets, then approving and depositing those same tokens into BatchExchange on behalf of each bracket.
 * @param {Address} masterAddress Address of the master safe owning the brackets
 * @param {Address[]} bracketAddresses list of bracket addresses that need the deposit
 * @param {Address} stableTokenAddress one token to be traded in bracket strategy
 * @param {number} investmentStableToken Amount of stable tokens to be invested (in total)
 * @param {Address} targetTokenAddress second token to be traded in bracket strategy
 * @param {number} investmentStableToken Amount of target tokens to be invested (in total)
 * @param {bool} storeDepositsAsFile whether to write the executed deposits to a file (defaults to false)
 * @return {Transaction} all the relevant transaction information to be used when submitting to the Gnosis Safe Multi-Sig
 */
const buildTransferApproveDepositFromOrders = async function(
  masterAddress,
  bracketAddresses,
  stableTokenAddress,
  investmentStableToken,
  targetTokenAddress,
  investmentTargetToken,
  artifacts,
  web3,
  storeDepositsAsFile = false
) {
  const fleetSize = bracketAddresses.length
  assert(fleetSize % 2 == 0, "Fleet size must be a even number")
  const deposits = []

  const fleetSizeDiv2 = fleetSize / 2
  for (const i of Array(fleetSizeDiv2).keys()) {
    const deposit = {
      amount: investmentStableToken.div(new BN(fleetSizeDiv2)).toString(),
      tokenAddress: stableTokenAddress,
      bracketAddress: bracketAddresses[i],
    }
    deposits.push(deposit)
  }
  for (const i of Array(fleetSizeDiv2).keys()) {
    const deposit = {
      amount: investmentTargetToken.div(new BN(fleetSizeDiv2)).toString(),
      tokenAddress: targetTokenAddress,
      bracketAddress: bracketAddresses[fleetSizeDiv2 + i],
    }
    deposits.push(deposit)
  }
  if (storeDepositsAsFile) {
    const depositsAsJsonString = formatDepositString(JSON.stringify(deposits))
    fs.writeFile("./automaticallyGeneratedDeposits.js", depositsAsJsonString, function(err) {
      if (err) {
        console.log("Warning: deposits could not be stored as a file.")
        console.log(err)
      }
    })
  }
  return await buildTransferApproveDepositFromList(masterAddress, deposits, web3, artifacts)
}

/**
 * Batches together a collection of transfers from each bracket safe to master
 * @param {Address} masterAddress address of Master Gnosis Safe (Multi-Sig)
 * @param {Address} tokenAddress for the funds to be deposited
 * @param {Address} bracketAddress The address of the bracket owning the funds in the Exchange
 * @param {BN} amount Amount to be deposited
 * @return {Transaction} Information describing the multisend transaction that has to be sent from the master address to transfer back all funds
 */
const buildBracketTransactionForTransferApproveDeposit = async (
  masterAddress,
  tokenAddress,
  bracketAddress,
  amount,
  artifacts,
  web3 = web3
) => {
  const ERC20 = artifacts.require("ERC20Detailed")
  const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))

  BatchExchange.setProvider(web3.currentProvider)
  BatchExchange.setNetwork(web3.network_id)
  const exchange = await BatchExchange.deployed()
  const depositToken = await ERC20.at(tokenAddress)
  const tokenDecimals = (await depositToken.decimals.call()).toNumber()
  const transactions = []

  // log(`Deposit Token at ${depositToken.address}: ${tokenSymbol}`)
  assert.equal(tokenDecimals, 18, "These scripts currently only support tokens with 18 decimals.")
  // Get data to move funds from master to bracket
  const transferData = await depositToken.contract.methods.transfer(bracketAddress, amount.toString()).encodeABI()
  transactions.push({
    operation: CALL,
    to: depositToken.address,
    value: 0,
    data: transferData,
  })
  // Get data to approve funds from bracket to exchange
  const approveData = await depositToken.contract.methods.approve(exchange.address, amount.toString()).encodeABI()
  // Get data to deposit funds from bracket to exchange
  const depositData = await exchange.contract.methods.deposit(tokenAddress, amount.toString()).encodeABI()
  // Get transaction for approve and deposit multisend on bracket
  const bracketBundledTransaction = await buildBundledTransaction(
    [
      { operation: CALL, to: tokenAddress, value: 0, data: approveData },
      { operation: CALL, to: exchange.address, value: 0, data: depositData },
    ],
    web3,
    artifacts
  )
  // Get transaction executing approve/deposit multisend via bracket
  const execTransaction = await buildExecTransaction(masterAddress, bracketAddress, bracketBundledTransaction, artifacts)
  transactions.push(execTransaction)
  return transactions
}
/**
 * Batches together a collection of "requestWithdraw" calls on BatchExchange
 * on behalf of a fleet of brackets owned by a single "Master Safe"
 * @param {Address} masterAddress address of Master Gnosis Safe (Multi-Sig)
 * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
 * @return {Transaction} Multisend transaction that has to be sent from the master address to request
withdrawal of the desired funds
*/
const buildRequestWithdraw = async function(masterAddress, withdrawals, web3, artifacts) {
  return await buildGenericFundMovement(masterAddress, withdrawals, "requestWithdraw", web3, artifacts)
}

/**
 * Batches together a collection of "withdraw" calls on BatchExchange
 * on behalf of a fleet of safes owned by a single "Master Safe"
 * Warning: if any bundled transaction fails, then no funds are withdrawn from the exchange.
 *   Ensure 1. to have executed requestWithdraw for every input before executing
 *          2. no bracket orders have been executed on these tokens (a way to ensure this is to cancel the brackets' standing orders)
 * @param {Address} masterAddress address of Master Gnosis Safe (Multi-Sig)
 * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
 * @return {Transaction} Multisend transaction that has to be sent from the master address to withdraw the desired funds
 */
const buildWithdraw = async function(masterAddress, withdrawals, web3, artifacts) {
  return await buildGenericFundMovement(masterAddress, withdrawals, "withdraw", web3, artifacts)
}

/**
 * Batches together a collection of transfers from each bracket to master
 * @param {Address} masterAddress address of Master Gnosis Safe (Multi-Sig)
 * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
 * @return {Transaction} Multisend transaction that has to be sent from the master address to transfer back all funds
 */
const buildTransferFundsToMaster = async function(masterAddress, withdrawals, limitToMaxWithdrawableAmount, web3, artifacts) {
  const masterTransactions = []
  const ERC20 = artifacts.require("ERC20Mintable")
  // TODO: enforce that there are no overlapping withdrawals
  for (const withdrawal of withdrawals) {
    const token = await ERC20.at(withdrawal.tokenAddress)
    let amount
    if (limitToMaxWithdrawableAmount) {
      amount = BN.min(new BN(withdrawal.amount), new BN(await token.balanceOf.call(withdrawal.bracketAddress)))
    } else {
      amount = withdrawal.amount
    }
    // create transaction for the token
    const transactionData = await token.contract.methods.transfer(masterAddress, amount.toString()).encodeABI()

    // prepare bracket transaction
    const transactionToExecute = {
      operation: CALL,
      to: token.address,
      value: 0,
      data: transactionData,
    }
    // build transaction to execute previous transaction through master
    const execTransaction = await buildExecTransaction(masterAddress, withdrawal.bracketAddress, transactionToExecute, artifacts)
    masterTransactions.push(execTransaction)
  }
  return await buildBundledTransaction(masterTransactions, web3, artifacts)
}

/**
 * Batches together a collection of transfers from each bracket to master
 * @param {Address} masterAddress address of Master Gnosis Safe (Multi-Sig)
 * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
 * @return {Transaction} Multisend transaction that has to be sent from the master address to transfer back the funds stored in the exchange
 */
const buildWithdrawAndTransferFundsToMaster = async function(masterAddress, withdrawals, web3 = web3, artifacts = artifacts) {
  const withdrawalTransaction = await buildWithdraw(masterAddress, withdrawals, web3, artifacts)
  const transferFundsToMasterTransaction = await buildTransferFundsToMaster(masterAddress, withdrawals, false, web3, artifacts)
  return buildBundledTransaction([withdrawalTransaction, transferFundsToMasterTransaction], web3, artifacts)
}

module.exports = {
  deployFleetOfSafes,
  buildOrders,
  buildBundledTransaction,
  buildTransferApproveDepositFromList,
  buildTransferFundsToMaster,
  buildWithdrawAndTransferFundsToMaster,
  buildBracketTransactionForTransferApproveDeposit,
  buildTransferApproveDepositFromOrders,
  checkSufficiencyOfBalance,
  buildRequestWithdraw,
  buildWithdraw,
  fetchTokenInfo,
  isOnlySafeOwner,
  max128,
  maxU32,
  maxUINT,
  ADDRESS_0,
}
