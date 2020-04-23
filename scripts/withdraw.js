const { signAndSend, promptUser } = require("./utils/sign_and_send")(web3, artifacts)
const { getSafe } = require("./utils/trading_strategy_helpers")(web3, artifacts)
const prepareWithdraw = require("./wrapper/withdraw")(web3, artifacts)

const argv = require("./utils/default_yargs")
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning bracketSafes",
    demandOption: true,
  })
  .option("withdrawalFile", {
    type: "string",
    describe: "file name (and path) to the list of withdrawals",
    demandOption: true,
  })
  .option("allTokens", {
    type: "boolean",
    default: false,
    describe: "ignore amounts from withdrawalFile and try to withdraw the maximum amount available for each bracket",
  })
  .option("requestWithdraw", {
    type: "boolean",
    default: false,
    describe: "request withdraw from the exchange",
  })
  .option("withdraw", {
    type: "boolean",
    default: false,
    describe: "withdraw from the exchange. A withdraw request must always be made before withdrawing funds from the exchange",
  })
  .option("transferFundsToMaster", {
    type: "boolean",
    default: false,
    describe: "transfer back funds from brackets to master. Funds must be present in the bracket wallets",
  }).argv

module.exports = async (callback) => {
  try {
    const masterSafe = getSafe(argv.masterSafe)

    const transaction = await prepareWithdraw(argv, true)
    const answer = await promptUser("Are you sure you want to send this transaction to the EVM? [yN] ")
    if (answer == "y" || answer.toLowerCase() == "yes") {
      await signAndSend(await masterSafe, transaction, argv.network)
    }

    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
