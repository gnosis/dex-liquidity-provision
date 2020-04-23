module.exports = function (web3, artifacts) {
  const fs = require("fs").promises

  const { fromErc20Units, shortenedAddress } = require("../utils/printing_tools")
  const {
    getExchange,
    fetchTokenInfoForFlux,
    buildRequestWithdraw,
    buildWithdraw,
    buildTransferFundsToMaster,
    buildWithdrawAndTransferFundsToMaster,
  } = require("../utils/trading_strategy_helpers")(web3, artifacts)

  const assertGoodArguments = function (argv) {
    if (!argv.requestWithdraw && !argv.withdraw && !argv.transferFundsToMaster) {
      throw new Error("Argument error: one of --requestWithdraw, --withdraw, --transferFundsToMaster must be given")
    } else if (argv.requestWithdraw && (argv.transferFundsToMaster || argv.withdraw)) {
      throw new Error("Argument error: --requestWithdraw cannot be used with any of --withdraw, --transferFundsToMaster")
    }
  }

  const getMaxWithdrawableAmount = async function (argv, bracketAddress, tokenInfo, exchange, printOutput = false) {
    const log = printOutput ? (...a) => console.log(...a) : () => {}
    let amount
    const token = tokenInfo.instance
    if (argv.requestWithdraw) amount = (await exchange.getBalance(bracketAddress, tokenInfo.address)).toString()
    else if (argv.withdraw) {
      const currentBatchId = Math.floor(Date.now() / (5 * 60 * 1000)) // definition of BatchID, it avoids making a web3 request for each withdrawal to get BatchID
      const pendingWithdrawal = await exchange.getPendingWithdraw(bracketAddress, tokenInfo.address)
      if (pendingWithdrawal[1].toNumber() == 0) {
        log("Warning: no withdrawal was requested for address", bracketAddress, "and token", tokenInfo.symbol)
        amount = "0"
      }
      if (amount != "0" && pendingWithdrawal[1].toNumber() >= currentBatchId) {
        log("Warning: amount cannot be withdrawn from the exchange right now, withdrawing zero")
        amount = "0"
      }
      amount = pendingWithdrawal[0].toString()
    } else {
      amount = (await token.balanceOf(bracketAddress)).toString()
    }
    if (amount == "0") log("Warning: address", bracketAddress, "has no balance to withdraw for token", tokenInfo.symbol)
    return amount
  }

  return async function (argv, printOutput = false) {
    const log = printOutput ? (...a) => console.log(...a) : () => {}

    assertGoodArguments(argv)

    let withdrawals = JSON.parse(await fs.readFile(argv.withdrawalFile, "utf8"))
    const tokenInfoPromises = fetchTokenInfoForFlux(withdrawals)
    const exchange = await getExchange(web3)

    if (argv.allTokens) {
      log("Retrieving amount of tokens to withdraw.")
      // get full amount to withdraw from the blockchain
      withdrawals = await Promise.all(
        withdrawals.map(async (withdrawal) => ({
          bracketAddress: withdrawal.bracketAddress,
          tokenAddress: withdrawal.tokenAddress,
          amount: await getMaxWithdrawableAmount(
            argv,
            withdrawal.bracketAddress,
            await tokenInfoPromises[withdrawal.tokenAddress],
            await exchange
          ),
        }))
      )
    }

    log("Started building withdraw transaction.")
    let transactionPromise
    if (argv.requestWithdraw) transactionPromise = buildRequestWithdraw(argv.masterSafe, withdrawals)
    else if (argv.withdraw && !argv.transferFundsToMaster) transactionPromise = buildWithdraw(argv.masterSafe, withdrawals)
    else if (!argv.withdraw && argv.transferFundsToMaster)
      transactionPromise = buildTransferFundsToMaster(argv.masterSafe, withdrawals, true)
    else if (argv.withdraw && argv.transferFundsToMaster)
      transactionPromise = buildWithdrawAndTransferFundsToMaster(argv.masterSafe, withdrawals)
    else {
      throw new Error("No operation specified")
    }

    for (const withdrawal of withdrawals) {
      const { symbol: tokenSymbol, decimals: tokenDecimals } = await tokenInfoPromises[withdrawal.tokenAddress]

      const userAmount = fromErc20Units(withdrawal.amount, tokenDecimals)

      if (argv.requestWithdraw)
        log(
          `Requesting withdrawal of ${userAmount} ${tokenSymbol} from BatchExchange in behalf of Safe ${withdrawal.bracketAddress}`
        )
      else if (argv.withdraw && !argv.transferFundsToMaster)
        log(`Withdrawing ${userAmount} ${tokenSymbol} from BatchExchange in behalf of Safe ${withdrawal.bracketAddress}`)
      else if (!argv.withdraw && argv.transferFundsToMaster)
        log(
          `Transferring ${userAmount} ${tokenSymbol} from Safe ${withdrawal.bracketAddress} into master Safe ${shortenedAddress(
            argv.masterSafe
          )}`
        )
      else if (argv.withdraw && argv.transferFundsToMaster)
        log(
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

    return transactionPromise
  }
}
