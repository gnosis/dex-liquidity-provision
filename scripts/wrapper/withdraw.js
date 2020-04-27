module.exports = function (web3, artifacts) {
  const fs = require("fs").promises

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

  const getMaxWithdrawableAmount = async function (
    argv,
    bracketAddress,
    tokenData,
    exchange,
    currentBatchId,
    printOutput = false
  ) {
    const log = printOutput ? (...a) => console.log(...a) : () => {}
    let amount
    const token = tokenData.instance
    if (argv.requestWithdraw) amount = (await exchange.getBalance(bracketAddress, tokenData.address)).toString()
    else if (argv.withdraw) {
      const pendingWithdrawal = await exchange.getPendingWithdraw(bracketAddress, tokenData.address)
      amount = pendingWithdrawal[0].toString()
      if (pendingWithdrawal[1].toNumber() >= currentBatchId) {
        const batchIdsLeft = pendingWithdrawal[1].toNumber() - currentBatchId + 1
        log(
          `Warning: requested withdrawal of ${amount} ${
            tokenData.symbol
          } for bracket ${bracketAddress} cannot be executed until ${batchIdsLeft} ${
            batchIdsLeft == 1 ? "batch" : "batches"
          } from now, skipping`
        )
        amount = "0"
      }
    } else {
      amount = (await token.balanceOf(bracketAddress)).toString()
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
      const currentBatchId = (await exchange.getCurrentBatchId()).toNumber() // cannot be computed directly from Date() because time of testing blockchain is not consistent with system clock

      log("Retrieving amount of tokens to withdraw.")
      // get full amount to withdraw from the blockchain
      withdrawals = []
      const candidateWithdrawalPromises = []
      for (const [, tokenDataPromise] of Object.entries(tokenInfoPromises))
        for (const bracketAddress of argv.brackets)
          candidateWithdrawalPromises.push(
            (async () => {
              const maxWithdrawableAmount = await getMaxWithdrawableAmount(
                argv,
                bracketAddress,
                await tokenDataPromise,
                exchange,
                currentBatchId,
                printOutput
              )
              return {
                bracketAddress: bracketAddress,
                tokenAddress: (await tokenDataPromise).address,
                amount: maxWithdrawableAmount,
              }
            }).call()
          )
      for (const candidateWithdrawalPromise of candidateWithdrawalPromises) {
        const candidateWithdrawal = await candidateWithdrawalPromise
        if (candidateWithdrawal.amount !== "0") withdrawals.push(candidateWithdrawal)
      }
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
