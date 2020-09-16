const createTokenAndGetData = async function (symbol, decimals) {
  const tokenData = {
    decimals: decimals,
    symbol: symbol,
  }
  const TestToken = artifacts.require("DetailedMintableToken")
  const token = await TestToken.new(symbol, decimals)
  tokenData.address = token.address
  tokenData.instance = token
  return { address: token.address, tokenData: tokenData }
}

/**
 * Creates a price storage with dummy prices for the input tokens.
 * Used to make less network requests during testing.
 *
 * @returns {object} a price storage that assigns a dummy price (-1) to every pair of input tokens
 */
const populatePriceStorage = function () {
  const DUMMY_PRICE = -1
  const DEFAULT_USD_REFERENCE_TOKEN = "USDC"
  const MOCK_SLICE = {
    price: DUMMY_PRICE,
    source: "mocked in test",
  }

  const priceStorage = {}
  for (let firstTokenIndex = 0; firstTokenIndex < arguments.length; firstTokenIndex++) {
    for (let secondTokenIndex = firstTokenIndex + 1; secondTokenIndex < arguments.length; secondTokenIndex++) {
      priceStorage[arguments[firstTokenIndex] + "-" + arguments[secondTokenIndex]] = { ...MOCK_SLICE }
    }
  }

  if (!(DEFAULT_USD_REFERENCE_TOKEN in arguments)) {
    for (const token of arguments) {
      priceStorage[token + "-" + DEFAULT_USD_REFERENCE_TOKEN] = { ...MOCK_SLICE }
    }
  }

  return priceStorage
}

/**
 * Decodes a ProxyCreation raw event from GnosisSafeProxyFactory and tests it for validity.
 *
 * @param {any} rawEvent bytes of an event emmited from GnosisSafeProxyFactory
 * @returns {Address} the address of the newly created proxy.
 */
const decodeCreateProxy = function (rawEvent) {
  const { data, topics } = rawEvent
  const eventSignature = web3.eth.abi.encodeEventSignature("ProxyCreation(address)")
  if (topics[0] !== eventSignature) {
    throw new Error("Input raw event is not a CreateProxy event")
  }
  const decoded = web3.eth.abi.decodeLog(
    [
      {
        type: "address",
        name: "proxy",
      },
    ],
    data,
    topics
  )
  return decoded.proxy
}

module.exports = {
  createTokenAndGetData,
  populatePriceStorage,
  decodeCreateProxy,
}
