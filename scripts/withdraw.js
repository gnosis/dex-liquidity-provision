const Contract = require("@truffle/contract")
const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))

const { signAndSend, promptUser } = require("./sign_and_send")
const {
  getRequestWithdraw,
  getWithdraw,
  getTransferFundsToMaster,
  getWithdrawAndTransferFundsToMaster
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
  .option("allTokens", {
    type: "boolean",
    default: false,
    describe: "ignore amounts from withdrawalFile and try to withdraw the maximum amount available for each trader.",
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
  .demand(["masterSafe", "withdrawalFile"])
  .help(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js"
  )
  .check(function (argv) {
    if (!argv.requestWithdraw && !argv.withdraw && !argv.transferBackToMaster) {
      throw(new Error("Argument error: one of --request, --withdraw, --transferBackToMaster must be given"))
    } else if (argv.requestWithdraw && (argv.transferBackToMaster || argv.withdraw)) {
      throw(new Error("Argument error: --request cannot be used with any of --withdraw, --transferBackToMaster"))
    }
    return true
  })
  .version(false).argv

const getAmount = async function(slaveAddress, tokenAddress, exchange) {
  let amount
  const ERC20 = artifacts.require("ERC20Detailed")
  const token = await ERC20.at(tokenAddress)
  if (argv.requestWithdraw)
    amount = (await exchange.getBalance(slaveAddress, tokenAddress)).toString()
  else if (argv.withdraw) {    const currentBatchId = Math.floor( Date.now() / (5 * 60 * 1000) ) // definition of BatchID, it avoids making a web3 request for each withdrawal to get BatchID
    const pendingWithdrawal = await exchange.getPendingWithdraw(slaveAddress, tokenAddress)
    if (pendingWithdrawal[1].toNumber() == 0) {
      console.log("Warning: no withdrawal was requested for address", slaveAddress, "and token", (await token.name()))
      amount = "0"
    }
    if ((amount != "0") && (pendingWithdrawal[1].toNumber() >= currentBatchId)) {
      console.log("Warning: amount cannot be withdrawn from the exchange right now, withdrawing zero")
      amount = "0"
    }
    amount = pendingWithdrawal[0].toString()
  } else {
    amount = (await token.balanceOf(slaveAddress)).toString()
  }
  if (amount == "0")
    console.log("Warning: address", slaveAddress, "has no balance to withdraw for token", (await token.name()))
  return amount
}

module.exports = async callback => {
  try {
    await BatchExchange.setProvider(web3.currentProvider)
    await BatchExchange.setNetwork(web3.network_id)
    const exchange = await BatchExchange.deployed()
    const GnosisSafe = artifacts.require("GnosisSafe")
    const masterSafe = await GnosisSafe.at(argv.masterSafe)
    
    let withdrawals = require(argv.withdrawalFile)

    if (argv.allTokens) {
      console.log("Retrieving amount of tokens to withdraw.")
      // get full amount to withdraw from the blockchain
      withdrawals = await Promise.all(
        withdrawals.map(
          async withdrawal => ({
            userAddress: withdrawal.userAddress,
            tokenAddress: withdrawal.tokenAddress,
            amount: await getAmount(withdrawal.userAddress, withdrawal.tokenAddress, exchange),
          })
        )
      )
    }
    
    console.log("Started building withdraw transaction.")
    let transaction
    if (argv.requestWithdraw)
      transaction = await getRequestWithdraw(masterSafe.address, withdrawals, web3, artifacts)
    else if (argv.withdraw && !argv.transferBackToMaster)
      transaction = await getWithdraw(masterSafe.address, withdrawals, web3, artifacts)
    else if (!argv.withdraw && argv.transferBackToMaster)
      transaction = await getTransferFundsToMaster(masterSafe.address, withdrawals, web3, artifacts)
    else if (argv.withdraw && argv.transferBackToMaster)
      transaction = await getWithdrawAndTransferFundsToMaster(masterSafe.address, withdrawals, web3, artifacts)
    else {
      throw(new Error("No operation specified"))
    }

    for (const withdrawal of withdrawals) {
      const ERC20 = artifacts.require("ERC20Detailed")
      const token = await ERC20.at(withdrawal.tokenAddress)
      const tokenDecimals = (await token.decimals.call()).toNumber()
      const tokenSymbol = await token.symbol.call()
      if (tokenDecimals != 18) 
        throw(new Error("These scripts currently only support tokens with 18 decimals."))

      const unitAmount = web3.utils.fromWei(withdrawal.amount.toString(), "ether")

      if (argv.requestWithdraw)
        console.log(`Requesting withdrawal of ${unitAmount} ${tokenSymbol} from BatchExchange in behalf of Safe ${withdrawal.userAddress}`)
      else if (argv.withdraw && !argv.transferBackToMaster)
        console.log(`Withdrawing ${unitAmount} ${tokenSymbol} from BatchExchange in behalf of Safe ${withdrawal.userAddress}`)
      else if (!argv.withdraw && argv.transferBackToMaster)
        console.log(`Transferring ${unitAmount} ${tokenSymbol} from Safe ${withdrawal.userAddress} into master Safe ${masterSafe.address.slice(0,6)}...${masterSafe.address.slice(-2)}) and depositing  into BatchExchange`)
      else if (argv.withdraw && argv.transferBackToMaster)
        console.log(`Safe ${withdrawal.userAddress} withdrawing ${unitAmount} ${tokenSymbol} from BatchExchange and forwarding the whole amount into master Safe ${masterSafe.address.slice(0,6)}...${masterSafe.address.slice(-2)})`)
      else {
        throw(new Error("No operation specified"))
      }
    }

    const answer = await promptUser("Are you sure you want to send this transaction to the EVM? [yN] ")
    if (answer == "y" || answer.toLowerCase() == "yes") {
      await signAndSend(masterSafe, transaction, web3, argv.network)
    }

    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
