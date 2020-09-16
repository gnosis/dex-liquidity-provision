const assert = require("assert")

const { isPriceReasonable, areBoundsReasonable } = require("./price_utils")
const { proceedAnyways } = require("./user_interface_helpers")
const { toErc20Units } = require("./printing_tools")

module.exports = function (web3, artifacts) {
  const { fetchTokenInfoFromExchange, checkSufficiencyOfBalance, getSafe, getExchange } = require("./trading_strategy_helpers")(
    web3,
    artifacts
  )

  /**
   * Takes the input argument for liquidity provision, double checks that everything
   * looks right, and returns values needed to deploy a strategy.
   *
   * @param {object} param function parameters
   * @param {object} param.argv user command-line parameters that define a strategy
   * @param {number} param.maxBrackets maximum number of bracket that fit into a single deployment
   * @returns {object} data needed to deploy liquidity on the exchange
   */
  async function sanitizeArguments({ argv, maxBrackets }) {
    // initialize promises that will be used later in the code to speed up execution
    const exchangePromise = getExchange()
    const masterSafePromise = getSafe(argv.masterSafe)
    const masterSafeNoncePromise =
      argv.nonce === undefined
        ? masterSafePromise.then((masterSafe) => masterSafe.nonce()).then((nonce) => nonce.toNumber())
        : Promise.resolve(argv.nonce)
    const signerPromise = web3.eth.getAccounts().then((accounts) => accounts[0])
    const masterOwnersPromise = masterSafePromise.then((masterSafe) => masterSafe.getOwners())

    const exchange = await exchangePromise
    const tokenInfoPromises = fetchTokenInfoFromExchange(exchange, [argv.baseTokenId, argv.quoteTokenId])
    const baseTokenData = await tokenInfoPromises[argv.baseTokenId]
    const quoteTokenData = await tokenInfoPromises[argv.quoteTokenId]
    const { instance: baseToken, decimals: baseTokenDecimals } = baseTokenData
    const { instance: quoteToken, decimals: quoteTokenDecimals } = quoteTokenData
    const depositBaseToken = toErc20Units(argv.depositBaseToken, baseTokenDecimals)
    const depositQuoteToken = toErc20Units(argv.depositQuoteToken, quoteTokenDecimals)

    const hasSufficientBaseTokenPromise = checkSufficiencyOfBalance(baseToken, argv.masterSafe, depositBaseToken)
    const hasSufficientQuoteTokenPromise = checkSufficiencyOfBalance(quoteToken, argv.masterSafe, depositQuoteToken)
    const isPriceCloseToOnlineSourcePromise = isPriceReasonable(baseTokenData, quoteTokenData, argv.currentPrice)

    const signer = await signerPromise
    if (!argv.verify) {
      assert((await masterOwnersPromise).includes(signer), `Please ensure signer account ${signer} is an owner of masterSafe`)
    }

    console.log("==> Performing safety checks")
    if (!(await hasSufficientBaseTokenPromise)) {
      throw new Error(`MasterSafe ${argv.masterSafe} has insufficient balance for base token ${baseToken.address}`)
    }
    if (!(await hasSufficientQuoteTokenPromise)) {
      throw new Error(`MasterSafe ${argv.masterSafe} has insufficient balance for quote token ${quoteToken.address}`)
    }

    // check price against external price API
    if (!(await isPriceCloseToOnlineSourcePromise)) {
      if (!(await proceedAnyways("Price check failed!"))) {
        throw new Error("Price checks did not pass")
      }
    }
    const areBoundsTooSpreadOut = areBoundsReasonable(argv.currentPrice, argv.lowestLimit, argv.highestLimit)
    if (!areBoundsTooSpreadOut) {
      if (!(await proceedAnyways("Bound checks failed!"))) {
        throw new Error("Bound checks did not pass")
      }
    }
    if (argv.numBrackets > maxBrackets) {
      throw new Error("Error: Choose a smaller numBrackets, otherwise your transaction would be too large.")
    }

    return {
      exchange,
      masterSafe: await masterSafePromise,
      masterSafeNonce: await masterSafeNoncePromise,
      signer,
      depositBaseToken,
      depositQuoteToken,
      baseTokenData,
      quoteTokenData,
    }
  }

  return {
    sanitizeArguments,
  }
}
