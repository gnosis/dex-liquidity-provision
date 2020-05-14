module.exports = function (web3, artifacts) {
  const fs = require("fs").promises
  const { getWithdrawableAmount } = require("@gnosis.pm/dex-contracts")

  const { fromErc20Units, shortenedAddress } = require("../utils/printing_tools")
  const {
    getExchange,
    fetchTokenInfoAtAddresses,
    fetchTokenInfoForFlux,
    buildRequestWithdraw,
    buildWithdraw,
    buildTransferFundsToMaster,
    buildWithdrawAndTransferFundsToMaster,
  } = require("../utils/trading_strategy_helpers")(web3, artifacts)
  const { bnMaxUint } = require("../utils/printing_tools.js")

  const assertGoodArguments = function (argv) {
    if (!argv.masterSafe) throw new Error("Argument error: --masterSafe is required")

    if (!argv.requestWithdraw && !argv.withdraw && !argv.transferFundsToMaster) {
      throw new Error("Argument error: one of --requestWithdraw, --withdraw, --transferFundsToMaster must be given")
    } else if (argv.requestWithdraw && (argv.transferFundsToMaster || argv.withdraw)) {
      throw new Error("Argument error: --requestWithdraw cannot be used with any of --withdraw, --transferFundsToMaster")
    }

    if (!argv.withdrawalFile && !argv.brackets) {
      throw new Error("Argument error: one of --withdrawalFile, --brackets must be given")
    } else if (argv.withdrawalFile && argv.brackets) {
      throw new Error("Argument error: --brackets cannot be used with --withdrawalFile")
    }

    if (argv.brackets) {
      if (!argv.tokens && !argv.tokenIds) {
        throw new Error("Argument error: one of --tokens, --tokenIds must be given when using --brackets")
      } else if (argv.tokens && argv.tokenIds) {
        throw new Error("Argument error: only one of --tokens, --tokenIds is required when using --brackets")
      }
    } else {
      if (argv.tokens || argv.tokenIds) {
        throw new Error("Argument error: --tokens or --tokenIds can only be used with --brackets")
      }
    }
  }

  const determineAmountToWithdraw = async function (argv, bracketAddress, tokenData, exchange) {
    let amount
    const token = tokenData.instance
    if (argv.requestWithdraw) {
      amount = bnMaxUint.toString()
    } else {
      if (argv.withdraw) {
        amount = await getWithdrawableAmount(bracketAddress, tokenData.address, exchange, web3)
      }
      if (argv.transferFundsToMaster) {
        amount = amount || (await token.balanceOf(bracketAddress)).toString()
      }
    }
    return amount
  }

  return async function (argv, printOutput = false) {
    const log = printOutput ? (...a) => console.log(...a) : () => {}

    assertGoodArguments(argv)

    let withdrawals
    let tokenInfoPromises
    if (argv.withdrawalFile) {
      withdrawals = JSON.parse(await fs.readFile(argv.withdrawalFile, "utf8"))
      tokenInfoPromises = fetchTokenInfoForFlux(withdrawals)
    } else {
      const exchangePromise = getExchange(web3)
      const tokenAddresses =
        argv.tokens || (await Promise.all(argv.tokenIds.map(async (id) => (await exchangePromise).tokenIdToAddressMap(id))))
      tokenInfoPromises = fetchTokenInfoAtAddresses(tokenAddresses)
      const exchange = await exchangePromise

      log("Retrieving amount of tokens to withdraw.")
      const tokenDataList = await Promise.all(Object.entries(tokenInfoPromises).map(([, tokenDataPromise]) => tokenDataPromise))
      const tokenBracketPairs = []
      for (const tokenData of tokenDataList)
        for (const bracketAddress of argv.brackets) tokenBracketPairs.push([bracketAddress, tokenData])
      const maxWithdrawableAmounts = await Promise.all(
        tokenBracketPairs.map(([bracketAddress, tokenData]) =>
          determineAmountToWithdraw(argv, bracketAddress, tokenData, exchange)
        )
      )
      withdrawals = []
      maxWithdrawableAmounts.forEach((amount, index) => {
        if (amount !== "0")
          withdrawals.push({
            bracketAddress: tokenBracketPairs[index][0],
            tokenAddress: tokenBracketPairs[index][1].address,
            amount: amount,
          })
      })
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
