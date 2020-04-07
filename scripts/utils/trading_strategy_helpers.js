module.exports = function(web3 = web3, artifacts = artifacts) {
  const Contract = require("@truffle/contract")
  const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
  const GnosisSafe = artifacts.require("GnosisSafe")
  const FleetFactory = artifacts.require("FleetFactory")
  BatchExchange.setNetwork(web3.network_id)
  BatchExchange.setProvider(web3.currentProvider)
  const exchangePromise = BatchExchange.deployed()
  const gnosisSafeMasterCopyPromise = GnosisSafe.deployed()
  const fleetFactoryPromise = FleetFactory.deployed()

  const assert = require("assert")
  const BN = require("bn.js")
  const fs = require("fs")
  const { buildBundledTransaction, buildExecTransaction, CALL } = require("./internals")(web3, artifacts)
  const { shortenedAddress, fromErc20Units, toErc20Units } = require("./printing_tools")
  const { allElementsOnlyOnce } = require("./js_helpers")
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
   * @typedef TokenObject
   *  * Example:
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
   * Returns an instance of the exchange contract
   */
  const getExchange = function(web3) {
    BatchExchange.setNetwork(web3.network_id)
    BatchExchange.setProvider(web3.currentProvider)
    return BatchExchange.deployed()
  }

  /**
   * Returns an instance of the safe contract at the given address
   * @param {Address} safeAddress address of the safe of which to create an instance
   */
  const getSafe = function(safeAddress) {
    return GnosisSafe.at(safeAddress)
  }

  /**
   * Checks that the first input address is the only owner of the first input address
   * @param {Address} masterAddress address that should be the only owner
   * @param {Address} ownedAddress address that is owned
   * @return {bool} whether ownedAddress is indeed owned only by masterAddress
   */
  const isOnlySafeOwner = async function(masterAddress, ownedAddress) {
    const owned = await getSafe(ownedAddress)
    const ownerAddresses = await owned.getOwners()
    return ownerAddresses.length == 1 && ownerAddresses[0] == masterAddress
  }

  const globalTokenPromisesFromAddress = {}
  /**
   * Queries EVM for ERC20 token details by address
   * and returns a list of promises of detailed token information.
   * @param {Address[]} tokenAddresses list of *unique* token addresses whose data is to be fetch from the EVM
   * @return {Promise<TokenObject>[]} list of detailed/relevant token information
   */
  const fetchTokenInfoAtAddresses = function(tokenAddresses, debug = false) {
    const log = debug ? () => console.log.apply(arguments) : () => {}
    const ERC20 = artifacts.require("ERC20Detailed")

    log("Fetching token data from EVM")
    const tokenPromises = {}
    for (const tokenAddress of tokenAddresses) {
      if (!(tokenAddress in globalTokenPromisesFromAddress)) {
        globalTokenPromisesFromAddress[tokenAddress] = (async () => {
          const tokenInstance = await ERC20.at(tokenAddress)
          const [tokenSymbol, tokenDecimals] = await Promise.all([tokenInstance.symbol.call(), tokenInstance.decimals.call()])
          const tokenInfo = {
            address: tokenAddress,
            symbol: tokenSymbol,
            decimals: tokenDecimals.toNumber(),
            instance: tokenInstance,
          }
          log(`Found token ${tokenInfo.symbol} at address ${tokenInfo.address} with ${tokenInfo.decimals} decimals`)
          return tokenInfo
        }).call()
      }
      tokenPromises[tokenAddress] = globalTokenPromisesFromAddress[tokenAddress]
    }
    return tokenPromises
  }

  const globalTokenPromisesFromId = {}
  /**
   * Queries EVM for ERC20 token details by token id
   * and returns a list of detailed token information.
   * @param {SmartContract} exchange BatchExchange, contract, or any contract implementing `tokenIdToAddressMap`
   * @param {integer[]} tokenIds list of *unique* token ids whose data is to be fetch from EVM
   * @return {Promise<TokenObject>[]} list of detailed/relevant token information
   */
  const fetchTokenInfoFromExchange = function(exchange, tokenIds, debug = false) {
    const log = debug ? () => console.log.apply(arguments) : () => {}

    log("Fetching token data from EVM")
    const tokenPromises = {}
    for (const id of tokenIds) {
      if (!(id in globalTokenPromisesFromId)) {
        globalTokenPromisesFromId[id] = (async () => {
          const tokenAddress = await exchange.tokenIdToAddressMap(id)
          log(`Token id ${id} corresponds to token at address ${tokenAddress}`)
          return fetchTokenInfoAtAddresses([tokenAddress], debug)[tokenAddress]
        }).call()
      }
      tokenPromises[id] = globalTokenPromisesFromId[id]
    }
    return tokenPromises
  }

  /**
   * Retrieves token information foll all tokens involved in the deposits.
   * @param {(Deposit|Withdrawal)[]} flux List of {@link Deposit} or {@link Withdrawal}
   * @return {Promise<TokenObject>[]} list of detailed/relevant token information
   */
  const fetchTokenInfoForFlux = function(flux, debug = false) {
    const tokensInvolved = allElementsOnlyOnce(flux.map(entry => entry.tokenAddress))
    return fetchTokenInfoAtAddresses(tokensInvolved, debug)
  }

  /**
   * Deploys specified number singler-owner Gnosis Safes having specified ownership
   * @param {Address} masterAddress address of Gnosis Safe (Multi-Sig) owning the newly created Safes
   * @param {integer} fleetSize number of safes to be created with masterAddress as owner
   * @return {Address[]} list of Ethereum Addresses for the brackets that were deployed
   */
  const deployFleetOfSafes = async function(masterAddress, fleetSize, debug = false) {
    const log = debug ? (...a) => console.log(...a) : () => {}

    const fleetFactory = await fleetFactoryPromise
    const gnosisSafeMasterCopy = await gnosisSafeMasterCopyPromise

    const transcript = await fleetFactory.deployFleet(masterAddress, fleetSize, gnosisSafeMasterCopy.address)
    const createdSafes = transcript.logs[0].args.fleet
    log("New Safes created:")
    createdSafes.forEach((safeAddress, index) => {
      log("Safe " + index + ":", safeAddress)
    })

    return createdSafes
  }

  /**
   * Batches together a collection of order placements on BatchExchange
   * on behalf of a fleet of brackets owned by a single "Master Safe"
   * @param {Address} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig) owning all brackets
   * @param {Address[]} bracketAddresses List of addresses with the brackets sending the orders
   * @param {integer} targetTokenId ID of token (on BatchExchange) whose target price is to be specified (i.e. ETH)
   * @param {integer} stableTokenId ID of "Stable Token" for which trade with target token (i.e. DAI)
   * @param {number} currentPrice Price at which the order brackets will be centered (e.g. current price of ETH in USD)
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
    lowestLimit,
    highestLimit,
    debug = false,
    validFrom = 3,
    expiry = maxU32
  ) {
    const log = debug ? (...a) => console.log(...a) : () => {}

    const exchange = await exchangePromise
    log("Batch Exchange", exchange.address)

    const tokenInfoPromises = fetchTokenInfoFromExchange(exchange, [targetTokenId, stableTokenId])
    const batchIndexPromise = exchange.getCurrentBatchId.call()

    const targetToken = await tokenInfoPromises[targetTokenId]
    const stableToken = await tokenInfoPromises[stableTokenId]

    const stepSizeAsMultiplier = Math.pow(highestLimit / lowestLimit, 1 / bracketAddresses.length)
    log(
      `Constructing bracket trading strategy order data between the limits ${lowestLimit}-${highestLimit} ${stableToken.symbol} per ${targetToken.symbol}`
    )

    const transactions = await Promise.all(
      bracketAddresses.map(async (bracketAddress, bracketIndex) => {
        assert(await isOnlySafeOwner(masterAddress, bracketAddress), "each bracket should be owned only by the master Safe")

        const lowerLimit = lowestLimit * Math.pow(stepSizeAsMultiplier, bracketIndex)
        const upperLimit = lowerLimit * stepSizeAsMultiplier

        const [upperSellAmount, upperBuyAmount] = calculateBuyAndSellAmountsFromPrice(upperLimit, stableToken, targetToken)
        // While the first bracket-order trades standard_token against target_token, the second bracket-order trades
        // target_token against standard_token. Hence the buyAmounts and sellAmounts are switched in the next line.
        const [lowerBuyAmount, lowerSellAmount] = calculateBuyAndSellAmountsFromPrice(lowerLimit, stableToken, targetToken)

        log(
          `Safe ${bracketIndex} - ${bracketAddress}:\n  Buy  ${targetToken.symbol} with ${stableToken.symbol} at ${lowerLimit}\n  Sell ${targetToken.symbol} for  ${stableToken.symbol} at ${upperLimit}`
        )
        const validFromForAllOrders = (await batchIndexPromise).toNumber() + validFrom
        log(`The orders will be valid from the batch: ${validFromForAllOrders}`)

        const buyTokens = [targetTokenId, stableTokenId]
        const sellTokens = [stableTokenId, targetTokenId]
        const validFroms = [validFromForAllOrders, validFromForAllOrders]
        const validTos = [expiry, expiry]
        const buyAmounts = [lowerBuyAmount, upperBuyAmount]
        const sellAmounts = [lowerSellAmount, upperSellAmount]

        const orderData = exchange.contract.methods
          .placeValidFromOrders(buyTokens, sellTokens, validFroms, validTos, buyAmounts, sellAmounts)
          .encodeABI()
        const orderTransaction = {
          operation: CALL,
          to: exchange.address,
          value: 0,
          data: orderData,
        }

        return buildExecTransaction(masterAddress, bracketAddress, orderTransaction)
      })
    )

    log("Transaction bundle size", transactions.length)
    return buildBundledTransaction(transactions)
  }

  const calculateBuyAndSellAmountsFromPrice = function(price, stableToken, targetToken) {
    // decimalsForPrice: This number defines the rounding errors,
    // Since we can accept similar rounding error as within the smart contract
    // we set it to 38 = amount of digits of max128
    const decimalsForPrice = 38
    const roundedPrice = price.toFixed(decimalsForPrice)
    const priceFormatted = toErc20Units(roundedPrice, decimalsForPrice)

    const decimalsForOne = decimalsForPrice - stableToken.decimals + targetToken.decimals
    const ONE = toErc20Units(1, decimalsForOne)
    let sellAmount
    let buyAmount
    if (priceFormatted.gt(ONE)) {
      sellAmount = max128
        .mul(ONE)
        .div(priceFormatted)
        .toString()
      buyAmount = max128.toString()
    } else {
      buyAmount = max128
        .mul(priceFormatted)
        .div(ONE)
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
  const buildGenericFundMovement = async function(masterAddress, withdrawals, functionName) {
    const exchange = await exchangePromise

    // it's not necessary to avoid overlapping withdraws, since the full amount is withdrawn for each entry
    const masterTransactionsPromises = withdrawals.map(withdrawal => {
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
   * Batches together a collection of transfer-related transaction information.
   * Particularily, the resulting transaction is that of transfering all sufficient funds from master
   * to its brackets, then approving and depositing those same tokens into BatchExchange on behalf of each bracket.
   * @param {string} masterAddress Ethereum address of Master Gnosis Safe (Multi-Sig)
   * @param {Deposit[]} depositList List of {@link Deposit} that are to be bundled together
   * @return {Transaction} all the relevant transaction information to be used when submitting to the Gnosis Safe Multi-Sig
   */
  const buildTransferApproveDepositFromList = async function(masterAddress, depositList, debug = false) {
    const log = debug ? (...a) => console.log(...a) : () => {}

    const tokenInfoPromises = fetchTokenInfoForFlux(depositList)

    // TODO - make cumulative sum of deposits by token and assert that masterSafe has enough for the tranfer
    const transactionLists = await Promise.all(
      depositList.map(async deposit => {
        assert(
          await isOnlySafeOwner(masterAddress, deposit.bracketAddress),
          "All depositors must be owned only by the master Safe"
        )
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

    return buildBundledTransaction(transactions)
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
    targetTokenAddress,
    stableTokenAddress,
    lowestLimit,
    highestLimit,
    currentPrice,
    investmentStableToken,
    investmentTargetToken,
    storeDepositsAsFile = false
  ) {
    const fleetSize = bracketAddresses.length
    const stepSizeAsMultiplier = Math.pow(highestLimit / lowestLimit, 1 / bracketAddresses.length)
    // bracketIndexAtcurrentPrice is calculated with: lowestLimit * stepSizeAsMultiplier ^ x = currentPrice and solved for x
    // in case the currentPrice is at the limit price of two bracket-trader, only the first bracket-trader - the one with the
    // second order will be funded.
    let bracketIndexAtcurrentPrice = Math.round(Math.log(currentPrice / lowestLimit) / Math.log(stepSizeAsMultiplier))
    if (bracketIndexAtcurrentPrice > fleetSize) {
      bracketIndexAtcurrentPrice = fleetSize
    }
    if (bracketIndexAtcurrentPrice < 0) {
      bracketIndexAtcurrentPrice = 0
    }

    const deposits = []

    for (const i of Array(bracketIndexAtcurrentPrice).keys()) {
      const deposit = {
        amount: investmentStableToken.div(new BN(bracketIndexAtcurrentPrice)).toString(),
        tokenAddress: stableTokenAddress,
        bracketAddress: bracketAddresses[i],
      }
      deposits.push(deposit)
    }
    for (const i of Array(fleetSize - bracketIndexAtcurrentPrice).keys()) {
      const deposit = {
        amount: investmentTargetToken.div(new BN(fleetSize - bracketIndexAtcurrentPrice)).toString(),
        tokenAddress: targetTokenAddress,
        bracketAddress: bracketAddresses[bracketIndexAtcurrentPrice + i],
      }
      deposits.push(deposit)
    }
    if (storeDepositsAsFile) {
      const depositsAsJsonString = formatDepositString(JSON.stringify(deposits))
      fs.writeFile("./automaticallyGeneratedDeposits.json", depositsAsJsonString, function(err) {
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
   * @param {Address} masterAddress address of Master Gnosis Safe (Multi-Sig)
   * @param {Address} tokenAddress for the funds to be deposited
   * @param {Address} bracketAddress The address of the bracket owning the funds in the Exchange
   * @param {BN} amount Amount to be deposited
   * @return {Transaction} Information describing the multisend transaction that has to be sent from the master address to transfer back all funds
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
 * @param {Address} masterAddress address of Master Gnosis Safe (Multi-Sig)
 * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
 * @return {Transaction} Multisend transaction that has to be sent from the master address to request
withdrawal of the desired funds
*/
  const buildRequestWithdraw = function(masterAddress, withdrawals) {
    return buildGenericFundMovement(masterAddress, withdrawals, "requestWithdraw")
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
  const buildWithdraw = function(masterAddress, withdrawals) {
    return buildGenericFundMovement(masterAddress, withdrawals, "withdraw")
  }

  /**
   * Batches together a collection of transfers from each bracket to master
   * @param {Address} masterAddress address of Master Gnosis Safe (Multi-Sig)
   * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
   * @return {Transaction} Multisend transaction that has to be sent from the master address to transfer back all funds
   */
  const buildTransferFundsToMaster = async function(masterAddress, withdrawals, limitToMaxWithdrawableAmount) {
    const tokeinInfoPromises = fetchTokenInfoForFlux(withdrawals)

    // TODO: enforce that there are no overlapping withdrawals
    const masterTransactions = await Promise.all(
      withdrawals.map(async withdrawal => {
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
   * @param {Address} masterAddress address of Master Gnosis Safe (Multi-Sig)
   * @param {Withdrawal[]} withdrawals List of {@link Withdrawal} that are to be bundled together
   * @return {Transaction} Multisend transaction that has to be sent from the master address to transfer back the fubnds stored in the exchange
   */
  const buildWithdrawAndTransferFundsToMaster = async function(masterAddress, withdrawals) {
    const withdrawalTransaction = await buildWithdraw(masterAddress, withdrawals)
    const transferFundsToMasterTransaction = await buildTransferFundsToMaster(masterAddress, withdrawals, false)
    return buildBundledTransaction([withdrawalTransaction, transferFundsToMasterTransaction])
  }

  const getAllowances = async function(owner, tokenInfo) {
    const allowances = {}
    await Promise.all(
      Object.entries(tokenInfo).map(async ([tokenAddress, tokenData]) => {
        const token = (await tokenData).instance
        const eventList = await token.getPastEvents("Approval", { fromBlock: 0, toBlock: "latest", filter: { owner: [owner] } })
        const spenders = allElementsOnlyOnce(eventList.map(event => event.returnValues.spender))
        const tokenAllowances = {}
        // TODO: replace with web3 batch request if we need to reduce number of calls. This may require using web3 directly instead of Truffle contracts
        await Promise.all(
          spenders.map(async spender => {
            tokenAllowances[spender] = await token.allowance(owner, spender)
          })
        )
        allowances[tokenAddress] = tokenAllowances
      })
    )
    return allowances
  }

  const assertNoAllowances = async function(address, tokenInfo, exceptions = []) {
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
    getSafe,
    getExchange,
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
    fetchTokenInfoAtAddresses,
    fetchTokenInfoFromExchange,
    fetchTokenInfoForFlux,
    isOnlySafeOwner,
    getAllowances,
    assertNoAllowances,
    max128,
    maxU32,
    maxUINT,
    ADDRESS_0,
  }
}
