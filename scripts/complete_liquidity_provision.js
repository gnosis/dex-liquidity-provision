const { deployFleetOfSafes } = require("./utils/trading_strategy_helpers")(web3, artifacts)
const { isPriceReasonable, areBoundsReasonable } = require("./utils/price-utils")(web3, artifacts)
const Contract = require("@truffle/contract")
const {
  buildTransferApproveDepositFromOrders,
  buildOrders,
  checkSufficiencyOfBalance,
} = require("./utils/trading_strategy_helpers")(web3, artifacts)
const { signAndSend, promptUser } = require("./utils/sign_and_send")(web3, artifacts)
const { proceedAnyways } = require("./utils/user-interface-helpers")

const { toErc20Units } = require("./utils/printing_tools")
const assert = require("assert")

const argv = require("yargs")
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning every bracket",
  })
  .option("fleetSize", {
    type: "int",
    default: 20,
    describe: "Even number of brackets to be deployed",
  })
  .option("targetToken", {
    type: "int",
    describe: "Token whose target price is to be specified (i.e. ETH)",
  })
  .option("investmentTargetToken", {
    describe: "Amount to be invested into the targetToken",
  })
  .option("stableToken", {
    describe: "Trusted Stable Token for which to open orders (i.e. DAI)",
  })
  .option("investmentStableToken", {
    describe: "Amount to be invested into the stableToken",
  })
  .option("currentPrice", {
    type: "float",
    describe: "Price at which the brackets will be centered (e.g. current price of ETH in USD)",
  })
  .option("lowestLimit", {
    type: "float",
    describe: "Price for the bracket buying with the lowest price",
  })
  .option("highestLimit", {
    type: "float",
    describe: "Price for the bracket selling at the highest price",
  })
  .demand(["masterSafe", "targetToken", "stableToken", "currentPrice", "investmentTargetToken", "investmentStableToken"])
  .help(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js"
  )
  .version(false).argv

module.exports = async callback => {
  try {
    // Init params
    const GnosisSafe = artifacts.require("GnosisSafe")
    const masterSafe = await GnosisSafe.at(argv.masterSafe)
    const investmentTargetToken = toErc20Units(argv.investmentTargetToken, 18)
    const investmentStableToken = toErc20Units(argv.investmentStableToken, 18)
    const ERC20Detailed = artifacts.require("ERC20Detailed")
    const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
    BatchExchange.setProvider(web3.currentProvider)
    BatchExchange.setNetwork(web3.network_id)
    const exchange = await BatchExchange.deployed()
    const targetToken = await ERC20Detailed.at(await exchange.tokenIdToAddressMap.call(argv.targetToken))
    const stableToken = await ERC20Detailed.at(await exchange.tokenIdToAddressMap.call(argv.stableToken))

    assert(argv.fleetSize % 2 == 0, "Fleet size must be a even number for easy deployment script")

    console.log("1. Sanity checks")
    if (!(await checkSufficiencyOfBalance(targetToken, masterSafe.address, investmentTargetToken))) {
      callback(`Error: MasterSafe has insufficient balance for the token ${targetToken.address}.`)
    }
    if (!(await checkSufficiencyOfBalance(stableToken, masterSafe.address, investmentStableToken))) {
      callback(`Error: MasterSafe has insufficient balance for the token ${stableToken.address}.`)
    }
    // check price against dex.ag's API
    const targetTokenId = argv.targetToken
    const stableTokenId = argv.stableToken
    const priceCheck = await isPriceReasonable(exchange, targetTokenId, stableTokenId, argv.currentPrice)
    if (!priceCheck) {
      if (!(await proceedAnyways("Price check failed!"))) {
        callback("Error: Price checks did not pass")
      }
    }
    const boundCheck = areBoundsReasonable(argv.currentPrice, argv.lowestLimit, argv.highestLimit)
    if (!boundCheck) {
      if (!(await proceedAnyways("Bound checks failed!"))) {
        callback("Error: Bound checks did not pass")
      }
    }

    console.log(`2. Deploying ${argv.fleetSize} trading brackets`)
    const bracketAddresses = await deployFleetOfSafes(masterSafe.address, argv.fleetSize, true)
    console.log("Following bracket-traders have been deployed", bracketAddresses.join())

    console.log("3. Building orders and deposits")
    const orderTransaction = await buildOrders(
      masterSafe.address,
      bracketAddresses,
      argv.targetToken,
      argv.stableToken,
      argv.lowestLimit,
      argv.highestLimit,
      true
    )
    const bundledFundingTransaction = await buildTransferApproveDepositFromOrders(
      masterSafe.address,
      bracketAddresses,
      targetToken.address,
      stableToken.address,
      argv.lowestLimit,
      argv.highestLimit,
      argv.currentPrice,
      investmentStableToken,
      investmentTargetToken,
      true
    )

    console.log("4. Sending out orders")
    await signAndSend(masterSafe, orderTransaction, web3, argv.network)

    console.log("5. Sending out funds")
    const answer = await promptUser(
      "Are you sure you that the order placement was correct, did you check the telegram bot? [yN] "
    )
    if (answer == "y" || answer.toLowerCase() == "yes") {
      await signAndSend(masterSafe, bundledFundingTransaction, web3, argv.network)
    }

    callback()
  } catch (error) {
    callback(error)
  }
}
