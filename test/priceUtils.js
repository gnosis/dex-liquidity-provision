const BN = require("bn.js")
const assert = require("assert")
const Contract = require("@truffle/contract")
const { prepareTokenRegistration } = require("./test-utils")
const { toErc20Units } = require("../scripts/utils/printing_tools")
const { getOutputAmountFromPrice, isPriceReasonable } = require("../scripts/utils/price-utils")(web3, artifacts)

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
        price: 1/160,
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
        price: 10**30,
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
    const tolerance = new BN(2).pow(new BN(52)) // same tolerance as float precision
    for (const { price, inputAmountString, inputDecimals, outputDecimals, expectedOutputAmountString } of testCases) {
      const inputAmount = toErc20Units(inputAmountString, inputDecimals)
      const expectedOutputAmount = toErc20Units(expectedOutputAmountString, outputDecimals)
      const outputAmount = getOutputAmountFromPrice(price, inputAmount, inputDecimals, outputDecimals)
      const differenceFromExpected = outputAmount.sub(expectedOutputAmount).abs()
      assert(differenceFromExpected.mul(tolerance).lt(expectedOutputAmount))
    }
  })
})

contract("PriceOracle", function(accounts) {
  describe("Price oracle sanity check", async () => {
    it("checks that price is within reasonable range (10 ≤ price ≤ 1990)", async () => {
      //the following test especially checks that the price p is not inverted (1/p) and is not below 1

      const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
      BatchExchange.setProvider(web3.currentProvider)
      BatchExchange.setNetwork(web3.network_id)
      const exchange = await BatchExchange.deployed()

      const ERC20 = artifacts.require("DetailedMintableToken")
      const token1 = await ERC20.new("WETH", 18)
      const token2 = await ERC20.new("DAI", 18)
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(token1.address, { from: accounts[0] })
      await prepareTokenRegistration(accounts[0], exchange)
      await exchange.addToken(token2.address, { from: accounts[0] })
      const targetTokenId = 1
      const stableTokenId = 2
      const acceptedPriceDeviationInPercentage = 99
      const price = 1000
      assert(await isPriceReasonable(exchange, targetTokenId, stableTokenId, price, acceptedPriceDeviationInPercentage))
    })
  })
})
