const { signAndSend } = require("./utils/gnosis_safe_server_interactions")(web3, artifacts)
const { getSafe } = require("./utils/trading_strategy_helpers")(web3, artifacts)
const { defaultWithdrawYargs, prepareWithdrawRequest } = require("./wrapper/withdraw")(web3, artifacts)
const { signAndExecute } = require("./utils/internals")(web3, artifacts)
const { promptUser } = require("./utils/user_interface_helpers")

const argv = defaultWithdrawYargs.option("noBalanceCheck", {
  type: "boolean",
  default: false,
  describe:
    "Request withdraw for tokens without checking if the token has no balance. Useful to account for trading that might be happening during the withdraw request",
}).argv

module.exports = async (callback) => {
  try {
    const masterSafe = getSafe(argv.masterSafe)

    const transaction = await prepareWithdrawRequest(argv, true)
    const answer = await promptUser("Are you sure you want to send this transaction to the EVM? [yN] ")
    if (answer == "y" || answer.toLowerCase() == "yes") {
      const signAndSendOrExecuteOnChain = argv.executeOnchain ? (safe, tx) => signAndExecute(safe, tx) : signAndSend
      await signAndSendOrExecuteOnChain(await masterSafe, transaction, argv.network, argv.nonce)
    }

    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
