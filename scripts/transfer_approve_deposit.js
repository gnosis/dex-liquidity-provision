const { signAndSend, promptUser } = require("./sign_and_send")
const { transferApproveDeposit } = require("./utils/trading_strategy_helpers")

const argv = require("yargs")
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning slaveSafes",
  })
  .option("depositFile", {
    type: "string",
    describe: "file name (and path) to the list of deposits.",
  })
  .demand(["masterSafe", "depositFile"])
  .help(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js"
  )
  .version(false).argv

module.exports = async callback => {
  try {
    const GnosisSafe = artifacts.require("GnosisSafe")
    const masterSafe = await GnosisSafe.at(argv.masterSafe)

    const deposits = require(argv.depositFile)
    // TODO - make a simpler to construct deposit file style
    console.log("Preparing transaction data...")
    const transactionData = await transferApproveDeposit(masterSafe.address, deposits, web3, artifacts, true)

    const answer = await promptUser("Are you sure you want to send this transaction to the EVM? [yN] ")
    if (answer == "y" || answer.toLowerCase() == "yes") {
      await signAndSend(masterSafe, transactionData, web3, argv.network)
    }

    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
