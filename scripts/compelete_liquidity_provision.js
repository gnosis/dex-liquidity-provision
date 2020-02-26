const { deployFleetOfSafes } = require("./trading_strategy_helpers")
const Contract = require("@truffle/contract")
const {
  getBundledTransaction,
  buildTransferApproveDepositTransactionData,
  buildOrderTransactionData,
  checkSufficiencyOfBalance,
} = require("./trading_strategy_helpers")
const { signAndSend } = require("./sign_and_send")
const { toETH } = require("../test/utils")
const assert = require("assert")

const argv = require("yargs")
  .option("fleetSize", {
    type: "int",
    default: 10,
    describe: "Number of (sub)safes to be deployed",
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
  .demand(["masterSafe", "targetToken", "stableToken", "targetPrice"])
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

    console.log("0. Do all sanity checks upfront")
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
    const orderTransactionData = await buildOrderTransactionData(
      masterSafe.address,
      slaves,
      argv.targetToken,
      argv.stableToken,
      argv.targetPrice,
      web3,
      artifacts,
      true
    )
    const bundledFundingTransactionData = await buildTransferApproveDepositTransactionData(
      argv.fleetSize,
      masterSafe.address,
      slaves,
      stableToken.address,
      investmentStableToken,
      targetToken.address,
      investmentTargetToken
    )

    console.log("4. Sending out transaction")
    const transactionData = await getBundledTransaction([bundledFundingTransactionData, orderTransactionData], web3, artifacts)
    await signAndSend(masterSafe, transactionData, web3, argv.network)

    callback()
  } catch (error) {
    callback(error)
  }
}
