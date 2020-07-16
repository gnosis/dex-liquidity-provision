const assert = require("assert")

const {
  deployFleetOfSafes,
  fetchTokenInfoFromExchange,
  buildTransferApproveDepositFromOrders,
  buildOrders,
  checkSufficiencyOfBalance,
  hasExistingOrders,
  getSafe,
  getExchange,
} = require("./utils/trading_strategy_helpers")(web3, artifacts)
const { signAndSend, transactionExistsOnSafeServer } = require("./utils/gnosis_safe_server_interactions")(web3, artifacts)
const { verifyBracketsWellFormed } = require("./utils/verify_scripts")(web3, artifacts)

const { isPriceReasonable, areBoundsReasonable } = require("./utils/price_utils")
const { proceedAnyways } = require("./utils/user_interface_helpers")
const { toErc20Units } = require("./utils/printing_tools")
const { sleep } = require("./utils/js_helpers")
const { DEFAULT_NUM_SAFES } = require("./utils/constants")
const { default_yargs, checkBracketsForDuplicate } = require("./utils/default_yargs")

const argv = default_yargs
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning every bracket",
    demandOption: true,
  })
  .option("numBrackets", {
    type: "int",
    default: DEFAULT_NUM_SAFES,
    describe: "Number of brackets to be deployed",
  })
  .option("brackets", {
    type: "string",
    describe: "Trader account addresses to place orders on behalf of",
    coerce: (str) => {
      return str.split(",")
    },
  })
  .option("baseTokenId", {
    type: "int",
    describe: "Token whose target price is to be specified (i.e. ETH)",
    demandOption: true,
  })
  .option("depositBaseToken", {
    type: "string",
    describe: "Amount to be invested into the baseToken",
    demandOption: true,
  })
  .option("quoteTokenId", {
    type: "int",
    describe: "Trusted Quote Token for which to open orders (i.e. DAI)",
    demandOption: true,
  })
  .option("depositQuoteToken", {
    type: "string",
    describe: "Amount to be invested into the quoteToken",
    demandOption: true,
  })
  .option("currentPrice", {
    type: "float",
    describe: "Price at which the brackets will be centered (e.g. current price of ETH in USD)",
    demandOption: true,
  })
  .option("lowestLimit", {
    type: "float",
    describe: "Price for the bracket buying with the lowest price",
  })
  .option("highestLimit", {
    type: "float",
    describe: "Price for the bracket selling at the highest price",
  })
  .option("verify", {
    type: "boolean",
    default: false,
    describe: "Do not actually send transactions, just simulate their submission",
  })
  .option("nonce", {
    type: "int",
    describe: "Use this specific nonce instead of the next available one",
  })
  .check(checkBracketsForDuplicate).argv

const findBracketsWithExistingOrders = async function (bracketAddresses, exchange) {
  const existingOrders = await Promise.all(
    bracketAddresses.map(async (safeAddr) => {
      return hasExistingOrders(safeAddr, exchange)
    })
  )
  return bracketAddresses.filter((_, i) => existingOrders[i])
}

module.exports = async (callback) => {
  try {
    // initialize promises that will be used later in the code to speed up execution
    const exchangePromise = getExchange()
    const masterSafePromise = getSafe(argv.masterSafe)
    const signerPromise = web3.eth.getAccounts().then((accounts) => accounts[0])
    const masterOwnersPromise = masterSafePromise.then((masterSafe) => masterSafe.getOwners())
    let assertBracketsWellFormedPromise
    let bracketsWithExistingOrdersPromise
    let bracketAddresses
    if (argv.brackets) {
      bracketAddresses = argv.brackets
      assertBracketsWellFormedPromise = verifyBracketsWellFormed(argv.masterSafe, bracketAddresses, null, null, true)
      bracketsWithExistingOrdersPromise = exchangePromise.then((exchange) =>
        findBracketsWithExistingOrders(bracketAddresses, exchange)
      )
    }

    const exchange = await exchangePromise
    const tokenInfoPromises = fetchTokenInfoFromExchange(exchange, [argv.baseTokenId, argv.quoteTokenId])
    const baseTokenData = await tokenInfoPromises[argv.baseTokenId]
    const quoteTokenData = await tokenInfoPromises[argv.quoteTokenId]
    const { instance: baseToken, decimals: baseTokenDecimals } = baseTokenData
    const { instance: quoteToken, decimals: quoteTokenDecimals } = quoteTokenData
    const depositBaseToken = toErc20Units(argv.depositBaseToken, baseTokenDecimals)
    const depositQuoteToken = toErc20Units(argv.depositQuoteToken, quoteTokenDecimals)

    const hasSufficientBaseTokenPromise = checkSufficiencyOfBalance(baseToken, argv.masterSafe, depositBaseToken)
    const hasSufficientQuoteTokenPromise = checkSufficiencyOfBalance(quoteToken, argv.masterSafe, depositQuoteToken)
    const isPriceCloseToOnlineSourcePromise = isPriceReasonable(baseTokenData, quoteTokenData, argv.currentPrice)

    const signer = await signerPromise
    console.log("Using account:", signer)
    if (!argv.verify) {
      assert((await masterOwnersPromise).includes(signer), `Please ensure signer account ${signer} is an owner of masterSafe`)
    }
    if (argv.brackets) {
      assert(argv.numBrackets === argv.brackets.length, "Please ensure numBrackets equals number of brackets")
    }

    console.log("==> Performing safety checks")
    if (!(await hasSufficientBaseTokenPromise)) {
      callback(`Error: MasterSafe ${argv.masterSafe} has insufficient balance for base token ${baseToken.address}`)
    }
    if (!(await hasSufficientQuoteTokenPromise)) {
      callback(`Error: MasterSafe ${argv.masterSafe} has insufficient balance for quote token ${quoteToken.address}`)
    }

    // check price against external price API
    if (!(await isPriceCloseToOnlineSourcePromise)) {
      if (!(await proceedAnyways("Price check failed!"))) {
        callback("Error: Price checks did not pass")
      }
    }
    const areBoundsTooSpreadOut = areBoundsReasonable(argv.currentPrice, argv.lowestLimit, argv.highestLimit)
    if (!areBoundsTooSpreadOut) {
      if (!(await proceedAnyways("Bound checks failed!"))) {
        callback("Error: Bound checks did not pass")
      }
    }
    if (argv.numBrackets > 23) {
      callback("Error: Choose a smaller numBrackets, otherwise your payload will be to big for Infura nodes")
    }

    if (argv.brackets) {
      console.log("==> Skipping safe deployment and using brackets")
      bracketAddresses = argv.brackets
      await assertBracketsWellFormedPromise
      const dirtyBrackets = await bracketsWithExistingOrdersPromise
      if (
        dirtyBrackets.length !== 0 &&
        !(await proceedAnyways(`The following brackets have existing orders:\n  ${dirtyBrackets.join()}\n`))
      ) {
        callback("Error: Existing order verification failed.")
      }
    } else {
      assert(!argv.verify, "Trading Brackets need to be provided via --brackets when verifying a transaction")
      console.log(`==> Deploying ${argv.numBrackets} trading brackets`)
      bracketAddresses = await deployFleetOfSafes(argv.masterSafe, argv.numBrackets)
      console.log("List of deployed brackets:", bracketAddresses.join())
      // Sleeping for 3 seconds to make sure Infura nodes have processed
      // all newly deployed contracts so they can be awaited.
      await sleep(3000)
    }

    console.log("==> Building orders and deposits")
    const orderTransaction = await buildOrders(
      argv.masterSafe,
      bracketAddresses,
      argv.baseTokenId,
      argv.quoteTokenId,
      argv.lowestLimit,
      argv.highestLimit,
      true
    )
    const bundledFundingTransaction = await buildTransferApproveDepositFromOrders(
      argv.masterSafe,
      bracketAddresses,
      baseToken.address,
      quoteToken.address,
      argv.lowestLimit,
      argv.highestLimit,
      argv.currentPrice,
      depositQuoteToken,
      depositBaseToken,
      true
    )

    let nonce = argv.nonce
    const masterSafe = await masterSafePromise
    if (nonce === undefined) {
      nonce = (await masterSafe.nonce()).toNumber()
    }
    if (!argv.verify) {
      console.log(
        "==> Sending the order placing transaction to gnosis-safe interface.\n    Attention: This transaction MUST be executed first!"
      )
      await signAndSend(masterSafe, orderTransaction, argv.network, nonce)
      console.log(
        "==> Sending the funds transferring transaction.\n    Attention: This transaction can only be executed after the one above!"
      )
      await signAndSend(masterSafe, bundledFundingTransaction, argv.network, nonce + 1)
      console.log(
        `To verify the transactions run the same script with --verify --nonce=${nonce} --brackets=${bracketAddresses.join()}`
      )
    } else {
      console.log("==> Verifying order placing transaction.")
      await transactionExistsOnSafeServer(masterSafe, orderTransaction, argv.network, nonce)
      console.log("==> Verifying funds transferring transaction.")
      await transactionExistsOnSafeServer(masterSafe, bundledFundingTransaction, argv.network, nonce + 1)
    }

    callback()
  } catch (error) {
    callback(error)
  }
}
