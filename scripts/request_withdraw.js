const { signAndSend } = require("./utils/gnosis_safe_server_interactions")(web3, artifacts)
const { getSafe } = require("./utils/trading_strategy_helpers")(web3, artifacts)
const { defaultWithdrawYargs, prepareWithdrawRequest } = require("./wrapper/withdraw")(web3, artifacts)
const { signAndExecute } = require("./utils/internals")(web3, artifacts)
const { promptUser } = require("./utils/user_interface_helpers")

const argv = defaultWithdrawYargs
  .option("stopTrading", {
    type: "boolean",
    default: false,
    describe:
      "Request withdraw of all funds on each bracket for each traded tokens, independently of their actual balance. Selected brackets will stop any trading from the following batch",
  })
  .option("onlySkipNonzero", {
    type: "boolean",
    default: false,
    describe: "Withdraw balance of all nonzero balances, even if the amounts have very small USD value",
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
