const BN = require("bn.js")
const assert = require("assert")
const Contract = require("@truffle/contract")

const { addCustomMintableTokenToExchange } = require("./test_utils")
const { isPriceReasonable, checkNoProfitableOffer, amountUSDValue } = require("../scripts/utils/price_utils")
const { fetchTokenInfoFromExchange } = require("../scripts/utils/trading_strategy_helpers")(web3, artifacts)

contract("PriceOracle", function (accounts) {
  let exchange
  beforeEach(async function () {
    const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
    BatchExchange.setProvider(web3.currentProvider)
    exchange = await BatchExchange.deployed()
  })
  describe("Price oracle sanity check", async () => {
    it("checks that price is within reasonable range (10 ≤ price ≤ 1990)", async () => {
      // The following test especially checks that the price p is not inverted (1/p) and is not below 1
      const acceptedPriceDeviationInPercentage = 99
      const price = 1000
      const quoteTokenData = { symbol: "WETH", decimals: 18 }
      const baseTokenData = { symbol: "DAI", decimals: 18 }
      assert(await isPriceReasonable(baseTokenData, quoteTokenData, price, acceptedPriceDeviationInPercentage))
    })
    it("checks that price is within reasonable range (10 ≤ price ≤ 1990) for tokens with different decimals", async () => {
      //the following test especially checks that the price p is not inverted (1/p) and is not below 1
      const acceptedPriceDeviationInPercentage = 99
      const price = 1000
      const quoteTokenData = { symbol: "WETH", decimals: 18 }
      const baseTokenData = { symbol: "USDC", decimals: 6 }
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
      globalPriceStorage["DAI-USDC"] = { price: 1.0 }
      globalPriceStorage["WETH-DAI"] = { price: 1 / 120.0 }
      globalPriceStorage["WETH-USDC"] = { price: 1 / 120.0 }

      const tokenInfo = fetchTokenInfoFromExchange(exchange, [DAItokenId, WETHtokenId])
      assert.equal(
        await checkNoProfitableOffer(orders[0], tokenInfo, globalPriceStorage),
        true,
        "Amount should have been negligible"
      )
      assert.equal(await checkNoProfitableOffer(orders[1], tokenInfo, globalPriceStorage), true)
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
      globalPriceStorage["USDC-USDC"] = { price: 1.0 }
      globalPriceStorage["DAI-USDC"] = { price: 1.0 }
      const tokenInfo = fetchTokenInfoFromExchange(exchange, [DAItokenId, USDCtokenId])
      assert.equal(await checkNoProfitableOffer(orders[0], tokenInfo, globalPriceStorage), true)
      assert.equal(
        await checkNoProfitableOffer(orders[1], tokenInfo, globalPriceStorage),
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
      globalPriceStorage["USDC-USDC"] = { price: 1.0 }
      globalPriceStorage["DAI-USDC"] = { price: 1.0 }

      const tokenInfo = fetchTokenInfoFromExchange(exchange, [DAItokenId, USDCtokenId])
      assert.equal(
        await checkNoProfitableOffer(orders[0], tokenInfo, globalPriceStorage),
        false,
        "Price should have been profitable for others"
      )
      assert.equal(
        await checkNoProfitableOffer(orders[1], tokenInfo, globalPriceStorage),
        true,
        "Amount should have been negligible"
      )
    })
  })

  describe("amountUSDValue()", async () => {
    it("Ensures function returns expected values", async () => {
      const DAItokenId = (await addCustomMintableTokenToExchange(exchange, "DAI", 18, accounts[0])).id
      const XYZtokenId = (await addCustomMintableTokenToExchange(exchange, "XYZ", 8, accounts[0])).id
      const GEMtokenId = (await addCustomMintableTokenToExchange(exchange, "GEM", 2, accounts[0])).id

      const tokenInfo = fetchTokenInfoFromExchange(exchange, [DAItokenId, XYZtokenId, GEMtokenId])
      const globalPriceStorage = {}

      globalPriceStorage["DAI-USDC"] = { price: 2.0 }
      globalPriceStorage["XYZ-USDC"] = { price: 250.0 }
      globalPriceStorage["GEM-USDC"] = { price: 3.5 }

      const DAIvalue = await amountUSDValue("1000000000000000000", await tokenInfo[DAItokenId], globalPriceStorage)
      const XYZvalue = await amountUSDValue("100000000", await tokenInfo[XYZtokenId], globalPriceStorage)
      const GEMvalue = await amountUSDValue("100", await tokenInfo[GEMtokenId], globalPriceStorage)

      assert(DAIvalue.eq(new BN(2)))
      assert(XYZvalue.eq(new BN(250)))
      // Note that it should really be 3.5, but BN only works with integers.
      assert(GEMvalue.eq(new BN(3)))
    })
  })
})
