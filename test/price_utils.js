const BN = require("bn.js")
const assert = require("assert")
const Contract = require("@truffle/contract")

const { toErc20Units } = require("../scripts/utils/printing_tools")
const { addCustomMintableTokenToExchange } = require("./test_utils")
const {
  getOutputAmountFromPrice,
  getUnlimitedOrderAmounts,
  isPriceReasonable,
  checkNoProfitableOffer,
} = require("../scripts/utils/price_utils")(web3, artifacts)
const { fetchTokenInfoFromExchange } = require("../scripts/utils/trading_strategy_helpers")(web3, artifacts)
const { MAXUINT128, FLOAT_TOLERANCE } = require("../scripts/utils/constants")

const assertEqualUpToFloatPrecision = function (value, expected) {
  const differenceFromExpected = value.sub(expected).abs()
  assert(differenceFromExpected.mul(FLOAT_TOLERANCE).lt(expected))
}

describe("getOutputAmountFromPrice", () => {
  it("computes the right output amount", () => {
    const testCases = [
      {
        price: 160,
        inputAmountString: "1",
        inputDecimals: 18,
        outputDecimals: 6,
        expectedOutputAmountString: "160",
      },
      {
        price: 1 / 160,
        inputAmountString: "160",
        inputDecimals: 6,
        outputDecimals: 18,
        expectedOutputAmountString: "1",
      },
      {
        price: 0.000125,
        inputAmountString: "8000",
        inputDecimals: 8,
        outputDecimals: 18,
        expectedOutputAmountString: "1",
      },
      {
        price: 10 ** 30,
        inputAmountString: "0.000000000000000000000001", // 10**-24
        inputDecimals: 100,
        outputDecimals: 1,
        expectedOutputAmountString: "1000000",
      },
      {
        price: 10.1,
        inputAmountString: "1",
        inputDecimals: 0,
        outputDecimals: 70,
        expectedOutputAmountString: "10.1",
      },
    ]
    for (const { price, inputAmountString, inputDecimals, outputDecimals, expectedOutputAmountString } of testCases) {
      const inputAmount = toErc20Units(inputAmountString, inputDecimals)
      const expectedOutputAmount = toErc20Units(expectedOutputAmountString, outputDecimals)
      const outputAmount = getOutputAmountFromPrice(price, inputAmount, inputDecimals, outputDecimals)
      assertEqualUpToFloatPrecision(outputAmount, expectedOutputAmount)
    }
  })
})

describe("getUnlimitedOrderAmounts", () => {
  it("computes the amounts needed to set up an unlimited order", () => {
    const testCases = [
      {
        price: 160,
        quoteTokenDecimals: 18,
        baseTokenDecimals: 18,
        expectedQuoteTokenAmount: MAXUINT128,
        expectedbaseTokenAmount: MAXUINT128.divn(160),
      },
      {
        price: 1 / 160,
        quoteTokenDecimals: 18,
        baseTokenDecimals: 18,
        expectedQuoteTokenAmount: MAXUINT128.divn(160),
        expectedbaseTokenAmount: MAXUINT128,
      },
      {
        price: 1,
        quoteTokenDecimals: 18,
        baseTokenDecimals: 18,
        expectedQuoteTokenAmount: MAXUINT128,
        expectedbaseTokenAmount: MAXUINT128,
      },
      {
        price: 1 + Number.EPSILON,
        quoteTokenDecimals: 18,
        baseTokenDecimals: 18,
        expectedQuoteTokenAmount: MAXUINT128,
        expectedbaseTokenAmount: MAXUINT128.sub(new BN(2).pow(new BN(128 - 52))),
      },
      {
        price: 1 - Number.EPSILON,
        quoteTokenDecimals: 18,
        baseTokenDecimals: 18,
        expectedQuoteTokenAmount: MAXUINT128.sub(new BN(2).pow(new BN(128 - 52))),
        expectedbaseTokenAmount: MAXUINT128,
      },
      {
        price: 100,
        quoteTokenDecimals: 165,
        baseTokenDecimals: 200,
        expectedQuoteTokenAmount: MAXUINT128.div(new BN(10).pow(new BN(200 - 165 - 2))),
        expectedbaseTokenAmount: MAXUINT128,
      },
      {
        price: 100,
        quoteTokenDecimals: 200,
        baseTokenDecimals: 165,
        expectedQuoteTokenAmount: MAXUINT128,
        expectedbaseTokenAmount: MAXUINT128.div(new BN(10).pow(new BN(200 - 165 + 2))),
      },
    ]
    for (const {
      price,
      quoteTokenDecimals,
      baseTokenDecimals,
      expectedQuoteTokenAmount,
      expectedbaseTokenAmount,
    } of testCases) {
      const [baseTokenAmount, quoteTokenAmount] = getUnlimitedOrderAmounts(price, baseTokenDecimals, quoteTokenDecimals)
      assertEqualUpToFloatPrecision(quoteTokenAmount, expectedQuoteTokenAmount)
      assertEqualUpToFloatPrecision(baseTokenAmount, expectedbaseTokenAmount)
    }
  })
})

contract("PriceOracle", function (accounts) {
  let exchange
  beforeEach(async function () {
    // Create lightwallet
    const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
    BatchExchange.setProvider(web3.currentProvider)
    exchange = await BatchExchange.deployed()
  })
  describe("Price oracle sanity check", async () => {
    it("checks that price is within reasonable range (10 ≤ price ≤ 1990)", async () => {
      //the following test especially checks that the price p is not inverted (1/p) and is not below 1
      const acceptedPriceDeviationInPercentage = 99
      const price = 1000
      const baseTokenData = { symbol: "WETH" }
      const quoteTokenData = { symbol: "DAI" }
      assert(await isPriceReasonable(baseTokenData, quoteTokenData, price, acceptedPriceDeviationInPercentage))
    })
    it("checks that bracket traders does not sell unprofitable for tokens with the same decimals", async () => {
      const WETHtokenId = (await addCustomMintableTokenToExchange(exchange, "WETH", 18, accounts[0])).id
      const DAItokenId = (await addCustomMintableTokenToExchange(exchange, "DAI", 18, accounts[0])).id

      const orders = [
        {
          // normal order selling for more than 120 DAI per WETH
          user: "0xf888243aacb5626b520d0028371bad672a477fd8",
          sellTokenBalance: new BN(0),
          buyToken: WETHtokenId,
          sellToken: DAItokenId,
          priceNumerator: new BN("1").mul(new BN(10).pow(new BN(18))),
          priceDenominator: new BN("115").mul(new BN(10).pow(new BN(18))),
        },
        {
          // normal order selling for more than 120 DAI per WETH
          user: "0xf888243aacb5626b520d0028371bad672a477fd8",
          sellTokenBalance: new BN("125").mul(new BN(10).pow(new BN(18))),
          buyToken: DAItokenId,
          sellToken: WETHtokenId,
          priceNumerator: new BN("132").mul(new BN(10).pow(new BN(18))),
          priceDenominator: new BN("1").mul(new BN(10).pow(new BN(18))),
        },
      ]

      const globalPriceStorage = {}
      globalPriceStorage["DAI-USDC"] = 1.0
      globalPriceStorage["WETH-DAI"] = 1 / 120.0
      globalPriceStorage["WETH-USDC"] = 1 / 120.0

      const tokenInfo = fetchTokenInfoFromExchange(exchange, [DAItokenId, WETHtokenId])
      assert.equal(
        await checkNoProfitableOffer(orders[0], exchange, tokenInfo, globalPriceStorage),
        true,
        "Amount should have been negligible"
      )
      assert.equal(await checkNoProfitableOffer(orders[1], exchange, tokenInfo, globalPriceStorage), true)
    })
    it("checks that bracket traders does not sell unprofitable for tokens with the different decimals", async () => {
      const DAItokenId = (await addCustomMintableTokenToExchange(exchange, "DAI", 18, accounts[0])).id
      const USDCtokenId = (await addCustomMintableTokenToExchange(exchange, "USDC", 6, accounts[0])).id

      const orders = [
        {
          // normal order selling for more than 1
          user: "0x4c7281e2bd549a0aea492b28ef60e3d81fed36e6",
          sellTokenBalance: new BN("24719283572357"),
          buyToken: DAItokenId,
          sellToken: USDCtokenId,
          priceNumerator: new BN("101").mul(new BN(10).pow(new BN(18))),
          priceDenominator: new BN("100").mul(new BN(10).pow(new BN(6))),
        },
        {
          // normal order selling for more than 1
          user: "0x4c7281e2bd549a0aea492b28ef60e3d81fed36e6",
          sellTokenBalance: new BN("0"),
          buyToken: USDCtokenId,
          sellToken: DAItokenId,
          priceNumerator: new BN("101").mul(new BN(10).pow(new BN(6))),
          priceDenominator: new BN("100").mul(new BN(10).pow(new BN(18))),
        },
      ]

      const globalPriceStorage = {}
      globalPriceStorage["USDC-USDC"] = 1.0
      globalPriceStorage["DAI-USDC"] = 1.0
      const tokenInfo = fetchTokenInfoFromExchange(exchange, [DAItokenId, USDCtokenId])
      assert.equal(await checkNoProfitableOffer(orders[0], exchange, tokenInfo, globalPriceStorage), true)
      assert.equal(
        await checkNoProfitableOffer(orders[1], exchange, tokenInfo, globalPriceStorage),
        true,
        "Amount should have been negligible"
      )
    })
    it("detects unprofitable orders for tokens with different decimals", async () => {
      const DAItokenId = (await addCustomMintableTokenToExchange(exchange, "DAI", 18, accounts[0])).id
      const USDCtokenId = (await addCustomMintableTokenToExchange(exchange, "USDC", 6, accounts[0])).id

      const orders = [
        {
          // order is profitable for others
          user: "0x4c7281e2bd549a0aea492b28ef60e3d81fed36e6",
          sellTokenBalance: new BN("24719283572357"),
          buyToken: DAItokenId, // buy and sell tokens are changed in comparison to previous example
          sellToken: USDCtokenId,
          priceNumerator: new BN("99").mul(new BN(10).pow(new BN(18))),
          priceDenominator: new BN("100").mul(new BN(10).pow(new BN(6))),
        },
        {
          // order is profitable for others, but balance is 0
          user: "0x4c7281e2bd549a0aea492b28ef60e3d81fed36e6",
          sellTokenBalance: new BN("0"),
          buyToken: DAItokenId,
          sellToken: USDCtokenId,
          priceNumerator: new BN("101").mul(new BN(10).pow(new BN(18))),
          priceDenominator: new BN("100").mul(new BN(10).pow(new BN(6))),
        },
      ]

      const globalPriceStorage = {}
      globalPriceStorage["USDC-USDC"] = 1.0
      globalPriceStorage["DAI-USDC"] = 1.0

      const tokenInfo = fetchTokenInfoFromExchange(exchange, [DAItokenId, USDCtokenId])
      assert.equal(
        await checkNoProfitableOffer(orders[0], exchange, tokenInfo, globalPriceStorage),
        false,
        "Price should have been profitable for others"
      )
      assert.equal(
        await checkNoProfitableOffer(orders[1], exchange, tokenInfo, globalPriceStorage),
        true,
        "Amount should have been negligible"
      )
    })
  })
})
