const assert = require("assert")
<<<<<<< HEAD
const BN = require("bn.js")

const Contract = require("@truffle/contract")
const { prepareTokenRegistration, addCustomMintableTokenToExchange } = require("./test-utils")
const { isPriceReasonable, checkNoProfitableOffer } = require("../scripts/utils/price-utils")(web3, artifacts)
const ERC20 = artifacts.require("DetailedMintableToken")
contract("PriceOracle", function(accounts) {
  let exchange
  beforeEach(async function() {
    // Create lightwallet
    // TODO - can we just use accounts provided by ganache?
    const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
    BatchExchange.setProvider(web3.currentProvider)
    BatchExchange.setNetwork(web3.network_id)
    exchange = await BatchExchange.deployed()
  })
  describe("Price oracle sanity check", async () => {
    it("checks that price is within reasonable range (10 ≤ price ≤ 1990)", async () => {
      //the following test especially checks that the price p is not inverted (1/p) and is not below 1

      const token1 = await ERC20.new("WETH", 18)
      const token2 = await ERC20.new("DAI", 18)

      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(token1.address, { from: accounts[0] })
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(token2.address, { from: accounts[0] })
      const targetTokenId = 1
      const stableTokenId = 2
=======
const { isPriceReasonable } = require("../scripts/utils/price-utils")(web3, artifacts)

contract("PriceOracle", function() {
  describe("Price oracle sanity check", async () => {
    it("checks that price is within reasonable range (10 ≤ price ≤ 1990)", async () => {
      //the following test especially checks that the price p is not inverted (1/p) and is not below 1
>>>>>>> master
      const acceptedPriceDeviationInPercentage = 99
      const price = 1000
      const targetTokenData = { symbol: "WETH" }
      const stableTokenData = { symbol: "DAI" }
      assert(await isPriceReasonable(targetTokenData, stableTokenData, price, acceptedPriceDeviationInPercentage))
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

      assert.equal(
        await checkNoProfitableOffer(orders[0], exchange, globalPriceStorage),
        true,
        "Amount should have been negligible"
      )
      assert.equal(await checkNoProfitableOffer(orders[1], exchange, globalPriceStorage), true)
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
      assert.equal(await checkNoProfitableOffer(orders[0], exchange, globalPriceStorage), true)
      assert.equal(
        await checkNoProfitableOffer(orders[1], exchange, globalPriceStorage),
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

      assert.equal(
        await checkNoProfitableOffer(orders[0], exchange, globalPriceStorage),
        false,
        "Price should have been profitable for others"
      )
      assert.equal(
        await checkNoProfitableOffer(orders[1], exchange, globalPriceStorage),
        true,
        "Amount should have been negligible"
      )
    })
  })
})
