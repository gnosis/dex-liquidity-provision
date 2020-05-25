module.exports = function (web3, artifacts) {
  const fs = require("fs").promises
  const { getWithdrawableAmount } = require("@gnosis.pm/dex-contracts")

  const {
    getExchange,
    fetchTokenInfoAtAddresses,
    fetchTokenInfoForFlux,
    buildRequestWithdraw,
    buildWithdraw,
    buildTransferFundsToMaster,
    buildWithdrawAndTransferFundsToMaster,
  } = require("../utils/trading_strategy_helpers")(web3, artifacts)
  const { default_yargs, checkBracketsForDuplicate } = require("../utils/default_yargs")
  const { fromErc20Units, shortenedAddress } = require("../utils/printing_tools")
  const { MAXUINT256 } = require("../utils/constants")

  const assertGoodArguments = function (argv) {
    if (!argv.masterSafe) throw new Error("Argument error: --masterSafe is required")

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

  const getWithdrawalsAndTokenInfo = async function (
    amountFunction,
    withdrawalFile,
    brackets,
    tokens,
    tokenIds,
    printOutput = false
  ) {
    const log = printOutput ? (...a) => console.log(...a) : () => {}

    let withdrawals
    let tokenInfoPromises
    if (withdrawalFile) {
      withdrawals = JSON.parse(await fs.readFile(withdrawalFile, "utf8"))
      tokenInfoPromises = fetchTokenInfoForFlux(withdrawals)
    } else {
      const exchangePromise = getExchange(web3)
      const tokenAddresses =
        tokens || (await Promise.all(tokenIds.map(async (id) => (await exchangePromise).tokenIdToAddressMap(id))))
      tokenInfoPromises = fetchTokenInfoAtAddresses(tokenAddresses)
      const exchange = await exchangePromise

      log("Retrieving amount of tokens to withdraw.")
      const tokenDataList = await Promise.all(Object.entries(tokenInfoPromises).map(([, tokenDataPromise]) => tokenDataPromise))
      const tokenBracketPairs = []
      for (const tokenData of tokenDataList)
        for (const bracketAddress of brackets) tokenBracketPairs.push([bracketAddress, tokenData])
      const maxWithdrawableAmounts = await Promise.all(
        tokenBracketPairs.map(([bracketAddress, tokenData]) => amountFunction(bracketAddress, tokenData, exchange))
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

    return {
      withdrawals,
      tokenInfoPromises,
    }
  }

  const prepareRequestWithdraw = async function (argv, printOutput = false) {
    const log = printOutput ? (...a) => console.log(...a) : () => {}

    assertGoodArguments(argv)

    const amountFunction = function () {
      return MAXUINT256.toString()
    }
    const { withdrawals, tokenInfoPromises } = await getWithdrawalsAndTokenInfo(
      amountFunction,
      argv.withdrawalFile,
      argv.brackets,
      argv.tokens,
      argv.tokenIds,
      printOutput
    )

    log("Started building withdraw transaction.")
    const transactionPromise = buildRequestWithdraw(argv.masterSafe, withdrawals)

    for (const withdrawal of withdrawals) {
      const { symbol: tokenSymbol } = await tokenInfoPromises[withdrawal.tokenAddress]

      log(`Requesting withdrawal of all ${tokenSymbol} from BatchExchange in behalf of Safe ${withdrawal.bracketAddress}`)
    }

    return transactionPromise
  }
  const prepareDirectWithdraw = async function (argv, printOutput = false) {
    const log = printOutput ? (...a) => console.log(...a) : () => {}

    assertGoodArguments(argv)

    const amountFunction = function (bracketAddress, tokenData, exchange) {
      return getWithdrawableAmount(bracketAddress, tokenData.address, exchange, web3)
    }
    const { withdrawals, tokenInfoPromises } = await getWithdrawalsAndTokenInfo(
      amountFunction,
      argv.withdrawalFile,
      argv.brackets,
      argv.tokens,
      argv.tokenIds,
      printOutput
    )

    log("Started building withdraw transaction.")
    const transactionPromise = buildWithdraw(argv.masterSafe, withdrawals)

    for (const withdrawal of withdrawals) {
      const { symbol: tokenSymbol, decimals: tokenDecimals } = await tokenInfoPromises[withdrawal.tokenAddress]

      const userAmount = fromErc20Units(withdrawal.amount, tokenDecimals)
      log(`Withdrawing ${userAmount} ${tokenSymbol} from BatchExchange in behalf of Safe ${withdrawal.bracketAddress}`)
    }

    return transactionPromise
  }
  const prepareTransferFundsToMaster = async function (argv, printOutput = false) {
    const log = printOutput ? (...a) => console.log(...a) : () => {}

    assertGoodArguments(argv)

    const amountFunction = async function (bracketAddress, tokenData) {
      return (await tokenData.instance.balanceOf(bracketAddress)).toString()
    }
    const { withdrawals, tokenInfoPromises } = await getWithdrawalsAndTokenInfo(
      amountFunction,
      argv.withdrawalFile,
      argv.brackets,
      argv.tokens,
      argv.tokenIds,
      printOutput
    )

    log("Started building withdraw transaction.")
    const transactionPromise = buildTransferFundsToMaster(argv.masterSafe, withdrawals, true)

    for (const withdrawal of withdrawals) {
      const { symbol: tokenSymbol, decimals: tokenDecimals } = await tokenInfoPromises[withdrawal.tokenAddress]

      const userAmount = fromErc20Units(withdrawal.amount, tokenDecimals)

      log(
        `Transferring ${userAmount} ${tokenSymbol} from Safe ${withdrawal.bracketAddress} into master Safe ${shortenedAddress(
          argv.masterSafe
        )}`
      )
    }

    return transactionPromise
  }
  const prepareWithdrawAndTransferFundsToMaster = async function (argv, printOutput = false) {
    const log = printOutput ? (...a) => console.log(...a) : () => {}

    assertGoodArguments(argv)

    const amountFunction = function (bracketAddress, tokenData, exchange) {
      return getWithdrawableAmount(bracketAddress, tokenData.address, exchange, web3)
    }
    const { withdrawals, tokenInfoPromises } = await getWithdrawalsAndTokenInfo(
      amountFunction,
      argv.withdrawalFile,
      argv.brackets,
      argv.tokens,
      argv.tokenIds,
      printOutput
    )

    log("Started building withdraw transaction.")
    const transactionPromise = buildWithdrawAndTransferFundsToMaster(argv.masterSafe, withdrawals)

    for (const withdrawal of withdrawals) {
      const { symbol: tokenSymbol, decimals: tokenDecimals } = await tokenInfoPromises[withdrawal.tokenAddress]

      const userAmount = fromErc20Units(withdrawal.amount, tokenDecimals)
      log(
        `Safe ${
          withdrawal.bracketAddress
        } withdrawing ${userAmount} ${tokenSymbol} from BatchExchange and forwarding the whole amount into master Safe ${shortenedAddress(
          argv.masterSafe
        )})`
      )
    }

    return transactionPromise
  }

  const prepareWithdraw = function (argv, printOutput = false) {
    // if both options are unset, wa assume the user wants to withdraw and transfer funds to master
    if (argv.withdraw == argv.transferFundsToMaster) {
      return prepareWithdrawAndTransferFundsToMaster(argv, printOutput)
    } else if (argv.withdraw) {
      return prepareDirectWithdraw(argv, printOutput)
    } else {
      return prepareTransferFundsToMaster(argv, printOutput)
    }
  }

  const defaultWithdrawYargs = default_yargs
    .option("masterSafe", {
      type: "string",
      describe: "address of Gnosis Safe owning bracketSafes",
      demandOption: true,
    })
    .option("withdrawalFile", {
      type: "string",
      describe: "file name (and path) to the list of withdrawals",
    })
    .option("brackets", {
      type: "string",
      describe:
        "comma-separated list of brackets from which to withdraw the entire balance. Compatible with all valid combinations of --requestWithdraw, --withdraw, --transferFundsToMaster",
      coerce: (str) => {
        return str.split(",")
      },
    })
    .option("tokens", {
      type: "string",
      describe: "comma separated address list of tokens to withdraw, to use in combination with --brackets",
      coerce: (str) => {
        return str.split(",")
      },
    })
    .option("tokenIds", {
      type: "string",
      describe: "comma separated list of exchange ids for the tokens to withdraw, to use in combination with --brackets",
      coerce: (str) => {
        return str.split(",")
      },
    })
    .check(checkBracketsForDuplicate)

  return {
    prepareRequestWithdraw,
    prepareWithdraw,
    defaultWithdrawYargs,
  }
}
