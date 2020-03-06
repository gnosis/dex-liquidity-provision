const { deployFleetOfSafes } = require("./utils/trading_strategy_helpers")
const Contract = require("@truffle/contract")
const {
  buildTransferApproveDepositTransaction,
  buildOrderTransaction,
  checkSufficiencyOfBalance,
} = require("./utils/trading_strategy_helpers")
const { signAndSend, promptUser } = require("./utils/sign_and_send")
const { toETH } = require("./utils/internals")
const assert = require("assert")

const argv = require("yargs")
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning slaveSafes",
  })
  .option("fleetSize", {
    type: "int",
    default: 20,
    describe: "Even number of (sub)safes to be deployed",
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
  .option("targetPrice", {
    type: "float",
    describe: "Price at which the brackets will be centered (e.g. current price of ETH in USD)",
  })
  .option("priceRangePercentage", {
    type: "int",
    default: 20,
    describe: "Price at which the brackets will be centered (e.g. current price of ETH in USD)",
  })
  .demand(["masterSafe", "targetToken", "stableToken", "targetPrice", "investmentTargetToken", "investmentStableToken"])
  .help(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js"
  )
  .version(false).argv

module.exports = async callback => {
  try {
    // Init params
    const GnosisSafe = artifacts.require("GnosisSafe")
    const masterSafe = await GnosisSafe.at(argv.masterSafe)
    const investmentTargetToken = toETH(argv.investmentTargetToken)
    const investmentStableToken = toETH(argv.investmentStableToken)
    const ERC20Detailed = artifacts.require("ERC20Detailed")
    const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
    BatchExchange.setProvider(web3.currentProvider)
    BatchExchange.setNetwork(web3.network_id)
    const exchange = await BatchExchange.deployed()
    const targetToken = await ERC20Detailed.at(await exchange.tokenIdToAddressMap.call(argv.targetToken))
    const stableToken = await ERC20Detailed.at(await exchange.tokenIdToAddressMap.call(argv.stableToken))

    assert(argv.fleetSize % 2 == 0, "Fleet size must be a even number for easy deployment script")

    console.log("1. Check for sufficient funds")
    if (!(await checkSufficiencyOfBalance(targetToken, masterSafe.address, investmentTargetToken))) {
      callback(`Error: MasterSafe has insufficient balance for the token ${targetToken.address}.`)
    }
    if (!(await checkSufficiencyOfBalance(stableToken, masterSafe.address, investmentStableToken))) {
      callback(`Error: MasterSafe has insufficient balance for the token ${stableToken.address}.`)
    }

    console.log(`2. Deploying ${argv.fleetSize} subsafes `)
    const slaves = await deployFleetOfSafes(masterSafe.address, argv.fleetSize, artifacts, true)

    console.log("3. Building orders and deposits")
    const orderTransaction = await buildOrderTransaction(
      masterSafe.address,
      slaves,
      argv.targetToken,
      argv.stableToken,
      argv.targetPrice,
      web3,
      artifacts,
      true,
      argv.priceRangePercentage
    )
    const bundledFundingTransaction = await buildTransferApproveDepositTransaction(
      masterSafe.address,
      slaves,
      stableToken.address,
      investmentStableToken,
      targetToken.address,
      investmentTargetToken,
      artifacts,
      web3
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
