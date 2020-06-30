const BN = require("bn.js")
const { getWithdrawableAmount, decodeOrders } = require("@gnosis.pm/dex-contracts")

const { getExchange, getDeployedBrackets, fetchTokenInfoFromExchange } = require("./utils/trading_strategy_helpers")(
  web3,
  artifacts
)
const { default_yargs, checkBracketsForDuplicate } = require("./utils/default_yargs")
const { fromErc20Units } = require("./utils/printing_tools")
const { uniqueItems } = require("./utils/js_helpers")

const argv = default_yargs
  .option("masterSafe", {
    type: "string",
    describe: "address of Gnosis Safe whose brackets will be retrieved",
  })
  .option("brackets", {
    type: "string",
    describe: "comma-separated list of brackets to retrieve information about. Will be ignored if --masterSafe is provided",
    coerce: (str) => {
      return str.split(",")
    },
  })
  .check(checkBracketsForDuplicate).argv

const buildOptionalString = function ({ tokenData, requestedForWithdraw, storedInBracket }) {
  const optionalStringAwaitingWithdraw = requestedForWithdraw.isZero()
    ? ""
    : `${fromErc20Units(requestedForWithdraw, tokenData.decimals)} awaiting to be withdrawn`
  const optionalStringStoredInBracket = storedInBracket.isZero()
    ? ""
    : `${fromErc20Units(storedInBracket, tokenData.decimals)} directly stored in the bracket(s)`
  const bothOptionalStrings = !requestedForWithdraw.isZero() && !storedInBracket.isZero()
  const onlyOneOptionalStrings = !(requestedForWithdraw.isZero() == storedInBracket.isZero())
  let fullOptionalString = ""
  if (bothOptionalStrings) {
    fullOptionalString = ` (of which ${optionalStringAwaitingWithdraw} and ${optionalStringStoredInBracket})`
  } else if (onlyOneOptionalStrings) {
    fullOptionalString = ` (of which ${optionalStringAwaitingWithdraw}${optionalStringStoredInBracket})`
  }
  return fullOptionalString
}

module.exports = async (callback) => {
  try {
    const exchangePromise = getExchange(web3)
    let bracketAddressesPromise
    if (argv.masterSafe) {
      bracketAddressesPromise = getDeployedBrackets(argv.masterSafe)
    } else {
      if (!argv.brackets) {
        callback("One of --masterSafe or --brackets=... is required.")
      }
      bracketAddressesPromise = Promise.resolve(argv.brackets)
    }
    const exchange = await exchangePromise

    const detailedBrackets = await Promise.all(
      (await bracketAddressesPromise).map(async (bracketAddress) => {
        const orders = decodeOrders(await exchange.getEncodedUserOrders.call(bracketAddress))
        let tradedTokenIds = []
        for (const order of orders) {
          tradedTokenIds.push(order.buyToken, order.sellToken)
        }
        tradedTokenIds = uniqueItems(tradedTokenIds)
        const tokenInfoPromises = fetchTokenInfoFromExchange(exchange, tradedTokenIds)
        return {
          bracketAddress,
          tokenIds: tradedTokenIds,
          tokenInfoPromises,
        }
      })
    )

    const tokenBalancesPerUser = await Promise.all(
      detailedBrackets.map(async ({ bracketAddress, tokenIds, tokenInfoPromises }) => {
        const tokenBalances = []
        for (const tokenId of tokenIds) {
          const tokenData = await tokenInfoPromises[tokenId]
          const [availableForTrading, requestedForWithdraw, storedInBracket] = await Promise.all([
            exchange.getBalance(bracketAddress, tokenData.address),
            getWithdrawableAmount(bracketAddress, tokenData.address, exchange, web3),
            tokenData.instance.balanceOf(bracketAddress),
          ])
          tokenBalances.push({
            bracketAddress: bracketAddress,
            tokenId,
            tokenData,
            totalBalance: availableForTrading.add(requestedForWithdraw).add(storedInBracket),
            availableForTrading,
            requestedForWithdraw,
            storedInBracket,
          })
        }
        return tokenBalances
      })
    )

    const balances = []
    for (const tokenBalances of tokenBalancesPerUser) {
      balances.push(...tokenBalances)
    }

    const totalBalanceSum = {}
    const requestedForWithdrawSum = {}
    const storedInBracketSum = {}
    for (const balanceItem of balances) {
      if (balanceItem.totalBalance.isZero()) {
        continue
      }
      totalBalanceSum[balanceItem.tokenId] = (totalBalanceSum[balanceItem.tokenId] || new BN(0)).add(balanceItem.totalBalance)
      requestedForWithdrawSum[balanceItem.tokenId] = (requestedForWithdrawSum[balanceItem.tokenId] || new BN(0)).add(
        balanceItem.requestedForWithdraw
      )
      storedInBracketSum[balanceItem.tokenId] = (storedInBracketSum[balanceItem.tokenId] || new BN(0)).add(
        balanceItem.storedInBracket
      )
      const tokenData = balanceItem.tokenData
      const optionalString = buildOptionalString({ tokenData, ...balanceItem })
      console.log(
        `Balance of ${balanceItem.bracketAddress} for token ${tokenData.symbol}: ${fromErc20Units(
          balanceItem.totalBalance,
          tokenData.decimals
        )}${optionalString}`
      )
    }

    console.log()
    console.log("Total funds:")
    for (const tokenId in totalBalanceSum) {
      const tokenData = await fetchTokenInfoFromExchange(exchange, [tokenId])[tokenId]
      const optionalString = buildOptionalString({
        tokenData,
        requestedForWithdraw: requestedForWithdrawSum[tokenId],
        storedInBracket: storedInBracketSum[tokenId],
      })
      console.log(
        `Total ${tokenData.symbol} in all brackets: ${fromErc20Units(
          totalBalanceSum[tokenId].toString(),
          tokenData.decimals
        )}${optionalString}`
      )
    }

    callback()
  } catch (error) {
    console.log(error.response)
    callback(error)
  }
}
