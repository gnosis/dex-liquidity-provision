const { buildFullLiquidityProvision } = require("./utils/trading_strategy_helpers")(web3, artifacts)
const { processTransaction } = require("./utils/gnosis_safe_server_interactions")(web3, artifacts)
const { sanitizeArguments } = require("./utils/liquidity_provision_sanity_checks")(web3, artifacts)

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
    default: null,
    describe: "Use this specific nonce instead of the next available one",
  })
  .option("executeOnchain", {
    type: "boolean",
    default: false,
    describe: "Directly execute transaction on-chain instead of sending to the backend",
  })
  .check(checkBracketsForDuplicate).argv

module.exports = async (callback) => {
  try {
    const { masterSafe, masterSafeNonce, signer, depositBaseToken, depositQuoteToken } = await sanitizeArguments({
      argv,
      maxBrackets: 10,
    })

    console.log("Using account:", signer)

    console.log(`==> Transaction deploys ${argv.numBrackets} trading brackets`)

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

    await processTransaction(
      argv.verify,
      await masterSafe,
      argv.nonce,
      fullLiquidityProvisionTransaction,
      argv.network,
      argv.executeOnchain,
      false
    )

    callback()
  } catch (error) {
    callback(error)
  }
}
