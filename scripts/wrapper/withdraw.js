module.exports = function (web3, artifacts) {
  const fs = require("fs").promises
  const { getWithdrawableAmount } = require("@gnosis.pm/dex-contracts")
  const { amountUSDValue } = require("../utils/price_utils")
  const {
    getExchange,
    fetchTokenInfoAtAddresses,
    fetchTokenInfoForFlux,
    buildWithdrawRequest,
    buildWithdrawClaim,
    buildTransferFundsToMaster,
    buildWithdrawAndTransferFundsToMaster,
    retrieveTradedTokensPerBracket,
  } = require("../utils/trading_strategy_helpers")(web3, artifacts)
  const { default_yargs, checkBracketsForDuplicate } = require("../utils/default_yargs")
  const { fromErc20Units, shortenedAddress } = require("../utils/printing_tools")
  const { MAXUINT256, ONE } = require("../utils/constants")
  const { uniqueItems } = require("../utils/js_helpers")

  const assertGoodArguments = function (argv) {
    if (!argv.masterSafe) throw new Error("Argument error: --masterSafe is required")

    if (!argv.withdrawalFile && !argv.brackets) {
      throw new Error("Argument error: one of --withdrawalFile, --brackets must be given")
    } else if (argv.withdrawalFile && argv.brackets) {
      throw new Error("Argument error: --brackets cannot be used with --withdrawalFile")
    }

    if (argv.brackets) {
      if (argv.tokens && argv.tokenIds) {
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
    printOutput = false,
    globalPriceStorage = {}
  ) {
    const log = printOutput ? (...a) => console.log(...a) : () => {}

    if (withdrawalFile) {
      const withdrawals = JSON.parse(await fs.readFile(withdrawalFile, "utf8"))
      const tokenInfoPromises = fetchTokenInfoForFlux(withdrawals)
      return {
        withdrawals,
        tokenInfoPromises,
      }
    }

    const exchangePromise = getExchange(web3)

    let bracketsWithTradedTokenAddresses = []
    let tradedAddressesses = []
    if (!tokens && !tokenIds) {
      const bracketsWithTradedTokenIds = await retrieveTradedTokensPerBracket(brackets)
      const tradedTokenIds = []
      for (const { tokenIds } of bracketsWithTradedTokenIds) {
        tradedTokenIds.push(...tokenIds)
      }
      const idToAddress = {}
      await Promise.all(
        uniqueItems(tradedTokenIds).map(async (tokenId) => {
          idToAddress[tokenId] = await (await exchangePromise).tokenIdToAddressMap(tokenId)
        })
      )
      tradedAddressesses = Object.values(idToAddress)

      bracketsWithTradedTokenAddresses = bracketsWithTradedTokenIds.map(({ bracketAddress, tokenIds }) => ({
        bracketAddress,
        tokenAddresses: tokenIds.map((id) => idToAddress[id]),
      }))
    } else {
      if (!tokens) {
        tradedAddressesses = await Promise.all(tokenIds.map(async (id) => (await exchangePromise).tokenIdToAddressMap(id)))
      } else {
        tradedAddressesses = tokens
      }
      for (const bracketAddress of brackets) {
        bracketsWithTradedTokenAddresses.push({
          bracketAddress,
          tokenAddresses: tradedAddressesses,
        })
      }
    }

    const withdrawals = []
    const tokenInfoPromises = fetchTokenInfoAtAddresses(tradedAddressesses)
    log("Retrieving amount of tokens to withdraw.")
    await Promise.all(
      bracketsWithTradedTokenAddresses.map(({ bracketAddress, tokenAddresses }) =>
        Promise.all(
          tokenAddresses.map(async (tokenAddress) => {
            const tokenData = await tokenInfoPromises[tokenAddress]
            const amount = await amountFunction(bracketAddress, tokenData, await exchangePromise)
            // skip costly network request if amount is zero
            if (amount === "0") {
              return
            }
            const usdValue = await amountUSDValue(amount, tokenData, globalPriceStorage)

            if (usdValue.gte(ONE)) {
              withdrawals.push({
                bracketAddress,
                tokenAddress,
                amount,
              })
            } else {
              log(`Skipping request for ${tokenData.symbol} on bracket ${bracketAddress} since USD value < 1`)
            }
          })
        )
      )
    )

    return {
      withdrawals,
      tokenInfoPromises,
    }
  }

  const prepareWithdrawRequest = async function (argv, printOutput = false, globalPriceStorage = {}) {
    const log = printOutput ? (...a) => console.log(...a) : () => {}

    assertGoodArguments(argv)

    let amountFunction
    if (argv.noBalanceCheck) {
      amountFunction = function () {
        return MAXUINT256.toString()
      }
    } else {
      amountFunction = async function (bracketAddress, tokenData, exchange) {
        const amount = (await exchange.getBalance(bracketAddress, tokenData.address)).toString()
        const usdValue = await amountUSDValue(amount, tokenData, globalPriceStorage)
        if (usdValue.gte(ONE)) {
          return MAXUINT256.toString()
        } else {
          return "0"
        }
      }
    }
    const { withdrawals, tokenInfoPromises } = await getWithdrawalsAndTokenInfo(
      amountFunction,
      argv.withdrawalFile,
      argv.brackets,
      argv.tokens,
      argv.tokenIds,
      printOutput,
      globalPriceStorage
    )

    log("Started building withdraw transaction.")
    const transactionPromise = buildWithdrawRequest(argv.masterSafe, withdrawals)

    for (const withdrawal of withdrawals) {
      const { symbol: tokenSymbol } = await tokenInfoPromises[withdrawal.tokenAddress]

      log(`Requesting withdrawal of all ${tokenSymbol} from BatchExchange on behalf of Safe ${withdrawal.bracketAddress}`)
    }

    return transactionPromise
  }
  const prepareWithdraw = async function (argv, printOutput = false, globalPriceStorage = {}) {
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
      printOutput,
      globalPriceStorage
    )

    log("Started building withdraw transaction.")
    const transactionPromise = buildWithdrawClaim(argv.masterSafe, withdrawals)

    for (const withdrawal of withdrawals) {
      const { symbol: tokenSymbol, decimals: tokenDecimals } = await tokenInfoPromises[withdrawal.tokenAddress]

      const userAmount = fromErc20Units(withdrawal.amount, tokenDecimals)
      log(`Withdrawing ${userAmount} ${tokenSymbol} from BatchExchange on behalf of Safe ${withdrawal.bracketAddress}`)
    }

    return transactionPromise
  }
  const prepareTransferFundsToMaster = async function (argv, printOutput = false, globalPriceStorage = {}) {
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
      printOutput,
      globalPriceStorage
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
  const prepareWithdrawAndTransferFundsToMaster = async function (argv, printOutput = false, globalPriceStorage = {}) {
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
      printOutput,
      globalPriceStorage
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
    prepareWithdrawRequest,
    prepareWithdraw,
    prepareWithdrawAndTransferFundsToMaster,
    prepareTransferFundsToMaster,
    defaultWithdrawYargs,
  }
}
