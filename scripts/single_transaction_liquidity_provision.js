const assert = require("assert")

const {
  fetchTokenInfoFromExchange,
  buildFullLiquidityProvision,
  checkSufficiencyOfBalance,
  getSafe,
  getExchange,
} = require("./utils/trading_strategy_helpers")(web3, artifacts)
const { signAndSend, transactionExistsOnSafeServer } = require("./utils/gnosis_safe_server_interactions")(web3, artifacts)

const { isPriceReasonable, areBoundsReasonable } = require("./utils/price_utils")
const { proceedAnyways } = require("./utils/user_interface_helpers")
const { toErc20Units } = require("./utils/printing_tools")
const { default_yargs, checkBracketsForDuplicate } = require("./utils/default_yargs")

const argv = default_yargs
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning every bracket",
    demandOption: true,
  })
  .option("numBrackets", {
    type: "number",
    describe: "Number of brackets to be deployed",
    demandOption: true,
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

module.exports = async (callback) => {
  try {
    // initialize promises that will be used later in the code to speed up execution
    const exchangePromise = getExchange()
    const masterSafePromise = getSafe(argv.masterSafe)
    const masterSafeNoncePromise =
      argv.nonce === undefined
        ? masterSafePromise.then((masterSafe) => masterSafe.nonce()).then((nonce) => nonce.toNumber())
        : Promise.resolve(argv.nonce)
    const signerPromise = web3.eth.getAccounts().then((accounts) => accounts[0])
    const masterOwnersPromise = masterSafePromise.then((masterSafe) => masterSafe.getOwners())

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
    if (argv.numBrackets > 10) {
      callback("Error: Choose a smaller numBrackets, otherwise your transaction would be too large.")
    }

    console.log(`==> Transaction deploys ${argv.numBrackets} trading brackets`)

    const masterSafe = await masterSafePromise
    const masterSafeNonce = await masterSafeNoncePromise
    const fullLiquidityProvisionTransaction = await buildFullLiquidityProvision({
      masterAddress: argv.masterSafe,
      fleetSize: argv.numBrackets,
      baseTokenId: argv.baseTokenId,
      quoteTokenId: argv.quoteTokenId,
      lowestLimit: argv.lowestLimit,
      highestLimit: argv.highestLimit,
      currentPrice: argv.currentPrice,
      depositBaseToken,
      depositQuoteToken,
      masterSafeNonce,
    })
    if (!argv.verify) {
      console.log("==> Sending the transaction to the Gnosis-Safe interface.")
      await signAndSend(masterSafe, fullLiquidityProvisionTransaction, argv.network, masterSafeNonce)
      console.log("To verify the transactions run the same script with --verify")
    } else {
      console.log("==> Verifying transaction.")
      await transactionExistsOnSafeServer(masterSafe, fullLiquidityProvisionTransaction, argv.network, masterSafeNonce)
    }

    callback()
  } catch (error) {
    callback(error)
  }
}
