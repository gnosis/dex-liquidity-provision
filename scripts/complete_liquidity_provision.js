const assert = require("assert")

const {
  deployFleetOfSafes,
  buildTransferApproveDepositFromOrders,
  buildOrders,
  hasExistingOrders,
  getExchange,
} = require("./utils/trading_strategy_helpers")(web3, artifacts)
const { signAndSend, transactionExistsOnSafeServer } = require("./utils/gnosis_safe_server_interactions")(web3, artifacts)
const { verifyBracketsWellFormed } = require("./utils/verify_scripts")(web3, artifacts)
const { sanitizeArguments } = require("./utils/liquidity_provision_sanity_checks")(web3, artifacts)

const { proceedAnyways } = require("./utils/user_interface_helpers")
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
    type: "number",
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
    type: "number",
    describe: "Token whose target price is to be specified (i.e. ETH)",
    demandOption: true,
  })
  .option("depositBaseToken", {
    type: "string",
    describe: "Amount to be invested into the baseToken",
    demandOption: true,
  })
  .option("quoteTokenId", {
    type: "number",
    describe: "Trusted Quote Token for which to open orders (i.e. DAI)",
    demandOption: true,
  })
  .option("depositQuoteToken", {
    type: "string",
    describe: "Amount to be invested into the quoteToken",
    demandOption: true,
  })
  .option("currentPrice", {
    type: "number",
    describe: "Price at which the brackets will be centered (e.g. current price of ETH in USD)",
    demandOption: true,
  })
  .option("lowestLimit", {
    type: "number",
    describe: "Price for the bracket buying with the lowest price",
    demandOption: true,
  })
  .option("highestLimit", {
    type: "number",
    describe: "Price for the bracket selling at the highest price",
    demandOption: true,
  })
  .option("verify", {
    type: "boolean",
    default: false,
    describe: "Do not actually send transactions, just simulate their submission",
  })
  .option("nonce", {
    type: "number",
    implies: ["verify"],
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
    let assertBracketsWellFormedPromise
    let bracketsWithExistingOrdersPromise
    if (argv.brackets) {
      const exchangePromise = getExchange()
      assert(argv.numBrackets === argv.brackets.length, "Please ensure numBrackets equals number of brackets")
      assertBracketsWellFormedPromise = verifyBracketsWellFormed(argv.masterSafe, argv.brackets, null, null, true)
      bracketsWithExistingOrdersPromise = exchangePromise.then((exchange) =>
        findBracketsWithExistingOrders(argv.brackets, exchange)
      )
    }

    const {
      masterSafe,
      signer,
      depositBaseToken,
      depositQuoteToken,
      baseTokenData,
      quoteTokenData,
      masterSafeNonce,
    } = await sanitizeArguments({
      argv,
      maxBrackets: 23,
    })

    console.log("Using account:", signer)

    let bracketAddresses
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
      baseTokenData.address,
      quoteTokenData.address,
      argv.lowestLimit,
      argv.highestLimit,
      argv.currentPrice,
      depositQuoteToken,
      depositBaseToken,
      true
    )

    if (!argv.verify) {
      console.log(
        "==> Sending the order placing transaction to gnosis-safe interface.\n    Attention: This transaction MUST be executed first!"
      )
      await signAndSend(masterSafe, orderTransaction, argv.network, masterSafeNonce)
      console.log(
        "==> Sending the funds transferring transaction.\n    Attention: This transaction can only be executed after the one above!"
      )
      await signAndSend(masterSafe, bundledFundingTransaction, argv.network, masterSafeNonce + 1)
      console.log(
        `To verify the transactions run the same script with --verify --nonce=${masterSafeNonce} --brackets=${bracketAddresses.join()}`
      )
    } else {
      console.log("==> Verifying order placing transaction.")
      await transactionExistsOnSafeServer(masterSafe, orderTransaction, argv.network, masterSafeNonce)
      console.log("==> Verifying funds transferring transaction.")
      await transactionExistsOnSafeServer(masterSafe, bundledFundingTransaction, argv.network, masterSafeNonce + 1)
    }

    callback()
  } catch (error) {
    callback(error)
  }
}
