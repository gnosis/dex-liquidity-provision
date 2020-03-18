const { signAndSend, promptUser } = require("./utils/sign_and_send")(web3, artifacts)
const { fromErc20Units, shortenedAddress } = require("./utils/printing_tools")
const { allElementsOnlyOnce } = require("./utils/js_helpers")
const {
  getExchange,
  getSafe,
  fetchTokenInfoAtAddresses,
  buildRequestWithdraw,
  buildWithdraw,
  buildTransferFundsToMaster,
  buildWithdrawAndTransferFundsToMaster,
} = require("./utils/trading_strategy_helpers")(web3, artifacts)

const argv = require("yargs")
  .option("masterSafe", {
    type: "string",
    describe: "Address of Gnosis Safe owning bracketSafes.",
  })
  .option("withdrawalFile", {
    type: "string",
    describe: "file name (and path) to the list of withdrawals.",
  })
  .option("allTokens", {
    type: "boolean",
    default: false,
    describe: "ignore amounts from withdrawalFile and try to withdraw the maximum amount available for each bracket.",
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
    describe: "transfer back funds from brackets to master. Funds must be present in the bracket wallets",
  })
  .demand(["masterSafe", "withdrawalFile"])
  .help(
    "Make sure that you have an RPC connection to the network in consideration. For network configurations, please see truffle-config.js"
  )
  .check(function(argv) {
    if (!argv.requestWithdraw && !argv.withdraw && !argv.transferBackToMaster) {
      throw new Error("Argument error: one of --requestWithdraw, --withdraw, --transferBackToMaster must be given")
    } else if (argv.requestWithdraw && (argv.transferBackToMaster || argv.withdraw)) {
      throw new Error("Argument error: --requestWithdraw cannot be used with any of --withdraw, --transferBackToMaster")
    }
    return true
  })
  .version(false).argv

const getAmount = async function(bracketAddress, tokenAddress, exchange) {
  let amount
  const ERC20 = artifacts.require("ERC20Detailed")
  const token = await ERC20.at(tokenAddress)
  if (argv.requestWithdraw) amount = (await exchange.getBalance(bracketAddress, tokenAddress)).toString()
  else if (argv.withdraw) {
    const currentBatchId = Math.floor(Date.now() / (5 * 60 * 1000)) // definition of BatchID, it avoids making a web3 request for each withdrawal to get BatchID
    const pendingWithdrawal = await exchange.getPendingWithdraw(bracketAddress, tokenAddress)
    if (pendingWithdrawal[1].toNumber() == 0) {
      console.log("Warning: no withdrawal was requested for address", bracketAddress, "and token", await token.name())
      amount = "0"
    }
    if (amount != "0" && pendingWithdrawal[1].toNumber() >= currentBatchId) {
      console.log("Warning: amount cannot be withdrawn from the exchange right now, withdrawing zero")
      amount = "0"
    }
    amount = pendingWithdrawal[0].toString()
  } else {
    amount = (await token.balanceOf(bracketAddress)).toString()
  }
  if (amount == "0") console.log("Warning: address", bracketAddress, "has no balance to withdraw for token", await token.name())
  return amount
}

module.exports = async callback => {
  try {
    const masterSafePromise = getSafe(argv.masterSafe)
    const exchange = await getExchange(web3)

    let withdrawals = require(argv.withdrawalFile)
    const tokensInvolved = allElementsOnlyOnce(withdrawals.map(withdrawal => withdrawal.tokenAddress))
    const tokenInfoPromises = fetchTokenInfoAtAddresses(tokensInvolved)

    if (argv.allTokens) {
      console.log("Retrieving amount of tokens to withdraw.")
      // get full amount to withdraw from the blockchain
      withdrawals = await Promise.all(
        withdrawals.map(async withdrawal => ({
          bracketAddress: withdrawal.bracketAddress,
          tokenAddress: withdrawal.tokenAddress,
          amount: await getAmount(withdrawal.bracketAddress, withdrawal.tokenAddress, exchange),
        }))
      )
    }

    console.log("Started building withdraw transaction.")
    let transactionPromise
    if (argv.requestWithdraw) transactionPromise = buildRequestWithdraw(argv.masterSafe, withdrawals)
    else if (argv.withdraw && !argv.transferBackToMaster) transactionPromise = buildWithdraw(argv.masterSafe, withdrawals)
    else if (!argv.withdraw && argv.transferBackToMaster)
      transactionPromise = buildTransferFundsToMaster(argv.masterSafe, withdrawals, true)
    else if (argv.withdraw && argv.transferBackToMaster)
      transactionPromise = buildWithdrawAndTransferFundsToMaster(argv.masterSafe, withdrawals)
    else {
      throw new Error("No operation specified")
    }

    for (const withdrawal of withdrawals) {
      const { symbol: tokenSymbol, decimals: tokenDecimals } = await tokenInfoPromises[withdrawal.tokenAddress]

      const userAmount = fromErc20Units(withdrawal.amount, tokenDecimals)

      if (argv.requestWithdraw)
        console.log(
          `Requesting withdrawal of ${userAmount} ${tokenSymbol} from BatchExchange in behalf of Safe ${withdrawal.bracketAddress}`
        )
      else if (argv.withdraw && !argv.transferBackToMaster)
        console.log(`Withdrawing ${userAmount} ${tokenSymbol} from BatchExchange in behalf of Safe ${withdrawal.bracketAddress}`)
      else if (!argv.withdraw && argv.transferBackToMaster)
        console.log(
          `Transferring ${userAmount} ${tokenSymbol} from Safe ${withdrawal.bracketAddress} into master Safe ${shortenedAddress(
            argv.masterSafe
          )}`
        )
      else if (argv.withdraw && argv.transferBackToMaster)
        console.log(
          `Safe ${
            withdrawal.bracketAddress
          } withdrawing ${userAmount} ${tokenSymbol} from BatchExchange and forwarding the whole amount into master Safe ${shortenedAddress(
            argv.masterSafe
          )})`
        )
      else {
        throw new Error("No operation specified")
      }
    }

    const answer = await promptUser("Are you sure you want to send this transaction to the EVM? [yN] ")
    if (answer == "y" || answer.toLowerCase() == "yes") {
      await signAndSend(await masterSafePromise, await transactionPromise, web3, argv.network)
    }

    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
