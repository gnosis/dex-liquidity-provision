const { signAndSend } = require("./utils/gnosis_safe_server_interactions")(web3, artifacts)
const { getSafe } = require("./utils/trading_strategy_helpers")(web3, artifacts)
const { defaultWithdrawYargs, prepareTransferFundsToMaster } = require("./wrapper/withdraw")(web3, artifacts)
const { promptUser } = require("./utils/user_interface_helpers")

const argv = defaultWithdrawYargs.argv

module.exports = async (callback) => {
  try {
    const masterSafe = getSafe(argv.masterSafe)

    const transaction = await prepareTransferFundsToMaster(argv, true)
    const answer = await promptUser("Are you sure you want to send this transaction to the EVM? [yN] ")
    if (answer == "y" || answer.toLowerCase() == "yes") {
      await signAndSend(await masterSafe, transaction, argv.network, argv.nonce)
    }

    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
