const { signAndSend } = require("./sign_and_send")
const { getRequestWithdrawTransaction, getWithdrawTransaction } = require("./trading_strategy_helpers")

const argv = require("yargs")
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning slaveSafes",
  })
  .option("withdrawalFile", {
    type: "string",
    describe: "file name (and path) to the list of withdrawals.",
  })
  .option("withdrawalsFromDepositFile", {
    type: "string",
    describe: "file name (and path) to the list of deposits whose corresponding tokens will be withdrawn.",
  })
  .option("request", {
    type: "boolean",
    default: false,
    describe: "file name (and path) to the list of deposits whose corresponding tokens will be withdrawn.",
  })
  .demand(["masterSafe"])
  .help(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js"
  )
  .check(function ({withdrawalFile, withdrawalsFromDepositFile}) {
    if ((withdrawalFile && !withdrawalsFromDepositFile) || (!withdrawalFile && withdrawalsFromDepositFile)) {
      return true
    } else if (withdrawalFile && withdrawalsFromDepositFile) {
      throw(new Error("Argument error: pass only one of withdrawalFile, withdrawalsFromDepositFile"))
    } else {
      throw(new Error("Argument error: either withdrawalFile or withdrawalsFromDepositFile must be specified"))
    }
  })
  .version(false).argv

const extractWithdrawals = function(deposits) {
  return deposits.map(deposit => ({
    amount: deposit.amount,
    tokenAddress: deposit.tokenAddress,
    traderAddress: deposit.userAddress,
  }))
}

const genericExecWithdraw = async function(functionName, web3, artifacts) {
  const GnosisSafe = artifacts.require("GnosisSafe")
  const masterSafe = await GnosisSafe.at(argv.masterSafe)

  let withdrawals
  if (argv.withdrawalFile) {
    withdrawals = require(argv.withdrawalFile)
  } else { // argv.withdrawalsFromDepositFile is defined
    const deposits = require(argv.withdrawalsFromDepositFile)
    withdrawals = extractWithdrawals(deposits)
  }
  console.log("Withdrawals", withdrawals)
  let transaction
  switch (functionName) {
  /* eslint-disable indent */
    case "requestWithdraw":
      transaction = await getRequestWithdrawTransaction(masterSafe.address, withdrawals, web3, artifacts)
      break
    case "withdraw":
      transaction = await getWithdrawTransaction(masterSafe.address, withdrawals, web3, artifacts)
      break
    default:
      assert(false, "Function " + functionName + "is not implemented")
  /* eslint-enable indent */
  }

  // careful! transaction.operation and transaction.value are ignored by signAndSend.
  // this is fine for, since we only send transactions to multisend, but we should
  // TODO: generalize signAndSend to accept any transaction
  await signAndSend(masterSafe, transaction, web3, argv.network)
}

module.exports = async callback => {
  try {
    if (argv.request)
      await genericExecWithdraw("requestWithdraw", web3, artifacts)
    else
      await genericExecWithdraw("withdraw", web3, artifacts)
    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
