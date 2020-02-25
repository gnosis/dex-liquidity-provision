const { signAndSend } = require("./sign_and_send")
const {
  getRequestWithdrawTransaction,
  getWithdrawTransaction,
  getTransferFundsToMasterTransaction,
  getWithdrawAndTransferFundsToMasterTransaction
} = require("./trading_strategy_helpers")

const argv = require("yargs")
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning slaveSafes.",
  })
  .option("withdrawalFile", {
    type: "string",
    describe: "file name (and path) to the list of withdrawals.",
  })
  .option("withdrawalsFromDepositFile", {
    type: "string",
    describe: "file name (and path) to the list of deposits whose corresponding tokens will be withdrawn.",
  })
  .option("requestWithdraw", {
    type: "boolean",
    default: false,
    describe: "request withdraw from the exchange.",
  })
  .option("withdraw", {
    type: "boolean",
    default: false,
    describe: "withdraw from the exchange. A withdraw request must always be made before withdrawing funds from the exchange.",
  })
  .option("transferBackToMaster", {
    type: "boolean",
    default: false,
    describe: "transfer back funds from traders to master. Funds must be present in the trader wallets",
  })
  .demand(["masterSafe"])
  .help(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js"
  )
  .check(function (argv) {
    if (!argv.requestWithdraw && !argv.withdraw && !argv.transferBackToMaster) {
      throw(new Error("Argument error: one of --request, --withdraw, --transferBackToMaster must be given"))
    } else if (argv.requestWithdraw && (argv.transferBackToMaster || argv.withdraw)) {
      throw(new Error("Argument error: --request cannot be used with any of --withdraw, --transferBackToMaster"))
    }
    if ((argv.withdrawalFile && !argv.withdrawalsFromDepositFile) || (!argv.withdrawalFile && argv.withdrawalsFromDepositFile)) {
      return true
    } else if (argv.withdrawalFile && argv.withdrawalsFromDepositFile) {
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

module.exports = async callback => {
  try {
    const GnosisSafe = artifacts.require("GnosisSafe")
    const masterSafe = await GnosisSafe.at(argv.masterSafe)

    let withdrawals
    if (argv.withdrawalFile) {
      withdrawals = require(argv.withdrawalFile)
    } else { // argv.withdrawalsFromDepositFile is defined
      const deposits = require(argv.withdrawalsFromDepositFile)
      withdrawals = extractWithdrawals(deposits)
    }
    let transaction
    if (argv.requestWithdraw)
      transaction = await getRequestWithdrawTransaction(masterSafe.address, withdrawals, web3, artifacts)
    else if (argv.withdraw && !argv.transferBackToMaster)
      transaction = await getWithdrawTransaction(masterSafe.address, withdrawals, web3, artifacts)
    else if (!argv.withdraw && argv.transferBackToMaster)
      transaction = await getTransferFundsToMasterTransaction(masterSafe.address, withdrawals, web3, artifacts)
    else if (argv.withdraw && argv.transferBackToMaster)
      transaction = await getWithdrawAndTransferFundsToMasterTransaction(masterSafe.address, withdrawals, web3, artifacts)
    else {
      throw(new Error("No operation specified"))
    }

    // careful! transaction.operation and transaction.value are ignored by signAndSend.
    // this is fine for, since we only send transactions to multisend, but we should
    // TODO: generalize signAndSend to accept any transaction
    await signAndSend(masterSafe, transaction, web3, argv.network)

    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
