const BN = require("bn.js")
const { decodeOrders } = require("@gnosis.pm/dex-contracts")

/**
 * @typedef {import('../typedef.js').Address} Address
 * @typedef {import('../typedef.js').Deposit} Deposit
 * @typedef {import('../typedef.js').Withdrawal} Withdrawal
 * @typedef {import('../typedef.js').SmartContract} SmartContract
 * @typedef {import('../typedef.js').TokenObject} TokenObject
 * @typedef {import('../typedef.js').Transaction} Transaction
 * @typedef {import('../typedef.js').Transfer} Transfer
 */

module.exports = function (web3 = web3, artifacts = artifacts) {
  const assert = require("assert")
  const fs = require("fs")
  const { getUnlimitedOrderAmounts } = require("@gnosis.pm/dex-contracts")
  const { buildBundledTransaction, buildExecTransaction } = require("./internals")(web3, artifacts)
  const { shortenedAddress, toErc20Units, fromErc20Units } = require("./printing_tools")
  const { uniqueItems } = require("./js_helpers")
  const { DEFAULT_ORDER_EXPIRY, CALL } = require("./constants")

  const ERC20 = artifacts.require("ERC20Detailed")
  const BatchExchange = artifacts.require("BatchExchange")
  const GnosisSafe = artifacts.require("GnosisSafe")
  const FleetFactory = artifacts.require("FleetFactory")

  const exchangePromise = BatchExchange.deployed()
  const gnosisSafeMasterCopyPromise = GnosisSafe.deployed()
  const fleetFactoryPromise = FleetFactory.deployed()
  const hardcodedTokensByNetwork = require("./hardcoded_tokens")

  /**
   * Returns an instance of the exchange contract
   *
   * @returns {SmartContract} An instance of BatchExchange
   */
  const getExchange = function () {
    return BatchExchange.deployed()
  }

  /**
   * Returns an instance of the safe contract at the given address
   *
   * @param {Address} safeAddress address of the safe of which to create an instance
   * @returns {SmartContract} Gnosis Safe Contract
   */
  const getSafe = function (safeAddress) {
    return GnosisSafe.at(safeAddress)
  }

  /**
   * Checks that the address used as the first argument is the only owner of the Safe included as the second argument
   *
   * @param {Address} masterAddress address pointing to the candidate only owner of the Safe
   * @param {SmartContract|Address} owned Safe that might be owned by master
   * @returns {boolean} whether owned is indeed owned only by master
   */
  const isOnlySafeOwner = async function (masterAddress, owned) {
    const ownedSafe = typeof owned === "string" ? await getSafe(owned) : owned
    const ownerAddresses = await ownedSafe.getOwners()
    return ownerAddresses.length === 1 && ownerAddresses[0].toLowerCase() === masterAddress.toLowerCase()
  }

  /**
   * Fail if the address used as the first argument is not the only owner of all the Safes
   * specified in the given array.
   *
   * @param {Address} masterAddress address pointing to the candidate only owner of the Safe
   * @param {(SmartContract|Address)[]} fleet array of Safes that might be owned by master
   */
  const assertIsOnlyFleetOwner = async function (masterAddress, fleet) {
    assert(await isOnlyFleetOwner(masterAddress, fleet), "All depositors must be owned only by the master Safe")
  }

  /**
   * Returns the tokens traded by the brackets.
   *
   * @param {Address[]} bracketAddresses breackets for which to retrieve the traded tokens
   * @returns {Promise<object>[]} A vector of objects containing the relevant bracket, its
   * traded token ids, and a promise with the relevant token info.
   */
  const retrieveTradedTokensPerBracket = async function (bracketAddresses) {
    const exchange = await exchangePromise

    return Promise.all(
      bracketAddresses.map(async (bracketAddress) => {
        const orders = decodeOrders(await exchange.getEncodedUserOrders.call(bracketAddress))
        let tradedTokenIds = []
        for (const order of orders) {
          tradedTokenIds.push(order.buyToken, order.sellToken)
        }
        tradedTokenIds = uniqueItems(tradedTokenIds)
        return {
          bracketAddress,
          tokenIds: tradedTokenIds,
        }
      })
    )
  }

  /**
   * Checks that the address used as the first argument is the only owner of all the Safes
   * specified in the given array.
   *
   * @param {Address} masterAddress address pointing to the candidate only owner of the Safe
   * @param {(SmartContract|Address)[]} fleet array of Safes that might be owned by master
   * @returns {boolean} whether the fleet is indeed owned only by master
   */
  const isOnlyFleetOwner = async function (masterAddress, fleet) {
    return (await Promise.all(uniqueItems(fleet).map((bracketAddress) => isOnlySafeOwner(masterAddress, bracketAddress)))).every(
      (isOnlyOwner) => isOnlyOwner
    )
  }

  /**
   * Checks that a bracket has not yet made any orders
   *
   * @param {Address} bracket for trader account
   * @param {SmartContract} exchange Batch exchange for which we are checking for orders
   * @returns {boolean} true if bracket has existing orders, otherwise false
   */
  const hasExistingOrders = async function (bracket, exchange) {
    const orders = await exchange.getEncodedUserOrders.call(bracket)
    // TODO if orders is not null, could return orders.length / 225 (which is numOrders)
    return orders != null
  }

  /**
   * Returns the symbol of the ERC20 token in input.
   * Returns the value from a list if present, otherwise executes a contract call.
   *
   * @param {string} method the name of the methods that (can be "symbol", "decimals", or "name")
   * @param {SmartContract} tokenInstance instance of the token at the previous address
   * @returns {string|number} the result of calling the selected method
   */
  const tokenDetail = async function (method, tokenInstance) {
    let detail
    const tokenAddress = tokenInstance.address
    const networkId = tokenInstance.constructor.network_id
    if (hardcodedTokensByNetwork[networkId] && hardcodedTokensByNetwork[networkId][tokenAddress]) {
      return hardcodedTokensByNetwork[networkId][tokenAddress][method]
    }
    try {
      detail = await tokenInstance[method].call()
    } catch (error) {
      throw Error(`Cannot retrieve ${method}() of token at address ${tokenAddress}`)
    }
    if (method === "decimals") {
      return detail.toNumber()
    } else {
      return detail
    }
  }

  const globalTokenPromisesFromAddress = {}
  /**
   * Queries EVM for ERC20 token details by address and returns a list of promises of detailed token information.
   *
   * @param {Address[]} tokenAddresses list of *unique* token addresses whose data is to be fetch from the EVM
   * @param {boolean} [debug=false] prints log statements when true
   * @returns {object} object mapping token addresses to a promise of relevant token information
   */
  const fetchTokenInfoAtAddresses = function (tokenAddresses, debug = false) {
    const log = debug ? (...a) => console.log(...a) : () => {}

    let requiresFetching = false
    const tokenPromises = {}
    for (const tokenAddress of tokenAddresses) {
      if (!(tokenAddress in globalTokenPromisesFromAddress)) {
        requiresFetching = true
        globalTokenPromisesFromAddress[tokenAddress] = (async () => {
          const tokenInstance = await ERC20.at(tokenAddress)
          const [tokenSymbol, tokenDecimals] = await Promise.all([
            tokenDetail("symbol", tokenInstance),
            tokenDetail("decimals", tokenInstance),
          ])
          const tokenInfo = {
            address: tokenAddress,
            symbol: tokenSymbol,
            decimals: tokenDecimals,
            instance: tokenInstance,
          }
          log(`Found token ${tokenInfo.symbol} at address ${tokenInfo.address} with ${tokenInfo.decimals} decimals`)
          return tokenInfo
        }).call()
      }
      tokenPromises[tokenAddress] = globalTokenPromisesFromAddress[tokenAddress]
    }
    if (requiresFetching) log("Fetching token data from EVM")
    return tokenPromises
  }

  const globalTokenPromisesFromId = {}
  /**
   * Queries EVM for ERC20 token details by token id and returns a list of detailed token information.
   *
   * @param {SmartContract} exchange BatchExchange, contract, or any contract implementing `tokenIdToAddressMap`
   * @param {number[]} tokenIds list of *unique* token ids whose data is to be fetch from EVM
   * @param {boolean} [debug=false] prints log statements when true
   * @returns {object} object mapping token ids to a promise of relevant token information
   */
  const fetchTokenInfoFromExchange = function (exchange, tokenIds, debug = false) {
    const log = debug ? (...a) => console.log(...a) : () => {}

    let requiresFetching = false
    const tokenPromises = {}
    for (const id of tokenIds) {
      if (!(id in globalTokenPromisesFromId)) {
        requiresFetching = true
        globalTokenPromisesFromId[id] = (async () => {
          const tokenAddress = await exchange.tokenIdToAddressMap(id)
          const tokenInfo = await fetchTokenInfoAtAddresses([tokenAddress], false)[tokenAddress]
          log(
            `Found token ${tokenInfo.symbol} for exchange id ${id} at address ${tokenInfo.address} with ${tokenInfo.decimals} decimals`
          )
          return tokenInfo
        }).call()
      }
      tokenPromises[id] = globalTokenPromisesFromId[id]
    }
    if (requiresFetching) log("Fetching token data from EVM")
    return tokenPromises
  }

  /**
   * Retrieves token information foll all tokens involved in the deposits.
   *
   * @param {(Deposit|Withdrawal|Transfer)[]} flux List of {@link Deposit}, {@link Withdrawal} or {@link Transfer}
   * @param {boolean} [debug=false] prints log statements when true
   * @returns {object} object mapping token addresses to a promise of relevant token information
   */
  const fetchTokenInfoForFlux = function (flux, debug = false) {
    const uniqueAddresses = uniqueItems(flux.map((item) => item.tokenAddress))
    return fetchTokenInfoAtAddresses(uniqueAddresses, debug)
  }

  /**
   * Deploys specified number singler-owner Gnosis Safes having specified ownership
   *
   * @param {Address} masterAddress address of Gnosis Safe (Multi-Sig) owning the newly created Safes
   * @param {number} fleetSize number of safes to be created with masterAddress as owner
   * @returns {Address[]} list of Ethereum Addresses for the brackets that were deployed
   */
  const deployFleetOfSafes = async function (masterAddress, fleetSize) {
    const fleetFactory = await fleetFactoryPromise
    const gnosisSafeMasterCopy = await gnosisSafeMasterCopyPromise

    const transcript = await fleetFactory.deployFleet(masterAddress, fleetSize, gnosisSafeMasterCopy.address)
    return transcript.logs[0].args.fleet
  }

  /**
   * Returns a list of order placement transaction data for BatchExchange
   * on behalf of a fleet of brackets owned by a single "Master Safe"
   *
   * @param {Address} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig) owning all brackets
   * @param {Address[]} bracketAddresses List of addresses with the brackets sending the orders
   * @param {number} baseTokenId ID of token (on BatchExchange) whose target price is to be specified (i.e. ETH)
   * @param {number} quoteTokenId ID of "Quote Token" for which trade with base token (i.e. DAI)
   * @param {number} lowestLimit lower price bound
   * @param {number} highestLimit upper price bound
   * @param {boolean} [debug=false] prints log statements when true
   * @param {number} [expiry=DEFAULT_ORDER_EXPIRY] Maximum auction batch for which these orders are valid (e.g. maxU32)
   * @returns {Transaction[]} all the relevant transactions to be used when submitting to the Gnosis Safe Multi-Sig
   */
  const transactionsForOrders = async function (
    masterAddress,
    bracketAddresses,
    baseTokenId,
    quoteTokenId,
    lowestLimit,
    highestLimit,
    debug = false,
    expiry = DEFAULT_ORDER_EXPIRY
  ) {
    const log = debug ? (...a) => console.log(...a) : () => {}

    assert(lowestLimit < highestLimit, "Lowest limit must be lower than highest limit")

    const exchange = await exchangePromise
    log("Batch Exchange", exchange.address)

    const tokenInfoPromises = fetchTokenInfoFromExchange(exchange, [baseTokenId, quoteTokenId])

    const baseToken = await tokenInfoPromises[baseTokenId]
    const quoteToken = await tokenInfoPromises[quoteTokenId]

    const stepSizeAsMultiplier = Math.pow(highestLimit / lowestLimit, 1 / bracketAddresses.length)
    log(
      `Constructing bracket trading strategy order data between the limits ${lowestLimit}-${highestLimit} ${quoteToken.symbol} per ${baseToken.symbol}`
    )

    const buyAndSellOrderPromises = await Promise.all(
      bracketAddresses.map(async (bracketAddress, bracketIndex) => {
        const lowerLimit = lowestLimit * Math.pow(stepSizeAsMultiplier, bracketIndex)
        const upperLimit = lowerLimit * stepSizeAsMultiplier

        const { base: upperSellAmount, quote: upperBuyAmount } = getUnlimitedOrderAmounts(
          upperLimit,
          baseToken.decimals,
          quoteToken.decimals
        )
        // While the first bracket-order sells baseToken for quoteToken, the second buys baseToken for quoteToken at a lower price.
        // Hence the buyAmounts and sellAmounts are switched in the next line.
        const { base: lowerSellAmount, quote: lowerBuyAmount } = getUnlimitedOrderAmounts(
          1 / lowerLimit,
          quoteToken.decimals,
          baseToken.decimals
        )

        log(
          `Safe ${bracketIndex} - ${bracketAddress}:\n  Buy  ${baseToken.symbol} with ${quoteToken.symbol} at ${lowerLimit}\n  Sell ${baseToken.symbol} for  ${quoteToken.symbol} at ${upperLimit}`
        )

        const orderDataSell = exchange.contract.methods
          .placeOrder(baseTokenId, quoteTokenId, expiry, lowerBuyAmount.toString(), lowerSellAmount.toString())
          .encodeABI()
        const orderDataBuy = exchange.contract.methods
          .placeOrder(quoteTokenId, baseTokenId, expiry, upperBuyAmount.toString(), upperSellAmount.toString())
          .encodeABI()
        const sellOrderTransaction = {
          operation: CALL,
          to: exchange.address,
          value: 0,
          data: orderDataSell,
        }
        const buyOrderTransaction = {
          operation: CALL,
          to: exchange.address,
          value: 0,
          data: orderDataBuy,
        }

        return [
          buildExecTransaction(masterAddress, bracketAddress, sellOrderTransaction),
          buildExecTransaction(masterAddress, bracketAddress, buyOrderTransaction),
        ]
      })
    )
    const transactions = await Promise.all([].concat(...buyAndSellOrderPromises))
    log("Transaction bundle size", transactions.length)
    return transactions
  }

  /**
   * Batches together a collection of order placements on BatchExchange
   * on behalf of a fleet of brackets owned by a single "Master Safe"
   *
   * @param {Address} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig) owning all brackets
   * @param {Address[]} bracketAddresses List of addresses with the brackets sending the orders
   * @param {number} baseTokenId ID of token (on BatchExchange) whose target price is to be specified (i.e. ETH)
   * @param {number} quoteTokenId ID of "Quote Token" for which trade with base token (i.e. DAI)
   * @param {number} lowestLimit lower price bound
   * @param {number} highestLimit upper price bound
   * @param {boolean} [debug=false] prints log statements when true
   * @param {number} [expiry=DEFAULT_ORDER_EXPIRY] Maximum auction batch for which these orders are valid (e.g. maxU32)
   * @returns {Transaction} all the relevant transaction information to be used when submitting to the Gnosis Safe Multi-Sig
   */
  const buildOrders = async function () {
    return buildBundledTransaction(await transactionsForOrders(...arguments))
  }

  const checkSufficiencyOfBalance = async function (token, owner, amount) {
    const depositor_balance = await token.balanceOf.call(owner)
    return depositor_balance.gte(amount)
  }

  /**
   * Batches together a collection of operations (either withdraw or requestWithdraw) on BatchExchange
   * on behalf of a fleet of brackets owned by a single "Master Safe"
   *
   * @param {Address} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
   * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
   * @param {string} functionName Name of the function that is to be executed (can be "requestWithdraw" or "withdraw")
   * @returns {Transaction} Multisend transaction to be sent from masterAddress for withdraw requests or claims
   */
  const buildGenericFundMovement = async function (masterAddress, withdrawals, functionName) {
    // TODO: the name of this function is misleading considering it is only for request and claim of withdraws.
    const exchange = await exchangePromise

    // it's not necessary to avoid overlapping withdraws, since the full amount is withdrawn for each entry
    const masterTransactionsPromises = withdrawals.map((withdrawal) => {
      // create transaction for the token
      let transactionData
      switch (functionName) {
        case "requestWithdraw":
          transactionData = exchange.contract.methods["requestWithdraw"](
            withdrawal.tokenAddress,
            withdrawal.amount.toString()
          ).encodeABI()
          break
        case "withdraw":
          transactionData = exchange.contract.methods["withdraw"](withdrawal.bracketAddress, withdrawal.tokenAddress).encodeABI()
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
      return buildExecTransaction(masterAddress, withdrawal.bracketAddress, transactionToExecute)
    })

    // safe pushing to array
    const masterTransactions = []
    for (const transactionPromise of masterTransactionsPromises) masterTransactions.push(await transactionPromise)
    return buildBundledTransaction(masterTransactions)
  }

  /**
   * Returns a list of transfer-related transaction information. Particularly,
   * the resulting transaction is that of transfering all specified funds from master through its brackets
   * followed by approval and deposit of those same tokens into BatchExchange on behalf of each bracket.
   *
   * @param {string} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
   * @param {Deposit[]} depositList List of {@link Deposit} that are to be bundled together
   * @param {boolean} [debug=false] prints log statements when true
   * @returns {Transaction[]} all the relevant transactions required to be bundled for submission to a Gnosis Safe Multi-Sig
   */
  const transactionsForTransferApproveDepositFromList = async function (masterAddress, depositList, debug = false) {
    const log = debug ? (...a) => console.log(...a) : () => {}

    const tokenInfoPromises = fetchTokenInfoForFlux(depositList)

    // TODO - make cumulative sum of deposits by token and assert that masterSafe has enough for the tranfer
    const transactionLists = await Promise.all(
      depositList.map(async (deposit) => {
        const tokenInfo = await tokenInfoPromises[deposit.tokenAddress]
        const unitAmount = fromErc20Units(deposit.amount, tokenInfo.decimals)
        log(
          `Safe ${deposit.bracketAddress} receiving (from ${shortenedAddress(masterAddress)}) and depositing ${unitAmount} ${
            tokenInfo.symbol
          } into BatchExchange`
        )

        return buildBracketTransactionForTransferApproveDeposit(
          masterAddress,
          deposit.tokenAddress,
          deposit.bracketAddress,
          deposit.amount
        )
      })
    )

    let transactions = []
    for (const transactionList of transactionLists) transactions = transactions.concat(transactionList)

    return transactions
  }

  /**
   * Batches together a collection of transfer-related transaction information. Particularily,
   * the resulting transaction is that of transfering all specified funds from master through its brackets
   * followed by approval and deposit of those same tokens into BatchExchange on behalf of each bracket.
   *
   * @param {string} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
   * @param {Deposit[]} depositList List of {@link Deposit} that are to be bundled together
   * @param {boolean} [debug=false] prints log statements when true
   * @returns {Transaction} all the relevant transaction information used for submission to a Gnosis Safe Multi-Sig
   */
  const buildTransferApproveDepositFromList = async function () {
    return buildBundledTransaction(await transactionsForTransferApproveDepositFromList(...arguments))
  }

  /**
   * Batches together a collection of Deposits from brackets into BatchExchange. Particularily,
   * the resulting transaction is that of approval and deposit of specified tokens behalf of each bracket.
   *
   * @param {string} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
   * @param {Deposit[]} depositList List of {@link Deposit} that are to be bundled together
   * @param {boolean} [debug=false] prints log statements when true
   * @returns {Transaction} all the relevant transaction information used for submission to a Gnosis Safe Multi-Sig
   */
  const buildDepositFromList = async function (masterAddress, depositList, debug = false) {
    const log = debug ? (...a) => console.log(...a) : () => {}
    const exchange = await exchangePromise
    const tokenInfoPromises = fetchTokenInfoForFlux(depositList)

    // TODO - make cumulative sum of deposits by token and assert that masterSafe has enough for the tranfer
    const transactions = await Promise.all(
      depositList.map(async (deposit) => {
        const tokenInfo = await tokenInfoPromises[deposit.tokenAddress]
        const unitAmount = fromErc20Units(deposit.amount, tokenInfo.decimals)
        log(`Safe ${deposit.bracketAddress} depositing ${unitAmount} ${tokenInfo.symbol} into BatchExchange`)

        const approveData = tokenInfo.instance.contract.methods.approve(exchange.address, deposit.amount).encodeABI()
        const depositData = exchange.contract.methods.deposit(deposit.tokenAddress, deposit.amount).encodeABI()
        const bracketBundledTransaction = await buildBundledTransaction([
          { operation: CALL, to: deposit.tokenAddress, value: 0, data: approveData },
          { operation: CALL, to: exchange.address, value: 0, data: depositData },
        ])
        // Get transaction executing approve & deposit multisend via bracket
        return buildExecTransaction(masterAddress, deposit.bracketAddress, bracketBundledTransaction)
      })
    )
    return buildBundledTransaction(transactions)
  }

  /**
   * Batches together a collection of transfer-related transaction information. Particularily,
   * the resulting transaction is that of transfering all specified funds from master through its brackets
   * followed by approval and deposit of those same tokens into BatchExchange on behalf of each bracket.
   *
   * @param {string} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
   * @param {Transfer[]} transferList List of {@link Deposit} that are to be bundled together
   * @param {boolean} [unsafe=false] does not perform balance verification
   * @param {boolean} [debug=false] prints log statements when true
   * @returns {Transaction} all the relevant transaction information used for submission to a Gnosis Safe Multi-Sig
   */
  const buildTransferDataFromList = async function (masterAddress, transferList, unsafe = false, debug = false) {
    const log = debug ? (...a) => console.log(...a) : () => {}

    const uniqueTokens = uniqueItems(transferList.map((t) => t.tokenAddress))
    const tokenInfo = fetchTokenInfoForFlux(transferList)

    // Will be used to make sufficient balance assertion before transfer.
    const cumulativeAmounts = new Map(uniqueTokens.map((address) => [address, new BN(0)]))
    const transactions = await Promise.all(
      transferList.map(async (transfer) => {
        const token = await tokenInfo[transfer.tokenAddress]
        const weiAmount = toErc20Units(transfer.amount, token.decimals)
        // Accumulate amounts being transfered for each token.
        cumulativeAmounts.set(token.address, cumulativeAmounts.get(token.address).add(weiAmount))

        log(
          `Transferring ${fromErc20Units(weiAmount, token.decimals)} ${token.symbol} to ${
            transfer.receiver
          } from ${shortenedAddress(masterAddress)}`
        )
        const transferData = token.instance.contract.methods.transfer(transfer.receiver, weiAmount.toString()).encodeABI()
        return {
          operation: CALL,
          to: token.address,
          value: 0,
          data: transferData,
        }
      })
    )
    log(`Transfer bundle contains ${transactions.length} elements and sends ${uniqueTokens.length} distinct tokens.`)
    if (!unsafe) {
      // Ensure sufficient funds.
      await Promise.all(
        uniqueTokens.map(async (tokenAddress) => {
          const token = await tokenInfo[tokenAddress]
          const masterBalance = await token.instance.balanceOf(masterAddress)
          if (masterBalance.lt(cumulativeAmounts.get(tokenAddress))) {
            throw new Error(
              `Fund Account has insufficient ${token.symbol} balance (${masterBalance.toString()} < ${cumulativeAmounts
                .get(tokenAddress)
                .toString()})`
            )
          }
          log(`    * ${fromErc20Units(cumulativeAmounts.get(tokenAddress), token.decimals)} - ${token.symbol}`)
        })
      )
      log("Balance verification passed")
    }
    return buildBundledTransaction(transactions)
  }

  const formatDepositString = function (depositsAsJsonString) {
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
   * Fetches the brackets deployed by a given masterSafe from the blockchain via events
   *
   * @param {Address} masterSafe Fund account for the brackets being queried.
   * @returns {Address[]} List of bracket (Safe) addresses
   **/
  const getDeployedBrackets = async function (masterSafe) {
    const FleetFactory = artifacts.require("FleetFactory")
    const fleetFactory = await FleetFactory.deployed()
    const events = await fleetFactory.getPastEvents("FleetDeployed", {
      filter: { owner: masterSafe },
      fromBlock: 0,
      toBlock: "latest",
    })
    const bracketsAsObjects = events.map((object) => object.returnValues.fleet)
    return [].concat(...bracketsAsObjects)
  }
  /**
   * Batches together a collection of transfer-related transaction information.
   * Particularly, the resulting transaction is that of transfering all sufficient funds from master
   * to its brackets, then approving and depositing those same tokens into BatchExchange on behalf of each bracket.
   *
   * @param {Address} masterAddress Address of the master safe owning the brackets
   * @param {Address[]} bracketAddresses list of bracket addresses that need the deposit
   * @param {Address} baseTokenAddress second token to be traded in bracket strategy
   * @param {Address} quoteTokenAddress one token to be traded in bracket strategy
   * @param {number} lowestLimit lower price bound
   * @param {number} highestLimit upper price bound
   * @param {number} currentPrice current quote price
   * @param {number} depositQuoteToken Amount of quote tokens to be invested (in total)
   * @param {number} depositBaseToken Amount of base tokens to be invested (in total)
   * @param {boolean} storeDepositsAsFile whether to write the executed deposits to a file (defaults to false)
   * @returns {Transaction} all the relevant transaction information to be used when submitting to the Gnosis Safe Multi-Sig
   */
  const buildTransferApproveDepositFromOrders = async function (
    masterAddress,
    bracketAddresses,
    baseTokenAddress,
    quoteTokenAddress,
    lowestLimit,
    highestLimit,
    currentPrice,
    depositQuoteToken,
    depositBaseToken,
    storeDepositsAsFile = false
  ) {
    const numBrackets = bracketAddresses.length
    const stepSizeAsMultiplier = Math.pow(highestLimit / lowestLimit, 1 / bracketAddresses.length)
    // bracketIndexAtCurrentPrice is calculated with: lowestLimit * stepSizeAsMultiplier ^ x = currentPrice and solved for x
    // in case the currentPrice is at the limit price of two bracket-trader, only the first bracket-trader - the one with the
    // second order will be funded.
    let bracketIndexAtCurrentPrice = Math.round(Math.log(currentPrice / lowestLimit) / Math.log(stepSizeAsMultiplier))
    if (bracketIndexAtCurrentPrice > numBrackets) {
      bracketIndexAtCurrentPrice = numBrackets
    }
    if (bracketIndexAtCurrentPrice < 0) {
      bracketIndexAtCurrentPrice = 0
    }

    const deposits = []

    for (const i of Array(bracketIndexAtCurrentPrice).keys()) {
      const deposit = {
        amount: depositQuoteToken.div(new BN(bracketIndexAtCurrentPrice)).toString(),
        tokenAddress: quoteTokenAddress,
        bracketAddress: bracketAddresses[i],
      }
      deposits.push(deposit)
    }
    for (const i of Array(numBrackets - bracketIndexAtCurrentPrice).keys()) {
      const deposit = {
        amount: depositBaseToken.div(new BN(numBrackets - bracketIndexAtCurrentPrice)).toString(),
        tokenAddress: baseTokenAddress,
        bracketAddress: bracketAddresses[bracketIndexAtCurrentPrice + i],
      }
      deposits.push(deposit)
    }
    if (storeDepositsAsFile) {
      const depositsAsJsonString = formatDepositString(JSON.stringify(deposits))
      fs.writeFile("./automaticallyGeneratedDeposits.json", depositsAsJsonString, function (err) {
        if (err) {
          console.log("Warning: deposits could not be stored as a file.")
          console.log(err)
        }
      })
    }
    return buildTransferApproveDepositFromList(masterAddress, deposits)
  }

  /**
   * Batches together a collection of transfers from each bracket safe to master
   *
   * @param {Address} masterAddress address of Master Gnosis Safe (Multi-Sig)
   * @param {Address} tokenAddress for the funds to be deposited
   * @param {Address} bracketAddress The address of the bracket owning the funds in the Exchange
   * @param {BN} amount Amount to be deposited
   * @returns {Transaction} Information describing the multisend transaction that has to be sent from the master address to transfer back all funds
   */
  const buildBracketTransactionForTransferApproveDeposit = async (masterAddress, tokenAddress, bracketAddress, amount) => {
    const exchange = await exchangePromise
    const tokenInfo = await fetchTokenInfoAtAddresses([tokenAddress], false)[tokenAddress]
    const depositToken = tokenInfo.instance
    const transactions = []

    // log(`Deposit Token at ${depositToken.address}: ${tokenSymbol}`)
    // Get data to move funds from master to bracket
    const transferData = depositToken.contract.methods.transfer(bracketAddress, amount.toString()).encodeABI()
    transactions.push({
      operation: CALL,
      to: depositToken.address,
      value: 0,
      data: transferData,
    })
    // Get data to approve funds from bracket to exchange
    const approveData = depositToken.contract.methods.approve(exchange.address, amount.toString()).encodeABI()
    // Get data to deposit funds from bracket to exchange
    const depositData = exchange.contract.methods.deposit(tokenAddress, amount.toString()).encodeABI()
    // Get transaction for approve and deposit multisend on bracket
    const bracketBundledTransaction = await buildBundledTransaction([
      { operation: CALL, to: tokenAddress, value: 0, data: approveData },
      { operation: CALL, to: exchange.address, value: 0, data: depositData },
    ])
    // Get transaction executing approve/deposit multisend via bracket
    const execTransaction = await buildExecTransaction(masterAddress, bracketAddress, bracketBundledTransaction)
    transactions.push(execTransaction)
    return transactions
  }

  /**
   * Batches together a collection of "requestWithdraw" calls on BatchExchange
   * on behalf of a fleet of brackets owned by a single "Master Safe"
   *
   * @param {Address} masterAddress address of Master Gnosis Safe (Multi-Sig)
   * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
   * @returns {Transaction} Multisend transaction requesting withdraw that must sent from masterAddress
   */
  const buildWithdrawRequest = function (masterAddress, withdrawals) {
    return buildGenericFundMovement(masterAddress, withdrawals, "requestWithdraw")
  }

  /**
   * Batches together a collection of "withdraw" calls on BatchExchange
   * on behalf of a fleet of safes owned by a single "Master Safe"
   * Warning: if any bundled transaction fails, then no funds are withdrawn from the exchange.
   *   Ensure 1. to have executed requestWithdraw for every input before executing
   *          2. no bracket orders have been executed on these tokens (a way to ensure this is to cancel the brackets' standing orders)
   *
   * @param {Address} masterAddress address of Master Gnosis Safe (Multi-Sig)
   * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
   * @returns {Transaction} Multisend transaction that has to be sent from the master address to withdraw the desired funds
   */
  const buildWithdrawClaim = function (masterAddress, withdrawals) {
    return buildGenericFundMovement(masterAddress, withdrawals, "withdraw")
  }

  /**
   * Batches together a collection of transfers from each bracket to master
   *
   * @param {Address} masterAddress address of Master Gnosis Safe (Multi-Sig)
   * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
   * @param {boolean} limitToMaxWithdrawableAmount flag indicating max withdrawable amount should be limited to balance
   * @returns {Transaction} Multisend transaction that has to be sent from the master address to transfer back all funds
   */
  const buildTransferFundsToMaster = async function (masterAddress, withdrawals, limitToMaxWithdrawableAmount) {
    const tokeinInfoPromises = fetchTokenInfoForFlux(withdrawals)

    // TODO: enforce that there are no overlapping withdrawals
    const masterTransactions = await Promise.all(
      withdrawals.map(async (withdrawal) => {
        const tokenInfo = await tokeinInfoPromises[withdrawal.tokenAddress]
        const token = tokenInfo.instance
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
        return buildExecTransaction(masterAddress, withdrawal.bracketAddress, transactionToExecute)
      })
    )

    return buildBundledTransaction(masterTransactions)
  }

  /**
   * Batches together a collection of transfers from each bracket to master
   *
   * @param {Address} masterAddress address of Master Gnosis Safe (Multi-Sig)
   * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
   * @returns {Transaction} Multisend transaction that has to be sent from the master address to transfer back the fubnds stored in the exchange
   */
  const buildWithdrawAndTransferFundsToMaster = async function (masterAddress, withdrawals) {
    const withdrawalTransaction = await buildWithdrawClaim(masterAddress, withdrawals)
    const transferFundsToMasterTransaction = await buildTransferFundsToMaster(masterAddress, withdrawals, false)
    return buildBundledTransaction([withdrawalTransaction, transferFundsToMasterTransaction])
  }

  const getAllowances = async function (owner, tokenInfo) {
    const allowances = {}
    await Promise.all(
      Object.entries(tokenInfo).map(async ([tokenAddress, tokenData]) => {
        const token = (await tokenData).instance
        const eventList = await token.getPastEvents("Approval", { fromBlock: 0, toBlock: "latest", filter: { owner: [owner] } })
        const spenders = uniqueItems(eventList.map((event) => event.returnValues.spender))
        const tokenAllowances = {}
        // TODO: replace with web3 batch request if we need to reduce number of calls. This may require using web3 directly instead of Truffle contracts
        await Promise.all(
          spenders.map(async (spender) => {
            tokenAllowances[spender] = await token.allowance(owner, spender)
          })
        )
        allowances[tokenAddress] = tokenAllowances
      })
    )
    return allowances
  }

  const assertNoAllowances = async function (address, tokenInfo, exceptions = []) {
    const allowances = await getAllowances(address, tokenInfo)
    for (const [tokenAddress, tokenAllowances] of Object.entries(allowances)) {
      for (const spender in tokenAllowances) {
        if (!exceptions.includes(spender))
          assert.equal(
            tokenAllowances[spender].toString(),
            "0",
            address +
              " allows address " +
              spender +
              " to spend " +
              (await tokenInfo[tokenAddress]).symbol +
              " (amount: " +
              fromErc20Units(tokenAllowances[spender], (await tokenInfo[tokenAddress]).decimals) +
              ")"
          )
      }
    }
  }

  return {
    assertNoAllowances,
    assertIsOnlyFleetOwner,
    buildBracketTransactionForTransferApproveDeposit,
    buildDepositFromList,
    buildOrders,
    buildTransferApproveDepositFromOrders,
    buildTransferApproveDepositFromList,
    buildTransferDataFromList,
    buildTransferFundsToMaster,
    buildWithdrawAndTransferFundsToMaster,
    buildWithdrawClaim,
    buildWithdrawRequest,
    transactionsForOrders,
    transactionsForTransferApproveDepositFromList,
    checkSufficiencyOfBalance,
    deployFleetOfSafes,
    fetchTokenInfoAtAddresses,
    fetchTokenInfoFromExchange,
    fetchTokenInfoForFlux,
    getAllowances,
    getDeployedBrackets,
    getExchange,
    getSafe,
    hasExistingOrders,
    isOnlySafeOwner,
    isOnlyFleetOwner,
    retrieveTradedTokensPerBracket,
    tokenDetail,
  }
}
